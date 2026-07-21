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

/**
 * Faz 3 — draft/target tokenizer imzası (GGUF metadata'sından, inference YOK).
 * Speculative decoding taslak ve ana modelin AYNI vocab'ı paylaşmasını ister;
 * aile-adı (dosya adı regex'i) sağlam bir vekil DEĞİL — aynı aileden iki model
 * farklı vocab boyutuna sahip olabilir (canlı: Qwen2.5-14B n_vocab=152064 vs
 * qwen2.5-3b=151936). Bu imza gerçek metadata'dan gelir ve kesin karar verir.
 */
export interface VocabSig {
  nVocab: number
  tokenizerModel: string
  tokenizerPre: string
  eos: number
  bos: number
}

/**
 * Draft, target ile speculative decoding için UYUMLU mu? Muhafazakâr: llama.cpp'nin
 * sessizce reddettiği/bozduğu çiftleri ELE — aynı tokenizer modeli + pre + eos + AYNI
 * vocab boyutu ŞART. En küçük fark (128 token) bile speculative'i bozar. reason
 * makine-okur (UI "neden kapandı"yı söyler).
 */
export function isDraftCompatible(
  target: VocabSig,
  draft: VocabSig
): { ok: boolean; reason?: 'tokenizer-model' | 'tokenizer-pre' | 'eos' | 'vocab-size' } {
  if (target.tokenizerModel !== draft.tokenizerModel) return { ok: false, reason: 'tokenizer-model' }
  if (target.tokenizerPre !== draft.tokenizerPre) return { ok: false, reason: 'tokenizer-pre' }
  if (target.eos !== draft.eos) return { ok: false, reason: 'eos' }
  if (target.nVocab !== draft.nVocab) return { ok: false, reason: 'vocab-size' }
  return { ok: true }
}

export interface DraftPick {
  path: string | null
  /** null ise turbo neden kendini kapattı (UI'ye + telemetriye). */
  reason?: 'family' | 'no-candidate' | 'metadata' | 'tokenizer-model' | 'tokenizer-pre' | 'eos' | 'vocab-size'
}

/**
 * Faz 3 — UYUM-farkında draft seçimi: pickDraftModel'in family+size ön-filtresi +
 * tokenizer-imza kapısı. POZİTİF uyum kanıtı ŞART — hedef ya da aday metadata'sı
 * okunamazsa turbo KAPANIR (uyumsuz asla seçilmez, çıkış kriteri). resolveSig
 * ENJEKTE edilir: gerçek okuma main'de (node-llama-cpp), burada saf + test edilebilir.
 */
export async function pickDraftModelChecked(
  mainPath: string,
  mainSizeBytes: number,
  candidates: ModelCandidate[],
  resolveSig: (path: string) => Promise<VocabSig | null>
): Promise<DraftPick> {
  const mainFam = detectFamily(mainPath.split('/').pop() ?? mainPath)
  if (mainFam === 'generic') return { path: null, reason: 'family' }
  const viable = candidates
    .filter((c) => c.path !== mainPath)
    .filter((c) => detectFamily(c.path.split('/').pop() ?? c.path) === mainFam)
    .filter((c) => c.sizeBytes > 0 && c.sizeBytes <= mainSizeBytes * 0.5)
    .filter((c) => !/(mmproj|[-_.]vl[-_.]|embed|nomic|bge|stable-diffusion|sdxl|flux)/i.test(c.path))
    .sort((a, b) => a.sizeBytes - b.sizeBytes)
  if (viable.length === 0) return { path: null, reason: 'no-candidate' }
  const targetSig = await resolveSig(mainPath)
  if (!targetSig) return { path: null, reason: 'metadata' } // hedef doğrulanamadı → seçme
  let lastReason: DraftPick['reason'] = 'metadata'
  for (const c of viable) {
    const sig = await resolveSig(c.path)
    if (!sig) continue
    const compat = isDraftCompatible(targetSig, sig)
    if (compat.ok) return { path: c.path }
    lastReason = compat.reason
  }
  return { path: null, reason: lastReason }
}

/** Bir oturum/proje anahtarından KARARLI, güvenli KV-slot dosya adı (resume). */
export function slotFileFor(key: string): string {
  const safe = (key || 'default').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'default'
  return `kv-${safe}.bin`
}

/** llama-server draft spawn argümanları (draft yoksa boş dizi). */
/**
 * Turbo'nun kullandığı SÜRÜM-HASSAS bayraklar. Bir binary güncellemesinde bunlar
 * yeniden adlandırılırsa/kaldırılırsa (b9870'de --draft-max kalktı gibi) binary
 * arg-parse'ta çıkar → turbo açık her yükleme kırılırdı. Yetenek probu (binaryCaps)
 * yüklemeden ÖNCE bunların binary --help'inde olduğunu doğrular; yoksa turbo kapanır.
 */
export const DRAFT_FLAGS: readonly string[] = ['--model-draft', '--spec-draft-n-max', '--spec-draft-n-min', '-ngld']

export function draftArgs(draftPath: string | null): string[] {
  if (!draftPath) return []
  // spec-draft-n-max: kabul edilirse sıçranan taslak token sayısı; -ngld 0 draft
  // CPU'da (küçük olduğu için ucuz), ana modelin VRAM'ini yemesin.
  // ⚠️ b9870: eski --draft-max/--draft-min KALDIRILDI (binary arg-parse'ta çıkıyordu,
  // turbo açık her yüklemeyi kırıyordu) → --spec-draft-n-max/-min (canlı --help doğrulandı).
  return ['--model-draft', draftPath, '--spec-draft-n-max', '16', '--spec-draft-n-min', '2', '-ngld', '0']
}

/** llama-server slot-save-path argümanları (resume dizini). */
export function slotArgs(slotDir: string | null): string[] {
  if (!slotDir) return []
  return ['--slot-save-path', slotDir]
}
