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
  /** GGUF metadata/dosya adından tespit edilen model ailesi (roadmap 2.5). */
  family?: import('../shared/prompts').ModelFamily
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
  /**
   * Düz-metin turu işareti (sohbet/brief). Kod turlarının tarifi (kod
   * personası, tekrar cezaları, enable_thinking:false) doğal dile uygulanınca
   * Türkçe cevaplar bozuluyordu — bu turlarda motor sohbet sistem prompt'una
   * geçer, cezaları kaldırır ve düşünen modellerin düşünmesine izin verir.
   */
  purpose?: 'chat' | 'prose'
  /** Sohbet sistem prompt'unun cevap dili. */
  answerLang?: 'tr' | 'en'
  /**
   * Tur motor geçmişine YAZILMAZ (enhance gibi meta turlar). Canlı-test
   * bulgusu: geçmişteki "Output ONLY the brief text" talimatı, brief'in
   * yeniden gönderiminde 3B'yi kod yerine brief'i tekrarlamaya itiyordu.
   */
  ephemeral?: boolean
  /**
   * FAZ 9.3 — Tur, motor geçmişini NE OKUR NE YAZAR (tam yalıtım). Fidelity
   * planlı üretimde her bileşen turu için: aksi hâlde model KV geçmişindeki
   * önceki dosyayı (ör. Navbar) sonraki bileşene KLONLUYOR (canlı bug: Hero =
   * Navbar kopyası). Her bileşen kendi dilimlenmiş brief'inden bağımsız üretilir.
   */
  isolate?: boolean
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
