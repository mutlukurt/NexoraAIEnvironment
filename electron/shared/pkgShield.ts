/**
 * SAHTE PAKET KALKANI (slopsquatting shield) — güven katmanının bir parçası.
 *
 * Sorun: bir model bazen GERÇEKTE VAR OLMAYAN bir paket adı uydurur ("halüsinasyon").
 * Saldırganlar tam da bu uydurulan/yakın-yazımlı adları kayıt defterine önceden
 * koyar (typosquat / "slopsquatting") — kullanıcı farkında olmadan ZARARLI paket kurar.
 * Örnek gerçek saldırı: `crossenv` (gerçeği `cross-env`), `electerm` vb.
 *
 * Bu modül İNTERNETSİZ + DETERMİNİSTİK çalışır: kurulum komutundaki paket adlarını
 * ayrıştırır, gömülü popüler-paket listesine karşı YAKIN-YAZIM (Damerau-Levenshtein 1
 * + ayraç-karıştırma: crossenv≈cross-env) tespit eder. Şüpheli varsa güven katmanı
 * kararı 'auto' yerine 'ask'a yükseltilir (kullanıcı görür, karar verir).
 *
 * NİYET-TABANLI İNVARYANT: bu NİYET belirlemez — yalnız bir komutun GÜVENLİĞİNİ
 * denetler (trust.ts gibi). Model ne kuracağına özgürce karar verir; kalkan sadece
 * "bu ad popülerin sahte-benzeri mi?" diye BİÇİM/güvenlik doğrulaması yapar.
 *
 * `npm run test:pkgshield` saf çekirdeği kilitler.
 */

export type PkgEcosystem = 'npm' | 'pip'

export interface PkgFinding {
  /** Ayrıştırılan ham paket adı (sürüm/ekstra soyulmuş). */
  name: string
  ecosystem: PkgEcosystem
  /** 'known' = listede birebir; 'typosquat' = popülere çok yakın ama farklı;
   *  'unknown' = listede yok, yakın da değil (çevrimdışı doğrulanamaz → engellenmez). */
  kind: 'known' | 'typosquat' | 'unknown'
  /** typosquat ise benzediği popüler paket. */
  near?: string
  /** İnsan-okur gerekçe. */
  reason?: string
}

/**
 * Popüler npm paketleri (gömülü, çevrimdışı). Amaç kapsamlı bir kayıt değil —
 * yakın-yazım saldırılarının HEDEFLEDİĞİ yüksek-indirilen adları içermek. Ayrıca
 * uygulamanın kendi scaffold bağımlılıkları (react/vite/tailwind…) burada → asla
 * yanlış-pozitif vermez. Meşru komşular (preact, next…) da listede → onlar da 'known'.
 */
