/**
 * Deterministik kod formatlama — prettier (standalone, renderer içinde).
 *
 * Üretim bittikten sonra yazılan/düzenlenen dosyalar prettier'dan geçirilir:
 * model token harcamadan tutarlı stil, üstelik prettier parse edemediği
 * dosyada hata fırlattığı için bozuk sözdizimi erken sinyal verir (o durumda
 * dosya OLDUĞU GİBİ bırakılır — asla veri kaybettirmez).
 *
 * ÖNEMLİ ZAMANLAMA: formatlama yalnızca ÜRETİM TAMAMEN BİTİNCE çalışır.
 * Akış sırasında ya da edit blokları uygulanırken format yapılırsa, aynı
 * yanıttaki sonraki SEARCH blokları eski metni bulamaz.
 */
import * as prettier from 'prettier/standalone'
import * as pluginBabel from 'prettier/plugins/babel'
import * as pluginEstree from 'prettier/plugins/estree'
import * as pluginTs from 'prettier/plugins/typescript'
import * as pluginPostcss from 'prettier/plugins/postcss'
import * as pluginHtml from 'prettier/plugins/html'

function parserFor(path: string): { parser: string; plugins: unknown[] } | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts':
    case 'tsx':
      return { parser: 'typescript', plugins: [pluginTs, pluginEstree] }
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { parser: 'babel', plugins: [pluginBabel, pluginEstree] }
    case 'json':
      return { parser: 'json', plugins: [pluginBabel, pluginEstree] }
    case 'css':
      return { parser: 'css', plugins: [pluginPostcss] }
    case 'html':
    case 'htm':
      return { parser: 'html', plugins: [pluginHtml, pluginPostcss, pluginBabel, pluginEstree] }
    default:
      return null
  }
}

/**
 * Dosyayı formatla. Değişiklik yoksa/format edilemiyorsa (bilinmeyen tür ya
 * da sözdizimi hatası) null döner — çağıran dosyayı olduğu gibi bırakır.
 */
export async function formatFileContent(path: string, content: string): Promise<string | null> {
  const cfg = parserFor(path)
  if (!cfg || !content.trim()) return null
  try {
    const out = await prettier.format(content, {
      parser: cfg.parser,
      plugins: cfg.plugins as never,
      printWidth: 100,
      semi: false,
      singleQuote: true
    })
    return out !== content ? out : null
  } catch {
    // Parse hatası: dosya bozuk olabilir — dokunma, buildCheck yakalar.
    return null
  }
}
