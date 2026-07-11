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
import { useTermStore } from '@/store/termStore'
import { looksFileMutating, SYNCABLE_EXT_RE } from '@shared/fileOps'

export interface McpCallDirective {
  server: string
  tool: string
  args: Record<string, unknown>
}

export interface AgentDirectives {
  pkgs: string[]
  fonts: string[]
  fetches: Array<{ url: string; path: string }>
  runs: string[]
  dev: boolean
  /** 10.1: yerel MCP araç çağrıları — [MCP] sunucu araç {json}. */
  mcp: McpCallDirective[]
  /** 13.8: [IMG] <ingilizce prompt> — text modeli görsel NİYETİNİ anlayıp işi
   *  SD motoruna devreder (yerel/API text modeli görseli KENDİSİ üretmez). */
  imgs: string[]
  /** 13.8: [ASSET] add — son üretilen görseli projenin assets'ine ekle. */
  assetAdd: boolean
  /** NİYET KÖPRÜSÜ: sohbet personası "bu aslında ÜRETİM isteği" derse [BUILD]
   *  basar → istek üretim pipeline'ına yeniden yönlenir. Yönlendirme sezgisi
   *  (looksLikeChatIntent) böylece yalnız performans ipucudur; SON SÖZ modelde. */
  build: boolean
}

const RUN_RE = /^\s*\[RUN\]\s+(.+?)\s*$/gm
const IMG_RE = /^\s*\[IMG\]\s+(.+?)\s*$/gm
const ASSET_RE = /^\s*\[ASSET\](?:\s+add)?\s*$/im
const BUILD_RE = /^\s*\[BUILD\]\s*$/im
const FETCH_RE = /^\s*\[FETCH\]\s+(\S+)\s*(?:->|→)\s*(\S+)\s*$/gm
const FONT_RE = /^\s*\[FONT\]\s+(.+?)\s*$/gm
const PKG_RE = /^\s*\[PKG\]\s+(.+?)\s*$/gm
const DEV_RE = /^\s*\[DEV\]\s*$/m
// [MCP] sunucu araç {"json":"args"}   → JSON opsiyonel (argümansız araçlar için)
const MCP_RE = /^\s*\[MCP\]\s+(\S+)\s+(\S+)[ \t]*(\{.*\})?[ \t]*$/gm
// 10.8 [REMEMBER] ...   → model bir şey öğrenmeyi ÖNERİR (onaylı-hafıza; oto-yazMAZ)
const REMEMBER_RE = /^\s*\[REMEMBER\]\s+(.+?)\s*$/gim

/** Chat balonunda gizlenecek direktif satırları. */
export const DIRECTIVE_LINE_RE = /^\s*\[(RUN|FETCH|FONT|PKG|DEV|DELETE|MCP|REMEMBER|IMG|ASSET|BUILD)\]/i

/**
 * 10.8 — Onaylı-hafıza: modelin "[REMEMBER] ..." önerilerini çıkarır. Oto-yazMAZ;
 * kullanıcı onaylayınca proje bilgi tabanına user-preference olarak işlenir.
 */
export function parseMemories(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  for (const m of text.matchAll(REMEMBER_RE)) {
    const v = m[1].trim()
    if (v && !isPlaceholderValue(v) && v.length <= 300) out.push(v)
  }
  return [...new Set(out)]
}

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
  return (
    /<[^>]*>/.test(v) ||
    /^(package-name|paket-adi|Font Family Name|komut|url)$/i.test(v.trim()) ||
    // example.com/org/net RFC'de yer tutucudur — modeller URL uydururken bunu
    // kullanıyor (gerçek 14B vakası: https://example.com/logo.svg → 404)
    /\/\/(www\.)?example\.(com|org|net)/i.test(v)
  )
}

export function parseDirectives(text: string): AgentDirectives {
  const d: AgentDirectives = { pkgs: [], fonts: [], fetches: [], runs: [], dev: false, mcp: [], imgs: [], assetAdd: false, build: false }
  if (!text) return d
  for (const m of text.matchAll(IMG_RE)) {
    const p = m[1].trim()
    if (p && p.length >= 3 && p.length <= 500 && !isPlaceholderValue(p)) d.imgs.push(p)
  }
  d.assetAdd = ASSET_RE.test(text)
  d.build = BUILD_RE.test(text)
  for (const m of text.matchAll(MCP_RE)) {
    const server = m[1].trim()
    const tool = m[2].trim()
    if (isPlaceholderValue(server) || isPlaceholderValue(tool)) continue
    let args: Record<string, unknown> = {}
    if (m[3]) {
      try {
        const parsed = JSON.parse(m[3])
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
      } catch {
        continue // bozuk JSON — uydurma çağrı, atla
      }
    }
    d.mcp.push({ server, tool, args })
  }
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
    if (/^https?:\/\//i.test(m[1]) && !isPlaceholderValue(m[1])) {
      d.fetches.push({ url: m[1], path: m[2].replace(/^\.?\//, '') })
    }
  }
  for (const m of text.matchAll(RUN_RE)) {
    if (!isPlaceholderValue(m[1])) d.runs.push(m[1])
  }
  d.dev = DEV_RE.test(text)
  return d
}

export function hasDirectives(d: AgentDirectives): boolean {
  return (
    d.pkgs.length > 0 || d.fonts.length > 0 || d.fetches.length > 0 || d.runs.length > 0 || d.dev || d.mcp.length > 0 ||
    d.imgs.length > 0 || d.assetAdd || d.build
  )
}

function currentFiles(): Array<{ path: string; content: string }> {
  return Object.values(useArtifactsStore.getState().files).map((f) => ({ path: f.path, content: f.content }))
}

/**
 * 8.5: brief → dosya-sistemi-güvenli proje adı (Türkçe-duyarlı; main sürecindeki
 * agentService.slugifyName ile aynı ruh). İlk cümle/öbek alınır, slug'lanır.
 * Türetilemezse '' döner (çağıran yüksek sesle uyarır — sessiz fallback YOK).
 */
export function deriveProjectName(brief: string): string {
  const firstClause = (brief || '').split(/[,.\n;:!?]/)[0] ?? ''
  return firstClause
    .toLocaleLowerCase('tr')
    .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİI]/g, 'i')
    .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

/** 8.5: kimlik fallback'i bir kez konsola uyarır (sessiz commingling gözlemlenebilir olsun). */
let warnedIdentityFallback = false

/** Proje adı: package.json'daki name → yoksa varsayılan (YÜKSEK SESLE uyarır). */
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
  // 8.5: sessizce 'nexora-projesi'ye düşmek TÜM projelerin knowledge/rules/
  // history'sini tek klasörde karıştırıyordu. Fallback kalır ama artık GÖRÜNÜR.
  if (!warnedIdentityFallback) {
    warnedIdentityFallback = true
    console.warn(
      "[NexoraAI] Proje kimliği yok (package.json'da name yok) — knowledge/rules/history 'nexora-projesi' altında toplanıyor. Planlı build gerçek bir ad yazar."
    )
  }
  return 'nexora-projesi'
}

