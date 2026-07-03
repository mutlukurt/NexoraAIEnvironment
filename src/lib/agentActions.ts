/**
 * Model çıktısındaki agent direktiflerini ayrıştırır ve sırayla yürütür:
 *   [PKG] paket-adi            → package.json'a bağımlılık ekle
 *   [FONT] Font Adı            → Google Font indir + projeye bağla
 *   [FETCH] url -> yol         → internetten dosya indir
 *   [RUN] komut                → proje klasöründe terminal komutu çalıştır
 *   [DEV]                      → bağımlılıkları kur, dev sunucusunu başlat
 *
 * Direktifler kod bloklarının DIŞINDA, kendi satırlarında yazılır (parseStreaming
 * çıktısındaki prose üzerinden okunur, kodun içindekiler tetiklenmez).
 */
import { useArtifactsStore, detectLanguage } from '@/store/artifactsStore'

export interface AgentDirectives {
  pkgs: string[]
  fonts: string[]
  fetches: Array<{ url: string; path: string }>
  runs: string[]
  dev: boolean
}

const RUN_RE = /^\s*\[RUN\]\s+(.+?)\s*$/gm
const FETCH_RE = /^\s*\[FETCH\]\s+(\S+)\s*(?:->|→)\s*(\S+)\s*$/gm
const FONT_RE = /^\s*\[FONT\]\s+(.+?)\s*$/gm
const PKG_RE = /^\s*\[PKG\]\s+(.+?)\s*$/gm
const DEV_RE = /^\s*\[DEV\]\s*$/m

/** Chat balonunda gizlenecek direktif satırları. */
export const DIRECTIVE_LINE_RE = /^\s*\[(RUN|FETCH|FONT|PKG|DEV|DELETE)\]/

/**
 * İçeriği yalnızca direktif/şablon satırlarından oluşan "dosya" — küçük model
 * talimat örneklerini kod bloğuna kopyaladığında oluşur; dosya olarak yazılmaz.
 */
export function isDirectiveOnlyContent(code: string): boolean {
  const t = code.trim()
  if (!t || t.length > 600) return false
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length > 0 && lines.every((l) => DIRECTIVE_LINE_RE.test(l))
}

/** "<url>", "<shell command>" gibi şablon değerleri — asla yürütülmez. */
export function isPlaceholderValue(v: string): boolean {
  return /<[^>]*>/.test(v) || /^(package-name|paket-adi|Font Family Name|komut|url)$/i.test(v.trim())
}

