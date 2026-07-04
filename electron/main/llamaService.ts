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
  AGENT_HINT
} from '../shared/prompts'
import type { InferenceEngine, LoadProgressCallback, PromptOptions } from './engineTypes'
import { serverEngine } from './llamaServerEngine'
import { workerEngine } from './llamaWorkerEngine'
import { buildEditGrammar, buildFileGrammar, buildPlanGrammar } from '../shared/editGrammar'

export type { LoadProgressCallback } from './engineTypes'

let engine: InferenceEngine | null = null
let loadedInfo: ModelLoadedInfo | null = null
let customSystemPrompt = ''
let activeProfileId = DEFAULT_PROFILE_ID
/** ≲8B modeller için kompakt tek-dosya prompt'u kullanılır (9 GB eşiği). */
let smallModel = true

export function setCustomSystemPrompt(prompt: string): void {
  customSystemPrompt = prompt
}

export function getActiveProfileId(): string {
  return activeProfileId
}

function getFullSystemPrompt(): string {
  return buildSystemPrompt(activeProfileId, customSystemPrompt, smallModel)
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

  // Gerçek parametre sayısı metadata'dan geldi: dosya-boyutu tahminimiz
  // yanlışsa (örn. sıkı quantize 14B+) doğru prompt ile oturumu yeniden kur.
  // ≥13B modeller tam profesyonel çok-dosyalı prompt'u kaldırabilir.
  if (typeof info.paramCount === 'number' && info.paramCount > 0) {
    const actualSmall = info.paramCount < 13e9
    if (actualSmall !== smallModel) {
      console.log(
        `[llamaService] model ${(info.paramCount / 1e9).toFixed(1)}B parametre — prompt profili düzeltiliyor (small=${actualSmall})`
      )
      smallModel = actualSmall
      await engine.reset(getFullSystemPrompt())
    }
  }

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
  const detected = isIterationTurn ? null : detectProfile(input.prompt)
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

Respond ONLY with surgical edit blocks. For EACH separate fix write ONE SMALL block:
\`\`\`edit src/App.tsx
<<<<<<< SEARCH
(the SMALLEST unique snippet that changes — 2 to 8 lines, NEVER more than 12)
=======
(the new lines that replace them)
>>>>>>> REPLACE
\`\`\`
GOOD example — one heading changes, so SEARCH holds only that line:
\`\`\`edit src/App.tsx
<<<<<<< SEARCH
        <h2 className="text-2xl">Welcome to Aelixa</h2>
=======
        <p className="text-xs uppercase tracking-widest">Welcome to Aelixa</p>
>>>>>>> REPLACE
\`\`\`
FORBIDDEN: copying an entire component, section or file into SEARCH. If a section needs many changes, write SEVERAL small blocks — one per exact spot. 5 requested fixes → at least 5 separate small blocks.
Rules:
1. SEARCH text must exist in the file character-for-character (same indentation).
2. Blocks are applied in order; each SEARCH must still match after earlier blocks.
3. A COMPLETE file (normal \`\`\`tsx path format) is allowed ONLY for a brand NEW file that does not exist yet. Rewriting an EXISTING file in full is automatically REJECTED — it will never be applied; generation gets cut off.
4. Do not output unchanged files. No explanations outside blocks.
5. If the request reports an error or bug, locate the cause in the files above and fix it with a small edit block.
6. If the user is ONLY asking a question (no change requested), reply instead with a single line starting with: ANSWER: <short answer in the user's language>
==================================================`
  }

  // Agent ipucu yalnızca istek gerektirdiğinde eklenir — kalıcı olarak sistem
  // prompt'una koymak küçük modellerin şablon satırlarını kopyalamasına yol
  // açıyordu ([FETCH] <url> ... satırlarının dosya olarak üretilmesi vakası).
  if (detectAgentIntent(input.prompt)) {
    prompt += '\n\n' + AGENT_HINT
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

  return engine!.prompt(prompt, options, onChunk)
}

export async function abortChat(): Promise<void> {
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
