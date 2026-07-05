/**
 * Onarım Merdiveni — Kat 0: deterministik, MODELSİZ hata onarımı.
 *
 * Sahibin tespiti (2026-07-05): "kod düzeltme sorununu çözmeden ne yapsak
 * boş". Küçük modelin ürettiği hataların büyük çoğunluğu SAYILABİLİR
 * sınıflara düşer: eksik import, tanımsız lucide ikonu, kesme işaretiyle
 * erken kapanan string… Bu sınıflar modele hiç sorulmadan, milisaniyede ve
 * %100 kesinlikle kodla onarılır; model yalnızca kalanlara çağrılır.
 */

export interface RepairFix {
  path: string
  content: string
  note: string
}

const REACT_HOOKS = new Set([
  'useState', 'useEffect', 'useMemo', 'useRef', 'useCallback', 'useContext', 'useReducer', 'useLayoutEffect'
])

/** Tanı metninden hedef dosya yolunu çek ("File: src/App.tsx" ya da vite "src/App.tsx:12:5"). */
export function fileFromDiagnosis(diagnosis: string, knownPaths: string[]): string | null {
  const m = diagnosis.match(/File:\s*([^\s\n]+)/)
  if (m && knownPaths.includes(m[1])) return m[1]
  for (const p of knownPaths) {
    if (diagnosis.includes(p)) return p
  }
  return null
}

/** Tanıdan satır numarası çek ("(12:5)", ":12:5", "line 12"). */
function lineFromDiagnosis(diagnosis: string): number | null {
  const m = diagnosis.match(/\((\d+):\d+\)/) ?? diagnosis.match(/:(\d+):\d+/) ?? diagnosis.match(/line\s+(\d+)/i)
  return m ? Number(m[1]) : null
}

