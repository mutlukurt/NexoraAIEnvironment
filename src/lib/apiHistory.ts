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
type MsgLike = { role?: string; content?: string; streaming?: boolean; images?: unknown[]; imagePrompt?: string }

/** Büyük-bağlam API'lerde ~48k karakter ≈ 12-15k token: pencere taşmasın ama
 * yakın geçmiş korunsun. En yeni turlardan geriye doğru bütçelenir. */
export const HISTORY_CHAR_BUDGET = 48000

/**
 * Yerel motora TAŞINACAK (seedHistory) geçmiş bütçesi — MODEL DEĞİŞİMİ / OTURUM
 * AÇILIŞI carryover'ı. API durumsuz olduğundan her tur 48000'i yeniden gönderir;
 * yerel motor durumlu (tohum bir kez, sonra KV-cache'te birikir). Ama switch
 * carryover'ı API'ye EŞ olmalı: güçlü/büyük-bağlam yerel modele geçince, API'ye
 * geçseydin hatırlayacağından AZINI hatırlamasın (parite). Bütçe modelin context
 * penceresine ölçeklenir (~%40'ı taşınan geçmişe, kalanı güncel tur + üretim),
 * API tavanında (48000) doyar; bağlam bilinmiyorsa eski muhafazakâr 12000 tabanı.
 */
export function seedHistoryBudget(contextTokens?: number): number {
  if (!contextTokens || contextTokens <= 0) return 12000
  const CHARS_PER_TOKEN = 3.5 // TR/kod/EN karışık kaba oran
  const HISTORY_FRACTION = 0.4
  const scaled = Math.floor(contextTokens * CHARS_PER_TOKEN * HISTORY_FRACTION)
  return Math.min(HISTORY_CHAR_BUDGET, Math.max(12000, scaled))
}

/** Bütçe dışına düşen eski turların özet derlemesi için karakter tavanı. */
export const DIGEST_CHAR_BUDGET = 3500

/**
 * Bütçe dışına düşen turları kronolojik, kısaltılmış bir bağlam notuna derle —
 * eskiden bunlar SESSİZCE düşüyordu (yerel motor özet alırken API almıyordu).
 * Deterministik (LLM'siz): her tur tek satır, ilk ~160 karakter. Açılış turu
 * (konuyu kuran mesaj) daima dahil; kalan yer en yeni düşenlere ayrılır.
 */
function digestDropped(dropped: ChatTurn[]): string {
  const line = (t: ChatTurn): string => {
    const who = t.role === 'user' ? 'Kullanıcı' : 'Asistan'
    const body = t.content.replace(/\s+/g, ' ').trim()
    return `- ${who}: ${body.length > 160 ? body.slice(0, 160) + '…' : body}`
  }
  const opener = line(dropped[0])
  const rest: string[] = []
  let used = opener.length
  for (let i = dropped.length - 1; i >= 1; i--) {
    const l = line(dropped[i])
    if (used + l.length > DIGEST_CHAR_BUDGET) break
    rest.unshift(l)
    used += l.length
  }
  const skipped = dropped.length - 1 - rest.length
  return (
    '[Bağlam notu: sohbetin daha eski kısmı uzunluk sınırı nedeniyle kısaltıldı. Kronolojik özet derlemesi:\n' +
    opener +
    (skipped > 0 ? `\n…(${skipped} eski tur atlandı)…` : '') +
    (rest.length ? '\n' + rest.join('\n') : '') +
    '\nBu nottaki bilgiler geçerli bağlamdır; kullanıcıya bu notu gösterme.]'
  )
}

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
    if (!content) {
      // Faz 13: görsel mesajının content'i boş (yalnız images[]) — geçmişten
      // sessizce düşünce model "görsel üretilmedi" sanıyordu (canlı bug).
      // Metin izi bırak ki sonraki text/API turu görseli bilsin.
      if (m.role === 'assistant' && Array.isArray(m.images) && m.images.length > 0) {
        // 14.9 — SON görsel bağlamı: yalnız "üretildi" demek yetmiyordu; model
        // düzenleme istendiğinde konuyu unutup kendi önceki [IMG] şablonunu
        // kopyalıyordu (canlı bug: turuncu balon → "gece moduna çevir" → yeşil
        // ejderha logosu). Konuyu AÇIKÇA ve düzenlenebilir olduğunu belirt.
        turns.push({
          role: 'assistant',
          content: m.imagePrompt
            ? `[Bu sohbette bir görsel ürettim — konusu: "${m.imagePrompt}". Sohbetteki güncel/son görsel bu; kullanıcı "bunu/bu görseli/şunu" der ya da bir değişiklik isterse TAM OLARAK bu görseli ([EDIT] ile) düzenle, konusunu koru.]`
            : '[Görsel üretildi]'
        })
      }
      continue
    }
    turns.push({ role: m.role, content })
  }
  let total = 0
  const kept: ChatTurn[] = []
  let cut = -1 // kept'e girmeyen son (en yeni) düşen turun indeksi
  for (let i = turns.length - 1; i >= 0; i--) {
    total += turns[i].content.length
    if (total > budget && kept.length > 0) {
      cut = i
      break
    }
    kept.unshift(turns[i])
  }
  // Düşen turlar varsa özet derlemesini başa iliştir. Rol alternasyonu korunur:
  // ilk kalan tur user ise notu içeriğinin başına göm; assistant ise nottan
  // ayrı bir user turu aç (user→assistant→… dizilimi bozulmaz).
  if (cut >= 0) {
    const digest = digestDropped(turns.slice(0, cut + 1))
    if (kept[0]?.role === 'user') {
      kept[0] = { role: 'user', content: digest + '\n\n' + kept[0].content }
    } else {
      kept.unshift({ role: 'user', content: digest })
    }
  }
  return kept
}