export function parseDirectives(text: string): AgentDirectives {
  const d: AgentDirectives = { pkgs: [], fonts: [], fetches: [], runs: [], dev: false }
  if (!text) return d
  for (const m of text.matchAll(PKG_RE)) {
    for (const p of m[1].split(/[\s,]+/)) {
      if (/^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(p)) d.pkgs.push(p)
    }
  }
  for (const m of text.matchAll(FONT_RE)) {
    const fam = m[1].replace(/["'`]/g, '').trim()
    if (fam && fam.length < 60 && !isPlaceholderValue(fam)) d.fonts.push(fam)
  }
  for (const m of text.matchAll(FETCH_RE)) {
    if (/^https?:\/\//i.test(m[1])) d.fetches.push({ url: m[1], path: m[2].replace(/^\.?\//, '') })
  }
  for (const m of text.matchAll(RUN_RE)) {
    if (!isPlaceholderValue(m[1])) d.runs.push(m[1])
  }
  d.dev = DEV_RE.test(text)
  return d
}

export function hasDirectives(d: AgentDirectives): boolean {
  return d.pkgs.length > 0 || d.fonts.length > 0 || d.fetches.length > 0 || d.runs.length > 0 || d.dev
}

function currentFiles(): Array<{ path: string; content: string }> {
  return Object.values(useArtifactsStore.getState().files).map((f) => ({ path: f.path, content: f.content }))
}

/** Proje adı: package.json'daki name → yoksa varsayılan. */
export function getProjectName(): string {
  const pj = useArtifactsStore.getState().files['package.json']
  if (pj) {
    try {
      const name = JSON.parse(pj.content).name
      if (typeof name === 'string' && name.trim()) return name.trim()
    } catch {
      /* ignore */
    }
  }
  return 'nexora-projesi'
}

function isStaticHtmlProject(): boolean {
  const files = useArtifactsStore.getState().files
  return !!files['index.html'] && !Object.keys(files).some((p) => p.startsWith('src/'))
}

function addPackageToArtifacts(pkg: string): void {
  const store = useArtifactsStore.getState()
  const [nameRaw, ver] = pkg.startsWith('@')
    ? [pkg.split('@').slice(0, 2).join('@'), pkg.split('@')[2]]
    : [pkg.split('@')[0], pkg.split('@')[1]]
  const name = nameRaw
  const version = ver ? `^${ver.replace(/^[\^~]/, '')}` : 'latest'

  const existing = store.files['package.json']
  let pj: Record<string, unknown>
  try {
    pj = existing ? JSON.parse(existing.content) : {}
  } catch {
    pj = {}
  }
  if (!pj.name) pj.name = getProjectName()
  const deps = (pj.dependencies ?? {}) as Record<string, string>
  deps[name] = version
  pj.dependencies = deps
  store.upsertFile('package.json', JSON.stringify(pj, null, 2), 'json')
}

function prependImportToMainCss(importLine: string): void {
  const store = useArtifactsStore.getState()
  const cssPath = ['src/index.css', 'src/globals.css', 'app/globals.css', 'css/styles.css', 'styles.css'].find(
    (p) => store.files[p]
  )
  if (cssPath) {
    const cur = store.files[cssPath].content
    if (!cur.includes(importLine)) {
      store.upsertFile(cssPath, importLine + '\n' + cur, 'css')
    }
  }
}

export interface ActionLogger {
  (line: string): void
}

/** Direktifleri sırayla yürütür; her adımı log callback'ine yazar. */
export async function executeDirectives(d: AgentDirectives, log: ActionLogger): Promise<void> {
  const projectName = getProjectName()

  for (const pkg of d.pkgs) {
    try {
      addPackageToArtifacts(pkg)
      log(`📦 Paket eklendi: ${pkg}`)
    } catch (err) {
      log(`✗ Paket eklenemedi (${pkg}): ${(err as Error).message}`)
    }
  }

  for (const fam of d.fonts) {
    log(`🔤 Google Font indiriliyor: ${fam}…`)
    const baseDir = isStaticHtmlProject() ? 'css' : 'src/assets'
    const res = await window.nexora.agent.font({ projectName, files: currentFiles(), family: fam, baseDir })
    if (res.ok && res.cssPath && res.cssContent) {
      const store = useArtifactsStore.getState()
      store.upsertFile(res.cssPath, res.cssContent, 'css')
      // ana css'e görece yol: src/index.css → ./assets/fonts/x.css, css/styles.css → ./fonts/x.css
      const rel = isStaticHtmlProject()
        ? './' + res.cssPath.replace(/^css\//, '')
        : './' + res.cssPath.replace(/^src\//, '')
      prependImportToMainCss(`@import '${rel}';`)
      log(`✓ Font hazır: ${res.family} (${res.fileCount} dosya indirildi, ${res.cssPath})`)
    } else {
      log(`✗ Font indirilemedi (${fam}): ${res.error ?? 'bilinmeyen hata'}`)
    }
  }

  for (const f of d.fetches) {
    log(`⬇ İndiriliyor: ${f.url}`)
    const res = await window.nexora.agent.fetch({ projectName, files: currentFiles(), url: f.url, path: f.path })
    if (res.ok && res.path) {
      if (res.isText && res.textContent != null) {
        useArtifactsStore.getState().upsertFile(res.path, res.textContent, detectLanguage(res.path))
      }
      const kb = res.bytes ? (res.bytes / 1024).toFixed(0) : '?'
      log(`✓ İndirildi: ${res.path} (${kb} KB${res.isText ? '' : ', dışa aktarmada projeye dahil edilir'})`)
    } else {
      log(`✗ İndirilemedi: ${f.url} — ${res.error ?? 'bilinmeyen hata'}`)
    }
  }

  for (const cmd of d.runs) {
    log(`$ ${cmd}`)
    const res = await window.nexora.agent.run({ projectName, files: currentFiles(), command: cmd })
    const tail = res.output ? res.output.slice(-500).trim() : ''
    if (res.ok) {
      log(`✓ Komut tamamlandı${tail ? '\n' + tail : ''}`)
    } else {
      log(`✗ Komut başarısız (kod ${res.exitCode ?? '?'})${tail ? '\n' + tail : ''}`)
    }
  }

  if (d.dev) {
    log('▶ Proje başlatılıyor (bağımlılıklar kurulacak, tarayıcı açılacak)…')
    const res = await window.nexora.agent.devStart({ projectName, files: currentFiles() })
    if (res.ok && res.url) {
      log(`✓ Proje çalışıyor: ${res.url} (tarayıcıda açıldı)`)
    } else {
      log(`✗ Başlatılamadı: ${res.error ?? 'bilinmeyen hata'}`)
    }
  }
}
