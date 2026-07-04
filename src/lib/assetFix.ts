/**
 * Kırık yerel görsel referansı onarımı.
 *
 * Küçük modeller var olmayan dosyalara işaret etmeyi seviyor
 * (src="/assets/portrait.jpg" gibi) — sayfa kırık resim simgeleriyle doluyor.
 * Üretim bittikten sonra bu referanslar taranır: dosya projede yoksa ve aynı
 * yanıttaki bir [FETCH] direktifiyle de indirilmiyorsa, foto uzantıları
 * deterministik picsum yer tutucusuna, svg'ler nötr bir data-URI simgesine
 * çevrilir. Gerçekten var olan/indirilen dosyalara dokunulmaz.
 */

const NEUTRAL_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='48' height='48'%3E%3Crect x='3' y='3' width='18' height='18' rx='5' fill='%23a78bfa'/%3E%3Ccircle cx='12' cy='12' r='4' fill='white'/%3E%3C/svg%3E"

// src="..." / href="..." / url(...) içindeki yerel asset-vari yollar.
const ATTR_RE = /(src|href)=(["'])((?:\.{0,2}\/)?(?:public\/|src\/)?(?:assets|images?|img)\/[^"']+)\2/gi
const CSS_URL_RE = /url\(\s*(["']?)((?:\.{0,2}\/)?(?:public\/|src\/)?(?:assets|images?|img)\/[^"')]+)\1\s*\)/gi

function normalizeCandidates(p: string): string[] {
  const clean = p.replace(/^\.{0,2}\//, '').replace(/^\//, '')
  return [clean, 'src/' + clean, 'public/' + clean, clean.replace(/^src\//, ''), clean.replace(/^public\//, '')]
}

function placeholderFor(path: string): string {
  const base = (path.split('/').pop() ?? 'gorsel').replace(/\.[^.]*$/, '').replace(/[^\w-]/g, '') || 'gorsel'
  if (/\.svg(\?|$)/i.test(path)) return NEUTRAL_SVG
  return `https://picsum.photos/seed/${base}/800/600`
}

export interface AssetFixResult {
  content: string
  fixed: number
}

export function fixBrokenAssetRefs(
  content: string,
  existingPaths: Set<string>,
  fetchTargets: Set<string>
): AssetFixResult {
  let fixed = 0
  const known = (p: string): boolean =>
    normalizeCandidates(p).some((c) => existingPaths.has(c) || fetchTargets.has(c))

  let out = content.replace(ATTR_RE, (m, attr: string, q: string, path: string) => {
    if (known(path)) return m
    fixed++
    return `${attr}=${q}${placeholderFor(path)}${q}`
  })
  out = out.replace(CSS_URL_RE, (m, _q: string, path: string) => {
    if (known(path)) return m
    fixed++
    return `url('${placeholderFor(path)}')`
  })
  return { content: out, fixed }
}

/**
 * Kod dosyasina sizan agent-direktifi satirlarini SIL (roadmap canli-test
 * bulgusu): model "[FONT] import ..." gibi satirlari dosya icine yazabiliyor;
 * duzeltme turlari bunlari yorumlayip duruyor (her turda bir "// " daha) ve
 * dosya asla derlenmiyor. Direktifler zaten uretimin tam metninden ayristirilip
 * YURUTULUYOR — dosyada isleri yok. Yorumlanmis kopyalari da temizler.
 */
const STRAY_DIRECTIVE_RE = /^\s*(?:\/\/\s*)*\[(?:PKG|FONT|FETCH|RUN|DEV)\]/
const CODE_EXT_RE = /\.(tsx|ts|jsx|js|mjs|cjs|css|html)$/i

export function stripStrayDirectiveLines(path: string, content: string): { content: string; removed: number } {
  if (!CODE_EXT_RE.test(path)) return { content, removed: 0 }
  const lines = content.split('\n')
  const kept = lines.filter((l) => !STRAY_DIRECTIVE_RE.test(l))
  return { content: kept.join('\n'), removed: lines.length - kept.length }
}
