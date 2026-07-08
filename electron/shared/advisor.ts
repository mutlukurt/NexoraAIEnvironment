/**
 * Donanım Danışmanı — cihaz ölçümüne göre model önerisi.
 *
 * Amaç: kullanıcı "hangi model bana uygun?" diye düşünmesin. Uygulama RAM,
 * CPU ve GPU'yu ölçer; bu katalogdan cihaza uyan kodlayıcı seçeneklerini hız
 * ve kalite notlarıyla listeler. Katalog tek aile değildir: Qwen, DeepSeek,
 * Mistral (Codestral), Microsoft (Phi), Meta (Llama) ve Google (Gemma)
 * ailelerinden cihaza sığan GGUF'lar birlikte gösterilir. Görsel (VL) modeli
 * ayrıca önerilir — o, çalışma anında boş RAM'e göre otomatik seçilir
 * (visionService).
 *
 * Main ve renderer tarafından paylaşılır; bağımlılıksız tutun.
 */

export interface HardwareInfo {
  ramGb: number
  freeRamGb: number
  cpuModel: string
  cpuCores: number
  gpu: { name: string; vramGb: number } | null
  platform: string
}

export type SpeedGrade = 'ultra' | 'hizli' | 'orta' | 'yavas'

export interface CoderOption {
  id: string
  label: string
  /** Model ailesi (Qwen, Meta, Google…) — arayüzde rozet olarak gösterilir */
  family: string
  repo: string
  file: string
  sizeGb: number
  /** Bu cihazdaki tahmini hız notu */
  speed: SpeedGrade
  /** Kalite açıklaması */
  quality: string
  note: string
  recommended?: boolean
  /**
   * Ayrı (discrete) GPU'da model NEREDE koşar:
   *  'vram' = ağırlıklar+bağlam VRAM'e TAM sığar → hızlı (tam GPU offload)
   *  'ram'  = VRAM'e sığmaz, RAM/CPU'ya taşar → yavaş (kısmi offload)
   * Tümleşik/unified bellekte (Apple Silicon, CPU-only) tanımsız kalır.
   */
  fit?: 'vram' | 'ram'
}

export interface AdvisorPlan {
  coders: CoderOption[]
  vision: { label: string; note: string }
}

interface CoderDef {
  id: string
  label: string
  family: string
  repo: string
  file: string
  sizeGb: number
  quality: string
  /** MoE mimarisi: aktif parametre az olduğundan boyutuna göre çok daha hızlı */
  moe?: boolean
}

export const EMBEDDED_CODERS: Record<string, CoderDef> = {
  c32: {
    id: 'coder-32b',
    label: 'Qwen2.5-Coder-32B',
    family: 'Qwen',
    repo: 'bartowski/Qwen2.5-Coder-32B-Instruct-GGUF',
    file: 'Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf',
    sizeGb: 19.9,
    quality: 'En yüksek — tam profesyonel çok dosyalı projeler'
  },
  codestral: {
    id: 'codestral-22b',
    label: 'Codestral-22B',
    family: 'Mistral',
    repo: 'bartowski/Codestral-22B-v0.1-GGUF',
    file: 'Codestral-22B-v0.1-Q4_K_M.gguf',
    sizeGb: 13.3,
    quality: 'Çok yüksek — Mistral\'in kod uzmanı, 80+ dil'
  },
  dsLite: {
    id: 'deepseek-coder-v2-lite',
    label: 'DeepSeek-Coder-V2-Lite',
    family: 'DeepSeek',
    repo: 'bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF',
    file: 'DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf',
    sizeGb: 10.4,
    quality: 'Yüksek — MoE mimarisi: boyutuna göre çok hızlı kod uzmanı',
    moe: true
  },
  c14: {
    id: 'coder-14b',
    label: 'Qwen2.5-Coder-14B',
    family: 'Qwen',
    repo: 'bartowski/Qwen2.5-Coder-14B-Instruct-GGUF',
    file: 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf',
    sizeGb: 9.0,
    quality: 'Yüksek — profesyonel çok dosyalı projeler'
  },
  phi4: {
    id: 'phi-4-14b',
    label: 'Phi-4 (14B)',
    family: 'Microsoft',
    repo: 'bartowski/phi-4-GGUF',
    file: 'phi-4-Q4_K_M.gguf',
    sizeGb: 9.1,
    quality: 'Yüksek — kod ve genel akıl yürütme dengeli'
  },
  gemma9: {
    id: 'gemma-2-9b',
    label: 'Gemma-2-9B',
    family: 'Google',
    repo: 'bartowski/gemma-2-9b-it-GGUF',
    file: 'gemma-2-9b-it-Q4_K_M.gguf',
    sizeGb: 5.8,
    quality: 'İyi — genel amaçlı; açıklama ve sohbette güçlü'
  },
  llama8: {
    id: 'llama-3.1-8b',
    label: 'Llama-3.1-8B',
    family: 'Meta',
    repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    file: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    sizeGb: 4.9,
    quality: 'İyi — genel amaçlı; kodda Qwen-Coder kadar uzman değil'
  },
  c7: {
    id: 'coder-7b',
    label: 'Qwen2.5-Coder-7B',
    family: 'Qwen',
    repo: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
    file: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    sizeGb: 4.7,
    quality: 'İyi — tek dosyalık sağlam siteler, dengeli seçim'
  },
  c3: {
    id: 'coder-3b',
    label: 'Qwen2.5-Coder-3B',
    family: 'Qwen',
    repo: 'bartowski/Qwen2.5-Coder-3B-Instruct-GGUF',
    file: 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf',
    sizeGb: 2.0,
    quality: 'Temel — basit sayfalar, en düşük bekleme'
  },
  llama3: {
    id: 'llama-3.2-3b',
    label: 'Llama-3.2-3B',
    family: 'Meta',
    repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeGb: 2.0,
    quality: 'Temel — genel amaçlı, hafif ve hızlı'
  }
}

