/**
 * Debug Engine — hata konumlama (roadmap 5.3): "sorun ŞURADA".
 *
 * Girdi: ham tanı metni (hata mesajı + stack) ve proje dosyaları.
 * Çıktı: sıralı şüpheli listesi — dosya + satır + sembol + güven + nedenler.
 *
 * İki kip:
 *  1) Stack proje dosyası söylüyorsa → DOĞRUDAN İSABET (yüksek güven);
 *     sembol adı stack çerçevesinden çekilir.
 *  2) Stack kesik/karartılmışsa (yalnız vendor chunk'ları) → ŞÜPHELİ
 *     SIRALAMASI: hatadaki tanımlayıcı hangi dosyada TANIMSIZ kullanılıyor
 *     (en güçlü sinyal), hangi dosyalar onu hiç kullanıyor, en son hangi
 *     dosyalar düzenlendi (bozan genelde son dokunulandır). Deterministik,
 *     modelsiz, milisaniyelik.
 *
 * Sonuç hem kullanıcı raporuna ("%92 bu dosya") hem model turuna (doğru
 * dosyaya odaklanmış satır-numaralı bağlam) beslenir — 5.1 tek borusu.
 */
import { importedNames, declaredNames } from './debugScan'

export interface Suspect {
  path: string
  line: number | null
  symbol: string | null
  /** 0-1 arası; rapora yüzde olarak yansır. */
  confidence: number
  /** Kısa, insan-okur nedenler (TR — uygulamanın rapor dili çekirdeği). */
  reasons: string[]
}

export interface Localization {
  primary: Suspect | null
  /** primary dahil, güvene göre sıralı (en çok 4). */
  suspects: Suspect[]
  /** Hatadan çekilen tanımlayıcı (varsa) — raporda ` `items` ` diye geçer. */
  identifier: string | null
}

type FileMap = Record<string, { path: string; content: string; updatedAt?: number }>

const CODE_RE = /\.(tsx|ts|jsx|js)$/i

