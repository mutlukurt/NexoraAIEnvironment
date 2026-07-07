/**
 * Yorumla-yönlendir (roadmap 7.4) — saf çekirdek.
 *
 * İnceleme panelindeki bir diff satırına ya da bir artifact belgesinin
 * bölümüne yazılan yorum, "yeni belirsiz brief" değil, dosya:satır çapalı
 * CERRAHİ talimat olarak bir SONRAKİ tura iliştirilir. Tur koşarken yazılan
 * yorumlar kuyrukta bekler — koşan turu asla öldürmez.
 *
 * Bu modül store'suz saf fonksiyonlardır: `npm run test:steer` doğrudan koşar.
 */

export interface SteerComment {
  id: string
  anchor:
    | { kind: 'diff'; path: string; line: number; excerpt: string }
    | { kind: 'doc'; doc: string; section: string }
  text: string
  createdAt: number
}

const MAX_COMMENTS = 12
const MAX_TEXT = 300
const CONTEXT = 2

/** Çapa satırının çevresini satır-numaralı ver — SEARCH bloğu birebir kopyalansın. */
function numberedContext(content: string, line: number): string {
  const lines = content.split('\n')
  const from = Math.max(1, line - CONTEXT)
  const to = Math.min(lines.length, line + CONTEXT)
  const out: string[] = []
  for (let n = from; n <= to; n++) {
    out.push(`   ${n}| ${lines[n - 1] ?? ''}${n === line ? '   ← COMMENT TARGET' : ''}`)
  }
  return out.join('\n')
}

/**
 * Yorumları modele giden tura iliştirilecek blok olarak bileştir.
 * Diff çapaları dosyanın GÜNCEL baytlarından satır-numaralı bağlam taşır
 * (dosya/satır artık yoksa inceleme anındaki alıntıya düşer — dürüst iz).
 */
export function composeCommentBlock(
  comments: SteerComment[],
  files: Record<string, { content: string }>,
  tr: boolean
): string {
  if (comments.length === 0) return ''
  const list = comments.slice(0, MAX_COMMENTS)
  const lines: string[] = []
  lines.push('=== REVIEW COMMENTS (user feedback anchored to exact lines/sections) ===')
  lines.push(
    'Apply EACH comment with a SMALL surgical SEARCH/REPLACE edit at its anchor. Do NOT rebuild files, do NOT touch unrelated code.'
  )
  list.forEach((c, i) => {
    const text = c.text.trim().slice(0, MAX_TEXT)
    if (c.anchor.kind === 'diff') {
      lines.push('', `${i + 1}. ${c.anchor.path}:${c.anchor.line}`)
      const f = files[c.anchor.path]
      const ln = c.anchor.line
      if (f && ln >= 1 && ln <= f.content.split('\n').length) {
        lines.push(numberedContext(f.content, ln))
      } else {
        // Dosya silinmiş ya da satır kaymış — inceleme anındaki alıntı kalır.
        lines.push(`   (line no longer present; reviewed text was: ${JSON.stringify(c.anchor.excerpt.slice(0, 120))})`)
      }
      lines.push(`   USER${tr ? ' (Türkçe)' : ''}: "${text}"`)
    } else {
      lines.push('', `${i + 1}. [${c.anchor.doc} § ${c.anchor.section}]`)
      lines.push(`   USER${tr ? ' (Türkçe)' : ''}: "${text}"`)
    }
  })
  if (comments.length > MAX_COMMENTS) {
    lines.push('', `(+${comments.length - MAX_COMMENTS} more comments were queued — they will arrive next turn)`)
  }
  lines.push('=== END REVIEW COMMENTS ===')
  return lines.join('\n')
}

/** Sohbet çipi için kısa özet: "Hero.tsx:12 · walkthrough § Özellikler …" */
export function summarizeComments(comments: SteerComment[]): string {
  return comments
    .slice(0, 3)
    .map((c) => (c.anchor.kind === 'diff' ? `${c.anchor.path.split('/').pop()}:${c.anchor.line}` : `${c.anchor.doc} § ${c.anchor.section.slice(0, 18)}`))
    .join(' · ')
}
