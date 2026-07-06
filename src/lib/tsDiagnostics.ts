/**
 * Debug Engine 6.2 — derleyici-dereceli tanılar.
 *
 * TypeScript'in createLanguageService'i, artifacts store'un BELLEK-İÇİ dosya
 * haritası üstünde koşar: node_modules yok, kurulum yok, tamamen çevrimdışı.
 * Regex tarayıcının sezgisel yaklaştığı sınıflar (tanımsız ad, olmayan
 * property, yanlış çağrı) burada derleyicinin kendisinden gelir — yanlış
 * alarm sınıfları yapısal olarak imkansızlaşır (Claude Code'un LSP hamlesinin
 * bizim mimarideki karşılığı).
 *
 * Bundler-bağımsız çekirdek: lib/tip dosyaları dışarıdan enjekte edilir
 * (uygulamada vite glob'u — tsLibs.ts; testte fs). typescript lazy import'tur,
 * ilk çağrıda ~1-2 sn, sonrası artımlı (sürüm haritası + önbellekli servis).
 */
import type * as TS from 'typescript'

export interface TsFinding {
  path: string
  line: number
  code: number
  message: string
  /** Kat 0'ın anladığı sentetik tanı (2304 sınıfı) — yoksa model katına. */
  diagnosis: string
  deterministic: boolean
}

type FileMap = Record<string, { path: string; content: string }>
export type LibMap = Record<string, string>

// Yalnızca sinyal değeri yüksek, gürültüsü düşük kodlar raporlanır (v1):
// 2304/2305 tanımsız ad-modül üyesi, 2339 olmayan property, 2551/2552
// "şunu mu demek istedin", 2554 yanlış argüman sayısı, 2741 zorunlu prop eksik.
const REPORT_CODES = new Set([2304, 2305, 2339, 2551, 2552, 2554, 2741])
const CODE_RE = /\.(tsx|ts)$/i

let tsMod: typeof TS | null = null
let service: TS.LanguageService | null = null
let libs: LibMap = {}
const contents = new Map<string, string>()
const versions = new Map<string, number>()

function buildHost(ts: typeof TS): TS.LanguageServiceHost {
  const options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    allowArbitraryExtensions: true
  }
  const resolveRelative = (spec: string, importer: string): string | undefined => {
    const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : ''
    const joined = (dir ? dir + '/' : '') + spec.replace(/^\.\//, '')
    const norm = joined.split('/').reduce<string[]>((acc, part) => {
      if (part === '..') acc.pop()
      else if (part !== '.' && part !== '') acc.push(part)
      return acc
    }, []).join('/')
    for (const c of [norm, `${norm}.tsx`, `${norm}.ts`, `${norm}.jsx`, `${norm}.js`, `${norm}/index.tsx`, `${norm}/index.ts`]) {
      if (contents.has(c)) return c
    }
    // .css/.svg gibi kod-dışı varlıklar: çözümsüz bırak — ambient '*' yutar.
    return undefined
  }
  const MODULE_TYPES: Record<string, string> = {
    react: '/types/react/index.d.ts',
    'react/jsx-runtime': '/types/react/jsx-runtime.d.ts',
    'react/jsx-dev-runtime': '/types/react/jsx-dev-runtime.d.ts',
    'react-dom': '/types/react-dom/index.d.ts',
    'react-dom/client': '/types/react-dom/client.d.ts'
  }
  return {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...contents.keys()].filter((p) => CODE_RE.test(p)).concat(Object.keys(libs).filter((l) => l.startsWith('/types/ambient'))),
    getScriptVersion: (f) => String(versions.get(f) ?? 0),
    getScriptSnapshot: (f) => {
      const c = contents.get(f) ?? libs[f]
      return c === undefined ? undefined : tsMod!.ScriptSnapshot.fromString(c)
    },
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/libs/lib.es2020.full.d.ts',
    fileExists: (f) => contents.has(f) || f in libs,
    readFile: (f) => contents.get(f) ?? libs[f],
    resolveModuleNames: (names, containingFile) =>
      names.map((name) => {
        const target = name.startsWith('.')
          ? resolveRelative(name, containingFile)
          : MODULE_TYPES[name]
        if (!target) return undefined
        return {
          resolvedFileName: target,
          extension: target.endsWith('.tsx') ? tsMod!.Extension.Tsx : target.endsWith('.d.ts') ? tsMod!.Extension.Dts : tsMod!.Extension.Ts,
          isExternalLibraryImport: target.startsWith('/types/')
        } as TS.ResolvedModuleFull
      })
  }
}