/** Hata mesajından suçlu tanımlayıcıyı çek. */
function extractIdentifier(diagnosis: string): { name: string; kind: 'undefined' | 'property' | 'not-function' } | null {
  let m = diagnosis.match(/([\w$]+) is not defined/)
  if (m) return { name: m[1], kind: 'undefined' }
  m = diagnosis.match(/Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([\w$]+)'\)/)
  if (m) return { name: m[1], kind: 'property' }
  m = diagnosis.match(/([\w$.]+) is not a function/)
  if (m) return { name: m[1].split('.').pop() ?? m[1], kind: 'not-function' }
  return null
}

/** Stack'ten proje-dosyası çerçevelerini sırayla çek (sembol + satır dahil). */
function stackFrames(diagnosis: string, paths: string[]): Array<{ path: string; line: number | null; symbol: string | null }> {
  const frames: Array<{ path: string; line: number | null; symbol: string | null }> = []
  const seen = new Set<string>()
  // "at Sembol (yol:satır:sütun)" ya da "at yol:satır:sütun" ya da çıplak "yol:satır"
  const frameRe = /(?:at\s+([\w$.<>]+)\s*\()?([^\s():]+):(\d+):(\d+)\)?/g
  for (const m of diagnosis.matchAll(frameRe)) {
    const raw = m[2]
    const hit = paths.find((p) => raw === p || raw.endsWith('/' + p) || p.endsWith('/' + raw) || raw.includes(p))
    if (!hit || seen.has(hit + ':' + m[3])) continue
    seen.add(hit + ':' + m[3])
    frames.push({ path: hit, line: Number(m[3]), symbol: m[1] && m[1] !== 'async' ? m[1] : null })
  }
  // Satır bilgisiz düz yol geçişleri (ör. "File: src/App.tsx")
  if (frames.length === 0) {
    for (const p of paths) {
      if (CODE_RE.test(p) && diagnosis.includes(p)) {
        frames.push({ path: p, line: null, symbol: null })
        break
      }
    }
  }
  return frames
}

/** updatedAt sırasına göre 0-1 tazelik puanı (en yeni = 1). */
function recencyScores(files: FileMap): Map<string, number> {
  const stamped = Object.values(files).filter((f) => CODE_RE.test(f.path) && typeof f.updatedAt === 'number')
  const sorted = [...stamped].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
  const scores = new Map<string, number>()
  sorted.forEach((f, i) => scores.set(f.path, sorted.length > 1 ? i / (sorted.length - 1) : 1))
  return scores
}

export function locateFault(diagnosis: string, files: FileMap): Localization {
  const paths = Object.keys(files)
  const ident = extractIdentifier(diagnosis)
  const frames = stackFrames(diagnosis, paths)

  // ---- Kip 1: doğrudan isabet -------------------------------------------
  if (frames.length > 0) {
    const suspects: Suspect[] = frames.slice(0, 3).map((f, i) => ({
      path: f.path,
      line: f.line,
      symbol: f.symbol,
      confidence: i === 0 ? 0.92 : 0.6 - i * 0.15,
      reasons: [i === 0 ? 'stack çerçevesi doğrudan bu dosyayı gösteriyor' : 'stack\'te alt çerçeve']
    }))
    // Tanımlayıcı BAŞKA dosyada tanımsız kullanılıyorsa çapraz-dosya ipucu ekle
    if (ident && ident.kind === 'undefined') {
      for (const f of Object.values(files)) {
        if (!CODE_RE.test(f.path) || suspects.some((s) => s.path === f.path)) continue
        const uses = new RegExp(`\\b${ident.name}\\b`).test(f.content)
        if (!uses) continue
        const declared = declaredNames(f.content).has(ident.name) || importedNames(f.content).has(ident.name)
        if (!declared) {
          suspects.push({
            path: f.path,
            line: null,
            symbol: null,
            confidence: 0.35,
            reasons: [`'${ident.name}' burada da tanımsız kullanılıyor`]
          })
        }
      }
    }
    return { primary: suspects[0], suspects: suspects.slice(0, 4), identifier: ident?.name ?? null }
  }

  // ---- Kip 2: kesik stack → şüpheli sıralaması ---------------------------
  const recency = recencyScores(files)
  const scored: Suspect[] = []
  for (const f of Object.values(files)) {
    if (!CODE_RE.test(f.path)) continue
    let score = 0
    const reasons: string[] = []
    if (ident) {
      const usesRe = new RegExp(`\\b${ident.name}\\b`)
      if (usesRe.test(f.content)) {
        const declared = declaredNames(f.content).has(ident.name) || importedNames(f.content).has(ident.name)
        if (ident.kind === 'undefined' && !declared) {
          score += 0.55
          reasons.push(`'${ident.name}' kullanılıyor ama tanımlı/import değil`)
        } else if (ident.kind === 'property') {
          // ".prop" okuması undefined'a çarptı: .prop'u OKUYAN dosya baş şüpheli
          if (new RegExp(`\\.\\s*${ident.name}\\b`).test(f.content)) {
            score += 0.45
            reasons.push(`'.${ident.name}' erişimi bu dosyada`)
          } else {
            score += 0.15
            reasons.push(`'${ident.name}' bu dosyada geçiyor`)
          }
        } else {
          score += 0.2
          reasons.push(`'${ident.name}' bu dosyada geçiyor`)
        }
      }
    }
    const fresh = recency.get(f.path) ?? 0
    if (score > 0 && fresh > 0) {
      score += 0.15 * fresh
      if (fresh >= 0.99) reasons.push('en son düzenlenen dosya')
    }
    if (score > 0) {
      // Satır tahmini: tanımlayıcının ilk geçtiği satır
      let line: number | null = null
      if (ident) {
        const idx = f.content.search(new RegExp(`\\b${ident.name}\\b`))
        if (idx >= 0) line = f.content.slice(0, idx).split('\n').length
      }
      scored.push({ path: f.path, line, symbol: null, confidence: Math.min(0.85, score), reasons })
    }
  }
  scored.sort((a, b) => b.confidence - a.confidence)
  return { primary: scored[0] ?? null, suspects: scored.slice(0, 4), identifier: ident?.name ?? null }
}

/** Rapor satırı: "src/x.tsx:41 (Menu) — %85: neden; neden" */
export function formatLocalization(loc: Localization, tr: boolean): string {
  if (!loc.primary) {
    return tr ? 'Konum tespit edilemedi (sinyal yok).' : 'Could not localize (no signal).'
  }
  const lines: string[] = []
  const head = tr ? 'KONUM' : 'LOCATION'
  for (const s of loc.suspects) {
    const pct = Math.round(s.confidence * 100)
    const sym = s.symbol ? ` (${s.symbol})` : ''
    const ln = s.line ? ':' + s.line : ''
    lines.push(`${s === loc.primary ? `📍 ${head}: ` : '   aday: '}${s.path}${ln}${sym} — %${pct}: ${s.reasons.join('; ')}`)
  }
  return lines.join('\n')
}