/** CPU çekirdeği ve GPU'ya göre hız notu (yaklaşık, dürüst). */
function speedFor(def: CoderDef, hw: HardwareInfo): SpeedGrade {
  // MoE modellerde aktif parametre az — hız, dosya boyutunun ~1/3'ü gibi davranır
  const effGb = def.moe ? def.sizeGb / 3 : def.sizeGb
  const gpuBoost = hw.gpu && hw.gpu.vramGb >= effGb * 0.5
  if (effGb <= 2.5) return gpuBoost || hw.cpuCores >= 8 ? 'ultra' : 'hizli'
  if (effGb <= 5) return gpuBoost ? 'hizli' : hw.cpuCores >= 12 ? 'hizli' : 'orta'
  if (effGb <= 10) return gpuBoost ? 'orta' : 'yavas'
  return 'yavas'
}

function opt(def: CoderDef, hw: HardwareInfo, note: string, recommended = false, fit?: 'vram' | 'ram'): CoderOption {
  const { moe: _moe, ...base } = def
  return { ...base, speed: speedFor(def, hw), note, recommended, fit }
}

// Kodlama kalitesine göre sıralı katalog (en iyi → en hafif); VRAM yolunda öneri bu sırayı korur.
const QUALITY_ORDER = ['c32', 'codestral', 'c14', 'dsLite', 'phi4', 'c7', 'gemma9', 'llama8', 'c3', 'llama3']

/**
 * Cihaz ölçümünden öneri planı üret.
 *
 * AYRI (discrete) GPU varsa öneri VRAM'e GÖREDİR: en iyi pick, ağırlıkları VRAM'e
 * TAM sığan (tam GPU offload → hızlı) en kaliteli modeldir; VRAM'e sığmayanlar
 * "RAM'e taşar (yavaş)" diye işaretlenir. Canlı-test bulgusu: eski mantık sistem
 * RAM'ine bakıp 8GB VRAM'li makineye 32B (19.9GB) öneriyordu → o model VRAM'e
 * sığmadığı için CPU'da 3-4 tok/s sürünürdü. Tümleşik/unified bellekte (Apple
 * Silicon) veya GPU yoksa RAM havuzuna göre önerir (orada GPU-RAM ortak ya da
 * tek seçenek CPU'dur).
 */
