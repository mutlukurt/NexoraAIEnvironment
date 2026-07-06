/**
 * Debug Engine — statik proje taraması (roadmap 5.2).
 *
 * "Çalıştırmadan hatayı bul": projenin TÜM dosyaları milisaniyeler içinde
 * taranır — sözdizimi (Babel katman-1), import grafiği (çözülmeyen /
 * büyük-küçük harfi bozuk yollar, var olmayan export'lar), tanımsız JSX
 * bileşenleri, importsuz React hook'ları, tanımsız veri değişkenleri
 * (.map/.filter), şablon marker artıkları, package.json sağlığı.
 *
 * TASARIM İLKESİ: her bulgu, autoRepair'in (Onarım Merdiveni Kat 0) birebir
 * anladığı `diagnosis` metniyle üretilir — taramanın bulduğu hata, runtime'da
 * yakalanmış gibi AYNI merdivene akar: önce modelsiz kesin onarım, kalanlar
 * satır-numaralı model turu. Tek boru hattı (roadmap 5.1), iki ayrı beyin değil.
 */
import { syntaxCheckFiles } from './verifyCode'

export interface ScanFinding {
  path: string
  line: number | null
  /** Hata sınıfı — telemetri ve rapor gruplaması için. */
  cls:
    | 'syntax'
    | 'import-unresolved'
    | 'import-missing-export'
    | 'jsx-undefined'
    | 'hook-missing-import'
    | 'data-undefined'
    | 'template-marker'
    | 'package-json'
    | 'ts-semantic'
  message: string
  /** Kat 0'ın (autoRepair) beklediği biçimde sentetik tanı. */
  diagnosis: string
  /** Kat 0'ın bu sınıfı modelsiz onarma ihtimali var mı? */
  deterministic: boolean
}

type FileMap = Record<string, { path: string; content: string }>

const CODE_RE = /\.(tsx|ts|jsx|js)$/i
const REACT_HOOKS = [
  'useState', 'useEffect', 'useMemo', 'useRef', 'useCallback', 'useContext', 'useReducer', 'useLayoutEffect'
]
// Tarayıcı/JSX ortamında zaten var olan global adlar — yanlış alarm vermesin.
const KNOWN_GLOBALS = new Set([
  'React', 'window', 'document', 'console', 'localStorage', 'sessionStorage', 'navigator',
  'JSON', 'Math', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise',
  'Set', 'Map', 'RegExp', 'Error', 'parseInt', 'parseFloat', 'isNaN', 'fetch', 'alert',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'Intl', 'URL', 'URLSearchParams', 'FormData', 'crypto', 'performance', 'structuredClone',
  'encodeURIComponent', 'decodeURIComponent', 'undefined', 'Infinity', 'NaN', 'Symbol', 'BigInt'
])

/** Satırdaki 1-tabanlı konum (bulgu raporu için). */
function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

/** import satırlarından bu dosyada TANIMLI sayılan adları topla. */
export function importedNames(content: string): Set<string> {
  const names = new Set<string>()
  const importRe = /import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"][^'"]+['"]/g
  for (const m of content.matchAll(importRe)) {
    if (m[1]) names.add(m[1])
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part.split(' as ').pop()?.trim()
        if (name) names.add(name)
      }
    }
  }
  const nsRe = /import\s*\*\s*as\s+([\w$]+)/g
  for (const m of content.matchAll(nsRe)) names.add(m[1])
  return names
}

