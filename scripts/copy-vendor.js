const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const dest = path.join(root, 'public', 'vendor')

fs.mkdirSync(dest, { recursive: true })

// Prefer production builds (smaller + faster preview boot), fall back to development.
const files = [
  [
    ['node_modules/react/umd/react.production.min.js', 'node_modules/react/umd/react.development.js'],
    'react.js'
  ],
  [
    ['node_modules/react-dom/umd/react-dom.production.min.js', 'node_modules/react-dom/umd/react-dom.development.js'],
    'react-dom.js'
  ]
]

for (const [candidates, name] of files) {
  const from = candidates.map((c) => path.join(root, c)).find((p) => fs.existsSync(p))
  if (!from) {
    console.warn('[copy-vendor] missing', candidates[0])
    continue
  }
  fs.copyFileSync(from, path.join(dest, name))
  console.log('[copy-vendor] copied', path.basename(from), '->', name)
}

// Window icon: main process references out/renderer/logo.png at runtime.
const logoSrc = path.join(root, 'src', 'assets', 'logo.png')
if (fs.existsSync(logoSrc)) {
  fs.copyFileSync(logoSrc, path.join(root, 'public', 'logo.png'))
  console.log('[copy-vendor] copied logo.png -> public/')
}
