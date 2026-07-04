/**
 * Üretim-sonrası HIZLI sözdizimi denetimi (roadmap 2.3, katman 1).
 *
 * Her üretimden sonra dokunulan JS/TS/JSX/TSX dosyaları @babel/standalone
 * ile ayrıştırılır — node_modules gerekmez, milisaniyeler sürer ve hataların
 * ezici çoğunluğunu (kapanmamış tırnak/parantez/JSX etiketi) anında yakalar.
 * Import çözümleme / tip hataları gibi derinlikli sorunlar, node_modules
 * kuruluysa koşan tam vite derlemesine (katman 2) kalır.
 *
 * formatCode gibi tembel yüklenir: Babel ana pakete binmez.
 */

export interface SyntaxIssue {
  path: string
  message: string
}

const CHECKABLE_RE = /\.(tsx|ts|jsx|js|mjs|cjs)$/i

export async function syntaxCheckFiles(
  files: Array<{ path: string; content: string }>
): Promise<SyntaxIssue[]> {
  const targets = files.filter((f) => CHECKABLE_RE.test(f.path))
  if (targets.length === 0) return []

  const Babel = await import('@babel/standalone')
  const issues: SyntaxIssue[] = []
  for (const f of targets) {
    try {
      const isTs = /\.tsx?$/i.test(f.path)
      Babel.transform(f.content, {
        filename: f.path,
        // Yalnızca ayrıştırma amaçlı dönüşüm; çıktı kullanılmaz.
        presets: isTs ? ['typescript', 'react'] : ['react'],
        code: false,
        ast: false,
        sourceMaps: false
      })
    } catch (err) {
      // Babel hata mesajı dosya/satır/sütun + kod çerçevesi içerir — modele
      // doğrudan verilecek kadar isabetlidir.
      const msg = (err as Error).message ?? String(err)
      issues.push({ path: f.path, message: msg.slice(0, 1200) })
      if (issues.length >= 3) break // ilk hatalar yeterli; model turu boğulmasın
    }
  }
  return issues
}
