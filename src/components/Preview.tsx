import { useEffect, useMemo, useRef, useState } from 'react'
// @babel/standalone v8 CJS'i `__esModule: true` işaretler ama `default` export
// İÇERMEZ; default import undefined döner ve önizlemeyi kırar. Namespace import
// + çalışma anı normalizasyonu her bundler interop'unda güvenlidir.
import * as babelStandalone from '@babel/standalone'

type BabelTransform = (
  code: string,
  opts: { presets: unknown[]; filename: string; sourceType?: 'script' | 'module' }
) => { code?: string | null } | null

const babelTransform: BabelTransform = (() => {
  const ns = babelStandalone as unknown as Record<string, unknown>
  const direct = ns['transform']
  if (typeof direct === 'function') return direct as BabelTransform
  const dflt = ns['default'] as Record<string, unknown> | undefined
  if (dflt && typeof dflt['transform'] === 'function') return dflt['transform'] as BabelTransform
  return () => {
    throw new Error('@babel/standalone yüklenemedi (transform bulunamadı)')
  }
})()
import { useArtifactsStore } from '@/store/artifactsStore'
import type { ArtifactFile } from '@/store/artifactsStore'
import { useAppStore } from '@/store/appStore'
// Bundled at build time (?raw) — no runtime fetch, works over file:// in the packaged app.
import reactRaw from '../../public/vendor/react.js?raw'
import reactDomRaw from '../../public/vendor/react-dom.js?raw'
import tailwindRaw from '../../public/vendor/tailwind.js?raw'
import lucideRaw from '../../public/vendor/lucide-icons.js?raw'

/** `</script>` inside an inlined source would terminate the srcDoc script tag early. */
function escapeScript(src: string): string {
  return src.replace(/<\/script/gi, '<\\/script')
}

const VENDOR = {
  react: escapeScript(reactRaw),
  reactDom: escapeScript(reactDomRaw),
  tailwind: escapeScript(tailwindRaw),
  lucide: escapeScript(lucideRaw)
}

const STORAGE_MOCK_JS = `(function() {
  var createStorageMock = function() {
    var store = {};
    return {
      getItem: function(key) { return store[key] !== undefined ? store[key] : null; },
      setItem: function(key, value) { store[key] = String(value); },
      removeItem: function(key) { delete store[key]; },
      clear: function() { store = {}; },
      key: function(index) { return Object.keys(store)[index] || null; },
      get length() { return Object.keys(store).length; }
    };
  };
  try {
    var localMock = createStorageMock();
    Object.defineProperty(window, 'localStorage', { get: function() { return localMock; } });
  } catch (e) {}
  try {
    var sessionMock = createStorageMock();
    Object.defineProperty(window, 'sessionStorage', { get: function() { return sessionMock; } });
  } catch (e) {}
})();`

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\\/g, '/')
}
function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

function resolveImport(fromDir: string, importPath: string, allPaths: string[]): string | null {
  // `@/x` ve `~/x` proje kökü alias'ları (Vite/Next şablonlarında yaygın).
  if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
    const rest = importPath.slice(2)
    for (const cand of ['src/' + rest, rest]) {
      if (allPaths.includes(cand)) return cand
      for (const ext of ['.tsx', '.ts', '.jsx', '.js', '.css']) {
        if (allPaths.includes(cand + ext)) return cand + ext
      }
    }
    return null
  }
  if (!importPath.startsWith('.')) return null
  let resolved = normalizePath(fromDir + '/' + importPath)
  while (resolved.includes('/../')) resolved = resolved.replace(/[^/]+\/\.\.\//, '')
  resolved = resolved.replace(/^\.\//, '')
  if (allPaths.includes(resolved)) return resolved
  for (const ext of ['.tsx', '.ts', '.jsx', '.js', '.css']) {
    if (allPaths.includes(resolved + ext)) return resolved + ext
  }
  const baseName = importPath.split('/').pop() ?? ''
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    const c = baseName + ext
    const match = allPaths.find((p) => p.endsWith('/' + c) || p === c)
    if (match) return match
  }
  return null
}

interface NamedImport {
  imported: string
  local: string
}

