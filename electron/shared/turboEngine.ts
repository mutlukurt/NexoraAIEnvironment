/**
 * Faz 14.7 — Motor turbo (speculative decoding) + anında resume (KV-slot) çekirdeği.
 *
 * Saf/deterministik seçim mantığı (dosya sistemi/spawn dışında): (1) yüklü ana
 * modele AYNI AİLEDEN daha küçük bir "draft" GGUF eşle → llama-server --model-draft
 * ile bedava 1.4-2.5× hız; (2) her oturum/proje için KARARLI bir slot dosya adı →
 * --slot-save-path ile KV'yi idle'da kaydet, açılışta geri yükle (~%93 hızlı resume).
 */
import { detectFamily, type ModelFamily } from './prompts'

export interface ModelCandidate {
  path: string
  sizeBytes: number
}

/**
 * 22.2 — Draft-model provisioning: turbo için önerilecek KÜÇÜK, aynı-aileden draft
 * GGUF kataloğu (~/NexoraAI/models'a tek tıkla iner → pickDraftModel otomatik seçer).
 * Aynı aile = paylaşılan vocab; yanlış-aile ASLA önerilmez.
 */
export interface DraftCatalogEntry {
  family: ModelFamily
  label: string
  /** HuggingFace repo id + dosya adı — mevcut hf.download akışıyla indirilir. */
  repo: string
  file: string
  sizeMb: number
}

export const DRAFT_CATALOG: DraftCatalogEntry[] = [
  { family: 'qwen', label: 'Qwen2.5 0.5B · draft', repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf', sizeMb: 398 },
  { family: 'llama', label: 'Llama 3.2 1B · draft', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', sizeMb: 808 },
  { family: 'gemma', label: 'Gemma 2 2B · draft', repo: 'bartowski/gemma-2-2b-it-GGUF', file: 'gemma-2-2b-it-Q4_K_M.gguf', sizeMb: 1710 }
]

/**
 * Yüklü ana modele önerilecek draft (yoksa null): aynı aile + ana modelin ~%60'ından
 * KÜÇÜK olmalı (aksi hâlde speculative kazanç yok). Ana model zaten küçükse (ör. 1B) null.
 */
export function recommendDraft(mainPath: string, mainSizeBytes: number): DraftCatalogEntry | null {
  const fam = detectFamily((mainPath.split('/').pop() ?? mainPath))
  if (fam === 'generic') return null
  const entry = DRAFT_CATALOG.find((e) => e.family === fam)
  if (!entry) return null
  if (mainSizeBytes > 0 && entry.sizeMb * 1024 * 1024 > mainSizeBytes * 0.6) return null
  return entry
}

/**
 * Ana modele en uygun draft modelini seç: AYNI AİLE (paylaşılan vocab), ana
 * modelin ~yarısından KÜÇÜK (draft küçük olmalı) ve mümkün olan EN KÜÇÜK. Aynı
 * dosya seçilmez. Uygun yoksa null (turbo pasif). Aile eşleşmezse (vocab farklı)
 * ASLA seçilmez — yanlış draft speculative decoding'i bozar.
 */
export function pickDraftModel(mainPath: string, mainSizeBytes: number, candidates: ModelCandidate[]): string | null {
  const mainFam = detectFamily(mainPath.split('/').pop() ?? mainPath)
  if (mainFam === 'generic') return null // aile belirsiz → risk alma
  const viable = candidates
    .filter((c) => c.path !== mainPath)
    .filter((c) => detectFamily(c.path.split('/').pop() ?? c.path) === mainFam)
    // Draft ana modelin en çok yarısı kadar (yeterince küçük olsun)
    .filter((c) => c.sizeBytes > 0 && c.sizeBytes <= mainSizeBytes * 0.5)
    // mmproj/VL/embed/görsel değil
    .filter((c) => !/(mmproj|[-_.]vl[-_.]|embed|nomic|bge|stable-diffusion|sdxl|flux)/i.test(c.path))
  if (viable.length === 0) return null
  viable.sort((a, b) => a.sizeBytes - b.sizeBytes) // en küçük draft
  return viable[0].path
}

/** Bir oturum/proje anahtarından KARARLI, güvenli KV-slot dosya adı (resume). */
export function slotFileFor(key: string): string {
  const safe = (key || 'default').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'default'
  return `kv-${safe}.bin`
}

/** llama-server draft spawn argümanları (draft yoksa boş dizi). */
export function draftArgs(draftPath: string | null): string[] {
  if (!draftPath) return []
  // --draft-max: kabul edilirse sıçranan taslak token sayısı; -ngl 0 draft CPU'da
  // (küçük olduğu için ucuz), ana modelin VRAM'ini yemesin.
  return ['--model-draft', draftPath, '--draft-max', '16', '--draft-min', '2', '-ngld', '0']
}

/** llama-server slot-save-path argümanları (resume dizini). */
export function slotArgs(slotDir: string | null): string[] {
  if (!slotDir) return []
  return ['--slot-save-path', slotDir]
}
