import type { ArtifactFile } from '@/store/artifactsStore'

export function fixNextJsCode(file: ArtifactFile): ArtifactFile {
  if (file.language !== 'typescript' && file.language !== 'javascript') return file
  let content = file.content

  // Fix missing '=' in common JSX/HTML attributes (e.g. className "bg-red" -> className="bg-red", style {color: 'red'} -> style={color: 'red'})
  content = content.replace(
    /(className|id|src|href|alt|title|type|placeholder|style|value|width|height|onClick|onChange|onSubmit|disabled|checked|readOnly)\s+(?!=)\s*(["'][^"']*["']|{[^}]*})/g,
    '$1=$2'
  )

  content = content.replace(/^\s*['"]use client['"];?\s*$/gm, '')
  content = content.replace(/^\s*['"]use server['"];?\s*$/gm, '')

  content = content.replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+['"]next\/font\/google['"]\s*;?\s*$/gm,
    ''
  )
  content = content.replace(
    /^\s*import\s+\{[^}]*Inter[^}]*\}\s+from\s+['"]next\/font\/google['"]\s*;?\s*$/gm,
    ''
  )

  content = content.replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+['"]next\/link['"]\s*;?\s*$/gm,
    ''
  )
  content = content.replace(/<Link\s/g, '<a ')
  content = content.replace(/<\/Link>/g, '</a>')

  content = content.replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+['"]next\/image['"]\s*;?\s*$/gm,
    ''
  )
  content = content.replace(/<Image\s/g, '<img ')
  content = content.replace(/<\/Image>/g, '</img>')

  content = content.replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+['"]next\/navigation['"]\s*;?\s*$/gm,
    ''
  )
  content = content.replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+['"]next\/router['"]\s*;?\s*$/gm,
    ''
  )
  content = content.replace(
    /^\s*import\s+\{[^}]*useRouter[^}]*\}\s+from\s+['"]next\/.*['"]\s*;?\s*$/gm,
    'var useRouter = function() { return { push: function() {}, replace: function() {}, back: function() {}, refresh: function() {} }; }'
  )

  content = content.replace(/const\s+\w+\s*=\s*\w+\(\s*\{[^}]*\}\s*\)/g, (match) => {
    if (/font|Font|inter|Inter/.test(match)) {
      return ''
    }
    return match
  })

  if (content.includes('className={inter.className}')) {
    content = content.replace(/className=\{inter\.className\}/g, "style={{fontFamily: 'Inter, system-ui, sans-serif'}}")
  }

  content = content.replace(/^\s*import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*['"]\s*;?\s*$/gm, '')

  content = content.replace(/\n{3,}/g, '\n\n')

  return { ...file, content }
}

export function fixFiles(files: Record<string, ArtifactFile>): Record<string, ArtifactFile> {
  const out: Record<string, ArtifactFile> = {}
  for (const [path, file] of Object.entries(files)) {
    out[path] = fixNextJsCode(file)
  }
  return out
}