/** Kimlik kurulunca uyarı bayrağını sıfırla (sonraki kimliksiz proje yine uyarsın). */
export function resetIdentityWarning(): void {
  warnedIdentityFallback = false
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

/** Bir [RUN] diskte dosya değiştirdikten sonra çalışma alanını yeniden tarar ve
 *  editör/assets store'unu eşitler: yeni/değişen dosyaları ekler, silinenleri düşer. */
async function rescanAndSync(projectName: string, log: ActionLogger): Promise<void> {
  try {
    const res = await window.nexora.agent.rescan(projectName)
    if (!res.ok || !res.files) return
    const store = useArtifactsStore.getState()
    const current = store.files
    const scanned = new Set(res.files.map((f: { path: string; content: string }) => f.path))
    let added = 0
    let changed = 0
    let removed = 0
    for (const f of res.files) {
      const ex = current[f.path]
      if (!ex) {
        store.upsertFile(f.path, f.content)
        added++
      } else if (ex.content !== f.content) {
        store.upsertFile(f.path, f.content)
        changed++
      }
    }
    // Silinenleri düş — yalnız tarama eksiksizse (truncated değil) ve tür tanıdıksa.
    if (!res.truncated) {
      for (const path of Object.keys(current)) {
        if (!scanned.has(path) && SYNCABLE_EXT_RE.test(path)) {
          store.deleteFile(path)
          removed++
        }
      }
    }
    if (added || changed || removed) {
      log(`🔄 Çalışma alanı eşitlendi — +${added} yeni · ${changed} değişti · −${removed} silindi`)
    }
  } catch {
    /* rescan opsiyonel — komut zaten çalıştı */
  }
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
    // 7.6 görünür terminal: komut kartı açılır, çıktı TERM_OUTPUT ile canlı
    // akar; sonuç yine sohbet günlüğüne özetlenir (iki yüzey, tek yürütme).
    const execId = useTermStore.getState().register(cmd, 'agent')
    const res = await window.nexora.agent.run({ projectName, files: currentFiles(), command: cmd, execId })
    useTermStore.getState().finish(execId, { ok: res.ok, exitCode: res.exitCode, fallbackOutput: res.output })
    const tail = res.output ? res.output.slice(-500).trim() : ''
    if (res.ok) {
      log(`✓ Komut tamamlandı${tail ? '\n' + tail : ''}`)
      // Dosya-değiştiren komut çalıştıysa çalışma alanını yeniden tara ve
      // editör/assets'i eşitle (yeni .webp görünür, silinen dosya kaybolur).
      if (looksFileMutating(cmd)) await rescanAndSync(projectName, log)
    } else {
      log(`✗ Komut başarısız (kod ${res.exitCode ?? '?'})${tail ? '\n' + tail : ''}`)
    }
  }

  for (const call of d.mcp) {
    const argStr = Object.keys(call.args).length ? ' ' + JSON.stringify(call.args) : ''
    log(`🔌 MCP: ${call.server}.${call.tool}${argStr}`)
    try {
      const res = await window.nexora.mcp.call({ server: call.server, tool: call.tool, args: call.args })
      const body = res.content.length > 1200 ? res.content.slice(0, 1200) + '…' : res.content
      if (res.ok) log(`✓ ${call.server}.${call.tool} →\n${body}`)
      else log(`✗ ${call.server}.${call.tool} başarısız →\n${body}`)
    } catch (err) {
      log(`✗ MCP çağrı hatası (${call.server}.${call.tool}): ${(err as Error).message}`)
    }
  }

  if (d.dev) {
    log('▶ Proje başlatılıyor (bağımlılıklar kurulacak, tarayıcı açılacak)…')
    const devExecId = useTermStore.getState().register('npm run dev  (dev sunucusu)', 'dev')
    const res = await window.nexora.agent.devStart({ projectName, files: currentFiles(), execId: devExecId })
    useTermStore.getState().finish(devExecId, { ok: res.ok, fallbackOutput: res.ok ? `çalışıyor: ${res.url ?? ''}` : res.error })
    if (res.ok && res.url) {
      log(`✓ Proje çalışıyor: ${res.url} (tarayıcıda açıldı)`)
    } else {
      log(`✗ Başlatılamadı: ${res.error ?? 'bilinmeyen hata'}`)
    }
  }
}