interface ImportNames {
  default?: string
  named: NamedImport[]
  ns?: string
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/

/**
 * `{ a, b as c, type T }` içini ayrıştır: type-only girdiler ve geçersiz
 * isimler ATILIR — aksi halde `var type T = …` gibi geçersiz JS üretilip
 * TÜM önizleme script'i sözdizimi hatasıyla çöker (App8/ClassValue vakası).
 */
function parseNamedList(inner: string): NamedImport[] {
  const out: NamedImport[] = []
  for (const part of inner.split(',')) {
    const s = part.trim()
    if (!s || /^type\s/.test(s)) continue
    const m = s.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
    if (!m) continue
    const imported = m[1]
    const local = m[2] ?? m[1]
    if (!IDENT_RE.test(imported) || !IDENT_RE.test(local)) continue
    out.push({ imported, local })
  }
  return out
}

function extractImportNames(clause: string): ImportNames {
  const r: ImportNames = { named: [] }
  const c = clause.trim()
  // `import type {...}` / `import type X` — çalışma anında hiçbir şey bağlamaz.
  if (/^type\s/.test(c)) return r

  let m = c.match(/^(\w+)\s*,\s*\{([^}]*)\}$/)
  if (m) {
    if (IDENT_RE.test(m[1])) r.default = m[1]
    r.named = parseNamedList(m[2])
    return r
  }
  m = c.match(/^(\w+)\s*,\s*\*\s+as\s+(\w+)$/)
  if (m) {
    if (IDENT_RE.test(m[1])) r.default = m[1]
    if (IDENT_RE.test(m[2])) r.ns = m[2]
    return r
  }
  m = c.match(/^(\w+)$/)
  if (m) {
    if (IDENT_RE.test(m[1])) r.default = m[1]
    return r
  }
  m = c.match(/^\*\s+as\s+(\w+)$/)
  if (m) {
    if (IDENT_RE.test(m[1])) r.ns = m[1]
    return r
  }
  m = c.match(/^\{([^}]*)\}$/)
  if (m) {
    r.named = parseNamedList(m[1])
    return r
  }
  return r
}

function makeLucideIcon(localName: string, iconKey?: string): string {
  return `function ${localName}(props){
  props = props || {};
  var inner = window.__LUCIDE[${JSON.stringify(iconKey ?? localName)}] || '<circle cx="12" cy="12" r="9"/>';
  var s = Object.assign({width:'1em',height:'1em',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round'}, props.style ? {} : {});
  var attrs = '';
  for (var k in s) attrs += ' '+k+'="'+s[k]+'"';
  if (props.className) attrs += ' class="'+props.className+'"';
  if (props.size) attrs += ' width="'+props.size+'" height="'+props.size+'"';
  return window.React.createElement('svg', {dangerouslySetInnerHTML:{__html: inner}, width: props.size || '1em', height: props.size || '1em', viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round', className: props.className, style: props.style});
}`
}

// clsx/classnames'in gerçek davranışı — className'ler önizlemede de doğru üretilsin.
const CLSX_IMPL = `function(){var out=[];function go(a){if(!a)return;var t=typeof a;if(t==='string'||t==='number'){out.push(a)}else if(Array.isArray(a)){for(var i=0;i<a.length;i++)go(a[i])}else if(t==='object'){for(var k in a){if(a[k])out.push(k)}}}for(var i=0;i<arguments.length;i++)go(arguments[i]);return out.join(' ')}`
// tailwind-merge: önizleme için sınıfları birleştirmek yeterli (çakışma çözümü gerekmez).
const TWMERGE_IMPL = `function(){return Array.prototype.slice.call(arguments).filter(Boolean).join(' ')}`
// framer-motion: motion.div vb. animasyon prop'larını atıp gerçek DOM etiketine düşer.
const MOTION_IMPL = `new Proxy(function(){}, { get: function(_t, tag) {
  if (tag === '__esModule') return false;
  return function(props){
    props = props || {};
    var skip = {initial:1,animate:1,exit:1,transition:1,variants:1,whileHover:1,whileTap:1,whileInView:1,whileFocus:1,whileDrag:1,viewport:1,layout:1,layoutId:1,drag:1,dragConstraints:1,onAnimationComplete:1,onAnimationStart:1};
    var clean = {};
    for (var p in props) { if (!skip[p] && p !== 'children') clean[p] = props[p]; }
    return window.React.createElement(String(tag), clean, props.children);
  };
} })`
const PASSTHROUGH_IMPL = `function(p){ return p && p.children != null ? p.children : null }`

