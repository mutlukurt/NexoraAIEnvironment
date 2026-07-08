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
import { basename } from 'path'
import { stat } from 'fs/promises'
import type { ChatSendInput, ModelLoadedInfo } from '../shared/ipc'
import {
  DEFAULT_PROFILE_ID,
  detectProfile,
  buildSystemPrompt,
  getProfile,
  detectAgentIntent,
  AGENT_HINT,
  UPDATE_MODE_RULES
} from '../shared/prompts'
import type { InferenceEngine, LoadProgressCallback, PromptOptions } from './engineTypes'
import { serverEngine } from './llamaServerEngine'
import { workerEngine } from './llamaWorkerEngine'
import { buildEditGrammar, buildFileGrammar, buildPlanGrammar } from '../shared/editGrammar'
import { shouldUseApi, promptApi } from './apiEngine'
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
  if (!isModelLoaded()) {
    throw new Error('Model yüklenmemiş. Önce bir GGUF seç.')
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
  if (input.currentFiles && input.currentFiles.length > 0) {
    const filesContext = input.currentFiles
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join('\n\n')
    // Bağlam diyeti: gösterilmeyen dosyalar listelenir ki model onları
    // yeniden yaratmaya kalkmasın; gerekiyorsa kullanıcı @dosya ile ekler.
    const others =
      input.otherPaths && input.otherPaths.length > 0
        ? `\n\nOther existing project files (content not shown — they EXIST, do NOT recreate them; ask the user to mention @file if you need one): ${input.otherPaths.join(', ')}`
        : ''
    prompt = `Current project files:
${filesContext}${others}

==================================================
UPDATE MODE — the user wants a CHANGE in the existing project.
User request: ${input.prompt}

${UPDATE_MODE_RULES}
==================================================`
  }

  // Agent ipucu yalnızca istek gerektirdiğinde eklenir — kalıcı olarak sistem
  // prompt'una koymak küçük modellerin şablon satırlarını kopyalamasına yol
  // açıyordu ([FETCH] <url> ... satırlarının dosya olarak üretilmesi vakası).
  // Sohbet/brief turunda hiç eklenmez: soru cevaplanacak, eylem yapılmayacak.
  if (!isProseTurn && detectAgentIntent(input.prompt)) {
    prompt += '\n\n' + AGENT_HINT
  }

  // Worker yedek motoru istek-başına sistem prompt'u değiştiremez (oturum
  // node-llama-cpp içinde kod personasıyla kurulu). Sohbet turunda soruyu
  // kısa bir konuşma direktifiyle sarmak oradaki tek koruma.
  if (input.options?.purpose === 'chat' && engine === workerEngine) {
    prompt = `The user is chatting or asking a question — NOT requesting a build. Answer briefly and conversationally in the user's language. No code, no files.\n\n${prompt}`
  }

  // GBNF gramerleri (roadmap 2.1 + 2.2): format örnekleyici seviyesinde
  // zorlanır. Server motoru uygular; worker yok sayar (watchdog orada korur).
  //  - expectFile: planlı üretimde tek-dosya turu — çıktı tam o yola ait
  //    TEK fenced blok olmak zorunda.
  //  - expectPlan: plan turu — "N. yol — açıklama" satırları.
  //  - UPDATE turu: cerrahi düzenleme; SEARCH ≤12 satır, hedef yol yalnızca
  //    gerçekten var olan dosyalar.
  const options: PromptOptions = { ...(input.options ?? {}) }
  if (input.expectFile) {
    options.grammar = buildFileGrammar(input.expectFile)
  } else if (input.expectPlan) {
    options.grammar = buildPlanGrammar()
  } else if (input.currentFiles && input.currentFiles.length > 0) {
    const allPaths = [
      ...input.currentFiles.map((f) => f.path),
      ...(input.otherPaths ?? [])
    ]
    options.grammar = buildEditGrammar(allPaths)
  }

  // Hibrit API (roadmap 4.1): bu tur bir DÜZELTME turu mu? (otomatik/kullanıcı
  // "düzelt" + derleme/runtime hata metni taşıyan iterasyon turları). Kullanıcı
  // yapılandırdıysa bu turlar frontier modele yönlendirilir — yerel küçük
  // modelin çözemediği keyfi yapı/mantık hataları için Bolt paritesi.
  const isFixTurn =
    !!input.currentFiles &&
    input.currentFiles.length > 0 &&
    /(^|\n)\s*düzelt\b|BUILD ERROR|RUNTIME ERROR|does NOT compile|GÖRSEL denetim/i.test(input.prompt)
  const escalate = !!input.options?.escalate
  if (shouldUseApi(isFixTurn, escalate)) {
    apiAbort = new AbortController()
    try {
      console.log(`[NexoraAI] tur API motoruna yönlendirildi (hibrit${escalate ? ', tırmanış 5.5' : ' 4.1'})`)
      // Telemetri (5.5): hangi kademe hangi vakayı aldı — zayıf sınıflar saha
      // verisinden çıksın diye her yönlendirme kararı kalıcı günlüğe yazılır.
      void appendRepairLog({ layer: escalate ? 'api-escalated' : 'api-turn' })
      return await promptApi(getFullSystemPrompt(), prompt, onChunk, apiAbort.signal)
    } catch (err) {
      // API başarısızsa sessizce yerele düş — kullanıcı asla motorsuz kalmaz.
      console.warn('[NexoraAI] API motoru başarısız, yerele düşülüyor:', (err as Error).message)
      void appendRepairLog({ layer: 'api-fallback-local', diag: (err as Error).message.slice(0, 200) })
    } finally {
      apiAbort = null
    }
  }

  return engine!.prompt(prompt, options, onChunk)
}

let apiAbort: AbortController | null = null

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
