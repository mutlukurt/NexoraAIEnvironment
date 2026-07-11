/**
 * Llama servis katmanı — CEPHE (facade).
 *
 * Asıl çıkarım iki motordan biriyle koşar (bkz. engineTypes.ts):
 *  - llamaServerEngine (varsayılan): llama.cpp'nin resmi sunucusu.
 *    Prompt cache sayesinde iterasyon turları ortak öneki yeniden işlemez.
 *  - llamaWorkerEngine (yedek): node-llama-cpp worker'ı. Sunucu binary'si
 *    edinilemezse ya da hiçbir konfigürasyonla başlamazsa devreye girer.
 *
 * Bu modül profil seçimi, model-boyutuna uyarlı sistem prompt'u ve UPDATE
 * modu sarmalayıcısından sorumludur; motorlar yalnızca "yükle/üret" bilir.
 */
import { basename, join } from 'path'
import { stat, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { nativeImage } from 'electron'
import type { ChatSendInput, ModelLoadedInfo } from '../shared/ipc'
import {
  DEFAULT_PROFILE_ID,
  detectProfile,
  buildSystemPrompt,
  getProfile,
  detectAgentIntent,
  AGENT_HINT,
  UPDATE_MODE_RULES,
  FIDELITY_RULES,
  chatSystemPrompt,
  frontierBuildSystemPrompt,
  frontierEditSystemPrompt
} from '../shared/prompts'
import type { InferenceEngine, LoadProgressCallback, PromptOptions } from './engineTypes'
import { toolsForPrompt as mcpToolsForPrompt } from './mcpService'
import { serverEngine } from './llamaServerEngine'
import { workerEngine } from './llamaWorkerEngine'
import { buildFileGrammar, buildPlanGrammar } from '../shared/editGrammar'
import { shouldUseApi, promptApi, getLastApiUsage, hasApiOverride } from './apiEngine'
import { getLastServerUsage } from './llamaServerEngine'
import type { UsageSample } from '../shared/ipc'
import { appendRepairLog } from './agentService'

export type { LoadProgressCallback } from './engineTypes'

let engine: InferenceEngine | null = null
let loadedInfo: ModelLoadedInfo | null = null
let customSystemPrompt = ''
let activeProfileId = DEFAULT_PROFILE_ID
/** ≲8B modeller için kompakt tek-dosya prompt'u kullanılır (9 GB eşiği). */
let smallModel = true
/** Yüklü modelin ailesi (roadmap 2.5) — prompt'a aileye özel not eklenir. */
let activeFamily: import('../shared/prompts').ModelFamily = 'generic'

export function setCustomSystemPrompt(prompt: string): void {
  customSystemPrompt = prompt
}

/**
 * "Kontrol → Anla → Yap": modele bu makinenin GERÇEK ortam gerçeklerini verir ki
 * yolları TAHMİN etmesin (Türkçe sistemde masaüstü ~/Masaüstü, ~/Desktop DEĞİL).
 * xdg-user-dir ile çözülür; yoksa Türkçe/İngilizce yaygın adlar denenir; hiçbiri
 * yoksa o satır atlanır (grant modele "listede yoksa ÖNCE kontrol et" der). Bir kez
 * hesaplanıp cache'lenir.
 */
let cachedEnvNote: string | null = null
function resolveUserDir(xdgName: string, ...candidates: string[]): string | null {
  try {
    const p = execSync(`xdg-user-dir ${xdgName}`, { encoding: 'utf8', timeout: 1500 }).trim()
    if (p && p !== homedir() && existsSync(p)) return p
  } catch {
    /* xdg-user-dir kurulu değil — adaylara düş */
  }
  for (const c of candidates) if (existsSync(c)) return c
  return null
}
export function environmentNote(): string {
  if (cachedEnvNote) return cachedEnvNote
  const home = homedir()
  const plat = process.platform
  const lines: string[] = [
    `- OS: ${plat === 'darwin' ? 'macOS' : plat === 'win32' ? 'Windows' : 'Linux'} (${plat})`,
    `- Home: ${home}`
  ]
  if (plat === 'linux') {
    const desk = resolveUserDir('DESKTOP', join(home, 'Masaüstü'), join(home, 'Desktop'))
    const dl = resolveUserDir('DOWNLOAD', join(home, 'İndirilenler'), join(home, 'Downloads'))
    const docs = resolveUserDir('DOCUMENTS', join(home, 'Belgeler'), join(home, 'Documents'))
    if (desk) lines.push(`- Desktop: ${desk}`)
    if (dl) lines.push(`- Downloads: ${dl}`)
    if (docs) lines.push(`- Documents: ${docs}`)
  } else {
    // macOS/Windows: yerelleştirilmiş klasör adları da fiziksel olarak İngilizce'dir.
    for (const [label, name] of [['Desktop', 'Desktop'], ['Downloads', 'Downloads'], ['Documents', 'Documents']]) {
      const p = join(home, name)
      if (existsSync(p)) lines.push(`- ${label}: ${p}`)
    }
  }
  const shell = process.env.SHELL || (plat === 'win32' ? 'cmd/powershell' : 'bash')
  lines.push(`- Shell: ${shell}`)
  const locale = process.env.LANG || process.env.LC_ALL || ''
  if (locale) lines.push(`- Locale: ${locale}`)
  cachedEnvNote =
    '\n\nENVIRONMENT (real, live values on THIS machine — use these EXACT paths, never guess English defaults like ~/Desktop):\n' +
    lines.join('\n') +
    '\n[RUN] commands execute inside the project folder; use the absolute paths above for anything outside it.'
  return cachedEnvNote
}

export function getActiveProfileId(): string {
  return activeProfileId
}

/** Yüklü modelin ailesi (roadmap 2.5) — selftest/debug için. */
export function getActiveFamily(): import('../shared/prompts').ModelFamily {
  return activeFamily
}

/** Aktif sistem prompt'unun aileye özel not içerip içermediği — debug için. */
export function debugHasFamilyNote(): boolean {
  return /OUTPUT DISCIPLINE/.test(getFullSystemPrompt())
}

function getFullSystemPrompt(): string {
  return buildSystemPrompt(activeProfileId, customSystemPrompt, smallModel, activeFamily)
}

export function isModelLoaded(): boolean {
  return !!loadedInfo && !!engine
}

/**
 * Faz 13 — görsel üretimi motordan geçmez; alışverişi yerel motorun geçmişine
 * elle işle ki sonraki text turunda model "az önce ne yapıldı"yı bilsin.
 * (API yolu bunu apiHistory'deki [Görsel üretildi] iziyle zaten görüyor.)
 */
export function noteImageExchange(userPrompt: string, marker: string): void {
  try {
    engine?.noteExchange?.(userPrompt, marker)
  } catch {
    /* geçmiş işlenemezse sessiz geç — tur akışı bozulmasın */
  }
}

/**
 * Faz 13 — motor geçmişini UI sohbetiyle tohumla: farklı bir yerel model
 * yüklenince / oturum açılınca yeni model önceki konuşmayı bilsin (eskiden
 * motor geçmişi sıfır başlıyordu — model "az önce ne konuştuk"u bilmiyordu).
 */
export function seedEngineHistory(turns: Array<{ role: 'user' | 'assistant'; content: string }>): void {
  try {
    engine?.seedHistory?.(turns)
  } catch {
    /* tohumlanamazsa sessiz geç */
  }
}

/**
 * Görsel bug düzeltmesi: bir görsel dosyasını API multimodal girdisi için
 * data-URL'e çevir. Uzun kenar 1024px'e küçültülür (token + bant tasarrufu;
 * visionService ile aynı yaklaşım); nativeImage başarısızsa ham baytlara düşer.
 */
export async function imageToDataUrl(imagePath: string): Promise<string> {
  let buf: Buffer
  let mime = 'image/png'
  try {
    const img = nativeImage.createFromPath(imagePath)
    const { width, height } = img.getSize()
    if (width === 0) throw new Error('boş görsel')
    const long = Math.max(width, height)
    buf = long > 1024 ? img.resize(width >= height ? { width: 1024 } : { height: 1024 }).toPNG() : img.toPNG()
    if (buf.length === 0) throw new Error('boş PNG')
  } catch {
    buf = await readFile(imagePath)
    const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'png'
    mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
  }
  return `data:${mime};base64,${buf.toString('base64')}`
}

export function getLoadedInfo(): ModelLoadedInfo | null {
  return loadedInfo
}

export async function loadModel(
  modelPath: string,
  enableGpu?: boolean,
  gpuLayers?: number | 'auto',
  onProgress?: LoadProgressCallback
): Promise<ModelLoadedInfo> {
  console.log('[llamaService] loadModel path =', modelPath, 'enableGpu =', enableGpu, 'gpuLayers =', gpuLayers)
  const file = await stat(modelPath)
  // Sistem prompt'u model boyutuna göre seçilir — motora göndermeden ÖNCE.
  smallModel = file.size < 9e9

  // Önceki motor hangisiyse kapat (motor değişimi temiz olsun).
  if (engine) {
    try {
      await engine.unload()
    } catch {
      /* ignore */
    }
  }

  const loadOpts = {
    path: modelPath,
    gpu: !!enableGpu,
    gpuLayers: gpuLayers ?? ('auto' as const),
    systemPrompt: getFullSystemPrompt(),
    onProgress
  }

  // Varsayılan motor: llama-server. Tamamen başarısızsa worker'a düş —
  // kullanıcı hiçbir durumda "motor yok" ile baş başa kalmaz.
  let info
  try {
    info = await serverEngine.load(loadOpts)
    engine = serverEngine
  } catch (serverErr) {
    console.warn(
      '[llamaService] llama-server motoru başarısız, node-llama-cpp worker yedeğine geçiliyor:',
      (serverErr as Error).message
    )
    try {
      info = await workerEngine.load(loadOpts)
      engine = workerEngine
    } catch (workerErr) {
      engine = null
      throw new Error(
        `Model yüklenemedi (${(workerErr as Error).message}). Bellek yetersiz olabilir — daha küçük bir model veya daha düşük quantizasyon (ör. Q4) deneyin.`
      )
    }
  }

  // loadOpts.systemPrompt ÖNCEKİ aileyle kuruldu; yeni model farklı aile
  // olabilir. Hem parametre-sayısı düzeltmesini hem aile değişimini burada
  // toparlayıp gerekiyorsa oturumu doğru prompt'la bir kez yeniden kur.
  let needsReset = false
  if (typeof info.paramCount === 'number' && info.paramCount > 0) {
    const actualSmall = info.paramCount < 13e9
    if (actualSmall !== smallModel) {
      console.log(
        `[llamaService] model ${(info.paramCount / 1e9).toFixed(1)}B parametre — prompt profili düzeltiliyor (small=${actualSmall})`
      )
      smallModel = actualSmall
      needsReset = true
    }
  }
  const newFamily = info.family ?? 'generic'
  if (newFamily !== activeFamily) {
    console.log(`[llamaService] model ailesi: ${newFamily} — aileye özel prompt notu uygulanıyor`)
    activeFamily = newFamily
    needsReset = true
  }
  if (needsReset) await engine.reset(getFullSystemPrompt())

  loadedInfo = {
    name: basename(modelPath),
    path: modelPath,
    sizeBytes: file.size,
    contextSize: info.contextSize,
    gpu: info.gpu,
    gpuLayers: info.gpuLayers,
    totalLayers: info.totalLayers
  }
  console.log('[llamaService] motor =', engine.name)
  return loadedInfo
}

export async function unloadModel(): Promise<void> {
  loadedInfo = null
  if (!engine) return
  try {
    await engine.unload()
  } catch {
    /* motor ölmüş olabilir; sorun değil */
  }
}

export async function resetSession(options?: { resetProfile?: boolean }): Promise<void> {
  if (options?.resetProfile) activeProfileId = DEFAULT_PROFILE_ID
  if (!engine || !loadedInfo) return
  await engine.reset(getFullSystemPrompt())
}

export async function chat(
  input: ChatSendInput,
  onChunk: (token: string) => void
): Promise<string> {
  // 10.13/10.14 — API modeli aktifken YEREL GGUF ŞART DEĞİL. Eskiden burada
  // koşulsuz throw vardı → pure-API sohbet/build "Model yüklenmemiş" hatası
  // veriyordu. Bir API override'ı varsa (kullanıcı açıkça API modeli seçmiş) tur
  // API'ye gider; yerel motor gerekmez.
  if (!isModelLoaded() && !hasApiOverride()) {
    throw new Error('Önce bir model seç (yerel GGUF ya da API modeli).')
  }

  // Proje türüne duyarlı prompt: açık bir sinyal ("electron app", "next.js site"…)
  // mimari profilini değiştirir; yoksa mevcut profil yapışkan kalır.
  // YALNIZCA yeni-istek turlarında: iterasyon/düzelt turunda profil KİLİTLİDİR —
  // canlı testte otomatik hata metnindeki bir kelime profili React Native'e
  // çevirip düzeltme turlarını zehirledi (model 'mobil uygulama yaz' talimatıyla
  // web dosyası yamamaya çalıştı).
  const isIterationTurn =
    (input.currentFiles && input.currentFiles.length > 0) || !!input.expectFile || !!input.expectPlan
  // Sohbet turu proje profili DEĞİŞTİRMEZ: "python nedir?" gibi bir soru
  // aktif projenin profilini FastAPI'ye çevirip oturumu sıfırlamamalı.
  const isProseTurn = !!input.options?.purpose
  const detected =
    isIterationTurn || isProseTurn || input.profileLock ? null : detectProfile(input.prompt)
  if (detected && detected.id !== activeProfileId) {
    activeProfileId = detected.id
    console.log('[NexoraAI] prompt profile ->', getProfile(activeProfileId).label)
    await resetSession()
  }

  let prompt = input.prompt
  // Bağlam diyeti: gösterilmeyen dosyalar listelenir ki model onları yeniden
  // yaratmaya kalkmasın; görsel/asset'ler BİREBİR yolla referanslanır (canlı
  // bug: "assets'teki görseli kullan" turunda model gerçek dosya adını hiç
  // görmeyip picsum yer tutucusu uydurdu).
  const othersNote =
    input.otherPaths && input.otherPaths.length > 0
      ? `\n\nOther existing project files (content not shown — they EXIST, do NOT recreate them. Reference them by these EXACT paths — e.g. use an image asset in <img src> or import it; never invent placeholder URLs when a matching asset exists. Ask the user to mention @file if you need one's content): ${input.otherPaths.join(', ')}`
      : ''
  if (input.currentFiles && input.currentFiles.length > 0) {
    const filesContext = input.currentFiles
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join('\n\n')
    prompt = `Current project files:
${filesContext}${othersNote}

==================================================
UPDATE MODE — the user wants a CHANGE in the existing project.
User request: ${input.prompt}

${UPDATE_MODE_RULES}
==================================================`
  } else if (othersNote) {
    // Proje yalnız binary asset'lerden ibaretken (görsel üretildi → "Assets'e
    // ekle" → ilk build) currentFiles boş kalır; asset listesi yine de gitsin.
    prompt = othersNote.trimStart() + '\n\nUser request: ' + input.prompt
  }

  // Agent ipucu yalnızca istek gerektirdiğinde eklenir — kalıcı olarak sistem
  // prompt'una koymak küçük modellerin şablon satırlarını kopyalamasına yol
  // açıyordu ([FETCH] <url> ... satırlarının dosya olarak üretilmesi vakası).
  // Sohbet/brief turunda hiç eklenmez: soru cevaplanacak, eylem yapılmayacak.
  // Sohbet turu (purpose==='chat') de action isteği taşıyabilir ("vercel yüklü
  // mü kontrol et") — eskiden isProseTurn TÜM purpose'ları (chat+prose) elerdi,
  // böylece sohbette [RUN] yeteneği HİÇ verilmiyordu (model açıklıyordu, yapmıyordu).
  // Artık yalnız 'prose' (yazım/brief) elenir; chat+intent AGENT_HINT alır. Ayrıca
  // chat personasının kendisi (chatSystemPrompt) terminal iznini her sohbet turuna
  // koyar → regex kaçırsa bile güçlü model yine yapar.
  if (input.options?.purpose !== 'prose' && detectAgentIntent(input.prompt)) {
    prompt += '\n\n' + AGENT_HINT
    // 10.1 — bağlı MCP araçları varsa modele bildir. Sunucu yoksa liste boştur
    // (mcp.json yoksa hiç süreç spawn edilmez → sıfır maliyet).
    try {
      const mcpTools = await mcpToolsForPrompt()
      if (mcpTools.length > 0) {
        const lines = mcpTools.map((t) => `[MCP] ${t.server} ${t.tool}${t.description ? '  — ' + t.description : ''}`)
        prompt +=
          '\n\nLOCAL MCP TOOLS (call at most one per line, outside code blocks, with JSON args): ' +
          '[MCP] server tool {"arg":"value"}\nAvailable:\n' +
          lines.join('\n')
      }
    } catch {
      /* MCP bağlantısı bu turu bloklamasın */
    }
  }

  // Kontrol→Anla→Yap: bilgisayar-erişimi muhtemel turlara GERÇEK ortam gerçeklerini
  // (home/masaüstü/… absolut yollar) ekle ki model yol TAHMİN etmesin (~/Desktop
  // yerine ~/Masaüstü). Sohbet / agent-niyeti / düzenleme (mevcut dosya) turları;
  // saf yeni-build ve prose turları hariç (ilgisiz + token gürültüsü).
  if (
    input.options?.purpose !== 'prose' &&
    (input.options?.purpose === 'chat' ||
      detectAgentIntent(input.prompt) ||
      (input.currentFiles !== undefined && input.currentFiles.length > 0))
  ) {
    prompt += environmentNote()
  }

  // FAZ 9.3 — Fidelity build/edit turu: spec'e HARFİYEN uy + __SLOT__
  // token'larını birebir koru. Renderer, Project Contract specificity yüksekse
  // bu bayrağı set eder (prompt zaten tokenize edilmiştir).
  if (input.fidelity) {
    prompt = `${FIDELITY_RULES}\n\n${prompt}`
  }

  // Worker yedek motoru istek-başına sistem prompt'u değiştiremez (oturum
  // node-llama-cpp içinde kod personasıyla kurulu). Sohbet turunda soruyu
  // kısa bir konuşma direktifiyle sarmak oradaki tek koruma.
  if (input.options?.purpose === 'chat' && engine === workerEngine) {
    prompt = detectAgentIntent(input.prompt)
      ? `The user is asking you to DO or CHECK something on their computer/project. Actually do it: write a directive line like "[RUN] <command>" (outside code blocks) to run it in the project folder, then report the REAL result in the user's language. Do NOT just explain how they could do it, and do NOT write files instead of running the command.\n\n${prompt}`
      : `The user is chatting or asking a question — NOT requesting a build. Answer briefly and conversationally in the user's language. No code, no files.\n\n${prompt}`
  }

  // GBNF gramerleri (roadmap 2.1 + 2.2): format örnekleyici seviyesinde
  // zorlanır. Server motoru uygular; worker yok sayar (watchdog orada korur).
  //  - expectFile: planlı üretimde tek-dosya turu — çıktı tam o yola ait
  //    TEK fenced blok olmak zorunda.
  //  - expectPlan: plan turu — "N. yol — açıklama" satırları.
  //  - UPDATE turu: cerrahi düzenleme; SEARCH ≤12 satır, hedef yol yalnızca
  //    gerçekten var olan dosyalar.
  const options: PromptOptions = { ...(input.options ?? {}) }
  // 10.14/10.16 — Frontier persona: bu tur güçlü bir modelle (API VEYA büyük yerel
  // GGUF) yeni build / iterasyon. currentFiles varsa DÜZENLEME, yoksa YENİ build
  // personası. Tek yerde hesaplanır: API yolu apiSys olarak, YEREL yol
  // options.systemOverride olarak kullanır (server motoru tur-başına uygular).
  const frontierSys = input.frontier
    ? input.currentFiles && input.currentFiles.length > 0
      ? frontierEditSystemPrompt(input.options?.answerLang)
      : frontierBuildSystemPrompt(input.options?.answerLang)
    : null
  if (frontierSys) {
    options.systemOverride = frontierSys // server motoru tur-başına uygular
    // Worker yedek motoru (node-llama-cpp) tur-başına sistem prompt'u değiştiremez
    // (oturuma gömülü) → frontier personasını prompt önüne iliştir (chat direktifi
    // gibi). Büyük modeller zaten serverEngine kullanır; bu sadece emniyet.
    if (engine === workerEngine) {
      prompt = `${frontierSys}\n\n=== TASK ===\n${prompt}`
    }
  } else if (input.options?.purpose === 'chat' || input.options?.purpose === 'prose') {
    // Frontier DEĞİL sohbet/brief turu: yerel SERVER motoru da action-capable
    // sohbet personasını kullansın (API yolu apiSys ile zaten kullanıyor). Böylece
    // "vercel kontrol et" gibi istekler yerel modelde de [RUN] ile YAPILIR, kod
    // personasıyla dosya dökülmez. (Worker embedded → yukarıdaki sargı korur.)
    options.systemOverride = chatSystemPrompt(input.options?.answerLang, input.options.purpose)
  }
  // FAZ 9.3 — fidelity bileşen turu: motor geçmişini yalıt. Aksi hâlde model KV
  // geçmişindeki önceki dosyayı (Navbar) sonraki bileşene klonluyor (Hero=Navbar
  // kopyası canlı bug). Her bileşen dilimlenmiş brief'inden bağımsız üretilir.
  if (input.fidelity && input.expectFile) {
    options.isolate = true
  }
  if (input.expectFile) {
    options.grammar = buildFileGrammar(input.expectFile)
  } else if (input.expectPlan) {
    options.grammar = buildPlanGrammar()
  }
  // 10.15 — CERRAHİ DÜZENLEME KALDIRILDI: iterasyon (currentFiles) turunda eskiden
  // buildEditGrammar ile SEARCH/REPLACE formatı ZORLANIRDI. Kaldırıldı — model
  // komple dosya yazar, gramer dayatması yok (zaten API bunu yok sayıyordu, yerel
  // model de tam-dosya yazımıyla daha kararlı).

  // Hibrit API (roadmap 4.1): bu tur bir DÜZELTME turu mu? (otomatik/kullanıcı
  // "düzelt" + derleme/runtime hata metni taşıyan iterasyon turları). Kullanıcı
  // yapılandırdıysa bu turlar frontier modele yönlendirilir — yerel küçük
  // modelin çözemediği keyfi yapı/mantık hataları için Bolt paritesi.
  const isFixTurn =
    !!input.currentFiles &&
    input.currentFiles.length > 0 &&
    /(^|\n)\s*düzelt\b|BUILD ERROR|RUNTIME ERROR|does NOT compile|GÖRSEL denetim/i.test(input.prompt)
  const escalate = !!input.options?.escalate
  // FAZ 9.5 — fidelity build'i escalate ile geldiyse (SpecVerifier fail sonrası
  // tırmanış), 'fix' modunda isFixTurn olmasa da frontier modele yükselt.
  const fidelityEscalate = !!input.fidelity && escalate
  if (shouldUseApi(isFixTurn, escalate, fidelityEscalate)) {
    apiAbort = new AbortController()
    try {
      console.log(`[NexoraAI] tur API motoruna yönlendirildi (hibrit${escalate ? ', tırmanış 5.5' : ' 4.1'})`)
      // Telemetri (5.5): hangi kademe hangi vakayı aldı — zayıf sınıflar saha
      // verisinden çıksın diye her yönlendirme kararı kalıcı günlüğe yazılır.
      void appendRepairLog({ layer: escalate ? 'api-escalated' : 'api-turn' })
      // 10.14 "API UNLEASHED": frontier build turunda 3B kod personası (COMPACT
      // tek-dosya) YERİNE elit çok-dosya frontier personası → güçlü model tam
      // gücünü kullanır (üst düzey modern, çok bileşenli proje).
      // 10.13: sohbet/soru turunda konuşma sistem prompt'u (kod personası değil).
      // 10.14: frontier turunda mevcut dosya varsa DÜZENLEME personası (editörü
      // serbest bırakır), yoksa YENİ build personası. pure-API'de smallModel=true
      // olduğundan getFullSystemPrompt COMPACT 3B veriyordu — burada devre dışı.
      const apiSys = frontierSys
        ? frontierSys
        : input.options?.purpose
        ? chatSystemPrompt(input.options.answerLang, input.options.purpose)
        : getFullSystemPrompt()
      // Görsel bug düzeltmesi: iliştirilmiş referans görsel API'ye DOĞRUDAN
      // (çok-kipli) gider — yerel VL modeli çalıştırılmaz. Renderer yalnız API
      // aktifken imagePath gönderir. Uzun kenar 1024'e küçültülüp base64'lenir.
      let imageDataUrl: string | undefined
      if (input.imagePath) {
        try {
          imageDataUrl = await imageToDataUrl(input.imagePath)
        } catch (e) {
          console.warn('[NexoraAI] görsel okunamadı, metin-only devam:', (e as Error).message)
        }
      }
      // 10.13: uzak model DURUMSUZ — önceki sohbet turlarını + tur-hedefli
      // örneklemeyi (sıcaklık/tavan) de ilet. Yoksa qwen-plus önceki mesajı
      // unutuyor ("hangi konu?") ve 0.1 sıcaklıkta mekanik/kısa kalıyordu.
      const apiText = await promptApi(apiSys, prompt, onChunk, apiAbort.signal, {
        history: input.history,
        temperature: input.options?.temperature,
        maxTokens: input.options?.maxTokens,
        imageDataUrl
      })
      recordTurn('api', prompt.length, apiText.length) // 10.12.2
      return apiText
    } catch (err) {
      // API başarısızsa sessizce yerele düş — kullanıcı asla motorsuz kalmaz.
      console.warn('[NexoraAI] API motoru başarısız, yerele düşülüyor:', (err as Error).message)
      void appendRepairLog({ layer: 'api-fallback-local', diag: (err as Error).message.slice(0, 200) })
    } finally {
      apiAbort = null
    }
  }

  // 10.10 — yerel model yüklü değilse (yalnız API modeli aktifken) ve API branch'e
  // girmediyse/başarısız olduysa net hata ver (engine! çökmesin).
  if (!engine) throw new Error('Model yüklü değil ve API turu başarısız oldu.')
  const localText = await engine.prompt(prompt, options, onChunk)
  recordTurn(engine === serverEngine ? 'server' : 'worker', prompt.length, localText.length) // 10.12.2
  return localText
}

/**
 * 10.2 — Serve engine primitifi: yerel modeli OLDUĞU GİBİ üret (kod personası
 * kurulumu korunur ama geçmiş yalıtılır → her istek bağımsız, OpenAI semantiği).
 * Dışarıdan (Continue/Cline gibi) gelen istekler bunu kullanır.
 */
export async function generateForServe(
  promptText: string,
  options: { maxTokens?: number; temperature?: number; topP?: number } | undefined,
  onToken: (t: string) => void
): Promise<string> {
  if (!engine) throw new Error('model yüklü değil')
  return engine.prompt(promptText, { ...(options ?? {}), isolate: true }, onToken)
}

let apiAbort: AbortController | null = null

// ── 10.12.2 Token/bağlam kullanımı ──────────────────────────────────────────
const API_CTX_DEFAULT = 128000 // sağlayıcı-özel pencere bilinmiyor → yaygın varsayılan
let turnSource: 'api' | 'server' | 'worker' = 'worker'
let turnPromptChars = 0
let turnRespChars = 0

function recordTurn(source: 'api' | 'server' | 'worker', promptChars: number, respChars: number): void {
  turnSource = source
  turnPromptChars = promptChars
  turnRespChars = respChars
}

/** Son turun token kullanımı — motor usage'ı varsa GERÇEK, yoksa (~) tahmin. */
export function getLastTurnUsage(): UsageSample | null {
  const estimate = (source: UsageSample['source'], ctx: number): UsageSample => {
    const pt = Math.ceil(turnPromptChars / 3.2)
    const ct = Math.ceil(turnRespChars / 3.2)
    return { source, promptTokens: pt, completionTokens: ct, totalTokens: pt + ct, contextSize: ctx, exact: false }
  }
  if (turnSource === 'api') {
    const u = getLastApiUsage()
    return u
      ? { source: 'api-usage', promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens, cachedTokens: u.cachedTokens, contextSize: API_CTX_DEFAULT, exact: true }
      : estimate('estimate', API_CTX_DEFAULT)
  }
  if (turnSource === 'server') {
    const u = getLastServerUsage()
    return u
      ? { source: 'llama-server', promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens, cachedTokens: u.cachedTokens, contextSize: u.contextSize, exact: true }
      : estimate('estimate', getLoadedInfo()?.contextSize ?? 4096)
  }
  return estimate('llama-native', getLoadedInfo()?.contextSize ?? 4096)
}

export async function abortChat(): Promise<void> {
  try {
    apiAbort?.abort()
  } catch {
    /* ignore */
  }
  if (!engine) return
  try {
    await engine.abort()
  } catch {
    /* ignore */
  }
}

/** Uygulama kapanırken motor süreçlerini de kapat. */
export function disposeWorker(): void {
  serverEngine.dispose()
  workerEngine.dispose()
  engine = null
}
