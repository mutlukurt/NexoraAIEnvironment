/**
 * Agent yetenekleri: gerçek dosya sistemi çalışma alanı, terminal komutları,
 * internetten dosya/font indirme, localhost dev sunucusu ve profesyonel proje
 * iskeleti (scaffold) üretimi.
 *
 * Tüm eylemler ~/NexoraAI/Projects/<proje> altındaki çalışma alanında koşar;
 * chat'teki dosyalar (artifacts) önce oraya senkronlanır. Böylece model
 * "[RUN] npm install" gibi komutları güvenli bir klasör bağlamında çalıştırır.
 */
import { spawn, type ChildProcess } from 'child_process'
import { homedir } from 'os'
import { join, dirname, resolve, sep } from 'path'
import { mkdir, writeFile, readFile, cp, rm, access } from 'fs/promises'
import { existsSync } from 'fs'
import { shell } from 'electron'

export interface ProjectFileInput {
  path: string
  content: string
}

export interface RunResult {
  ok: boolean
  output: string
  exitCode: number | null
}

const PROJECTS_ROOT = join(homedir(), 'NexoraAI', 'Projects')
const MAX_OUTPUT = 20_000
const MAX_DOWNLOAD = 50 * 1024 * 1024 // 50 MB
const TEXT_EXTS = new Set(['json', 'txt', 'svg', 'csv', 'md', 'css', 'js', 'ts', 'html', 'xml', 'yml', 'yaml', 'toml'])

/** Proje adını dosya sistemi için güvenli bir kök klasör adına çevir. */
export function slugifyName(name: string): string {
  const s = name
    .toLocaleLowerCase('tr')
    .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİI]/g, 'i')
    .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || 'nexora-projesi'
}

export function workspaceDir(projectName: string): string {
  return join(PROJECTS_ROOT, slugifyName(projectName))
}

/** path traversal koruması: hedef her zaman çalışma alanının içinde kalmalı. */
function safeJoin(base: string, rel: string): string {
  const p = resolve(base, rel.replace(/^\/+/, ''))
  if (p !== base && !p.startsWith(base + sep)) {
    throw new Error(`Geçersiz dosya yolu: ${rel}`)
  }
  return p
}

// ---------------------------------------------------------------------------
// Proje iskeleti (scaffold): eksik standart dosyaları tamamlar, böylece proje
// dışa aktarıldığında ya da dev sunucusu başlatıldığında gerçekten çalışır.
// ---------------------------------------------------------------------------

const KNOWN_VERSIONS: Record<string, string> = {
  react: '^18.3.1',
  'react-dom': '^18.3.1',
  'lucide-react': '^0.454.0',
  clsx: '^2.1.1',
  'tailwind-merge': '^2.5.4',
  'framer-motion': '^11.11.0',
  zustand: '^5.0.0',
  next: '^14.2.5'
}

function detectBareImports(files: ProjectFileInput[]): string[] {
  const found = new Set<string>()
  for (const f of files) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(f.path)) continue
    for (const m of f.content.matchAll(/(?:^|\n)\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'".][^'"]*)['"]/g)) {
      const spec = m[1]
      if (spec.startsWith('@/') || spec.startsWith('~/')) continue
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (pkg && pkg !== 'react-dom/client') found.add(pkg)
    }
  }
  found.add('react')
  found.add('react-dom')
  return [...found]
}

function usesTailwind(files: ProjectFileInput[]): boolean {
  return files.some(
    (f) => /@tailwind\s+(base|components|utilities)/.test(f.content) || f.path === 'tailwind.config.js'
  ) || files.some((f) => /\.(tsx|jsx)$/.test(f.path) && /className=/.test(f.content))
}

/**
 * Chat'te üretilen dosyaları eksiksiz, kurulup çalışabilir bir projeye dönüştür.
 * Var olan dosyalara ASLA dokunmaz; yalnızca eksik standart dosyaları ekler.
 */