/** Dosyada bildirilen üst-düzey/yerel adlar (kaba ama hızlı). */
export function declaredNames(content: string): Set<string> {
  const names = new Set<string>()
  const declRe = /\b(?:const|let|var|function|class)\s+([\w$]+)/g
  for (const m of content.matchAll(declRe)) names.add(m[1])
  // Yapıbozum: const { a, b } = ...; const [x, y] = ...
  const destructRe = /\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*=/g
  for (const m of content.matchAll(destructRe)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop()?.split('=')[0]?.trim()
      if (name && /^[\w$]+$/.test(name)) names.add(name)
    }
  }
  // Fonksiyon parametreleri (tek seviye): map((item, i) => ...)
  const paramRe = /\(([^()]*)\)\s*(?::[^=]+)?=>/g
  for (const m of content.matchAll(paramRe)) {
    for (const part of m[1].split(',')) {
      const name = part.replace(/[{}[\]]/g, '').split(':')[0]?.split('=')[0]?.trim()
      if (name && /^[\w$]+$/.test(name)) names.add(name)
    }
  }
  // Klasik fonksiyon parametreleri: function List({ data }) — canlı yanlış
  // alarm (25 no'lu ekran görüntüsü çekilirken): prop 'data' tanımsız sanılıp
  // modül düzeyinde stub'landı; prop gölgelediği için onarım da işe yaramazdı.
  const fnParamRe = /function\s*[\w$]*\s*\(([^)]*)\)/g
  for (const m of content.matchAll(fnParamRe)) {
    for (const part of m[1].split(',')) {
      const name = part.replace(/[{}[\]]/g, '').split(':')[0]?.split('=')[0]?.trim()
      if (name && /^[\w$]+$/.test(name)) names.add(name)
    }
  }
  return names
}

