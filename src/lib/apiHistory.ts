/**
 * 10.13 — Uzak (API) sohbet sürekliliği.
 *
 * Uzak modeller (OpenAI-uyumlu / Anthropic) DURUMSUZDUR: her istekte yalnız o
 * turun mesajını görürler. Önceki turları {role,content} dizisiyle taşımazsak
 * model bir önceki mesajı unutur — canlı bug: kullanıcı "evrim teorisini anlat"
 * dedi, ardından "özet geçme detaylı anlat" dedi, model "hangi konuyu?" diye
 * sordu (bağlamı tamamen kaybetti). Yerel motor kendi KV-cache history'sini
 * tuttuğundan bu yalnız API yolunda kullanılır.
 */

export type ChatTurn = { role: 'user' | 'assistant'; content: string }
type MsgLike = { role?: string; content?: string; streaming?: boolean }

/** Büyük-bağlam API'lerde ~48k karakter ≈ 12-15k token: pencere taşmasın ama
 * yakın geçmiş korunsun. En yeni turlardan geriye doğru bütçelenir. */
export const HISTORY_CHAR_BUDGET = 48000

/**
 * Sohbet mesajlarını API'ye gidecek {role,content} dizisine çevir.
 * - Yalnız user/assistant rolleri (system kartları, araç/görev kartları elenir).
 * - Boş content (yalnız-kart mesajları) ve akan (streaming) placeholder elenir.
 * - En yeni turlar bir karakter bütçesiyle sınırlanır (en az 1 tur daima kalır).
 */
export function buildApiHistory(msgs: readonly MsgLike[], budget = HISTORY_CHAR_BUDGET): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (m.streaming) continue
    const content = (m.content ?? '').trim()
    if (!content) continue
    turns.push({ role: m.role, content })
  }
  let total = 0
  const kept: ChatTurn[] = []
  for (let i = turns.length - 1; i >= 0; i--) {
    total += turns[i].content.length
    if (total > budget && kept.length > 0) break
    kept.unshift(turns[i])
  }
  return kept
}