function stubImport(clause: string, from: string): string {
  const info = extractImportNames(clause)
  const parts: string[] = []
  if (from === 'react' || from === 'react/jsx-runtime' || from.startsWith('react/')) {
    if (info.default) parts.push(`${info.default} = window.React`)
    if (info.ns) parts.push(`${info.ns} = window.React`)
    for (const n of info.named) parts.push(`${n.local} = window.React.${n.imported} || window.React`)
    return parts.length ? `var ${parts.join(', ')};\n` : ''
  }
  if (from === 'lucide-react') {
    if (info.default) parts.push(`${info.default} = ${makeLucideIcon(info.default, 'Icon')}`)
    if (info.ns) parts.push(`${info.ns} = {}`)
    for (const n of info.named) parts.push(`${n.local} = ${makeLucideIcon(n.local, n.imported)}`)
    return parts.length ? `var ${parts.join(', ')};\n` : ''
  }
  if (from === 'clsx' || from === 'classnames') {
    if (info.default) parts.push(`${info.default} = ${CLSX_IMPL}`)
    if (info.ns) parts.push(`${info.ns} = { default: ${CLSX_IMPL}, clsx: ${CLSX_IMPL} }`)
    for (const n of info.named) parts.push(`${n.local} = ${CLSX_IMPL}`)
    return parts.length ? `var ${parts.join(', ')};\n` : ''
  }
  if (from === 'tailwind-merge') {
    if (info.default) parts.push(`${info.default} = ${TWMERGE_IMPL}`)
    if (info.ns) parts.push(`${info.ns} = { twMerge: ${TWMERGE_IMPL} }`)
    for (const n of info.named) parts.push(`${n.local} = ${TWMERGE_IMPL}`)
    return parts.length ? `var ${parts.join(', ')};\n` : ''
  }
  if (from === 'framer-motion' || from === 'motion/react') {
    if (info.default) parts.push(`${info.default} = ${MOTION_IMPL}`)
    if (info.ns) parts.push(`${info.ns} = { motion: ${MOTION_IMPL}, AnimatePresence: ${PASSTHROUGH_IMPL} }`)
    for (const n of info.named) {
      if (n.imported === 'motion' || n.imported === 'm') parts.push(`${n.local} = ${MOTION_IMPL}`)
      else if (n.imported === 'AnimatePresence' || n.imported === 'LazyMotion' || n.imported === 'MotionConfig')
        parts.push(`${n.local} = ${PASSTHROUGH_IMPL}`)
      else parts.push(`${n.local} = function(){ return {} }`)
    }
    return parts.length ? `var ${parts.join(', ')};\n` : ''
  }
  const noop = (name: string) =>
    `function ${name}(p){ return p && p.children != null ? (window.React.isValidElement(p.children) ? p.children : null) : null }`
  if (info.default) parts.push(`${info.default} = ${noop('Comp')}`)
  if (info.ns) parts.push(`${info.ns} = {}`)
  for (const n of info.named) parts.push(`${n.local} = ${noop(n.local)}`)
  return parts.length ? `var ${parts.join(', ')};\n` : ''
}

