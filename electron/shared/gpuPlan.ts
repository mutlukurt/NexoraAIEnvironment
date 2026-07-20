/**
 * Faz 3 — modeli ekran kartına SIĞDIRMA planı (saf/deterministik hesap).
 *
 * Sorun: model açılırken ilk deneme körlemesine "tüm katmanları ekran kartına
 * yükle" diyordu; kart belleği (VRAM) küçükse taşıyor → süreç çöküyor → uygulama
 * katman sayısını körlemesine düşürüp tekrar deniyordu (yavaş, bazen hiç açılmaz).
 *
 * Bu modül cihazın kart belleğine bakıp KAÇ katmanın sığacağını hesaplar ve deneme
 * SIRASINI planlar; böylece ilk deneme cihaza uygun olur. Saf: yan etkisiz, test
 * edilebilir. Motor (llamaServerEngine) VRAM'i ölçüp buraya verir.
 */

/** Bir açma denemesinin (rung) parametreleri. `-ngl` = ekran kartına konacak katman. */
export type RungNgl = number | 'auto' | 0
export interface RungPlan {
  ctx: number
  ngl: RungNgl
  quantKv: boolean
}

/** Kart belleğine sığdırma hesabının girdileri (Faz 3). */
export interface GpuFitInput {
  vramGb: number
  modelSizeBytes: number
  blockCount: number
  /** Bağlam boyu (token) — KV önbelleği bununla büyür. Yoksa KV sayılmaz. */
  ctxTokens?: number
  /** Gizli boyut (embedding_length) — KV boyutu için. Yoksa KV kaba/atlanır. */
  embeddingLength?: number | null
  /** Dikkat başlığı sayısı (head_count). head_dim = embedding/headCount. */
  headCount?: number | null
  /** KV başlığı (head_count_kv; GQA'da daha az). Yoksa headCount kullanılır. */
  headCountKv?: number | null
  /** KV eleman başına bayt: q8_0 ≈ 1.1, f16 ≈ 2.2. Vars. 1.1 (uygulama q8_0 KV kullanır). */
  bytesPerKvElem?: number
  /** Sabit ek yük (masaüstü + CUDA bağlamı + compute tamponları), GB. Vars. 1.0. */
  fixedOverheadGb?: number
}

/**
 * Kart belleğine kaç katman sığar — GERÇEK fizikle. Karta konan HER katman iki yer
 * kaplar: (1) ağırlık ≈ model dosyası / katman sayısı; (2) o katmanın KV önbelleği ≈
 * 2(K+V) × KV-başlığı × head_dim × bağlam × bayt. KV önbelleği YALNIZ karta konan
 * katmanlar için sayılır (CPU'daki katmanların KV'si RAM'de) — bu yüzden sabit rezerv
 * yerine katman-başına eklenir; yüksek bağlamda bile GPU'yu boşuna boş bırakmaz.
 * Muhafazakâr taban + emin değilse (metadata yoksa) yalnız ağırlık. 0..blockCount döner.
 */
export function fitGpuLayers(input: GpuFitInput): number {
  const { vramGb, modelSizeBytes, blockCount } = input
  if (!(vramGb > 0) || !(modelSizeBytes > 0) || !(blockCount > 0)) return 0
  const overhead = input.fixedOverheadGb ?? 1.0
  const usableBytes = Math.max(0, (vramGb - overhead) * 1e9)
  const bytesPerLayer = modelSizeBytes / blockCount
  let kvPerLayer = 0
  const ctx = input.ctxTokens ?? 0
  if (ctx > 0 && input.embeddingLength && input.headCount) {
    const headDim = input.embeddingLength / input.headCount
    const nKv = input.headCountKv ?? input.headCount
    const bpe = input.bytesPerKvElem ?? 1.1
    kvPerLayer = 2 * nKv * headDim * ctx * bpe
  }
  const perLayer = bytesPerLayer + kvPerLayer
  if (!(perLayer > 0)) return 0
  const fit = Math.floor(usableBytes / perLayer)
  return Math.max(0, Math.min(fit, blockCount))
}

/**
 * Model açma denemelerinin (rung) SIRASI. GPU açıksa cihaza-sığdırılmış deneme
 * eklenir; sonra eski davranış (auto → yarı-bağlam → katman merdiveni → CPU) YEDEK
 * olarak korunur (regresyon yok — VRAM bilinmiyorsa tıpatıp eski sıra).
 *
 * Karar `weightsFitVram` ile (model AĞIRLIKLARI karta sığar mı — eskisinden asla
 * kötü olmasın diye asıl fizik):
 *  • Ağırlıklar karta SIĞIYOR (küçük model): 'auto' (tam-GPU, EN HIZLI) gerçekten
 *    çalışabilir → ÖNCE onu dene (sığıyorsa eskisi gibi tam hızlı, YAVAŞLAMA YOK);
 *    taşarsa kaba merdivene düşmeden HEMEN hassas sığan değere in.
 *  • Ağırlıklar karta SIĞMIYOR (büyük model): 'auto' kesinlikle taşar → boşa denemeyi
 *    ATLA, doğrudan sığan boyutla başla (yine de 'auto' yedekte kalır).
 */
export function planRungs(
  preferredCtx: number,
  gpu: boolean,
  gpuLayers: number | 'auto',
  blockCount: number | null,
  fittedNgl?: number,
  weightsFitVram: boolean = true
): RungPlan[] {
  const rungs: RungPlan[] = []
  const half = Math.max(4096, Math.floor(preferredCtx / 2))
  if (gpu) {
    const hasFit =
      typeof fittedNgl === 'number' && fittedNgl >= 1 && (blockCount == null || fittedNgl < blockCount)

    if (hasFit && !weightsFitVram) {
      // Büyük model: ağırlıklar bile sığmıyor → 'auto' kesin taşar. Sığan boyutla başla.
      rungs.push({ ctx: preferredCtx, ngl: fittedNgl as number, quantKv: true })
      rungs.push({ ctx: preferredCtx, ngl: gpuLayers, quantKv: true }) // yine de yedek
    } else {
      // Küçük model (ya da VRAM bilinmiyor): 'auto' (tam-GPU) çalışabilir → ÖNCE onu
      // dene (regresyon yok). Sığan değer biliniyorsa 'auto' taşarsa HEMEN yedek.
      rungs.push({ ctx: preferredCtx, ngl: gpuLayers, quantKv: true }) // auto / tam-GPU
      if (hasFit) rungs.push({ ctx: preferredCtx, ngl: fittedNgl as number, quantKv: true })
    }
    rungs.push({ ctx: half, ngl: gpuLayers, quantKv: true })
    // Katman merdiveni (1.2 ile aynı felsefe): auto bile OOM olabilir.
    if (blockCount) {
      const base = typeof gpuLayers === 'number' ? Math.min(gpuLayers, blockCount) : blockCount
      for (const f of [0.6, 0.4, 0.2]) {
        const n = Math.floor(base * f)
        if (n >= 1) rungs.push({ ctx: half, ngl: n, quantKv: true })
      }
    }
  }
  rungs.push({ ctx: preferredCtx, ngl: 0, quantKv: true })
  rungs.push({ ctx: 4096, ngl: 0, quantKv: false })
  return rungs
}