const POPULAR_NPM = [
  // React ekosistemi + uygulamanın kendi bağımlılıkları
  'react', 'react-dom', 'react-router', 'react-router-dom', 'preact', 'next', 'nuxt', 'vue',
  'svelte', 'angular', '@angular/core', 'solid-js', 'react-redux', 'redux', 'zustand',
  'jotai', 'recoil', 'mobx', 'react-query', '@tanstack/react-query', 'framer-motion',
  'react-icons', 'lucide-react', 'react-hook-form', 'formik', 'yup', 'zod',
  // Build / araç
  'vite', 'webpack', 'rollup', 'esbuild', 'parcel', 'typescript', 'ts-node', 'tsx',
  'babel', '@babel/core', '@babel/preset-env', 'eslint', 'prettier', 'nodemon',
  'concurrently', 'cross-env', 'rimraf', 'npm-run-all', 'electron', 'electron-builder',
  'electron-vite', 'vitest', 'jest', 'mocha', 'chai', 'cypress', 'playwright',
  '@playwright/test', 'testing-library', '@testing-library/react',
  // CSS / stil
  'tailwindcss', 'postcss', 'autoprefixer', 'sass', 'less', 'styled-components',
  'emotion', '@emotion/react', 'clsx', 'classnames', 'color', 'colord',
  // Yardımcı kütüphaneler (klasik squat hedefleri)
  'lodash', 'underscore', 'ramda', 'moment', 'dayjs', 'date-fns', 'luxon', 'axios',
  'node-fetch', 'got', 'request', 'express', 'koa', 'fastify', 'cors', 'body-parser',
  'dotenv', 'chalk', 'commander', 'yargs', 'inquirer', 'ora', 'debug', 'ws', 'socket.io',
  'uuid', 'nanoid', 'bcrypt', 'bcryptjs', 'jsonwebtoken', 'passport', 'helmet',
  'mongoose', 'mongodb', 'pg', 'mysql', 'mysql2', 'sequelize', 'prisma', 'redis',
  'ioredis', 'knex', 'sqlite3', 'better-sqlite3', 'graphql', 'apollo-server',
  '@apollo/client', 'nestjs', '@nestjs/core', 'rxjs', 'immer', 'lodash-es',
  'validator', 'joi', 'ajv', 'semver', 'glob', 'fs-extra', 'chokidar', 'minimist',
  'colors', 'winston', 'pino', 'morgan', 'multer', 'sharp', 'jimp', 'puppeteer',
  'cheerio', 'jsdom', 'marked', 'markdown-it', 'highlight.js', 'prismjs', 'katex',
  'three', 'd3', 'chart.js', 'chartjs', 'echarts', 'leaflet', 'mapbox-gl',
  'gsap', 'lottie-web', 'swiper', 'embla-carousel', 'react-spring',
  'i18next', 'react-i18next', 'stripe', 'firebase', '@supabase/supabase-js',
  'openai', '@anthropic-ai/sdk', 'langchain', 'node-llama-cpp',
]

/** Popüler pip paketleri (klasik squat hedefleri + veri/ML çekirdeği). */
const POPULAR_PIP = [
  'requests', 'urllib3', 'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn',
  'scikit-learn', 'sklearn', 'tensorflow', 'torch', 'pytorch', 'keras',
  'flask', 'django', 'fastapi', 'uvicorn', 'gunicorn', 'starlette', 'pydantic',
  'sqlalchemy', 'psycopg2', 'psycopg2-binary', 'pymongo', 'redis', 'celery',
  'beautifulsoup4', 'bs4', 'lxml', 'scrapy', 'selenium', 'playwright',
  'pillow', 'opencv-python', 'openpyxl', 'xlrd', 'pyyaml', 'toml', 'jsonschema',
  'click', 'typer', 'rich', 'tqdm', 'colorama', 'python-dotenv', 'dotenv',
  'boto3', 'botocore', 'awscli', 'google-cloud-storage', 'azure-storage-blob',
  'pytest', 'nose', 'tox', 'black', 'flake8', 'pylint', 'mypy', 'isort', 'ruff',
  'setuptools', 'wheel', 'pip', 'virtualenv', 'poetry', 'pipenv',
  'openai', 'anthropic', 'transformers', 'huggingface-hub', 'datasets', 'tokenizers',
  'langchain', 'llama-index', 'sentence-transformers', 'accelerate', 'safetensors',
  'jupyter', 'notebook', 'ipython', 'jinja2', 'werkzeug', 'markupsafe', 'certifi',
  'cryptography', 'pyjwt', 'passlib', 'bcrypt', 'httpx', 'aiohttp', 'websockets',
]

/** Ayraçları ve büyük/küçük harfi normalize et — crossenv≈cross-env için. */
function stripSeparators(s: string): string {
  return s.toLowerCase().replace(/[-_.]/g, '')
}

/**
 * Damerau-Levenshtein (optimal string alignment) mesafesi. Yer-değiştirme
 * (transpozisyon: "lodahs"≈"lodash") 1 sayılır — en yaygın yazım hatası/squat.
 * `cap` üstünde erken çıkar (hız + yanlış-pozitifi sınırlar).
 */