export function buildPlan(hw: HardwareInfo, CODERS: Record<string, CoderDef> = EMBEDDED_CODERS): AdvisorPlan {
  const vram = hw.gpu?.vramGb ?? 0
  const r = hw.ramGb
  const visionFor = (ram: number): { label: string; note: string } =>
    ram >= 28
      ? {
          label: ram >= 48 ? 'Qwen2.5-VL-32B (otomatik)' : 'Qwen2.5-VL-7B (otomatik)',
          note: 'Görsel eklediğinizde en iyi sığan göz otomatik seçilir; ilk kullanımda indirilir.'
        }
      : ram >= 12
        ? {
            label: 'Qwen2.5-VL-7B / 3B (otomatik)',
            note: '7B kodlayıcıyla çalışırken gözler 7B; büyük kodlayıcılar RAM doldurduğunda gözler 3B olur.'
          }
        : { label: 'Qwen2.5-VL-3B (otomatik)', note: 'Görsel eklediğinizde otomatik indirilip kullanılır.' }

  // --- AYRI GPU: öneri VRAM'e göre (hızlı = VRAM'e tam sığan en kaliteli) ---
  if (vram >= 2) {
    const HEADROOM = 1.5 // bağlam/KV cache/OS için VRAM payı (GB)
    const fitOf = (d: CoderDef): 'vram' | 'ram' => (d.sizeGb + HEADROOM <= vram ? 'vram' : 'ram')
    const defs = QUALITY_ORDER.map((k) => CODERS[k]).filter(Boolean)
    // En azından RAM'e sığıp çalışabilenler (aksi halde hiç listeleme)
    const usable = defs.filter((d) => d.sizeGb <= Math.max(3, r - 3))
    const fast = usable.filter((d) => fitOf(d) === 'vram') // kalite sırası korunur
    const slow = usable.filter((d) => fitOf(d) === 'ram')
    const recommended = fast[0] ?? usable[usable.length - 1] ?? defs[defs.length - 1]
    // Önce öneri (hızlı), sonra "kaliteli ama yavaş" büyükler, sonra kalan hızlılar.
    const ordered = [recommended, ...slow, ...fast]
      .filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i)
      .slice(0, 6)
    const noteFor = (d: CoderDef): string =>
      fitOf(d) === 'ram'
        ? d.moe
          ? "MoE — VRAM'e tam sığmaz ama boyutuna göre hızlı"
          : "RAM'e taşar — daha yüksek kalite ama yavaş"
        : d.id === recommended.id
          ? "VRAM'e tam sığar — bu cihazda en hızlı"
          : "VRAM'e sığar — hızlı"
    return {
      coders: ordered.map((d) => opt(d, hw, noteFor(d), d.id === recommended.id, fitOf(d))),
      vision: visionFor(r)
    }
  }

  // --- Ayrı GPU yok: RAM havuzuna göre (Apple unified / tümleşik / CPU) ---
  if (r >= 28) {
    return {
      coders: [
        opt(CODERS.c32, hw, 'Bu cihazın kaldırabileceği en iyi kalite', true),
        opt(CODERS.codestral, hw, 'Kod odaklı güçlü alternatif'),
        opt(CODERS.c14, hw, 'Kalite/hız dengesi'),
        opt(CODERS.dsLite, hw, 'MoE: 10 GB boyut, küçük model hızı'),
        opt(CODERS.c7, hw, 'Hızlı taslaklar ve görselli işler için')
      ],
      vision: visionFor(r)
    }
  }
  if (r >= 12) {
    const coders = [
      opt(CODERS.c14, hw, 'Bu cihazın en yüksek kod kalitesi — sabır ister'),
      opt(CODERS.phi4, hw, 'Kod + genel sohbet dengesi arayanlara'),
      opt(CODERS.c7, hw, 'Dengeli seçim; görsel referanslı işlerde bunu kullanın (gözler 7B olur)', true),
      opt(CODERS.gemma9, hw, 'Genel amaçlı alternatif'),
      opt(CODERS.llama8, hw, 'Genel amaçlı alternatif'),
      opt(CODERS.c3, hw, 'En hızlı — basit işler')
    ]
    if (r >= 14) {
      coders.splice(2, 0, opt(CODERS.dsLite, hw, 'MoE: 14B kalitesine yakın, çok daha hızlı'))
    }
    return { coders, vision: visionFor(r) }
  }
  if (r >= 8) {
    const coders = [
      opt(CODERS.c7, hw, 'Bu cihazın en iyi seçimi', true),
      opt(CODERS.llama8, hw, 'Genel amaçlı alternatif'),
      opt(CODERS.c3, hw, 'Daha hızlı, daha basit'),
      opt(CODERS.llama3, hw, 'Genel amaçlı, hafif')
    ]
    if (r >= 10) {
      coders.splice(2, 0, opt(CODERS.gemma9, hw, 'Genel amaçlı alternatif'))
    }
    return { coders, vision: visionFor(r) }
  }
  return {
    coders: [
      opt(CODERS.c3, hw, 'Bu cihaza uygun güvenli seçenek', true),
      opt(CODERS.llama3, hw, 'Genel amaçlı, hafif alternatif')
    ],
    vision: visionFor(r)
  }
}

export const SPEED_LABELS: Record<SpeedGrade, string> = {
  ultra: 'Ultra hızlı',
  hizli: 'Hızlı',
  orta: 'Orta',
  yavas: 'Yavaş ama değer'
}
