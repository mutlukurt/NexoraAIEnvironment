/**
 * Faz 14.10 — Statik davranış (Potemkin-UI) dedektörü.
 *
 * Görsel öz-inceleme "render oluyor"u kanıtlar ama "çalışıyor"u değil — ölü
 * onClick, no-op handler, onSubmit'siz form, mock/placeholder veri barındıran
 * arayüzler geçebiliyor. Bu modül üretilen React/JSX'i STATİK tarayıp bu
 * "davranış kokularını" çıkarır (canlı CDP gerektirmez, deterministik). Sonuç
 * kullanıcıya uyarı olarak sunulur / onarım döngüsüne beslenebilir.
 */

export interface BehaviorIssue {
  path: string
  line: number
  kind: 'dead-button' | 'noop-handler' | 'form-no-submit' | 'mock-data' | 'dead-link'
  detail: string
}

const CODE_RE = /\.(tsx|jsx)$/i

export function detectDeadInteractions(files: Array<{ path: string; content: string }>): BehaviorIssue[] {
  const issues: BehaviorIssue[] = []
  for (const f of files) {
    if (!CODE_RE.test(f.path) || f.content.startsWith('data:')) continue
    const lines = f.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const at = (kind: BehaviorIssue['kind'], detail: string) => issues.push({ path: f.path, line: i + 1, kind, detail })

      // no-op handler: onClick={() => {}} / onSubmit={() => {}} (boş gövde)
      if (/on[A-Z]\w+=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(line)) at('noop-handler', 'boş ok-fonksiyon handler (hiçbir şey yapmaz)')
      else if (/on[A-Z]\w+=\{\s*\(\s*\)\s*=>\s*(?:undefined|null|void\s+0)\s*\}/.test(line)) at('noop-handler', 'handler no-op döndürür')

      // <button …> onClick YOK (aynı satırda ve etiket kapanıyorsa) — kaba sezgi
      const btn = /<button\b([^>]*)>/.exec(line)
      if (btn && !/on[A-Z]\w+=|type=["']submit["']/.test(btn[1]) && !/\{/.test(btn[1])) at('dead-button', '<button> handler/type=submit yok')

      // <a> href yok veya href="#" (ölü link)
      const a = /<a\b([^>]*)>/.exec(line)
      if (a && (!/href=/.test(a[1]) || /href=["']#["']/.test(a[1])) && !/on[A-Z]\w+=/.test(a[1])) at('dead-link', '<a> gerçek href/handler yok (href="#" ya da yok)')

      // <form> onSubmit yok (ve action yok)
      const form = /<form\b([^>]*)>/.exec(line)
      if (form && !/onSubmit=|action=/.test(form[1])) at('form-no-submit', '<form> onSubmit/action yok')

      // mock/placeholder veri işaretleri
      if (/\b(TODO|FIXME|mock(Data|ed)?|placeholder\s*data|lorem ipsum|dummy(Data)?)\b/i.test(line) && !/\/\/\s*(eslint|@ts)/.test(line)) at('mock-data', 'mock/placeholder/TODO işareti')
    }
  }
  // Aynı satır-tür tekrarını sınırla (gürültü kes): en çok 12 bulgu
  return issues.slice(0, 12)
}

/** Bulguları kullanıcıya gösterilecek kısa uyarı bloğuna biçimle (yoksa boş). */
export function formatBehaviorReport(issues: BehaviorIssue[]): string {
  if (issues.length === 0) return ''
  const label: Record<BehaviorIssue['kind'], string> = {
    'dead-button': 'İşlevsiz buton',
    'noop-handler': 'Boş handler',
    'form-no-submit': 'onSubmit\'siz form',
    'mock-data': 'Sahte/placeholder veri',
    'dead-link': 'Ölü bağlantı'
  }
  const lines = issues.map((x) => `• ${x.path}:${x.line} — ${label[x.kind]}: ${x.detail}`)
  return `⚠️ Davranış denetimi — arayüz "görünüyor" ama şunlar gerçekten çalışmayabilir:\n${lines.join('\n')}`
}
