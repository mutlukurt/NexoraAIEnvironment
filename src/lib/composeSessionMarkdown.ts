/**
 * 16.3 — Yerel konuşma/diff dışa aktarma (Piebald yol haritası): bir oturumu
 * Markdown'a çevirir. Bulut "share-link"in DÜRÜST yerel karşılığı — dosya
 * kullanıcının diskinde kalır, hiçbir yere yüklenmez. Konuşma + (proje
 * oturumlarında) mesajlardaki diffStats'tan türetilen değişiklik özeti.
 *
 * Saf fonksiyon — `npm run test:export` doğrudan koşar (Electron/DOM yok).
 */
import type { ChatMessage } from '@shared/ipc'

export interface ComposeExportOpts {
  title?: string
  language?: 'tr' | 'en'
  /** ISO/okunur zaman damgası (test için dışarıdan verilir — Date.now() saflığı bozar). */
  exportedAt?: string
}

/** Mesajlardaki diffStats'ı yola göre topla → tek değişiklik özeti. */
function aggregateDiffs(messages: ChatMessage[]): Array<{ path: string; added: number; removed: number; isNew: boolean }> {
  const byPath = new Map<string, { added: number; removed: number; isNew: boolean }>()
  for (const m of messages) {
    for (const d of m.diffStats ?? []) {
      const cur = byPath.get(d.path) ?? { added: 0, removed: 0, isNew: false }
      byPath.set(d.path, { added: cur.added + d.added, removed: cur.removed + d.removed, isNew: cur.isNew || d.isNew })
    }
  }
  return [...byPath.entries()].map(([path, v]) => ({ path, ...v })).sort((a, b) => a.path.localeCompare(b.path))
}

export function composeSessionMarkdown(messages: ChatMessage[], opts: ComposeExportOpts = {}): string {
  const tr = opts.language !== 'en'
  const out: string[] = []
  out.push(`# ${opts.title || (tr ? 'NexoraAI Oturumu' : 'NexoraAI Session')}`)
  if (opts.exportedAt) out.push(`\n_${tr ? 'Dışa aktarıldı' : 'Exported'}: ${opts.exportedAt}_`)
  out.push('\n---\n')

  for (const m of messages) {
    const hasBody = (m.content && m.content.trim()) || m.image || (m.images && m.images.length)
    if (!hasBody) continue
    const who = m.role === 'user'
      ? (tr ? '🧑 Kullanıcı' : '🧑 User')
      : '🤖 NexoraAI'
    out.push(`### ${who}`)
    if (m.content && m.content.trim()) out.push(m.content.trim())
    if (m.image) out.push(`_(${tr ? 'üretilen görsel' : 'generated image'}: ${m.image.name})_`)
    else if (m.images && m.images.length) out.push(`_(${m.images.length} ${tr ? 'üretilen görsel' : 'generated images'})_`)
    out.push('')
  }

  const diffs = aggregateDiffs(messages)
  if (diffs.length > 0) {
    out.push('\n---\n')
    out.push(`## ${tr ? 'Değişiklikler' : 'Changes'}`)
    out.push('')
    for (const d of diffs) {
      out.push(`- \`${d.path}\`${d.isNew ? (tr ? ' _(yeni)_' : ' _(new)_') : ''} — +${d.added} / −${d.removed}`)
    }
  }

  out.push(`\n---\n_${tr
    ? 'NexoraAI ile YEREL olarak üretildi — hiçbir veri makineden çıkmadı.'
    : 'Generated LOCALLY with NexoraAI — nothing left your machine.'}_`)
  return out.join('\n')
}
