/**
 * Faz 14.8 — afterEdit sözleşmesi: her yazımdan sonra projenin KENDİ tooling'i.
 *
 * NexoraAI kendi iç kontrolleriyle (tsDiagnostics) doğruluyor ama projenin gerçek
 * linter/typechecker/test komutunu koşmuyordu. Bu modül package.json'dan (ya da
 * pyproject) bu komutları saptar ve mümkünse yalnız DEĞİŞEN dosyalara kapsar →
 * sonuç mevcut lastBuildError→onarım döngüsüne beslenir. Saf/deterministik.
 */

export interface AfterEditCommands {
  typecheck?: string
  lint?: string
  test?: string
  format?: string
}

const SCRIPT_KEYS = {
  typecheck: [/^typecheck$/, /^type-check$/, /^tsc$/, /^check-types$/, /^types$/],
  lint: [/^lint$/, /^eslint$/, /^lint:check$/],
  test: [/^test$/, /^test:unit$/, /^vitest$/, /^jest$/],
  format: [/^format$/, /^prettier$/, /^fmt$/, /^format:check$/]
}

/** package.json içeriğinden afterEdit komutlarını saptar (script adı → `npm run <ad>`). */
export function detectAfterEditCommands(pkgJsonText: string): AfterEditCommands {
  let scripts: Record<string, string> = {}
  try {
    const p = JSON.parse(pkgJsonText)
    if (p && typeof p.scripts === 'object') scripts = p.scripts
  } catch {
    return {}
  }
  const names = Object.keys(scripts)
  const out: AfterEditCommands = {}
  for (const [kind, pats] of Object.entries(SCRIPT_KEYS) as Array<[keyof AfterEditCommands, RegExp[]]>) {
    const hit = names.find((n) => pats.some((re) => re.test(n)))
    if (hit) out[kind] = `npm run ${hit}`
  }
  // Script yoksa ama araç bağımlılığı varsa doğrudan çağır (npx).
  try {
    const p = JSON.parse(pkgJsonText)
    const deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) }
    if (!out.typecheck && deps.typescript) out.typecheck = 'npx tsc --noEmit'
    if (!out.lint && deps.eslint) out.lint = 'npx eslint'
    if (!out.format && deps.prettier) out.format = 'npx prettier --check'
  } catch { /* yoksa boş */ }
  return out
}

const SCOPABLE = /(eslint|prettier|biome)/i

/**
 * Bir komutu YALNIZ değişen dosyalara kapsa (araç destekliyorsa: eslint/prettier
 * dosya listesi alır; `npm run` sarmalı `--` ile geçirir). tsc --noEmit proje
 * bütünü ister — kapsanmaz, olduğu gibi döner. Kod dosyası yoksa null (koşma).
 */
export function scopeCommand(cmd: string, editedFiles: string[]): string | null {
  const codeFiles = editedFiles.filter((f) => /\.(tsx?|jsx?|mjs|cjs|css|scss|json|md)$/i.test(f))
  if (codeFiles.length === 0) return null
  if (!SCOPABLE.test(cmd)) return cmd // tsc vb. — proje geneli
  const quoted = codeFiles.map((f) => `'${f.replace(/'/g, "")}'`).join(' ')
  // "npm run lint" → "npm run lint -- <files>"; "npx eslint" → "npx eslint <files>"
  return /^npm run /.test(cmd) ? `${cmd} -- ${quoted}` : `${cmd} ${quoted}`
}

/**
 * DIFF-ONLY sözleşmesi ihlali: iterasyon turu KÜÇÜK bir değişiklik isterken model
 * bir dosyayı BAŞTAN yazdı mı (tüm satırları değişti)? UI uyarısı için. Basit
 * sezgi: değişen dosyanın eski/yeni satır örtüşmesi çok düşükse "full rewrite".
 */
export function isFullRewrite(oldContent: string, newContent: string): boolean {
  const oldLines = new Set(oldContent.split('\n').map((l) => l.trim()).filter((l) => l.length > 3))
  if (oldLines.size < 8) return false // küçük dosya — rewrite normal
  const newLines = newContent.split('\n').map((l) => l.trim()).filter((l) => l.length > 3)
  if (newLines.length === 0) return false
  let kept = 0
  for (const l of newLines) if (oldLines.has(l)) kept++
  return kept / oldLines.size < 0.3 // eski satırların %30'undan azı korunduysa
}

/**
 * Dokunulan dosyalardan BAŞTAN yazılanları topla. Taban içerikler bir Map'te
 * tutulur; appStore bunu köşeli-parantez (`base[p]`) ile okuyordu → Map'te HEP
 * undefined → uyarı ASLA ateşlenmiyordu (14.8 canlı-denetim bulgusu). Map erişimi
 * artık burada, tek yerde ve test altında. data:-URL (görsel) tabanlar elenir.
 */
export function collectFullRewrites(
  touchedPaths: readonly string[],
  baseFiles: ReadonlyMap<string, string>,
  getNow: (path: string) => string | undefined
): string[] {
  return touchedPaths.filter((p) => {
    const base = baseFiles.get(p)
    const now = getNow(p)
    return !!base && !!now && !base.startsWith('data:') && isFullRewrite(base, now)
  })
}