export function scaffoldProject(files: ProjectFileInput[], projectName: string): ProjectFileInput[] {
  const map = new Map(files.map((f) => [f.path, f]))
  const has = (p: string) => map.has(p)
  const slug = slugifyName(projectName)
  const out = [...files]
  const add = (path: string, content: string) => {
    if (!has(path)) {
      out.push({ path, content })
      map.set(path, { path, content })
    }
  }

  const isNext = has('app/page.tsx') || has('app/layout.tsx')
  const isPython = has('requirements.txt') || has('app/main.py') || has('main.py')
  const appEntry = has('src/App.tsx') ? 'src/App.tsx' : has('src/App.jsx') ? 'src/App.jsx' : has('App.tsx') ? 'App.tsx' : null
  const isStaticHtml = has('index.html') && !appEntry && !isNext
  const tailwind = usesTailwind(out)

  add('.gitignore', 'node_modules/\ndist/\nbuild/\n.next/\nout/\n*.log\n.DS_Store\n.env\n__pycache__/\n')
  add('README.md', `# ${projectName}\n\nNexoraAI ile oluşturuldu.\n\n## Çalıştırma\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`)

  if (isPython || isStaticHtml) return out

  // package.json: yoksa oluştur, varsa eksik bağımlılıkları tamamla
  const deps: Record<string, string> = {}
  for (const pkg of detectBareImports(out)) {
    deps[pkg] = KNOWN_VERSIONS[pkg] ?? 'latest'
  }
  const devDeps: Record<string, string> = {
    typescript: '^5.5.3',
    vite: '^5.3.4',
    '@vitejs/plugin-react': '^4.3.1',
    '@types/react': '^18.3.3',
    '@types/react-dom': '^18.3.0'
  }
  if (tailwind) {
    devDeps['tailwindcss'] = '^3.4.6'
    devDeps['postcss'] = '^8.4.39'
    devDeps['autoprefixer'] = '^10.4.19'
  }

  if (isNext) {
    deps['next'] = KNOWN_VERSIONS['next']
    add(
      'package.json',
      JSON.stringify(
        {
          name: slug,
          version: '0.1.0',
          private: true,
          scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
          dependencies: deps,
          devDependencies: { typescript: devDeps.typescript, '@types/react': devDeps['@types/react'], '@types/react-dom': devDeps['@types/react-dom'], ...(tailwind ? { tailwindcss: devDeps.tailwindcss, postcss: devDeps.postcss, autoprefixer: devDeps.autoprefixer } : {}) }
        },
        null,
        2
      )
    )
  } else if (appEntry) {
    add(
      'package.json',
      JSON.stringify(
        {
          name: slug,
          version: '0.1.0',
          private: true,
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
          dependencies: deps,
          devDependencies: devDeps
        },
        null,
        2
      )
    )
    // package.json model tarafından yazıldıysa eksik dep'leri tamamla
    if (has('package.json')) {
      try {
        const pj = JSON.parse(map.get('package.json')!.content)
        pj.dependencies = pj.dependencies ?? {}
        for (const [k, v] of Object.entries(deps)) if (!pj.dependencies[k]) pj.dependencies[k] = v
        pj.devDependencies = { ...devDeps, ...(pj.devDependencies ?? {}) }
        pj.scripts = pj.scripts && pj.scripts.dev ? pj.scripts : { ...(pj.scripts ?? {}), dev: 'vite', build: 'vite build', preview: 'vite preview' }
        if (!pj.type) pj.type = 'module'
        const rec = map.get('package.json')!
        rec.content = JSON.stringify(pj, null, 2)
        const idx = out.findIndex((f) => f.path === 'package.json')
        if (idx >= 0) out[idx] = rec
      } catch {
        /* bozuk package.json'a dokunma */
      }
    }

    // Tailwind dosyaları main.tsx'ten ÖNCE eklenmeli — aksi halde index.css
    // import'u üretilmez ve stiller dev/export'ta hiç yüklenmez.
    if (tailwind) {
      add(
        'tailwind.config.js',
        `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: []
}
`
      )
      add('postcss.config.js', `export default { plugins: { tailwindcss: {}, autoprefixer: {} } }\n`)
      add('src/index.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n')
    }

    // main.tsx projedeki TÜM css dosyalarını import eder (modelin styles.css
    // gibi farklı adlarla yazdıkları dahil).
    const cssImport = out
      .filter((f) => f.path.endsWith('.css'))
      .map((f) => `import '${f.path.startsWith('src/') ? './' + f.path.slice(4) : '../' + f.path}'`)
      .join('\n')
    const cssImportBlock = cssImport ? cssImport + '\n' : ''
    const appImport = appEntry.startsWith('src/') ? './App' : '../App'
    add(
      'index.html',
      `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
    )
    add(
      'src/main.tsx',
      `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '${appImport}'
${cssImportBlock}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`
    )
    add(
      'vite.config.ts',
      `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } }
})
`
    )
    add(
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            jsx: 'react-jsx',
            moduleResolution: 'bundler',
            strict: false,
            skipLibCheck: true,
            noEmit: true,
            baseUrl: '.',
            paths: { '@/*': ['src/*'] }
          },
          include: ['src']
        },
        null,
        2
      )
    )
  }

  return out
}

// ---------------------------------------------------------------------------
// Çalışma alanı senkronizasyonu
// ---------------------------------------------------------------------------

export async function syncWorkspace(projectName: string, files: ProjectFileInput[]): Promise<string> {
  const dir = workspaceDir(projectName)
  await mkdir(dir, { recursive: true })
  const scaffolded = scaffoldProject(files, projectName)
  for (const f of scaffolded) {
    const full = safeJoin(dir, f.path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, f.content, 'utf8')
  }
  return dir
}

// ---------------------------------------------------------------------------
// Terminal komutu çalıştırma
// ---------------------------------------------------------------------------

const BLOCKED_CMD = /\b(sudo|shutdown|reboot|poweroff|mkfs|dd\s+if=|:\(\)\s*\{)|rm\s+(-[a-z]*\s+)*\/(\s|$)/i

export async function runCommand(projectName: string, cmd: string, timeoutMs = 300_000): Promise<RunResult> {
  if (BLOCKED_CMD.test(cmd)) {
    return { ok: false, output: 'Bu komut güvenlik nedeniyle engellendi: ' + cmd, exitCode: null }
  }
  const dir = workspaceDir(projectName)
  await mkdir(dir, { recursive: true })

  return new Promise<RunResult>((resolvePromise) => {
    // shell: true → Linux/macOS'ta /bin/sh, Windows'ta cmd.exe. 'bash'e sabitlemek
    // Windows'ta kaynak koddan çalıştıran kullanıcıların agent komutlarını kırar.
    const child = spawn(cmd, {
      cwd: dir,
      shell: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv,
      detached: false
    })
    let out = ''
    const push = (d: Buffer) => {
      if (out.length < MAX_OUTPUT) out += d.toString()
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      out += '\n[NexoraAI] Komut zaman aşımına uğradı.'
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ ok: code === 0, output: out.trim().slice(0, MAX_OUTPUT), exitCode: code })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolvePromise({ ok: false, output: 'Komut başlatılamadı: ' + err.message, exitCode: null })
    })
  })
}

// ---------------------------------------------------------------------------
// İnternetten dosya indirme
// ---------------------------------------------------------------------------

export interface FetchFileResult {
  ok: boolean
  path?: string
  bytes?: number
  isText?: boolean
  textContent?: string
  error?: string
}

export async function fetchToFile(projectName: string, url: string, relPath: string): Promise<FetchFileResult> {
  try {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Yalnızca http(s) adresleri indirilebilir.' }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
      redirect: 'follow'
    })
    if (!res.ok) return { ok: false, error: `İndirme başarısız (${res.status}): ${url}` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_DOWNLOAD) return { ok: false, error: 'Dosya çok büyük (50 MB sınırı).' }

    const dir = workspaceDir(projectName)
    const full = safeJoin(dir, relPath)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, buf)

    const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
    const isText = TEXT_EXTS.has(ext) && buf.length < 512 * 1024
    return {
      ok: true,
      path: relPath,
      bytes: buf.length,
      isText,
      textContent: isText ? buf.toString('utf8') : undefined
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ---------------------------------------------------------------------------
// Google Fonts indirme + projeye bağlama
// ---------------------------------------------------------------------------

export interface FontResult {
  ok: boolean
  family?: string
  cssPath?: string
  cssContent?: string
  fileCount?: number
  error?: string
}

export async function addGoogleFont(projectName: string, family: string, baseDir: string): Promise<FontResult> {
  try {
    const fam = family.trim()
    const famUrl = fam.replace(/\s+/g, '+')
    const cssUrl = `https://fonts.googleapis.com/css2?family=${famUrl}:wght@400;500;600;700;800&display=swap`
    const res = await fetch(cssUrl, {
      // woff2 çıktısı için modern tarayıcı UA'sı gerekir
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
    })
    if (!res.ok) return { ok: false, error: `Font bulunamadı: ${fam} (${res.status})` }
    let css = await res.text()

    const slug = slugifyName(fam)
    const fontsRel = `${baseDir}/fonts/${slug}`
    const dir = workspaceDir(projectName)
    await mkdir(safeJoin(dir, fontsRel), { recursive: true })

    // CSS içindeki uzak woff2 URL'lerini indir, yerel yollara çevir
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))]
    let i = 0
    for (const u of urls) {
      i++
      const extM = u.match(/\.(woff2?|ttf|otf)(\?|$)/)
      const ext = extM ? extM[1] : 'woff2'
      const fileRel = `${fontsRel}/${slug}-${i}.${ext}`
      const r = await fetch(u)
      if (!r.ok) continue
      await writeFile(safeJoin(dir, fileRel), Buffer.from(await r.arrayBuffer()))
      css = css.split(u).join(`./fonts/${slug}/${slug}-${i}.${ext}`)
    }

    // Önizleme iframe'i yerel woff2 okuyamaz; en üstteki uzak @import bunu telafi
    // eder. Dışa aktarılan projede ise altındaki yerel @font-face'ler çalışır.
    const finalCss = `@import url('${cssUrl}');\n\n${css}\n.font-${slug} { font-family: '${fam}', sans-serif; }\n`
    const cssRel = `${baseDir}/fonts/${slug}.css`
    await writeFile(safeJoin(dir, cssRel), finalCss, 'utf8')

    return { ok: true, family: fam, cssPath: cssRel, cssContent: finalCss, fileCount: urls.length }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ---------------------------------------------------------------------------
