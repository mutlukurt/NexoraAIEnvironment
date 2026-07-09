/**
 * 10.12.2 — Token/bağlam kullanımının saf yardımcıları (motor + UI ortak; test edilebilir).
 *
 * usage normalizasyonu (OpenAI/Anthropic → tek şekil), bağlam doluluk formülü ve
 * ~tahmin (char/3.2 — kod+Türkçe için muhafazakâr; erken uyarı). tiktoken YOK
 * (Claude/GGUF'ta yanlış sayar — yalnız gerçek engine-usage ya da bu tahmin).
 */
export interface RawUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  input_tokens?: number
  output_tokens?: number
}

export interface NormUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens?: number
}

/** OpenAI-uyumlu usage → normalize (total_tokens yoksa null = geçersiz chunk). */
export function normalizeOpenAiUsage(u: RawUsage | undefined | null): NormUsage | null {
  if (!u || typeof u.total_tokens !== 'number') return null
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens,
    cachedTokens: u.prompt_tokens_details?.cached_tokens
  }
}

/** ~tahmin: kod+Türkçe karışık yük için ~3.2 char/token (muhafazakâr, erken uyarır). */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 3.2)
}

/** Bağlam doluluğu: kullanılabilir pencere = ctx − çıktı − güvenlik payı. */
export function contextFill(
  promptTokens: number,
  contextSize: number,
  maxOutput = 4096,
  safety = 4096
): { usable: number; fill: number; pct: number } {
  const usable = Math.max(1, contextSize - maxOutput - safety)
  const fill = contextSize > 0 ? Math.min(1, Math.max(0, promptTokens) / usable) : 0
  return { usable, fill, pct: Math.round(fill * 100) }
}

/** Doluluk bandı: yeşil <70, amber 70–90, kırmızı ≥90 (kırmızı = compaction yakın). */
export function usageBand(pct: number): 'green' | 'amber' | 'red' {
  return pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green'
}
