/**
 * FAZ 9.4 — Deterministik SpecVerifier.
 *
 * Grammar formatı garanti eder, İÇERİĞİ asla. "Derlendi/parse oldu" ≠ "spec
 * karşılandı" (8.4 canlı bug: istenen satır yokken 'verified'). Bu modül,
 * üretilen dosyaları Project Contract'a karşı MODELSİZ denetler: her sabit
 * literal (birebir kopya / URL / class dizisi) BİREBİR var mı, istenen Tailwind
 * sürümü kurulu mu, adlandırılmış dosyalar mevcut mu → fidelityScore. Bu skor
 * 'verified' hükmünü kapılar ve 9.5 escalation'ı somut sinyalle tetikler.
 *
 * Tamamen deterministik + bağımsız (projectContract tipini import eder).
 */
import type { ProjectContract } from './projectContract'

export interface SpecFile {
  path: string
  content: string
}

export interface SpecVerifyResult {
  /** 0..1 — birebir bulunan sabit literaller / toplam. */
  score: number
  total: number
  found: number
  /** Eksik literaller (kısaltılmış, rapor için). */
  missing: string[]
  /** İstenen Tailwind sürümü gerçekten kurulu mu? */
  tailwindOk: boolean
  /** Adlandırılmış dosyaların tümü mevcut mu? */
  filesOk: boolean
  /** Tümü geçti mi (score==1 && tailwindOk && filesOk). */
  ok: boolean
}

function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1]
}

/** package.json + CSS'ten gerçekte kurulu Tailwind sürümü. */
function installedTailwind(files: SpecFile[]): 'v3' | 'v4' | null {
  const pkg = files.find((f) => f.path === 'package.json')
  if (pkg) {
    try {
      const j = JSON.parse(pkg.content)
      const all: Record<string, string> = { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) }
      if (all['@tailwindcss/vite'] || all['@tailwindcss/postcss'] || /^[\^~]?4/.test(all['tailwindcss'] ?? '')) return 'v4'
      if (/^[\^~]?3/.test(all['tailwindcss'] ?? '')) return 'v3'
    } catch {
      /* yok say */
    }
  }
  const css = files.some(
    (f) => f.path.endsWith('.css') && /@import\s+["']tailwindcss["']|@theme\b/.test(f.content)
  )
  if (css) return 'v4'
  const css3 = files.some((f) => f.path.endsWith('.css') && /@tailwind\s+(base|components|utilities)/.test(f.content))
  if (css3) return 'v3'
  return null
}

export function specVerify(contract: ProjectContract, files: SpecFile[]): SpecVerifyResult {
  const allText = files.map((f) => f.content).join('\n')

  // 1) Birebir literaller (kopya/URL/class — hepsi slots'ta)
  let found = 0
  const missing: string[] = []
  for (const s of contract.slots) {
    if (s.text && allText.includes(s.text)) found++
    else missing.push(s.text.length > 48 ? s.text.slice(0, 48) + '…' : s.text)
  }
  const total = contract.slots.length
  const score = total === 0 ? 1 : found / total

  // 2) Tailwind sürümü eşleşiyor mu (spec sürüm istediyse)
  let tailwindOk = true
  if (contract.tailwindVersion) {
    tailwindOk = installedTailwind(files) === contract.tailwindVersion
  }

  // 3) Adlandırılmış dosya mimarisi mevcut mu (basename eşleşmesi)
  const bases = new Set(files.map((f) => basename(f.path)))
  const filesOk = contract.fileArchitecture.every((fa) => bases.has(basename(fa)))

  return {
    score,
    total,
    found,
    missing,
    tailwindOk,
    filesOk,
    ok: score === 1 && tailwindOk && filesOk
  }
}
