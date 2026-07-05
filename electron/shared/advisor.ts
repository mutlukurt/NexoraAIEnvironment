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

function opt(def: CoderDef, hw: HardwareInfo, note: string, recommended = false): CoderOption {
  const { moe: _moe, ...base } = def
  return { ...base, speed: speedFor(def, hw), note, recommended }
}

/** Cihaz ölçümünden öneri planı üret. */
export function buildPlan(hw: HardwareInfo, CODERS: Record<string, CoderDef> = EMBEDDED_CODERS): AdvisorPlan {
  const r = hw.ramGb
  if (r >= 28) {
    return {
      coders: [
        opt(CODERS.c32, hw, 'Bu cihazın kaldırabileceği en iyi kalite', true),
        opt(CODERS.codestral, hw, 'Kod odaklı güçlü alternatif'),
        opt(CODERS.c14, hw, 'Kalite/hız dengesi'),
        opt(CODERS.dsLite, hw, 'MoE: 10 GB boyut, küçük model hızı'),
        opt(CODERS.c7, hw, 'Hızlı taslaklar ve görselli işler için')
      ],
      vision: {
        label: r >= 48 ? 'Qwen2.5-VL-32B (otomatik)' : 'Qwen2.5-VL-7B (otomatik)',
        note: 'Görsel eklediğinizde en iyi sığan göz otomatik seçilir; ilk kullanımda indirilir.'
      }
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
    return {
      coders,
      vision: {
        label: 'Qwen2.5-VL-7B / 3B (otomatik)',
        note: '7B kodlayıcıyla çalışırken gözler 7B; büyük kodlayıcılar RAM doldurduğundan gözler 3B olur.'
      }
    }
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
    return {
      coders,
      vision: { label: 'Qwen2.5-VL-3B (otomatik)', note: 'Görsel eklediğinizde otomatik indirilip kullanılır.' }
    }
  }
  return {
    coders: [
      opt(CODERS.c3, hw, 'Bu cihaza uygun güvenli seçenek', true),
      opt(CODERS.llama3, hw, 'Genel amaçlı, hafif alternatif')
    ],
    vision: { label: 'Qwen2.5-VL-3B (otomatik)', note: 'Görsel desteği sınırlı olabilir (RAM).' }
  }
}

export const SPEED_LABELS: Record<SpeedGrade, string> = {
  ultra: 'Ultra hızlı',
  hizli: 'Hızlı',
  orta: 'Orta',
  yavas: 'Yavaş ama değer'
}
