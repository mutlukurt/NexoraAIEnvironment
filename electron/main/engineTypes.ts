/**
 * Çıkarım motoru arayüzü — llamaService iki motora da aynı gözle bakar:
 *
 *  - llamaServerEngine: llama.cpp'nin resmi llama-server'ı (varsayılan).
 *    Prompt cache / KV yeniden kullanımı, paralel slotlar, --cache-reuse.
 *  - llamaWorkerEngine: node-llama-cpp worker'ı (otomatik yedek).
 *    Sunucu binary'si yoksa/başlatılamıyorsa devreye girer.
 *
 * Sohbet GEÇMİŞİ motorun içindedir (worker'da oturum, sunucuda messages
 * listesi); llamaService yalnızca tek turluk metin gönderir.
 */

export type LoadProgressCallback = (stage: 'model' | 'context', progress: number) => void

export interface EngineLoadOptions {
  path: string
  gpu: boolean
  /** GPU katman sayısı; 'auto' = sığan kadar. */
  gpuLayers: number | 'auto'
  systemPrompt: string
  onProgress?: LoadProgressCallback
}

export interface EngineLoadResult {
  contextSize: number
  trainContextSize: number
  gpu: boolean
  /** Offload edilen katman; -1 = otomatik (kesin sayı bilinmiyor), 0 = CPU. */
  gpuLayers: number
  totalLayers: number
  paramCount: number | null
}

export interface PromptOptions {
  temperature?: number
  topP?: number
  maxTokens?: number
  /**
   * GBNF grameri (yalnızca server motoru uygular; worker yok sayar —
   * orada renderer'daki streaming watchdog korumaya devam eder).
   */
  grammar?: string
}

export interface InferenceEngine {
  readonly name: 'server' | 'worker'
  load(opts: EngineLoadOptions): Promise<EngineLoadResult>
  /** Sohbet geçmişini sıfırla (model yüklü kalır). */
  reset(systemPrompt: string): Promise<void>
  prompt(text: string, options: PromptOptions | undefined, onToken: (t: string) => void): Promise<string>
  abort(): Promise<void>
  unload(): Promise<void>
  /** Uygulama kapanışı: süreçleri öldür. */
  dispose(): void
}