function transformModule(file: ArtifactFile, allPaths: string[], exportMap?: Record<string, string>): string {
  let code = file.content
  const exportedNames: string[] = []
  const exportPairs: Array<{ exported: string; local: string }> = []
  const exportStarFroms: string[] = []
  let defaultExportName: string | null = null

  // `export interface X` / `export type X = …` — TS tipleri, export anahtar
  // kelimesi kalırsa script modunda sözdizimi hatası olur; declarasyonu bırak.
  code = code.replace(/^(\s*)export\s+(interface|type)\s/gm, '$1$2 ')

  // `export { a, b as c }` ve `export { a } from './x'` / `export * from './x'`
  code = code.replace(
    /^\s*export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?\s*;?\s*$/gm,
    (_m, inner: string, from?: string) => {
      const specs = parseNamedList(inner)
      if (from) {
        // re-export: önce import gibi bağla, sonra dışa aktar
        const resolved = resolveImport(dirOf(file.path), from, allPaths) ?? from
        for (const s of specs) exportPairs.push({ exported: s.local, local: s.local })
        return specs.length
          ? `/*__NEXORA_REEXPORT__*/ var ${specs.map((s) => `${s.local} = require(${JSON.stringify(resolved)}).${s.imported}`).join(', ')};`
          : ''
      }
      for (const s of specs) exportPairs.push({ exported: s.local, local: s.imported })
      return ''
    }
  )
  code = code.replace(/^\s*export\s*\*\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/gm, (_m, from: string) => {
    exportStarFroms.push(from)
    return ''
  })

  code = code.replace(/export\s+default\s+async\s+function\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    defaultExportName = n
    return `var ${n} = async function ${n}`
  })

  code = code.replace(/export\s+default\s+function\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    defaultExportName = n
    return `var ${n} = function ${n}`
  })
  code = code.replace(/export\s+default\s+class\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    defaultExportName = n
    return `var ${n} = class ${n}`
  })
  code = code.replace(/export\s+default\s+/g, () => {
    exportedNames.push('__default')
    defaultExportName = '__default'
    return `var __default = `
  })
  code = code.replace(/export\s+async\s+function\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    return `var ${n} = async function ${n}`
  })
  code = code.replace(/export\s+function\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    return `var ${n} = function ${n}`
  })
  code = code.replace(/export\s+const\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    return `var ${n}`
  })
  code = code.replace(/export\s+let\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    return `var ${n}`
  })
  code = code.replace(/export\s+var\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    return `var ${n}`
  })
  code = code.replace(/export\s+class\s+(\w+)/g, (_m, n) => {
    exportedNames.push(n)
    return `var ${n} = class ${n}`
  })

  const imports: Array<{ clause: string; from: string }> = []
  code = code.replace(/^\s*import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_full, clause, from) => {
    imports.push({ clause: String(clause).trim(), from: String(from) })
    return ''
  })
  code = code.replace(/^\s*import\s+['"]([^'"]+)['"]\s*;?\s*$/gm, () => '')
  code = code.replace(/^\s*['"]use client['"];?\s*$/gm, '')
  code = code.replace(/^\s*['"]use server['"];?\s*$/gm, '')

  // AUTO-IMPORT HEURISTIC: Inject missing dependencies if they are in the project's export map but not imported or declared in this file.
  if (exportMap) {
    for (const [symbol, targetPath] of Object.entries(exportMap)) {
      if (targetPath === file.path) continue
      const isUsed = new RegExp(`\\b${symbol}\\b`).test(code)
      if (!isUsed) continue
      const isImported = new RegExp(`\\b${symbol}\\b`).test(file.content)
      const isDeclared = new RegExp(`(?:const|let|var|function|class)\\s+\\b${symbol}\\b`).test(code)
      if (!isImported && !isDeclared) {
        imports.push({ clause: symbol, from: targetPath })
      }
    }
  }

  const fromDir = dirOf(file.path)
  let importCode = ''
  for (const imp of imports) {
    const isLocal =
      imp.from.startsWith('.') || imp.from.startsWith('@/') || imp.from.startsWith('~/') || allPaths.includes(imp.from)
    if (isLocal) {
      const resolved = allPaths.includes(imp.from) ? imp.from : resolveImport(fromDir, imp.from, allPaths)
      if (resolved && !resolved.endsWith('.css')) {
        const info = extractImportNames(imp.clause)
        const mod = `require(${JSON.stringify(resolved)})`
        const parts: string[] = []
        if (info.default) {
          parts.push(`${info.default} = ${mod}.default || ${mod}.${info.default} || ${mod}`)
        }
        if (info.ns) {
          parts.push(`${info.ns} = ${mod}`)
        }
        for (const n of info.named) {
          parts.push(`${n.local} = ${mod}.${n.imported}`)
        }
        importCode += parts.length ? `var ${parts.join(', ')};\n` : ''
      } else if (resolved && resolved.endsWith('.css')) {
        // CSS handled separately
      } else {
        importCode += stubImport(imp.clause, imp.from)
      }
    } else {
      importCode += stubImport(imp.clause, imp.from)
    }
  }

  // Kullanılan ama hiçbir yerde tanımlanmamış JSX bileşenleri (küçük modeller
  // bazen unutuyor): çökmek yerine children'ı geçiren bir yer tutucu bağla.
  const REACT_BUILTINS = new Set(['Fragment', 'StrictMode', 'Suspense'])
  const jsxTags = [...new Set([...code.matchAll(/<([A-Z][\w$]*)/g)].map((m) => m[1]))]
  for (const tag of jsxTags) {
    if (REACT_BUILTINS.has(tag)) continue
    const declaredInFile = new RegExp(`(?:const|let|var|function|class)\\s+${tag}\\b`).test(code)
    const boundByImport = new RegExp(`(?:^|[\\s,{])${tag}\\s*=`).test(importCode)
    if (!declaredInFile && !boundByImport) {
      importCode += `var ${tag} = function(p){ p = p || {}; return window.React.createElement('div', {className: p.className, style: p.style}, p.children != null ? p.children : null) };\n`
    }
  }

  const isTs = file.language === 'typescript'
  let transformed: string
  try {
    // sourceType 'script': gözden kaçan bir import/export burada (yakalanabilir
    // şekilde) patlar; 'module' olsaydı üretilen kod tarayıcıda TÜM önizlemeyi
    // sözdizimi hatasıyla çökertirdi.
    const out = babelTransform(code, {
      presets: [
        ['react', { runtime: 'classic' }],
        ...(isTs ? (['typescript'] as const) : [])
      ],
      filename: file.path,
      sourceType: 'script'
    })
    if (!out?.code) throw new Error('Babel boş çıktı üretti')
    transformed = out.code
  } catch (err) {
    // Ham JSX'i asla yayma (iframe'de SyntaxError yapar) — hatayı görünür kıl.
    const msg = err instanceof Error ? err.message : String(err)
    transformed = `throw new Error(${JSON.stringify(`Derleme hatası — ${file.path}:\n${msg}`)});`
  }

  const exportEntries = exportedNames.map((n) =>
    n === '__default' ? `default: typeof __default !== 'undefined' ? __default : null` : `${n}: typeof ${n} !== 'undefined' ? ${n} : null`
  )
  for (const p of exportPairs) {
    exportEntries.push(`${p.exported}: typeof ${p.local} !== 'undefined' ? ${p.local} : null`)
  }
  if (defaultExportName && defaultExportName !== '__default') {
    exportEntries.push(`default: typeof ${defaultExportName} !== 'undefined' ? ${defaultExportName} : null`)
  }
  const exportObj = `Object.assign(module.exports, { ${exportEntries.join(', ')} });`
  const starExports = exportStarFroms
    .map((f) => resolveImport(dirOf(file.path), f, allPaths))
    .filter((p): p is string => !!p && !p.endsWith('.css'))
    .map((p) => `try { Object.assign(module.exports, require(${JSON.stringify(p)})); } catch (e) {}`)
    .join('\n')
  return `window.__defineModule(${JSON.stringify(file.path)}, function(require, exports, module){\n${importCode}\n${transformed}\n${exportObj}\n${starExports}\n});`
}

function findEntryPath(files: ArtifactFile[]): string | null {
  const jsxFiles = files.filter((f) => f.language === 'javascript' || f.language === 'typescript')
  if (jsxFiles.length === 0) return null

  // Next.js App Router: prefer app/page.tsx, fallback app/layout.tsx
  const nextEntry = ['app/page.tsx', 'app/page.jsx', 'app/layout.tsx', 'app/layout.jsx']
  for (const name of nextEntry) {
    const match = jsxFiles.find((f) => f.path === name)
    if (match) return match.path
  }

  // src/ altındaki giriş her zaman kök kopyaya tercih edilir (küçük modeller
  // bazen aynı dosyayı iki yolda üretiyor; src/ olanı derli toplu olandır).
  const preferred = ['src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx', 'app.tsx', 'app.jsx', 'index.tsx', 'index.jsx', 'main.tsx', 'main.jsx', 'page.tsx', 'page.jsx', 'layout.tsx']
  for (const name of preferred) {
    const match = jsxFiles.find((f) => f.path === name || f.path.endsWith('/' + name))
    if (match) return match.path
  }
  for (const f of jsxFiles) {
    if (/export\s+default\s+function\s+App\b/.test(f.content)) return f.path
    if (/export\s+default\s+function\s+Page\b/.test(f.content)) return f.path
  }
  return jsxFiles[0].path
}

export function buildReactPreview(
  files: Record<string, ArtifactFile>,
  reactSrc: string,
  reactDomSrc: string,
  tailwindSrc: string,
  lucideSrc: string
): string {
  const allFiles = Object.values(files)
  const jsxFiles = allFiles.filter((f) => f.language === 'javascript' || f.language === 'typescript')
  if (jsxFiles.length === 0) return ''
  const allPaths = jsxFiles.map((f) => f.path)
  const entryPath = findEntryPath(allFiles)
  if (!entryPath) return ''

  const exportMap: Record<string, string> = {}
  for (const f of jsxFiles) {
    const base = f.path.split('/').pop()?.split('.')[0] ?? ''
    if (base && /^[A-Z]/.test(base)) {
      exportMap[base] = f.path
    }
    const matches = f.content.matchAll(/export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g)
    for (const m of matches) {
      const name = m[1]
      if (name && name !== 'default') {
        exportMap[name] = f.path
      }
    }
  }

  // Her modül KENDİ <script> etiketinde: birinde sözdizimi hatası olsa bile
  // diğer modüller ve render bootstrap'ı çalışmaya devam eder.
  const moduleScripts = jsxFiles
    .map((f) => `<script>\ntry {\n${escapeScript(transformModule(f, allPaths, exportMap))}\n} catch (e) { window.__nexErr('Modül tanım hatası [${f.path}]: ' + (e.message || e)); }\n</script>`)
    .join('\n')

  const extraCss = allFiles
    .filter((f) => f.language === 'css')
    .map((f) => `<style data-path="${f.path}">${f.content}</style>`)
    .join('\n')

  return `<!doctype html>
<html><head><meta charset="utf-8">
<script>
${STORAGE_MOCK_JS}
// NexoraAI hata overlay'i — beyaz ekran yerine her hatayı görünür yapar.
window.__nexErr = function (msg) {
  try {
    var el = document.getElementById('nex-err');
    if (!el) {
      el = document.createElement('pre');
      el.id = 'nex-err';
      el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-height:45%;overflow:auto;background:#7f1d1d;color:#fecaca;font:12px/1.5 ui-monospace,monospace;padding:10px 12px;border-radius:8px;z-index:2147483647;white-space:pre-wrap;margin:0;box-shadow:0 4px 24px rgba(0,0,0,.45)';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = 'Önizleme hatası:\\n' + msg;
  } catch (_) {}
};
window.addEventListener('error', function (e) {
  window.__nexErr((e.message || 'Bilinmeyen hata') + (e.filename ? '\\n' + e.filename + (e.lineno ? ':' + e.lineno : '') : ''));
});
window.addEventListener('unhandledrejection', function (e) {
  var r = e && e.reason;
  window.__nexErr(String(r && (r.stack || r.message) || r || 'Promise reddedildi'));
});
</script>
${extraCss}
<style>body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}</style>
<script>${tailwindSrc}</script>
<script>${lucideSrc}</script>
</head><body>
<div id="root"></div>
<script>${reactSrc}</script>
<script>${reactDomSrc}</script>
<script>
if (window.React) {
  for (var k in window.React) {
    if (typeof window.React[k] === 'function' && !window[k]) {
      window[k] = window.React[k];
    }
  }
}
window.__modules = {};
window.__cache = {};

window.__defineModule = function(name, factory) {
  window.__modules[name] = factory;
};

window.__require = function(name) {
  if (window.__cache[name]) {
    return window.__cache[name];
  }
  var factory = window.__modules[name];
  if (!factory) {
    return {};
  }
  var module = { exports: {} };
  window.__cache[name] = module.exports; // cache early to support circular dependencies
  try {
    factory(window.__require, module.exports, module);
    window.__cache[name] = module.exports;
  } catch(e) {
    window.__nexErr("Modül yükleme hatası [" + name + "]: " + (e.stack || e.message || String(e)));
    throw e;
  }
  return module.exports;
};
</script>
${moduleScripts}
<script>
try {
var __entry = window.__require(${JSON.stringify(entryPath)});
var __Cmp = __entry && (__entry.default || __entry.Page || __entry.App || null);
if (!__Cmp) {
  for (var k in window.__cache) { if (window.__cache[k].default) { __Cmp = window.__cache[k].default; break; } }
}
if (__Cmp && window.ReactDOM && window.ReactDOM.createRoot) {
  window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(__Cmp));
  // Sessiz gri ekran teşhisi: render sonrası görünür içerik yoksa nedenini söyle.
  setTimeout(function () {
    var root = document.getElementById('root');
    var hasVisual = root && (root.innerText.trim().length > 0 || root.querySelector('img,svg,canvas,video,input,button'));
    if (!hasVisual && !document.getElementById('nex-err')) {
      window.__nexErr('Uygulama yüklendi ama görünür içerik üretmedi (bileşen boş dönüyor olabilir). Sohbetten "önizlemede hiçbir şey görünmüyor, düzelt" diyebilirsiniz.');
    }
  }, 1800);
} else {
  window.__nexErr('Önizlenebilecek bir component bulunamadı (export default App/Page yok).');
}
} catch (e) {
  window.__nexErr(e && e.stack ? e.stack : String(e));
}
</script>
</body></html>`
}

/** İçeriği tam bir HTML belgesi olan dosya — uzantısı yanlış (.txt vb.) olsa bile. */
function isHtmlDocFile(f: ArtifactFile): boolean {
  return f.language === 'html' || /^\s*(<!doctype\s+html|<html[\s>])/i.test(f.content)
}

export function buildHtmlPreview(
  files: Record<string, ArtifactFile>,
  selectedPath: string | null,
  tailwindSrc?: string
): string | null {
  const htmlFiles = Object.values(files).filter(isHtmlDocFile)
  if (htmlFiles.length === 0) return null

  const picked =
    (selectedPath && files[selectedPath] && isHtmlDocFile(files[selectedPath]) ? files[selectedPath] : null) ||
    htmlFiles.find((f) => f.path === 'index.html') ||
    htmlFiles.find((f) => f.path === 'index.htm') ||
    htmlFiles[0]
  if (!picked) return null

  const css = Object.values(files)
    .filter((f) => f.language === 'css' && f.path !== picked.path)
    .map((f) => `<style data-path="${f.path}">\n${f.content}\n</style>`)
    .join('\n')

  const plainJs = Object.values(files)
    .filter((f) => f.language === 'javascript' && f.path !== picked.path)
    .map((f) => `<script data-path="${f.path}">\n${escapeScript(f.content)}\n</script>`)
    .join('\n')

  const tw = tailwindSrc ? `<script>${tailwindSrc}</script>\n` : ''
  const storageMock = `<script>\n${STORAGE_MOCK_JS}\n</script>\n`
  let doc = picked.content
  const inject = '\n' + storageMock + tw + css + '\n' + plainJs + '\n'
  const hasHead = /<head[^>]*>/i.test(doc)
  if (hasHead) doc = doc.replace(/<head[^>]*>/i, (m) => m + inject)
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, (m) => m + `<head>${inject}</head>`)
  else doc = inject + doc
  return doc
}

/**
 * iframe içinden "hayattayım" sinyali. Belgenin EN BAŞINA (head açılır açılmaz)
 * enjekte edilir: ağır içerik (react+tailwind, ~1MB) yavaş makinede saniyeler
 * sürebilir; sinyal "çerçeve çalışıyor ve parse başladı" demektir, "her şey
 * yüklendi" değil. Sona konursa yavaş yüklemeler ölü sanılır (0.5.5 hatası).
 */
const READY_BEACON = `<script>try{parent.postMessage('nexora-preview-ready','*')}catch(e){}</script>`

function injectBeacon(doc: string): string {
  const m = doc.match(/<head[^>]*>/i)
  if (m && m.index != null) {
    const at = m.index + m[0].length
    return doc.slice(0, at) + READY_BEACON + doc.slice(at)
  }
  return READY_BEACON + doc
}

export default function Preview() {
  const files = useArtifactsStore((s) => s.files)
  const selectedPath = useArtifactsStore((s) => s.selectedPath)
  const generating = useAppStore((s) => s.generating)

  // nonce iframe'in key'i: artınca element SIFIRDAN yaratılır (askıda kalmış /
  // çökmüş çerçeve süreci dahil her şey tazelenir).
  const [nonce, setNonce] = useState(0)
  const [dead, setDead] = useState(false)
  const autoRetried = useRef(false)

  const { srcDoc } = useMemo(() => {
    const htmlPreview = buildHtmlPreview(files, selectedPath, VENDOR.tailwind)
    const hasJsx = Object.values(files).some((f) => f.language === 'javascript' || f.language === 'typescript')

    // Vite giriş iskeleti (boş #root + module script) gerçek içerik değildir;
    // React dosyaları varsa sandbox render'ı tercih edilir.
    const htmlIsEntryStub =
      !!htmlPreview && /<div\s+id=["']root["']\s*>\s*<\/div>/i.test(htmlPreview) && /type=["']module["']/i.test(htmlPreview)

    const doc =
      htmlPreview && !(htmlIsEntryStub && hasJsx)
        ? htmlPreview
        : hasJsx
          ? buildReactPreview(files, VENDOR.react, VENDOR.reactDom, VENDOR.tailwind, VENDOR.lucide)
          : (htmlPreview ?? null)
    return { srcDoc: doc ? injectBeacon(doc) : null }
  }, [files, selectedPath])

  // Üretim bittiğinde iframe'i taze bir elementle yeniden kur (streaming
  // sırasında biriken srcdoc güncellemelerinin her türlü kalıntısını temizler).
  const prevGenerating = useRef(generating)
  useEffect(() => {
    if (prevGenerating.current && !generating) {
      setNonce((n) => n + 1)
      autoRetried.current = false
    }
    prevGenerating.current = generating
  }, [generating])

  // Canlılık bekçisi: beacon parse başında gönderildiği için normalde 1-2 sn
  // içinde gelir. 10 sn gelmezse çerçeve gerçekten ölü demektir → bir kez
  // otomatik yeniden yarat; yine olmazsa kapatılabilir bir uyarı göster.
  useEffect(() => {
    if (!srcDoc || generating) return
    let ready = false
    setDead(false)
    const onMsg = (e: MessageEvent) => {
      if (e.data === 'nexora-preview-ready') {
        ready = true
        // Geç gelen sinyal (çok yavaş yükleme) uyarıyı kendiliğinden temizler.
        setDead(false)
      }
    }
    window.addEventListener('message', onMsg)
    const timer = setTimeout(() => {
      if (!ready) {
        if (!autoRetried.current) {
          autoRetried.current = true
          console.warn('[NexoraAI] preview beacon yok — iframe yeniden yaratılıyor')
          setNonce((n) => n + 1)
        } else {
          setDead(true)
        }
      }
    }, 10000)
    return () => {
      window.removeEventListener('message', onMsg)
      clearTimeout(timer)
    }
  }, [srcDoc, nonce, generating])

  if (!srcDoc) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-2 text-2xl text-zinc-700">🌐</div>
        <p className="text-sm text-ink-dim">Önizleme için bir HTML veya JSX/TSX dosyası gerekli</p>
        <p className="mt-1 text-xs text-ink-dim">Dosya ekle ya da modelden bir bileşen üret</p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <iframe
        key={nonce}
        title="preview"
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        srcDoc={srcDoc}
        className="h-full w-full border-0 bg-ink-card"
      />
      {/* Elle yenileme: çerçeveyi sıfırdan yaratır */}
      <button
        onClick={() => {
          autoRetried.current = true
          setDead(false)
          setNonce((n) => n + 1)
        }}
        title="Önizlemeyi yenile"
        className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-ink-line bg-ink-card/90 text-ink-mut shadow-sm backdrop-blur transition hover:text-ink-text"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>
      {dead && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300">Önizleme çerçevesinden yanıt gelmedi</p>
            <p className="text-[11px] text-amber-700 dark:text-amber-300/80">Sayfa hâlâ yükleniyor olabilir; yenilemek genellikle çözer.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => {
                setDead(false)
                setNonce((n) => n + 1)
              }}
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-500"
            >
              Yenile
            </button>
            <button
              onClick={() => setDead(false)}
              className="rounded-lg border border-amber-500/30 bg-ink-card px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 transition hover:bg-amber-100"
            >
              Kapat
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