// Dev sunucusu (localhost)
// ---------------------------------------------------------------------------

let devProc: ChildProcess | null = null
let devUrl: string | null = null

export interface DevResult {
  ok: boolean
  url?: string
  output?: string
  error?: string
}

export async function stopDev(): Promise<void> {
  if (devProc) {
    try {
      // npm alt süreç grubunu tümüyle sonlandır
      if (devProc.pid) process.kill(-devProc.pid, 'SIGTERM')
    } catch {
      try {
        devProc.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    devProc = null
    devUrl = null
  }
}

export async function startDev(
  projectName: string,
  files: ProjectFileInput[],
  onStatus: (msg: string) => void
): Promise<DevResult> {
  await stopDev()
  const dir = await syncWorkspace(projectName, files)

  const hasPackageJson = existsSync(join(dir, 'package.json'))
  if (!hasPackageJson) {
    // Statik proje: paketlemeye gerek yok, dosyayı doğrudan tarayıcıda aç
    const idx = join(dir, 'index.html')
    try {
      await access(idx)
      const url = 'file://' + idx
      void shell.openExternal(url)
      return { ok: true, url }
    } catch {
      return { ok: false, error: 'Çalıştırılabilir bir giriş (package.json veya index.html) bulunamadı.' }
    }
  }

  // Her başlatmada kur: package.json'a yeni eklenen bağımlılıklar (lucide-react
  // vb.) eski node_modules varken atlanırsa vite "Failed to resolve import" verir.
  // Bağımlılıklar güncelse npm bunu saniyeler içinde geçer.
  onStatus('Bağımlılıklar denetleniyor (npm install)…')
  const inst = await runCommand(projectName, 'npm install --no-audit --no-fund', 600_000)
  if (!inst.ok) {
    return { ok: false, error: 'npm install başarısız:\n' + inst.output.slice(-1500) }
  }

  onStatus('Dev sunucusu başlatılıyor…')
  return new Promise<DevResult>((resolvePromise) => {
    let output = ''
    let settled = false
    const child = spawn('npm run dev', {
      cwd: dir,
      shell: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none' } as NodeJS.ProcessEnv,
      // Windows'ta süreç grubu ayrımı desteklenmez; stopDev zaten child.kill'e düşer
      detached: process.platform !== 'win32'
    })
    devProc = child

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolvePromise({ ok: false, error: 'Dev sunucusu 90 saniyede hazır olmadı.\n' + output.slice(-1500) })
      }
    }, 90_000)

    const scan = (d: Buffer) => {
      output += d.toString()
      if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT)
      // ANSI renk kodları URL'nin ortasına düşebiliyor (vite portu renklendirir)
      const clean = output.replace(/\x1b\[[0-9;]*m/g, "")
      const m = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?/)
      if (m && !settled) {
        settled = true
        clearTimeout(timer)
        devUrl = m[0]
        void shell.openExternal(devUrl)
        resolvePromise({ ok: true, url: devUrl, output: output.slice(-800) })
      }
    }
    child.stdout?.on('data', scan)
    child.stderr?.on('data', scan)
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        devProc = null
        resolvePromise({ ok: false, error: `Dev sunucusu kapandı (kod ${code}):\n` + output.slice(-1500) })
      }
    })
  })
}

export function getDevUrl(): string | null {
  return devUrl
}

// ---------------------------------------------------------------------------
// Profesyonel dışa aktarma: <seçilen dizin>/<proje-adı>/ altına tam proje
// ---------------------------------------------------------------------------

export async function exportProject(
  projectName: string,
  files: ProjectFileInput[],
  targetBase: string
): Promise<{ ok: boolean; dir?: string; count?: number; error?: string }> {
  try {
    // Önce çalışma alanına senkronla (scaffold + indirilen fontlar/görseller orada)
    const ws = await syncWorkspace(projectName, files)
    const dest = join(targetBase, slugifyName(projectName))
    await rm(dest, { recursive: true, force: true })
    await cp(ws, dest, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(ws.length)
        return !/\/(node_modules|\.git|dist|build|\.next|out)(\/|$)/.test(rel)
      }
    })
    const scaffolded = scaffoldProject(files, projectName)
    return { ok: true, dir: dest, count: scaffolded.length }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
