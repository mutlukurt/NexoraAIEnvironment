/**
 * 20.2 — Güvenlik-inceleme geçişi + GÜVEN FİLTRESİ (Piebald yol haritası).
 *
 * Üretilen/düzenlenen kodda yaygın güvenlik kokularını DETERMİNİSTİK tarar
 * (behaviorCheck 14.10 kardeşi). Kritik olan GÜVEN FİLTRESİ: her bulgunun bir
 * güven düzeyi var; yalnız 'high'+'medium' yüzeye çıkar, 'low' (gürültü) bastırılır
 * — yanlış-pozitif seli olmadan gerçek riskleri gösterir. Saf — `npm run test:security`.
 */

export type Confidence = 'high' | 'medium' | 'low'

export interface SecurityFinding {
  path: string
  line: number
  confidence: Confidence
  kind: string
  message: string
}

const KEY_LIKE = /(api[_-]?key|secret|password|passwd|token|access[_-]?key|private[_-]?key)/i
const PLACEHOLDER = /(process\.env|import\.meta\.env|your[_-]?|example|placeholder|xxx+|\.\.\.|<[^>]+>|changeme|test|dummy)/i

/** Bilinen sağlayıcı anahtar biçimleri — belirsiz değil → HIGH güven. */
const HARD_SECRETS: Array<{ re: RegExp; kind: string }> = [
  { re: /\bsk-[A-Za-z0-9]{20,}\b/, kind: 'OpenAI API anahtarı' },
  { re: /\bghp_[A-Za-z0-9]{36,}\b/, kind: 'GitHub token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, kind: 'AWS erişim anahtarı' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, kind: 'Google API anahtarı' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, kind: 'Slack token' }
]

export function scanSecurity(files: Array<{ path: string; content: string }>): SecurityFinding[] {
  const out: SecurityFinding[] = []
  for (const f of files) {
    // .env dosyalarını tarama — orada anahtar OLMASI beklenir (yanlış-pozitif).
    if (/(^|\/)\.env(\.|$)/.test(f.path)) continue
    const lines = f.content.split('\n')
    lines.forEach((raw, i) => {
      const line = raw
      const n = i + 1

      // 1) Bilinen sağlayıcı anahtarı gömülü → HIGH
      for (const s of HARD_SECRETS) {
        if (s.re.test(line)) out.push({ path: f.path, line: n, confidence: 'high', kind: 'gömülü-sır', message: `${s.kind} kaynağa gömülmüş — ortam değişkenine taşı` })
      }

      // 2) Anahtar-benzeri değişkene string atanmış (placeholder değilse) → MEDIUM
      const assign = /(\w*(?:key|secret|password|passwd|token))\s*[:=]\s*(['"`])([^'"`]{8,})\2/i.exec(line)
      if (assign && KEY_LIKE.test(assign[1]) && !PLACEHOLDER.test(assign[3]) && !PLACEHOLDER.test(line)) {
        out.push({ path: f.path, line: n, confidence: 'medium', kind: 'olası-sır', message: `'${assign[1]}' sabit bir değere atanmış — sır olabilir, ortam değişkeni kullan` })
      }

      // 3) eval / new Function → kod-enjeksiyon riski, MEDIUM
      if (/\beval\s*\(/.test(line)) out.push({ path: f.path, line: n, confidence: 'medium', kind: 'eval', message: 'eval() kod enjeksiyonuna açık — kaçın' })
      if (/\bnew\s+Function\s*\(/.test(line)) out.push({ path: f.path, line: n, confidence: 'medium', kind: 'new-Function', message: 'new Function() eval gibidir — kaçın' })

      // 4) dangerouslySetInnerHTML → XSS riski, MEDIUM
      if (/dangerouslySetInnerHTML/.test(line)) out.push({ path: f.path, line: n, confidence: 'medium', kind: 'xss', message: 'dangerouslySetInnerHTML XSS riski — kullanıcı girdisini sanitize et' })

      // 5) Güvensiz http:// (localhost hariç) → LOW (çoğu zaman zararsız → filtreyle bastırılır)
      if (/\bhttp:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(line)) {
        out.push({ path: f.path, line: n, confidence: 'low', kind: 'insecure-http', message: 'http:// (şifresiz) — mümkünse https kullan' })
      }
    })
  }
  return out
}

/** GÜVEN FİLTRESİ: yalnız istenen eşik ve üstü. Varsayılan 'medium' → 'low' gürültüsü bastırılır. */
export function filterByConfidence(findings: SecurityFinding[], min: Confidence = 'medium'): SecurityFinding[] {
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }
  return findings.filter((f) => rank[f.confidence] >= rank[min])
}

const ICON: Record<Confidence, string> = { high: '🔴', medium: '🟠', low: '🟡' }

export function formatSecurityReport(findings: SecurityFinding[]): string {
  if (findings.length === 0) return ''
  const lines = [`🔒 Güvenlik incelemesi — ${findings.length} bulgu (güven-filtreli):`]
  for (const f of findings.slice(0, 12)) {
    lines.push(`  ${ICON[f.confidence]} ${f.path}:${f.line} — ${f.message}`)
  }
  return lines.join('\n')
}
