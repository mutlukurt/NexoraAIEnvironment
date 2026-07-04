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
import { pathToFileURL } from 'url'
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

  // Türkçe kesme işareti onarımı (gerçek 14B testinde 4 kez yakalandı):
  // model 'İstanbul'un lezzetleri' gibi tek tırnaklı stringler yazıyor ve
  // içteki kesme işareti stringi erken kapatıyor. Satırın tamamı tek bir
  // tek-tırnaklı değerse ve içinde kesme işareti varsa çift tırnağa çevir.
  for (const f of out) {
    if (!/\.(tsx|ts|jsx|js)$/.test(f.path)) continue
    f.content = f.content
      .split('\n')
      .map((line) => {
        const m = line.match(/^(\s*)'(.*)',?(\s*)$/)
        // Yalnızca TEK string değeri olan satırlar: 'a': 'b' anahtar-değer
        // çiftlerine (içinde "':" deseni olanlara) asla dokunma.
        if (m && m[2].includes("'") && !m[2].includes('"') && !/'\s*:/.test(m[2])) {
          return `${m[1]}"${m[2]}"${line.trimEnd().endsWith(',') ? ',' : ''}${m[3]}`
        }
        return line
      })
      .join('\n')
  }

  // "Kullanılmış ama import edilmemiş tanımlayıcı" onarımı — gerçek 14B
  // testlerinde iki kez yakalandı (cn() ve <Button/>): runtime ReferenceError
  // → bembeyaz sayfa. Projedeki export'ların haritası çıkarılır; bir dosyada
  // kullanılan ama ne tanımlanan ne import edilen isimler otomatik bağlanır.
  const relModulePath = (fromFile: string, targetFile: string): string => {
    const fromDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')).split('/') : []
    const target = targetFile.replace(/\.(tsx|ts|jsx|js)$/, '').split('/')
    let common = 0
    while (common < fromDir.length && common < target.length - 1 && fromDir[common] === target[common]) common++
    const rel = '../'.repeat(fromDir.length - common) + target.slice(common).join('/')
    return rel.startsWith('.') ? rel : './' + rel
  }

  // 1) Export haritası: isim → { dosya, default mı? }
  const exportMap = new Map<string, { path: string; isDefault: boolean }>()
  for (const f of out) {
    if (!/\.(tsx|ts|jsx)$/.test(f.path)) continue
    for (const m of f.content.matchAll(/export\s+default\s+(?:function\s+)?([A-Z]\w*)/g)) {
      exportMap.set(m[1], { path: f.path, isDefault: true })
    }
    const base = f.path.split('/').pop()!.split('.')[0]
    if (/^[A-Z]/.test(base) && /export\s+default\b/.test(f.content) && !exportMap.has(base)) {
      exportMap.set(base, { path: f.path, isDefault: true })
    }
    for (const m of f.content.matchAll(/export\s+(?:const|function|class)\s+([A-Z]\w*)/g)) {
      if (!exportMap.has(m[1])) exportMap.set(m[1], { path: f.path, isDefault: false })
    }
    // Veri exportları da (menuCategories, reviews, site...) — 14B testinde
    // bileşen importu kadar sık unutuldukları görüldü.
    for (const m of f.content.matchAll(/export\s+const\s+([a-z]\w*)/g)) {
      if (!exportMap.has(m[1])) exportMap.set(m[1], { path: f.path, isDefault: false })
    }
  }

  // 2) Eksik importları bağla: JSX bileşenleri + kullanılan veri exportları
  const REACT_BUILTINS = new Set(['Fragment', 'StrictMode', 'Suspense', 'React'])
  for (const f of out) {
    if (!/\.(tsx|jsx)$/.test(f.path)) continue
    const jsxTags = [...new Set([...f.content.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]))]
    const candidates = new Set<string>(jsxTags)
    for (const [name] of exportMap) {
      if (/^[a-z]/.test(name) && new RegExp(`\\b${name}\\b`).test(f.content)) candidates.add(name)
    }
    const importLines: string[] = []
    for (const name of candidates) {
      if (REACT_BUILTINS.has(name)) continue
      const info = exportMap.get(name)
      if (!info || info.path === f.path) continue
      const declared = new RegExp(`(?:const|let|var|function|class)\\s+${name}\\b`).test(f.content)
      const imported = new RegExp(`import[^\\n]*\\b${name}\\b`).test(f.content)
      if (declared || imported) continue
      const rel = relModulePath(f.path, info.path)
      importLines.push(info.isDefault ? `import ${name} from '${rel}'` : `import { ${name} } from '${rel}'`)
    }
    if (importLines.length > 0) f.content = importLines.join('\n') + '\n' + f.content
  }

  // 3) cn() özel durumu: hiçbir dosya export etmiyorsa bağımlılıksız üret
  const cnNeedy = out.filter(
    (f) =>
      /\.(tsx|jsx)$/.test(f.path) &&
      /\bcn\(/.test(f.content) &&
      !/(?:import|const|function|var|let)[^\n]*\bcn\b/.test(f.content)
  )
  if (cnNeedy.length > 0) {
    const cnSource = out.find((f) => /\.(ts|tsx)$/.test(f.path) && /export\s+(?:const|function)\s+cn\b/.test(f.content))?.path
    if (!cnSource) {
      add(
        'src/lib/utils.ts',
        `type ClassInput = string | number | null | undefined | false | Record<string, unknown>

export function cn(...inputs: ClassInput[]): string {
  const out: string[] = []
  for (const i of inputs) {
    if (!i) continue
    if (typeof i === 'string' || typeof i === 'number') out.push(String(i))
    else for (const k in i) if (i[k]) out.push(k)
  }
  return out.join(' ')
}
`
      )
    }
    const cnPath = cnSource ?? 'src/lib/utils.ts'
    for (const f of cnNeedy) {
      f.content = `import { cn } from '${relModulePath(f.path, cnPath)}'\n` + f.content
    }
  }

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

  // package.json (model YA DA [PKG] aksiyonu yazmis olabilir) KOSULSUZ
  // dezenfekte edilir — proje siniflandirilamasa bile. Canli testte yakalandi:
  // uretimi yarida kesilip entry dosyasi olmayan projede [PKG]'nin yazdigi
  // script'siz minimal manifest diske ham gitti ve Calistir "Missing
  // script: dev" ile dustu. Script uclusu proje turune gore secilir.
  if (has('package.json')) {
    try {
      const pj = JSON.parse(map.get('package.json')!.content)
      // Vite ile cakisan / gereksiz araclar hicbir listede kalamaz
      const BANNED = ['react-scripts', 'postcss-cli', 'webpack', 'webpack-cli', 'parcel']
      pj.dependencies = pj.dependencies ?? {}
      pj.devDependencies = pj.devDependencies ?? {}
      for (const b of BANNED) {
        delete pj.dependencies[b]
        delete pj.devDependencies[b]
      }
      // Derleme araclari dependencies'e degil devDependencies'e aittir;
      // bizim bilinen-iyi surumlerimiz modelinkileri EZER.
      for (const tool of Object.keys(devDeps)) delete pj.dependencies[tool]
      pj.devDependencies = { ...pj.devDependencies, ...devDeps }
      for (const [k, v] of Object.entries(deps)) if (!pj.dependencies[k]) pj.dependencies[k] = v
      // Calistirma script'leri her zaman zorlanir; react-scripts referansli
      // artik script'ler atilir.
      const scripts: Record<string, string> = {}
      for (const [k, v] of Object.entries((pj.scripts ?? {}) as Record<string, string>)) {
        if (!/react-scripts/.test(v)) scripts[k] = v
      }
      pj.scripts = isNext
        ? { ...scripts, dev: 'next dev', build: 'next build', start: 'next start' }
        : { ...scripts, dev: 'vite', build: 'vite build', preview: 'vite preview' }
      if (!pj.type && !isNext) pj.type = 'module'
      delete pj.main
      const rec = map.get('package.json')!
      rec.content = JSON.stringify(pj, null, 2)
      const idx = out.findIndex((f) => f.path === 'package.json')
      if (idx >= 0) out[idx] = rec
    } catch {
      /* bozuk package.json'a dokunma */
    }
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

  // Model, kurulum yapılmadan "npm run build" gibi komutlar verebiliyor
  // (gerçek 14B vakası: "vite: not found"). package.json varsa ve
  // node_modules yoksa, npm komutlarından önce bağımlılıkları kur.
  if (
    /^(npm|npx|vite|yarn|pnpm)\b/.test(cmd.trim()) &&
    !/^(npm|yarn|pnpm)\s+(install|i|ci)\b/.test(cmd.trim()) &&
    existsSync(join(dir, 'package.json')) &&
    !existsSync(join(dir, 'node_modules'))
  ) {
    const inst = await runCommand(projectName, 'npm install --no-audit --no-fund', 600_000)
    if (!inst.ok) return { ok: false, output: 'Önkoşul npm install başarısız:\n' + inst.output.slice(-800), exitCode: inst.exitCode }
  }

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
      // pathToFileURL: Windows sürücü harfli yollarda da geçerli file:/// üretir
      const url = pathToFileURL(idx).toString()
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
// Derleme denetimi: "Çalıştır" sonrası arka planda vite build koşulur; hata
// varsa dosya+satır+kod çerçevesiyle yakalanıp chat'e taşınır. Kullanıcının
// tek yapması gereken "düzelt" yazmak — teknik olmayan kullanıcı için köprü.
// ---------------------------------------------------------------------------

export interface BuildCheckResult {
  ok: boolean
  error?: string
  /** node_modules kurulu olmadığı için tam derleme atlandı (onlyIfInstalled). */
  skipped?: boolean
}

export async function buildCheck(projectName: string, onlyIfInstalled?: boolean): Promise<BuildCheckResult> {
  const dir = workspaceDir(projectName)
  if (!existsSync(join(dir, 'package.json'))) return { ok: true } // statik proje: derleme yok

  // Üretim-sonrası sessiz denetim (roadmap 2.3): node_modules kurulu değilse
  // arka planda dakikalarca npm install BAŞLATMA — hızlı sözdizimi katmanı
  // (renderer, Babel) zaten koştu; tam derleme ilk Çalıştır'a kalır.
  if (onlyIfInstalled && !existsSync(join(dir, 'node_modules'))) {
    return { ok: true, skipped: true }
  }

  const res = await runCommand(projectName, 'npx vite build --logLevel error', 240_000)
  if (res.ok) return { ok: true }

  // Hata bölümünü çıkar: ilk "error" satırından itibaren, mutlak yolları
  // proje-görece yollara çevirerek (model dosyaları o adlarla tanıyor).
  const lines = res.output.split('\n')
  const firstErr = lines.findIndex((l) => /error/i.test(l))
  const slice = lines.slice(Math.max(0, firstErr), firstErr + 30).join('\n')
  const relativized = slice.split(dir + sep).join('').split(dir + '/').join('')
  let error = relativized.trim().slice(0, 1500) || res.output.slice(-1000)
  // Hata sınıfı ipuçları: modeller "dosya sonu" hatasında hata satırına takılıp
  // kök nedeni aramıyor (gerçek 14B testinde iki kez görüldü). Yönlendir.
  if (/unexpected end of file/i.test(error)) {
    error +=
      '\n\nİPUCU: "Unexpected end of file" hatasının asıl nedeni neredeyse her zaman dosyanın DAHA YUKARISINDA kapanmamış bir tırnak, parantez veya JSX etiketidir. Hata satırına değil, açık kalan yere odaklan (örn. className="... ifadesinde eksik kapanış tırnağı).'

    // Şüpheli satır taraması: çift tırnak sayısı TEK olan satırlar kapanmamış
    // string demektir. Modele nokta atışı hedef ver (14B testinde, satır
    // içeriği verilmeden EOF hatasının 3 turda da çözülemediği görüldü).
    const fileMatch = error.match(/([\w./-]+\.(?:tsx|ts|jsx|js)):\d+/)
    if (fileMatch) {
      try {
        const src = await readFile(join(dir, fileMatch[1]), 'utf8')
        const suspects = src
          .split('\n')
          .map((l, i) => ({ n: i + 1, l }))
          .filter(({ l }) => ((l.match(/"/g) ?? []).length % 2 === 1))
          .slice(0, 3)
        if (suspects.length > 0) {
          error +=
            '\n\nŞÜPHELİ SATIR(LAR) — tırnak sayısı tek, kapanmamış string olabilir:\n' +
            suspects.map(({ n, l }) => `${fileMatch[1]}:${n}: ${l.trim()}`).join('\n')
        }
      } catch {
        /* ignore */
      }
    }
  }
  return { ok: false, error }
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