/** Dosya haritasını servise işle: değişenlerin sürümünü artır (artımlılık). */
function syncFiles(files: FileMap): void {
  const seen = new Set<string>()
  for (const f of Object.values(files)) {
    seen.add(f.path)
    if (contents.get(f.path) !== f.content) {
      contents.set(f.path, f.content)
      versions.set(f.path, (versions.get(f.path) ?? 0) + 1)
    }
  }
  for (const p of [...contents.keys()]) {
    if (!seen.has(p) && !(p in libs)) {
      contents.delete(p)
      versions.set(p, (versions.get(p) ?? 0) + 1)
    }
  }
}

/**
 * Projeyi derleyici gözüyle tara. loadLibs ilk çağrıda lib/tip haritasını
 * sağlar (vite glob'u ya da test fs'i) — yüklenemezse sessizce boş döner
 * (motor regex katmanıyla yaşamaya devam eder; test ortamı da böyle hermetik
 * kalır).
 */
export async function tsScan(files: FileMap, loadLibs: () => Promise<LibMap>): Promise<TsFinding[]> {
  const hasCode = Object.keys(files).some((p) => CODE_RE.test(p))
  if (!hasCode) return []
  try {
    if (!tsMod) tsMod = (await import('typescript')).default ?? (await import('typescript'))
    if (Object.keys(libs).length === 0) {
      libs = await loadLibs()
      // Emniyet: varsayılan lib yoksa (glob boş eşleşti vb.) LIB'SİZ koşma —
      // her global tip "tanımsız" görünür ve tarama gürültüye boğulur.
      if (!libs['/libs/lib.es2020.full.d.ts']) {
        console.warn('[tsScan] lib haritası eksik — derleyici katmanı kapalı (yük:', Object.keys(libs).length, 'dosya)')
        libs = {}
        return []
      }
    }
    syncFiles(files)
    if (!service) service = tsMod.createLanguageService(buildHost(tsMod), tsMod.createDocumentRegistry())

    const findings: TsFinding[] = []
    for (const p of Object.keys(files)) {
      if (!CODE_RE.test(p)) continue
      const program = service.getProgram()
      const sf = program?.getSourceFile(p)
      if (!sf) continue
      for (const d of service.getSemanticDiagnostics(p)) {
        if (!REPORT_CODES.has(d.code) || d.start === undefined) continue
        const { line } = sf.getLineAndCharacterOfPosition(d.start)
        const message = tsMod.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 220)
        // 2304 "Cannot find name 'X'": Kat 0'ın birebir anladığı sınıf —
        // sentetik runtime tanısına çevrilir, modelsiz onarım şansı doğar.
        const nameMatch = d.code === 2304 ? message.match(/Cannot find name '([\w$]+)'/) : null
        findings.push({
          path: p,
          line: line + 1,
          code: d.code,
          message,
          diagnosis: nameMatch
            ? `Uncaught ReferenceError: ${nameMatch[1]} is not defined\n    at ${p}:${line + 1}:1`
            : `TS${d.code}: ${message}\n  ${p}:${line + 1}`,
          deterministic: !!nameMatch
        })
        if (findings.length >= 40) return findings // gürültü tavanı
      }
    }
    return findings
  } catch (err) {
    // Derleyici katmanı çöktüyse motor regex katmanıyla devam eder; sebep
    // konsola düşer ki sessiz bozulma teşhis edilebilir kalsın (6.1 dersi).
    console.warn('[tsScan] derleyici katmanı devre dışı:', (err as Error).message?.slice(0, 200))
    return []
  }
}

/** Test/teşhis: servisi sıfırla (lib değişimi ya da bellek baskısı). */
export function resetTsService(): void {
  service = null
  libs = {}
  contents.clear()
  versions.clear()
}