export function damerauLevenshtein(a: string, b: string, cap = 3): number {
  if (a === b) return 0
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > cap) return cap + 1
  const prev2 = new Array<number>(bl + 1)
  let prev = new Array<number>(bl + 1)
  let cur = new Array<number>(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j
  for (let i = 1; i <= al; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(
        prev[j] + 1, // silme
        cur[j - 1] + 1, // ekleme
        prev[j - 1] + cost // değiştirme
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1) // transpozisyon
      }
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > cap) return cap + 1
    for (let j = 0; j <= bl; j++) prev2[j] = prev[j]
    const tmp = prev
    prev = cur
    cur = tmp
  }
  return prev[bl]
}

function popularFor(eco: PkgEcosystem): string[] {
  return eco === 'pip' ? POPULAR_PIP : POPULAR_NPM
}

/**
 * Tek bir paket adını popüler listeye karşı denetle.
 * - Birebir listede → 'known' (güvenli).
 * - Ayraçsız hali bir popülerin ayraçsız haline eşit ama ham ad farklı → 'typosquat'
 *   (klasik `crossenv`≈`cross-env` saldırısı).
 * - Popülere Damerau-Levenshtein ≤1 ama eşit değil → 'typosquat'.
 * - Aksi halde 'unknown' (çevrimdışı doğrulanamaz → ENGELLENMEZ, sadece bilinmez).
 */
export function screenPackage(rawName: string, eco: PkgEcosystem): PkgFinding {
  const name = (rawName ?? '').trim()
  if (!name) return { name, ecosystem: eco, kind: 'unknown' }
  const lower = name.toLowerCase()
  const list = popularFor(eco)
  const listLower = list.map((p) => p.toLowerCase())

  if (listLower.includes(lower)) return { name, ecosystem: eco, kind: 'known' }

  // Ayraç-karıştırma: ayraçsız hali bir popülere eşit ama ham farklı.
  const bare = stripSeparators(name)
  for (let i = 0; i < list.length; i++) {
    if (stripSeparators(list[i]) === bare && listLower[i] !== lower) {
      return {
        name,
        ecosystem: eco,
        kind: 'typosquat',
        near: list[i],
        reason: `"${name}" popüler "${list[i]}" paketine ayraç farkıyla çok benziyor (klasik sahte-paket kalıbı)`
      }
    }
  }

  // Yakın-yazım (DL ≤ 1). Çok kısa adlarda (≤3) atla — doğal olarak birbirine yakınlar.
  if (lower.length >= 4) {
    let best: { p: string; d: number } | null = null
    for (const p of list) {
      const pl = p.toLowerCase()
      // Ölçek farkı çok büyükse atla (react vs react-router-dom gibi).
      if (Math.abs(pl.length - lower.length) > 1) continue
      const d = damerauLevenshtein(lower, pl, 1)
      if (d >= 1 && d <= 1 && (!best || d < best.d)) best = { p, d }
    }
    if (best) {
      return {
        name,
        ecosystem: eco,
        kind: 'typosquat',
        near: best.p,
        reason: `"${name}" popüler "${best.p}" paketine tek harf farkıyla çok benziyor (olası sahte paket)`
      }
    }
  }

  return { name, ecosystem: eco, kind: 'unknown' }
}

interface InstallParse {
  ecosystem: PkgEcosystem
  packages: string[]
}