/** Görece import'u proje yollarına çöz; bulunanı ya da null döndür. */
function resolveRelative(spec: string, importer: string, paths: string[]): string | null {
  const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : ''
  const joined = (dir ? dir + '/' : '') + spec.replace(/^\.\//, '')
  const norm = joined.split('/').reduce<string[]>((acc, part) => {
    if (part === '..') acc.pop()
    else if (part !== '.' && part !== '') acc.push(part)
    return acc
  }, []).join('/')
  const candidates = [norm, `${norm}.tsx`, `${norm}.ts`, `${norm}.jsx`, `${norm}.js`, `${norm}/index.tsx`, `${norm}/index.ts`, `${norm}.css`, `${norm}.json`, `${norm}.svg`, `${norm}.png`]
  for (const c of candidates) if (paths.includes(c)) return c
  return null
}

/** Büyük-küçük harf farkıyla eşleşen gerçek yol var mı? (case-broken import) */
function caseInsensitiveMatch(spec: string, importer: string, paths: string[]): string | null {
  const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : ''
  const joined = ((dir ? dir + '/' : '') + spec.replace(/^\.\//, '')).toLowerCase()
  const norm = joined.split('/').reduce<string[]>((acc, part) => {
    if (part === '..') acc.pop()
    else if (part !== '.' && part !== '') acc.push(part)
    return acc
  }, []).join('/')
  for (const p of paths) {
    const lower = p.toLowerCase()
    if (lower === norm || lower.replace(/\.(tsx|ts|jsx|js)$/, '') === norm) return p
  }
  return null
}

/** Hedef dosya bu adı export ediyor mu? */
function exportsName(content: string, name: string): boolean {
  return (
    new RegExp(`export\\s+(?:const|let|var|function|class|type|interface|enum)\\s+${name}\\b`).test(content) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(content) ||
    /export\s+default/.test(content) === false // default'suz dosyada adlı arıyorsak yukarısı yeterli
  ) === true && (
    new RegExp(`export\\s+(?:const|let|var|function|class|type|interface|enum)\\s+${name}\\b`).test(content) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(content)
  )
}

/**
 * Projenin tamamını tara. Sözdizimi denetimi async (Babel chunk'ı lazy),
 * metin analizi saf senkron; 6.2 ile sona DERLEYİCİ geçişi eklendi:
 * TypeScript language service bellek-içi haritada koşar ve regex katmanının
 * göremediği sınıfları (olmayan property, yanlış argüman, "şunu mu demek
 * istedin") derleyici doğruluğunda raporlar. TS katmanı yüklenemezse motor
 * regex bulgularıyla yaşamaya devam eder (test ortamı böyle hermetik kalır).
 */
export async function scanProject(files: FileMap, opts?: { ts?: boolean }): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = []
  const paths = Object.keys(files)
  const codeFiles = Object.values(files).filter((f) => CODE_RE.test(f.path))

  // ---- 1) Sözdizimi (katman-1 ile aynı göz) -----------------------------
  const syntaxIssues = await syntaxCheckFiles(codeFiles.map((f) => ({ path: f.path, content: f.content })))
  const syntaxBroken = new Set<string>()
  for (const issue of syntaxIssues) {
    syntaxBroken.add(issue.path)
    const lm = issue.message.match(/\((\d+):\d+\)/)
    findings.push({
      path: issue.path,
      line: lm ? Number(lm[1]) : null,
      cls: 'syntax',
      message: issue.message.split('\n')[0],
      // autoRepair Sınıf 2 (kesme işareti) bu kalıbı tanır; diğer sözdizimi
      // hataları Kat 0'da doğru şekilde REDDEDİLİP model katına gider.
      diagnosis: `${issue.message.split('\n')[0]}\n  ${issue.path}`,
      deterministic: /Unterminated string|Unexpected token/.test(issue.message)
    })
  }

  for (const f of codeFiles) {
    // Sözdizimi bozuk dosyada metin analizi yanıltıcı olur — önce o düzelsin.
    if (syntaxBroken.has(f.path)) continue
    const imported = importedNames(f.content)
    const declared = declaredNames(f.content)

    // ---- 2) Import grafiği ---------------------------------------------
    const impRe = /import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"](\.[^'"]+)['"]/g
    for (const m of f.content.matchAll(impRe)) {
      const spec = m[3]
      const resolved = resolveRelative(spec, f.path, paths)
      if (!resolved) {
        const caseFix = caseInsensitiveMatch(spec, f.path, paths)
        findings.push({
          path: f.path,
          line: lineOf(f.content, m.index ?? 0),
          cls: 'import-unresolved',
          message: caseFix
            ? `import yolu büyük-küçük harf/uzantı bozuk: "${spec}" (gerçek dosya: ${caseFix})`
            : `import hedefi projede yok: "${spec}"`,
          // autoRepair Sınıf 3'ün birebir tanıdığı vite kalıbı:
          diagnosis: `Failed to resolve import "${spec}" from "${f.path}". Does the file exist?`,
          deterministic: !!caseFix
        })
        continue
      }
      // Adlı import'lar hedefte gerçekten export ediliyor mu?
      if (m[2] && CODE_RE.test(resolved)) {
        const target = files[resolved]
        for (const part of m[2].split(',')) {
          const name = part.split(' as ')[0]?.trim()
          if (!name || !/^[\w$]+$/.test(name)) continue
          if (!exportsName(target.content, name)) {
            findings.push({
              path: f.path,
              line: lineOf(f.content, m.index ?? 0),
              cls: 'import-missing-export',
              message: `"${name}" import ediliyor ama ${resolved} böyle bir export içermiyor`,
              diagnosis: `The requested module '${spec}' does not provide an export named '${name}'\n  ${f.path}`,
              deterministic: false
            })
          }
        }
      }
    }

    // ---- 3) Tanımsız JSX bileşenleri ------------------------------------
    const jsxRe = /<([A-Z][\w$]*)[\s/>]/g
    const seenJsx = new Set<string>()
    for (const m of f.content.matchAll(jsxRe)) {
      const name = m[1]
      if (seenJsx.has(name) || imported.has(name) || declared.has(name) || KNOWN_GLOBALS.has(name)) continue
      seenJsx.add(name)
      findings.push({
        path: f.path,
        line: lineOf(f.content, m.index ?? 0),
        cls: 'jsx-undefined',
        message: `<${name}> kullanılıyor ama import/tanım yok`,
        // autoRepair Sınıf 1c/1d bu kalıptan bileşen ya da lucide ikonu çıkarır:
        diagnosis: `Uncaught ReferenceError: ${name} is not defined\n    at ${f.path}:${lineOf(f.content, m.index ?? 0)}:1`,
        deterministic: true
      })
    }

    // ---- 4) Importsuz React hook'ları ------------------------------------
    for (const hook of REACT_HOOKS) {
      if (!new RegExp(`\\b${hook}\\s*\\(`).test(f.content)) continue
      if (imported.has(hook) || declared.has(hook)) continue
      const idx = f.content.search(new RegExp(`\\b${hook}\\s*\\(`))
      findings.push({
        path: f.path,
        line: lineOf(f.content, idx),
        cls: 'hook-missing-import',
        message: `${hook} kullanılıyor ama react'ten import edilmemiş`,
        diagnosis: `Uncaught ReferenceError: ${hook} is not defined\n    at ${f.path}:${lineOf(f.content, idx)}:1`,
        deterministic: true
      })
    }

    // ---- 5) Tanımsız veri değişkenleri (.map/.filter/.length) ------------
    const dataRe = /\b([a-z][\w$]*)\s*\.\s*(?:map|filter|forEach)\s*\(/g
    const seenData = new Set<string>()
    for (const m of f.content.matchAll(dataRe)) {
      const name = m[1]
      if (seenData.has(name) || imported.has(name) || declared.has(name) || KNOWN_GLOBALS.has(name)) continue
      if (REACT_HOOKS.includes(name)) continue
      seenData.add(name)
      findings.push({
        path: f.path,
        line: lineOf(f.content, m.index ?? 0),
        cls: 'data-undefined',
        message: `'${name}' dizisi kullanılıyor ama hiçbir yerde tanımlı değil`,
        // autoRepair Sınıf 1e (info.map vakası) bu kalıbı stub'la onarır:
        diagnosis: `Uncaught ReferenceError: ${name} is not defined\n    at ${f.path}:${lineOf(f.content, m.index ?? 0)}:1`,
        deterministic: true
      })
    }

    // ---- 6) Şablon marker artıkları --------------------------------------
    const markerRe = /\{\{[A-Z0-9_]+\}\}/g
    for (const m of f.content.matchAll(markerRe)) {
      findings.push({
        path: f.path,
        line: lineOf(f.content, m.index ?? 0),
        cls: 'template-marker',
        message: `doldurulmamış şablon marker'ı: ${m[0]}`,
        diagnosis: `Template marker left unfilled: ${m[0]}\n  File: ${f.path}`,
        deterministic: false
      })
      break // dosya başına bir bulgu yeter; model turu hepsini doldurur
    }
  }

  // ---- 7) package.json sağlığı -------------------------------------------
  const pkg = files['package.json']
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as { dependencies?: Record<string, string>; scripts?: Record<string, string> }
      const banned = ['react-scripts', 'craco', '@craco/craco'].filter((d) => parsed.dependencies?.[d])
      if (banned.length > 0) {
        findings.push({
          path: 'package.json',
          line: null,
          cls: 'package-json',
          message: `vite projesiyle çakışan bağımlılık: ${banned.join(', ')}`,
          diagnosis: `package.json contains CRA relics (${banned.join(', ')}) incompatible with vite\n  File: package.json`,
          deterministic: false
        })
      }
    } catch {
      findings.push({
        path: 'package.json',
        line: null,
        cls: 'package-json',
        message: 'package.json geçerli JSON değil',
        diagnosis: `Unexpected token in JSON\n  File: package.json`,
        deterministic: false
      })
    }
  }

  // ---- 8) Derleyici geçişi (6.2) — TS language service ---------------------
  if (opts?.ts !== false) {
    try {
      const [{ tsScan }, { loadTsLibs }] = await Promise.all([
        import('./tsDiagnostics'),
        import('./tsLibs')
      ])
      const tsFindings = await tsScan(files, loadTsLibs)
      for (const t of tsFindings) {
        // Regex katmanı aynı noktayı zaten bulduysa (±1 satır) derleyici
        // kopyası rapora girmez — tek bulgu, tek onarım.
        const dup = findings.some((f) => f.path === t.path && f.line !== null && Math.abs(f.line - t.line) <= 1)
        if (dup) continue
        findings.push({
          path: t.path,
          line: t.line,
          cls: 'ts-semantic',
          message: `TS${t.code}: ${t.message}`,
          diagnosis: t.diagnosis,
          deterministic: t.deterministic
        })
      }
    } catch {
      /* derleyici katmanı yok/çöktü — regex bulgularıyla devam */
    }
  }

  return findings
}
