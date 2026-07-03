const fs = require('fs')
const path = require('path')

const esmDir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'dist', 'esm', 'icons')
const destDir = path.join(__dirname, '..', 'public', 'vendor')
const outFile = path.join(destDir, 'lucide-icons.js')

fs.mkdirSync(destDir, { recursive: true })

const files = fs.readdirSync(esmDir).filter((f) => f.endsWith('.mjs'))
const icons = {}

for (const f of files) {
  const content = fs.readFileSync(path.join(esmDir, f), 'utf8')
  const nameMatch = content.match(/const\s+(\w+)\s*=/)
  const svgMatch = content.match(/`([\s\S]*?)`/)
  if (!nameMatch || !svgMatch) continue
  const name = nameMatch[1]
  const svg = svgMatch[1]
    .replace(/\s+/g, ' ')
    .replace(/class="[^"]*"/, '')
    .replace(/<svg/, '<svg')
    .trim()
  const innerMatch = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  if (!innerMatch) continue
  icons[name] = innerMatch[1].trim()
}

const header = `// Auto-generated from lucide-static. ${files.length} files scanned, ${Object.keys(icons).length} icons.
window.__LUCIDE = window.__LUCIDE || {};
`
let body = ''
for (const [name, inner] of Object.entries(icons)) {
  body += `window.__LUCIDE[${JSON.stringify(name)}] = ${JSON.stringify(inner)};\n`
}

fs.writeFileSync(outFile, header + body)
console.log(`[lucide] wrote ${Object.keys(icons).length} icons to ${path.relative(path.join(__dirname, '..'), outFile)}`)