/** pip için sürüm/ekstra soy: `pkg==1.2`, `pkg>=1`, `pkg[extra]`, `pkg~=1`. */
function cleanPipName(tok: string): string {
  return tok.split(/[=<>~!\[ ]/)[0].trim()
}

/** npm için sürüm soy: `pkg@1.2`, `@scope/pkg@1.2`. Scoped adı korur. */
function cleanNpmName(tok: string): string {
  let t = tok.trim()
  if (t.startsWith('@')) {
    // @scope/pkg@ver → son '@' sürüm ayracı (ilki scope'un).
    const at = t.indexOf('@', 1)
    if (at > 0) t = t.slice(0, at)
  } else {
    const at = t.indexOf('@')
    if (at > 0) t = t.slice(0, at)
  }
  return t
}

/** Bir tokenin registry paket adı OLMADIĞINI anla (yerel yol / url / tarball / bayrak). */
function isNonRegistryToken(tok: string): boolean {
  if (!tok || tok.startsWith('-')) return true
  if (/^(https?:|git\+|file:|github:|link:)/i.test(tok)) return true
  if (tok.startsWith('.') || tok.startsWith('~') || tok.startsWith('/')) return true
  if (/\.(tgz|tar\.gz|zip|whl)$/i.test(tok)) return true
  // scoped değilken '/' içeriyorsa (kullanıcı/repo, yerel yol) → registry adı değil.
  if (tok.includes('/') && !tok.startsWith('@')) return true
  return false
}

/**
 * Komut zincirindeki KURULUM segmentlerini bul, paket adlarını çıkar.
 * npm/npx/yarn/pnpm/bun (install|i|add) ve pip/pip3/pipx/python -m pip install.
 * Kurulum değilse (npm run build, yarn install-lockfile'dan…) boş döner.
 */
export function parseInstallTargets(cmd: string): InstallParse[] {
  const out: InstallParse[] = []
  const segments = (cmd ?? '')
    .split(/;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const seg of segments) {
    const toks = seg.split(/\s+/)
    if (toks.length === 0) continue
    const tool = toks[0].toLowerCase()

    // pip / pipx / python -m pip
    let eco: PkgEcosystem | null = null
    let rest: string[] = []
    if (/^pip3?$/.test(tool) || tool === 'pipx') {
      if ((toks[1] || '').toLowerCase() !== 'install') continue
      eco = 'pip'
      rest = toks.slice(2)
    } else if (tool === 'python' || tool === 'python3' || tool === 'py') {
      // python -m pip install ...
      const m = toks.findIndex((t) => t.toLowerCase() === 'pip')
      if (m < 0 || (toks[m + 1] || '').toLowerCase() !== 'install') continue
      eco = 'pip'
      rest = toks.slice(m + 2)
    } else if (/^(npm|npx|yarn|pnpm|bun)$/.test(tool)) {
      // subcommand: install | i | add. yarn/bun/pnpm 'add' de kurar.
      let idx = 1
      if ((toks[1] || '').toLowerCase() === 'global') idx = 2 // yarn global add
      const sub = (toks[idx] || '').toLowerCase()
      if (sub !== 'install' && sub !== 'i' && sub !== 'add') continue
      eco = 'npm'
      rest = toks.slice(idx + 1)
    } else {
      continue
    }

    const packages: string[] = []
    for (let k = 0; k < rest.length; k++) {
      const tok = rest[k]
      // pip: değer alan bayrakları ve değerlerini atla.
      if (eco === 'pip' && /^(-r|-c|-e|--requirement|--constraint|--editable|--index-url|-i|--extra-index-url)$/i.test(tok)) {
        k++ // sonraki token bu bayrağın değeri
        continue
      }
      if (isNonRegistryToken(tok)) continue
      const name = eco === 'pip' ? cleanPipName(tok) : cleanNpmName(tok)
      if (name) packages.push(name)
    }
    // 'npm install' (paketsiz = package.json'dan) → boş, denetlenecek bir şey yok.
    if (packages.length) out.push({ ecosystem: eco, packages })
  }
  return out
}

export interface ShieldResult {
  /** Şüpheli (typosquat) bir paket bulundu mu? */
  suspicious: boolean
  findings: PkgFinding[]
  /** İnsan-okur özet gerekçe (ilk şüpheli). */
  reason?: string
}

/**
 * Bir kabuk komutunu baştan sona denetle. Kurulum yoksa suspicious=false.
 * Bir/çok typosquat bulunursa suspicious=true + gerekçe.
 */
export function screenInstallCommand(cmd: string): ShieldResult {
  const parses = parseInstallTargets(cmd)
  const findings: PkgFinding[] = []
  for (const p of parses) {
    for (const name of p.packages) {
      findings.push(screenPackage(name, p.ecosystem))
    }
  }
  const squat = findings.find((f) => f.kind === 'typosquat')
  return {
    suspicious: !!squat,
    findings,
    reason: squat?.reason
  }
}