/** "X is not defined" / "X is not exported" sınıfındaki tanımlayıcıyı çek. */
function undefinedIdent(diagnosis: string): string | null {
  const m =
    diagnosis.match(/([A-Za-z_$][\w$]*) is not defined/) ??
    diagnosis.match(/does not provide an export named ['"]([\w$]+)['"]/)
  return m ? m[1] : null
}

function addNamedImport(content: string, name: string, from: string): string {
  const re = new RegExp(`(import\\s*\\{)([^}]*)(\\}\\s*from\\s*['"]${from.replace(/[/\\]/g, '\\$&')}['"])`)
  const m = content.match(re)
  if (m) {
    if (new RegExp(`\\b${name}\\b`).test(m[2])) return content
    return content.replace(re, `$1$2, ${name}$3`)
  }
  return `import { ${name} } from '${from}'\n` + content
}

/** Projedeki dosyalarda `name` adında export var mı? → görece import yolu döndür. */
function findExportSource(
  name: string,
  files: Record<string, { path: string; content: string }>,
  importerPath: string
): { from: string; named: boolean } | null {
  for (const f of Object.values(files)) {
    if (f.path === importerPath || !/\.(tsx|ts|jsx|js)$/.test(f.path)) continue
    const isDefault =
      new RegExp(`export\\s+default\\s+(function\\s+)?${name}\\b`).test(f.content) ||
      (new RegExp(`function\\s+${name}\\b`).test(f.content) && /export\s+default\s+\w/.test(f.content) === false && f.path.endsWith(`/${name}.tsx`))
    const isNamed = new RegExp(`export\\s+(const|function|class)\\s+${name}\\b`).test(f.content)
    if (isDefault || isNamed || f.path.endsWith(`/${name}.tsx`) || f.path.endsWith(`/${name}.jsx`)) {
      // Görece yol hesabı
      const fromDir = importerPath.includes('/') ? importerPath.slice(0, importerPath.lastIndexOf('/')).split('/') : []
      const target = f.path.replace(/\.(tsx|ts|jsx|js)$/, '').split('/')
      let common = 0
      while (common < fromDir.length && common < target.length - 1 && fromDir[common] === target[common]) common++
      const rel = '../'.repeat(fromDir.length - common) + target.slice(common).join('/')
      return { from: rel.startsWith('.') ? rel : './' + rel, named: isNamed && !isDefault }
    }
  }
  return null
}

/**
 * Kat 0 onarımı: tanı + dosyalar → uygulanabilir kesin düzeltmeler.
 * Boş dizi = bu tanı sınıfını kodla onaramıyoruz, model katına geç.
 */
export function autoRepair(
  diagnosis: string,
  files: Record<string, { path: string; content: string }>
): RepairFix[] {
  const paths = Object.keys(files)
  const target = fileFromDiagnosis(diagnosis, paths)
  if (!target) return []
  const file = files[target]
  const fixes: RepairFix[] = []

  // ---- Sınıf 1: tanımsız tanımlayıcı (import eksik) --------------------
  const ident = undefinedIdent(diagnosis)
  if (ident) {
    // 1a) React hook'u
    if (REACT_HOOKS.has(ident)) {
      const patched = addNamedImport(file.content, ident, 'react')
      if (patched !== file.content) {
        return [{ path: target, content: patched, note: `eksik React import'u eklendi: ${ident}` }]
      }
    }
    // 1b) React'in kendisi
    if (ident === 'React') {
      const patched = `import React from 'react'\n` + file.content
      return [{ path: target, content: patched, note: "eksik import eklendi: React" }]
    }
    // 1c) Büyük harfli JSX bileşeni: projede export'u varsa import et
    if (/^[A-Z]/.test(ident)) {
      const src = findExportSource(ident, files, target)
      if (src) {
        const patched = src.named
          ? addNamedImport(file.content, ident, src.from)
          : `import ${ident} from '${src.from}'\n` + file.content
        return [{ path: target, content: patched, note: `eksik bileşen import'u eklendi: ${ident} ← ${src.from}` }]
      }
      // 1d) Projede yoksa ve dosya lucide-react kullanıyorsa: ikon varsay
      if (/from ['"]lucide-react['"]/.test(file.content) || new RegExp(`<${ident}[\\s/>]`).test(file.content)) {
        const patched = addNamedImport(file.content, ident, 'lucide-react')
        if (patched !== file.content) {
          return [{ path: target, content: patched, note: `lucide-react import'una eklendi: ${ident}` }]
        }
      }
    }
  }

  // ---- Sınıf 2: kesme işaretiyle erken kapanan string ------------------
  if (/Unterminated string|Unexpected token/.test(diagnosis)) {
    const line = lineFromDiagnosis(diagnosis)
    if (line) {
      const lines = file.content.split('\n')
      const idx = line - 1
      if (idx >= 0 && idx < lines.length) {
        const L = lines[idx]
        // 'İstanbul'un ...' kalıbı: tek tırnaklı string içinde kesme işareti →
        // çift tırnağa çevir (içinde çift tırnak yoksa).
        const m = L.match(/'([^']*'[^']*)'/)
        if (m && !m[1].includes('"')) {
          lines[idx] = L.replace(/'([^']*'[^']*)'/, `"$1"`)
          fixes.push({
            path: target,
            content: lines.join('\n'),
            note: `satır ${line}: kesme işaretli string çift tırnağa çevrildi`
          })
          return fixes
        }
      }
    }
  }

  // ---- Sınıf 3: görece import hedefi yok (yanlış uzantı/büyük-küçük) ----
  const badImport = diagnosis.match(/Failed to resolve import ['"](\.[^'"]+)['"] from ['"]([^'"]+)['"]/)
  if (badImport) {
    const spec = badImport[1]
    const importer = paths.find((p) => badImport[2].endsWith(p)) ?? target
    const importerDir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : ''
    // İstenen mutlak proje yolu
    const wanted = (importerDir ? importerDir + '/' : '') + spec.replace(/^\.\//, '')
    const norm = wanted.split('/').reduce<string[]>((acc, part) => {
      if (part === '..') acc.pop()
      else if (part !== '.') acc.push(part)
      return acc
    }, []).join('/')
    const candidate = paths.find(
      (p) => p.toLowerCase() === norm.toLowerCase() || p.toLowerCase().replace(/\.(tsx|ts|jsx|js)$/, '') === norm.toLowerCase()
    )
    if (candidate && files[importer]) {
      // Doğru görece yolu kur
      const fromDir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')).split('/') : []
      const t = candidate.replace(/\.(tsx|ts|jsx|js)$/, '').split('/')
      let common = 0
      while (common < fromDir.length && common < t.length - 1 && fromDir[common] === t[common]) common++
      const rel = '../'.repeat(fromDir.length - common) + t.slice(common).join('/')
      const fixed = files[importer].content.split(spec).join(rel.startsWith('.') ? rel : './' + rel)
      if (fixed !== files[importer].content) {
        return [{ path: importer, content: fixed, note: `kırık import yolu düzeltildi: ${spec} → ${rel}` }]
      }
    }
  }

  return fixes
}

/**
 * Model düzeltme turu için satır numaralı bağlam: hatalı dosyanın hata
 * satırı çevresi. SEARCH bloğunun birebir kopyalanabilmesi için.
 */
export function numberedSnippet(
  diagnosis: string,
  files: Record<string, { path: string; content: string }>
): string {
  const target = fileFromDiagnosis(diagnosis, Object.keys(files))
  if (!target) return ''
  const line = lineFromDiagnosis(diagnosis) ?? 1
  const lines = files[target].content.split('\n')
  const from = Math.max(0, line - 1 - 12)
  const to = Math.min(lines.length, line - 1 + 12)
  const body = lines
    .slice(from, to)
    .map((l, i) => `${String(from + i + 1).padStart(4)}| ${l}`)
    .join('\n')
  return `\n--- ${target} (hata satırı ${line} çevresi, satır numaralı) ---\n${body}\n--- SON ---\nSEARCH bloğun, yukarıdaki pasajdan (satır numaraları OLMADAN) birebir kopyalanmış ardışık satırlar olmak ZORUNDA.`
}
