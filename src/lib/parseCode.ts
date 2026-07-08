export interface CodeBlock {
  lang: string
  code: string
  suggestedName: string
}

export type ContentSegment = { type: 'text'; value: string } | { type: 'code'; block: CodeBlock }

const KNOWN_EXTS = new Set([
  'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'md', 'markdown',
  'mjs', 'cjs', 'svg', 'txt', 'py', 'vue', 'svelte', 'toml', 'yaml', 'yml', 'xml', 'sh'
])

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

/** Normalize + validate something that should be a file path. */
function cleanPath(raw: string): string | null {
  if (!raw) return null
  let s = raw.trim()
  s = s.replace(/^["'`]+/, '').replace(/["'`]+$/, '')
  s = s.replace(/^\.\//, '').replace(/^\/+/, '')
  s = s.replace(/[.,;:!?]+$/, '')
  if (!s || s.length > 120) return null
  if (!/^[\w.@/-]+$/.test(s)) return null
  if (s.includes('//') || s.includes('..')) return null
  if (!KNOWN_EXTS.has(extOf(s))) return null
  return s
}

// `// File: app/page.tsx`, `# File: x`, `<!-- File: x -->`, `/* File: x */`, `**File: x**`, `File: x`, `Dosya: x`
const MARKER_RE = /^\s*(?:\/\/|#{1,6}|<!--|\/\*|\*\*|;{1,2})?\s*(?:file|dosya)\s*:\s*(.+?)\s*(?:-->|\*\/|\*\*)?\s*$/i

// A line that is ONLY a path: `app/page.tsx`, `**app/page.tsx**`, `### app/page.tsx`,
// `components/Hero.tsx:`, `3. src/App.tsx` (list numbering ahead of the path is common).
const BARE_PATH_RE = /^\s*(?:#{1,6}\s+)?(?:\d{1,2}[.)]\s+)?(?:\*\*|__|`)?\s*(?:\d{1,2}[.)]\s+)?((?:[\w.@-]+\/)*[\w@-][\w.@-]*\.[A-Za-z]{1,10})\s*(?:\*\*|__|`)?\s*:?\s*$/

/** If the (complete) line announces a new file, return its path. */
function fileMarkerPath(line: string): string | null {
  const m1 = line.match(MARKER_RE)
  if (m1) {
    const p = cleanPath(m1[1])
    if (p) return p
  }
  const m2 = line.match(BARE_PATH_RE)
  if (m2) {
    const p = cleanPath(m2[1])
    if (p) return p
  }
  return null
}

// A zero-indent sentence (starts uppercase, no code symbols, ends with punctuation)
// after a blank line means the model went back to talking — the file is done.
const PROSE_RESUME_RE = /^[A-ZÇĞİÖŞÜ][^{}()<>=;[\]`|&$]*[.!?:…]$/

function isProseResume(line: string, curExt: string): boolean {
  if (curExt === 'md' || curExt === 'markdown' || curExt === 'txt') return false
  if (!line || line !== line.trimStart()) return false
  if (!line.includes(' ')) return false
  return PROSE_RESUME_RE.test(line.trimEnd())
}

/** Could this still-incomplete trailing line grow into a marker/fence? Hide it from prose if so. */
function maybeMarkerStart(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^(`|\/\/|\/\*?|<!?-{0,2}|#|\*\*?|;)/.test(t)) return true
  if (/^(f(i(l(e:?)?)?)?|d(o(s(y(a:?)?)?)?)?)$/i.test(t)) return true
  if (/^(file|dosya)\s*:/i.test(t)) return true
  // A path being typed out — only when a "/" makes it unambiguous
  // (a plain word ending with "." like "Bitti." must stay visible).
  if (/^[\w.@/-]{1,80}$/.test(t) && t.includes('/')) return true
  return false
}

function extractPath(raw: string): string | null {
  if (!raw) return null
  let s = raw.trim()
  s = s
    .replace(/^\/\//, '')
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .replace(/^\/\*/, '')
    .replace(/\*\/$/, '')
    .replace(/^#+/, '')
    .replace(/^(?:file|dosya)\s*:\s*/i, '')
    .trim()
  return cleanPath(s.split(/\s+/)[0] ?? '')
}

const DEFAULT_STEMS: Record<string, [stem: string, ext: string]> = {
  html: ['index', 'html'],
  htm: ['index', 'html'],
  css: ['styles', 'css'],
  js: ['script', 'js'],
  javascript: ['script', 'js'],
  jsx: ['App', 'jsx'],
  ts: ['script', 'ts'],
  tsx: ['App', 'tsx'],
  json: ['data', 'json'],
  py: ['script', 'py'],
  python: ['script', 'py'],
  md: ['README', 'md'],
  markdown: ['README', 'md']
}

/** Tam bir HTML belgesi mi? (küçük modeller HTML'i dilsiz fence'e koyabiliyor) */
export function looksLikeHtmlDoc(code: string): boolean {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(code)
}

/** Fallback name for a truly anonymous block: per-language counter (App.tsx, App2.tsx…). */
function suggestName(lang: string, code: string, existingPaths: string[]): string {
  const firstLine = code.split('\n').find((x) => x.trim()) ?? ''
  const fromFirstLine = fileMarkerPath(firstLine) ?? extractPath(firstLine)
  if (fromFirstLine) return fromFirstLine

  // Dil belirtilmemiş ama içerik HTML belgesi: snippet.txt yerine index.html.
  // Aksi halde önizleme HTML dosyası bulamaz ve boş (gri) ekran kalır.
  const effectiveLang = !lang || lang === 'text' ? (looksLikeHtmlDoc(code) ? 'html' : lang) : lang

  const [stem, ext] = DEFAULT_STEMS[effectiveLang] ?? ['snippet', 'txt']
  const sameStem = new RegExp(`^${stem}\\d*\\.${ext}$`)
  const count = existingPaths.filter((p) => sameStem.test(p)).length
  return count === 0 ? `${stem}.${ext}` : `${stem}${count + 1}.${ext}`
}

export interface StreamedFileBlock {
  path: string
  lang: string
  code: string
  complete: boolean
}

export interface StreamingParseResult {
  /** All prose outside code blocks (code is never included). */
  text: string
  files: StreamedFileBlock[]
}

function trimBlankEdges(arr: string[]): string[] {
  const out = [...arr]
  while (out.length && !out[0].trim()) out.shift()
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out
}

/**
 * Streaming-aware parser. Detects files in BOTH formats:
 *   1. Fenced:   ```tsx app/page.tsx ... ```
 *   2. Unfenced: a `// File: app/page.tsx` (or bare `app/page.tsx`) header line,
 *      code runs until the next file header / fence / end of content.
 *
 * While streaming, the last open block is emitted with `complete: false` so
 * files can be written live. Pass `{ final: true }` once the stream is over:
 * every block is then complete and trailing prose is fully recovered.
 * Code NEVER leaks into `text`.
 */
export function parseStreaming(content: string, opts?: { final?: boolean }): StreamingParseResult {
  const files: StreamedFileBlock[] = []
  const prose: string[] = []
  if (!content) return { text: '', files }

  const fin = opts?.final === true
  const endsNL = content.endsWith('\n')
  const lines = content.split('\n')
  if (endsNL) lines.pop()
  const isComplete = (idx: number) => fin || idx < lines.length - 1 || endsNL

  let cur: { path: string; buf: string[] } | null = null

  const closeCur = (complete: boolean) => {
    if (!cur) return
    const buf = trimBlankEdges(cur.buf)
    files.push({ path: cur.path, lang: extOf(cur.path), code: buf.join('\n'), complete })
    cur = null
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const complete = isComplete(i)

    // ---- Fenced block ----
    const fm = line.match(/^\s*```([\w+-]*)[ \t]*(.*?)\s*$/)
    if (fm) {
      // `src/App.tsx:` on its own line right before the fence names THIS block.
      // Without this, that line became an empty file and the block got a made-up
      // numbered name (App2.tsx, App8.tsx, …).
      let pendingPath: string | null = null
      if (cur && trimBlankEdges(cur.buf).length === 0) {
        pendingPath = cur.path
        cur = null
      } else {
        closeCur(true)
      }
      const lang = (fm[1] || '').toLowerCase()
      const headerPath = cleanPath(fm[2] || '') ?? extractPath(fm[2] || '') ?? pendingPath

      let close = -1
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*```+\s*$/.test(lines[j])) {
          close = j
          break
        }
      }
      const closed = close !== -1
      let codeLines = lines.slice(i + 1, closed ? close : lines.length)

      // First inner line may repeat the path as a `// File:` comment — use it, then strip it.
      let path = headerPath
      const fni = codeLines.findIndex((l) => l.trim())
      if (fni !== -1 && isComplete(i + 1 + fni)) {
        const p = fileMarkerPath(codeLines[fni])
        if (p) {
          if (!path) path = p
          if (p === path) codeLines = [...codeLines.slice(0, fni), ...codeLines.slice(fni + 1)]
        }
      }

      // Open blocks are only emitted once the file name is knowable.
      const firstLineComplete = fni !== -1 && isComplete(i + 1 + fni)
      if (closed || path || firstLineComplete) {
        const code = trimBlankEdges(codeLines).join('\n')
        const finalPath = path ?? suggestName(lang || 'text', code, files.map((f) => f.path))
        files.push({
          path: finalPath,
          lang: lang || extOf(finalPath) || 'text',
          code,
          complete: closed || fin
        })
      }
      if (!closed) return finish()
      i = close + 1
      continue
    }

    // ---- Unfenced file header (`// File: x`, bare path line) ----
    const markerPath = complete ? fileMarkerPath(line) : null
    if (markerPath) {
      closeCur(true)
      cur = { path: markerPath, buf: [] }
      i++
      continue
    }

    if (cur) {
      // Blank line + a sentence at column 0 → the model resumed talking; close the file.
      const lastBuf = cur.buf.length ? cur.buf[cur.buf.length - 1] : null
      if (complete && lastBuf !== null && lastBuf.trim() === '' && isProseResume(line, extOf(cur.path))) {
        closeCur(true)
        prose.push(line)
      } else {
        cur.buf.push(line)
      }
    } else if (!(!complete && maybeMarkerStart(line))) {
      // Prose. A suspicious incomplete trailing line (`// Fi`, "```", `app/pa`…)
      // is hidden until we know what it becomes.
      prose.push(line)
    }
    i++
  }

  return finish()

  function finish(): StreamingParseResult {
    closeCur(fin)
    let text = prose.join('\n')
    if (!fin) text = text.replace(/`{1,3}[\w+-]*[ \t]*$/, '')
    return { text, files }
  }
}

// ---------------------------------------------------------------------------
// Cerrahi düzenleme (Aider/Cursor tarzı SEARCH/REPLACE blokları)
// ---------------------------------------------------------------------------

export interface EditApplyResult {
  content: string
  applied: number
  failed: number
  /** 6.3: eşleşmeyen SEARCH metinleri — gerçeklik geri beslemesi bunlardan kurulur. */
  failures: string[]
}

/** Bir blok cerrahi düzenleme mi? (```edit yolu ya da içinde SEARCH işareti) */
export function isEditBlock(lang: string, code: string): boolean {
  return lang === 'edit' || /^<{4,}[ \t]*SEARCH/m.test(code)
}

/** Bir SEARCH bloğu bu satır sayısını aşarsa model dosyayı baştan yazıyor demektir. */
export const MAX_SEARCH_LINES = 20

/**
 * Akış sırasında bekçi: son açılan SEARCH bölümü (henüz ======= gelmeden)
 * MAX_SEARCH_LINES'ı aştıysa true döner. Model komple bölüm/dosya kopyalamaya
 * başladığında üretimi erken kesip küçük bloklar istemek için kullanılır.
 */
export function hasOversizedOpenSearch(content: string, maxLines = MAX_SEARCH_LINES): boolean {
  const at = content.lastIndexOf('<<<<<<< SEARCH')
  if (at === -1) return false
  const lines = content.slice(at).split('\n').slice(1)
  const sep = lines.findIndex((l) => /^={4,}[ \t]*$/.test(l.trim()))
  const searchLines = sep === -1 ? lines.length : sep
  return searchLines > maxLines
}

/** Akan bir edit bloğunun canlı durumu (sohbette gösterim için). */
export function editStreamInfo(code: string): { blocks: number; phase: 'search' | 'replace' } {
  const blocks = (code.match(/<{4,}[ \t]*SEARCH/g) || []).length
  const at = code.lastIndexOf('<<<<<<< SEARCH')
  const after = at === -1 ? '' : code.slice(at)
  const phase = /^={4,}[ \t]*$/m.test(after) ? 'replace' : 'search'
  return { blocks: Math.max(blocks, 1), phase }
}

interface EditSegment {
  search: string
  replace: string
}

function parseEditSegments(block: string): EditSegment[] {
  const segs: EditSegment[] = []
  let mode: 'none' | 'search' | 'replace' = 'none'
  let search: string[] = []
  let replace: string[] = []
  for (const raw of block.split('\n')) {
    const t = raw.trim()
    if (/^<{4,}[ \t]*SEARCH[ \t]*$/.test(t)) {
      mode = 'search'
      search = []
      replace = []
      continue
    }
    if (/^={4,}$/.test(t) && mode === 'search') {
      mode = 'replace'
      continue
    }
    if (/^>{4,}[ \t]*REPLACE[ \t]*$/.test(t) && mode === 'replace') {
      segs.push({ search: search.join('\n'), replace: replace.join('\n') })
      mode = 'none'
      continue
    }
    if (mode === 'search') search.push(raw)
    else if (mode === 'replace') replace.push(raw)
  }
  return segs
}

/**
 * SEARCH/REPLACE bloklarını dosyaya uygula. Önce birebir eşleşme; olmazsa
 * satır bazında trim'li (girinti farklarına hoşgörülü) kayan pencere.
 * Eşleşmeyen segment dosyayı BOZMAZ, yalnızca failed sayacına yazılır.
 */
/**
 * 6.3 çapa: satır-numarası öneki temizliği. Model, kendisine verilen satır
 * numaralı pasajdan ("  12| kod") kopyalarken önekleri de taşıyabiliyor —
 * SEARCH satırlarının çoğunluğu "NN|" taşıyorsa önekler soyulur.
 */
function stripLineNumberPrefixes(text: string): string {
  const lines = text.split('\n')
  const prefixed = lines.filter((l) => /^\s*\d+\|\s?/.test(l)).length
  if (prefixed === 0 || prefixed * 2 < lines.filter((l) => l.trim()).length) return text
  return lines.map((l) => l.replace(/^\s*\d+\|\s?/, '')).join('\n')
}

/** İki metnin bigram Dice benzerliği (0-1) — kısa tek satırlar için yeterli. */
function diceSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const t = s.replace(/\s+/g, ' ').trim().toLowerCase()
    const out = new Set<string>()
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
    return out
  }
  const A = grams(a)
  const B = grams(b)
  if (A.size === 0 || B.size === 0) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return (2 * hit) / (A.size + B.size)
}

export function applySearchReplace(original: string, block: string): EditApplyResult {
  let content = original
  let applied = 0
  let failed = 0
  const failures: string[] = []

  for (let seg of parseEditSegments(block)) {
    if (!seg.search.trim()) {
      failed++
      continue
    }
    // 6.3 ön-normalizasyon: satır-numarası önekli SEARCH/REPLACE soyulur.
    const cleanedSearch = stripLineNumberPrefixes(seg.search)
    if (cleanedSearch !== seg.search) {
      seg = { search: cleanedSearch, replace: stripLineNumberPrefixes(seg.replace) }
    }
    if (content.includes(seg.search)) {
      content = content.replace(seg.search, seg.replace)
      applied++
      continue
    }
    // Hoşgörülü eşleşme: baş/son boş satırları at, satırları trim'leyerek ara.
    const sLines = seg.search.split('\n')
    while (sLines.length && !sLines[0].trim()) sLines.shift()
    while (sLines.length && !sLines[sLines.length - 1].trim()) sLines.pop()
    const sTrim = sLines.map((l) => l.trim())
    const oLines = content.split('\n')
    let matchAt = -1
    for (let i = 0; i + sTrim.length <= oLines.length; i++) {
      let ok = true
      for (let j = 0; j < sTrim.length; j++) {
        if (oLines[i + j].trim() !== sTrim[j]) {
          ok = false
          break
        }
      }
      if (ok) {
        matchAt = i
        break
      }
    }
    if (matchAt >= 0) {
      const rLines = seg.replace.split('\n')
      oLines.splice(matchAt, sTrim.length, ...rLines)
      content = oLines.join('\n')
      applied++
      continue
    }

    // 3. kademe: tırnak-duyarsız BENZERSİZ eşleşme. Modeller bozuk satırı
    // SEARCH'e kopyalarken istemsizce düzeltiyor (eksik tırnağı tamamlıyor) —
    // gerçek 14B testinde görüldü. Tırnaklar yok sayılarak karşılaştırılır;
    // güvenlik için dosyada TEK eşleşme varsa uygulanır.
    const dequote = (s: string) => s.replace(/["']/g, '').trim()
    const sDq = sTrim.map(dequote)
    let dqMatch = -1
    let dqCount = 0
    for (let i = 0; i + sDq.length <= oLines.length; i++) {
      let ok = true
      for (let j = 0; j < sDq.length; j++) {
        if (dequote(oLines[i + j]) !== sDq[j]) {
          ok = false
          break
        }
      }
      if (ok) {
        dqCount++
        dqMatch = i
      }
    }
    if (dqCount === 1) {
      const rLines = seg.replace.split('\n')
      oLines.splice(dqMatch, sDq.length, ...rLines)
      content = oLines.join('\n')
      applied++
      continue
    }

    // 4. kademe: idempotenlik — SEARCH yok ama REPLACE içeriği zaten dosyada.
    // Canlı uygulama (akış sırasında) bloğu çoktan işlemiştir; final geçişte
    // aynı blok ikinci kez gelince bunu hata değil "zaten uygulanmış" say.
    const rTrim = trimBlankEdges(seg.replace.split('\n')).map((l) => l.trim())
    if (rTrim.length > 0) {
      let already = false
      for (let i = 0; i + rTrim.length <= oLines.length; i++) {
        let ok = true
        for (let j = 0; j < rTrim.length; j++) {
          if (oLines[i + j].trim() !== rTrim[j]) {
            ok = false
            break
          }
        }
        if (ok) {
          already = true
          break
        }
      }
      if (already) {
        applied++
        continue
      }
    }

    // 5. kademe (6.3 AST-ruhlu çapa): tek satırlık `key: 'değer'` düzeltmesi.
    // 14B gecesi dersi: model veri dizisindeki desc satırını kopyalamak yerine
    // çevresini uydurdu ve 3 tur ıskaladı. SEARCH tek satır `key: '...'` ise,
    // dosyada AYNI anahtarı taşıyan satırlar arasından değeri EN BENZER olan
    // (Dice ≥ 0.55 ve ikinciden belirgin şekilde iyi) hedef alınır.
    const kvMatch = seg.search.trim().match(/^([\w$]+)\s*:\s*(['"])(.+)\2,?$/)
    if (kvMatch && !seg.search.trim().includes('\n')) {
      const [, key, , value] = kvMatch
      const oLines2 = content.split('\n')
      const keyRe = new RegExp(`^\\s*${key}\\s*:\\s*(['"]).*\\1,?\\s*$`)
      const candidates: Array<{ i: number; score: number }> = []
      for (let i = 0; i < oLines2.length; i++) {
        if (!keyRe.test(oLines2[i])) continue
        const v = oLines2[i].match(/(['"])(.*)\1/)?.[2] ?? ''
        candidates.push({ i, score: diceSimilarity(v, value) })
      }
      candidates.sort((a, b) => b.score - a.score)
      const best = candidates[0]
      const second = candidates[1]
      if (best && best.score >= 0.55 && (!second || best.score - second.score >= 0.15)) {
        const indent = oLines2[best.i].match(/^\s*/)?.[0] ?? ''
        oLines2.splice(best.i, 1, indent + seg.replace.trim())
        content = oLines2.join('\n')
        applied++
        continue
      }
    }

    // 6. kademe (Aider replace_closest_edit_distance ruhu — ARAŞTIRMA 2026):
    // çok-satırlı SEARCH hiçbir kademede tutmadıysa, dosyada satır-benzerliği
    // EN YÜKSEK pencereyi bul; yeterince benzer VE tek belirgin adaysa oraya
    // uygula. Zayıf modeller 1-2 satırı paraphrase eder ama pencere tanınabilir
    // kalır ("0 blok eşleşmedi"in en büyük sebebi buydu). Güvenlik: yüksek eşik
    // (≥0.82 ort. Dice) + ikinciye net üstünlük; yanlış yere yazmayı önler.
    if (sTrim.length >= 2) {
      const oLines3 = content.split('\n')
      let bestI = -1
      let bestScore = 0
      let secondScore = 0
      for (let i = 0; i + sTrim.length <= oLines3.length; i++) {
        let sum = 0
        for (let j = 0; j < sTrim.length; j++) sum += diceSimilarity(oLines3[i + j].trim(), sTrim[j])
        const avg = sum / sTrim.length
        if (avg > bestScore) {
          secondScore = bestScore
          bestScore = avg
          bestI = i
        } else if (avg > secondScore) {
          secondScore = avg
        }
      }
      if (bestI >= 0 && bestScore >= 0.82 && bestScore - secondScore >= 0.05) {
        const rLines = seg.replace.split('\n')
        oLines3.splice(bestI, sTrim.length, ...rLines)
        content = oLines3.join('\n')
        applied++
        continue
      }
    }

    failed++
    failures.push(seg.search)
  }

  return { content, applied, failed, failures }
}

/**
 * 6.3 gerçeklik geri beslemesi: ıskalanan SEARCH için dosyanın EN YAKIN
 * gerçek bölgesini (satır-benzerliği skoruyla) bulur ve satır numaralı,
 * birebir kopyalanabilir bir pasaj döndürür. 14B gecesinin dersi: model
 * ıskaladığında ona "eşleşmedi" demek yetmez — bir daha uydurur; GERÇEK
 * baytları göstermek gerekir.
 */
export function realityFeedback(searchText: string, fileContent: string, path: string): string {
  const sLines = searchText.split('\n').map((l) => l.trim()).filter(Boolean)
  if (sLines.length === 0) return ''
  const oLines = fileContent.split('\n')
  // En ayırt edici SEARCH satırı (en uzun) ile dosyada en benzer satırı bul.
  const anchor = [...sLines].sort((a, b) => b.length - a.length)[0]
  let bestI = 0
  let bestScore = -1
  for (let i = 0; i < oLines.length; i++) {
    const sc = diceSimilarity(oLines[i], anchor)
    if (sc > bestScore) {
      bestScore = sc
      bestI = i
    }
  }
  const from = Math.max(0, bestI - 5)
  const to = Math.min(oLines.length, bestI + 6)
  const excerpt = oLines
    .slice(from, to)
    .map((l, i) => `${String(from + i + 1).padStart(4)}| ${l}`)
    .join('\n')
  return (
    `\nSEARCH bloğun ${path} içinde EŞLEŞMEDİ — dosyada öyle satırlar yok. ` +
    `Dosyanın GERÇEK içeriği (hedefe en yakın bölge, satır numaralı):\n${excerpt}\n` +
    `Yeni SEARCH bloğunu bu pasajdan (satır numaraları OLMADAN) BİREBİR kopyala.`
  )
}

export function parseContent(content: string): ContentSegment[] {
  const { text, files } = parseStreaming(content, { final: true })
  const segments: ContentSegment[] = []
  if (text.trim()) segments.push({ type: 'text', value: text })
  for (const f of files) {
    segments.push({ type: 'code', block: { lang: f.lang, code: f.code, suggestedName: f.path } })
  }
  return segments
}
