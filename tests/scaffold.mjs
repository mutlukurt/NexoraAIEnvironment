/**
 * scaffoldProject dep sertleştirme regresyon takımı.
 * GERÇEK-APP canlı test bulgusu: model uydurma bir CRA package.json'ı yazıp
 * `@tailwindcss/aspect-ratio@^0.4.3` (var olmayan versiyon) ekledi → npm ETARGET
 * → dev sunucu hiç kalkmadı. Fix: dependencies KODDA import edilen + güvenli-
 * versiyonlu yetkili setle DEĞİŞTİRİLİR; uydurma depler budanır.
 *
 * Çalıştırma: npm run test:scaffold
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-scaffold-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { scaffoldProject } from '${join(repo, 'electron/main/agentService.ts')}'\n`)
// electron/ana-süreç importları (shell, dialog) scaffoldProject'te KULLANILMIYOR;
// düz node'da 'electron' yüklenemez → boş stub'la, çağrılmaz.
const stub = join(work, 'electron-stub.js')
writeFileSync(stub, 'export const shell = {}; export const dialog = {}; export default {};')
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { electron: stub, '@shared': join(repo, 'electron/shared') }
})
const { scaffoldProject } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++
  console.log(ok ? '✓' : '✗', n, d ? '— ' + d : '')
}

// Model'in uydurduğu CRA package.json (canlı testte diske giden birebir sınıf):
const modelPkg = JSON.stringify({
  name: 'nexoraai',
  version: '1.0.0',
  main: 'src/App.tsx',
  scripts: { dev: 'react-scripts start', build: 'react-scripts build' },
  dependencies: {
    '@emotion/react': '^11.8.2',
    '@tailwindcss/aspect-ratio': '^0.4.3', // VAR OLMAYAN versiyon → ETARGET
    '@tailwindcss/line-clamp': '^0.4.3',
    '@tailwindcss/typography': '^0.5.7',
    'framer-motion': '^9.1.10', // eski versiyon
    'lucide-react': '^0.276.0', // eski versiyon
    react: '^18.2.0',
    'react-dom': '^18.2.0'
  },
  devDependencies: { 'react-scripts': '5.0.1', typescript: '^4.9.5' }
})

const files = [
  {
    path: 'src/App.tsx',
    content: `import React from 'react'\nimport { Home } from 'lucide-react'\nimport { motion } from 'framer-motion'\nexport default function App(){ return <div className="p-4"><Home/></div> }`
  },
  { path: 'src/index.css', content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' },
  { path: 'package.json', content: modelPkg },
  {
    path: 'tailwind.config.js',
    content: `export default {\n  content: ['./src/**/*.tsx'],\n  theme: { extend: { colors: { brand: '#123456' } } },\n  plugins: [require('@tailwindcss/aspect-ratio'), require('@tailwindcss/typography')]\n}\n`
  }
]

const out = scaffoldProject(files, 'Kişisel Portfolyo Sitesi')
const pkgOut = JSON.parse(out.find((f) => f.path === 'package.json').content)
const twOut = out.find((f) => f.path === 'tailwind.config.js').content
const deps = pkgOut.dependencies || {}

// --- ETARGET kökü: uydurma/import-edilmeyen depler budanmalı ---
check('uydurma @tailwindcss/aspect-ratio budandı (ETARGET kökü)', !deps['@tailwindcss/aspect-ratio'], JSON.stringify(Object.keys(deps)))
check('@tailwindcss/line-clamp budandı', !deps['@tailwindcss/line-clamp'])
check('@tailwindcss/typography budandı', !deps['@tailwindcss/typography'])
check('import edilmeyen @emotion/react budandı', !deps['@emotion/react'])

// --- import EDİLEN depler kalır, güvenli versiyonla ---
check('react var + güvenli versiyon', /^\^18\.3/.test(deps['react'] || ''), deps['react'])
check('react-dom var', !!deps['react-dom'])
check('lucide-react import edildi → var + güvenli versiyon (eski ^0.276 DEĞİL)', deps['lucide-react'] === '^0.454.0', deps['lucide-react'])
check('framer-motion import edildi → var + güvenli versiyon (eski ^9.1 DEĞİL)', deps['framer-motion'] === '^11.11.0', deps['framer-motion'])

// --- hiçbir dep VAR OLMAYAN/kötü versiyon taşımamalı (ETARGET imkansız) ---
const badVersion = Object.entries(deps).find(([, v]) => /aspect-ratio|@0\.4\.3|\^0\.276|\^9\.1/.test(String(v)))
check('hiçbir depte kötü/eski versiyon kalmadı', !badVersion, badVersion ? JSON.stringify(badVersion) : '')

// --- react-scripts scripts atıldı, vite zorlandı ---
check('scripts.dev = vite (react-scripts atıldı)', pkgOut.scripts.dev === 'vite', JSON.stringify(pkgOut.scripts))
check('react-scripts hiçbir yerde kalmadı', !JSON.stringify(pkgOut).includes('react-scripts'))

// --- tailwind.config plugin require'ları güvenli boşaltıldı ---
check('tailwind.config plugins boşaltıldı (cannot-find-module önlendi)', /plugins:\s*\[\s*\]/.test(twOut), twOut.match(/plugins:[^\n]*/)?.[0])
check('tailwind.config custom theme korundu', /brand.*#123456|#123456/.test(twOut))

rmSync(work, { recursive: true, force: true })
console.log(`\nscaffold: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
