/**
 * YIKICI-EYLEM DRY-RUN (roadmap 21.4) — güven katmanının kardeşi.
 *
 * Sorun: bir komut ("rm -rf dist", "mv a b", "echo x > config.json") çalışmadan
 * ÖNCE kullanıcı neyin gideceğini görmüyor; yanlış bir hedef önemli dosyaları
 * sessizce silebilir/üzerine yazabilir. Bu modül komutu ÇALIŞTIRMADAN statik
 * çözümler: hangi yol siliniyor / hangi dosyanın üzerine yazılıyor. Projenin
 * mevcut dosya listesine karşı eşleştirip "şunları silecek: … (N dosya)" özeti
 * üretir. Onay kutusunda gösterilir — kullanıcı kör onay vermez.
 *
 * SAFtır (dosya sistemi OKUMAZ — eşleştirmeyi çağıran, renderer'daki proje
 * dosya listesiyle yapar): deterministik + test edilebilir. NİYET-TABANLI
 * invaryant: niyet üretmez, yalnız komutun ETKİSİNİ önizler (güvenlik/biçim).
 *
 * `npm run test:blast` saf çekirdeği kilitler.
 */

export type BlastKind = 'delete' | 'overwrite'

export interface BlastOp {
  /** Komuttaki fiil (rm, mv, del, > …). */
  verb: string
  kind: BlastKind
  /** Etkilenen ham hedef yollar (bayraklar/sürüm soyulmuş). */
  targets: string[]
  /** -r/-rf/--recursive/ /s → klasör içeriği dahil. */
  recursive: boolean
}

export interface BlastAnalysis {
  destructive: boolean
  ops: BlastOp[]
}

const DELETE_VERB = /^(rm|rmdir|rd|del|erase|unlink|shred)$/i
const MOVE_VERB = /^(mv|move)$/i
const RECURSIVE_FLAG = /^(-[rR]|-[a-z]*r[a-z]*f?|--recursive|\/s)$/i

/** Bir tokenin bayrak olduğunu anla (- ya da / ile başlar, kısa Windows bayrağı dahil). */
function isFlag(tok: string): boolean {
  if (tok.startsWith('-')) return true
  if (/^\/[a-z]$/i.test(tok)) return true // /s /q Windows
  return false
}

/** Tırnakları soy. */
function unquote(t: string): string {
  return t.replace(/^["']|["']$/g, '')
}

/** Tırnak-duyarlı tokenize — "boşluklu yol.txt" tek token kalır (tırnaksız döner). */
function tokenize(seg: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(seg)) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** Komut zincirini yıkıcı segmentlere ayrıştır — HİÇBİR ŞEY çalıştırmaz. */
export function analyzeCommand(cmd: string): BlastAnalysis {
  const ops: BlastOp[] = []
  const segments = (cmd ?? '')
    .split(/;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const seg of segments) {
    // Shell yönlendirmesi: `... > dosya` (üzerine yaz) / `>> dosya` (ekle sayılmaz).
    // Not: `>>` ekleme olduğu için yıkıcı saymayız; yalnız tek `>`.
    const redir = seg.match(/(^|[^>])>(?!>)\s*("[^"]+"|'[^']+'|\S+)/)
    if (redir) {
      ops.push({ verb: '>', kind: 'overwrite', targets: [unquote(redir[2])], recursive: false })
    }

    const toks = tokenize(seg)
    if (toks.length === 0) continue
    const verb = toks[0]

    if (DELETE_VERB.test(verb)) {
      let recursive = false
      const targets: string[] = []
      for (const t of toks.slice(1)) {
        if (RECURSIVE_FLAG.test(t)) {
          recursive = true
          continue
        }
        if (isFlag(t)) continue
        // yönlendirme operatörünü hedef sanma
        if (t === '>' || t === '>>' || t.startsWith('>')) continue
        targets.push(unquote(t))
      }
      if (targets.length) ops.push({ verb: verb.toLowerCase(), kind: 'delete', targets, recursive })
    } else if (MOVE_VERB.test(verb)) {
      // mv src... dest → dest üzerine yazılabilir (var olan bir dosyaysa).
      const args = toks.slice(1).filter((t) => !isFlag(t)).map(unquote)
      if (args.length >= 2) {
        const dest = args[args.length - 1]
        ops.push({ verb: verb.toLowerCase(), kind: 'overwrite', targets: [dest], recursive: false })
      }
    }
  }

  return { destructive: ops.length > 0, ops }
}

/** ./ ve sondaki / soyulmuş normalize yol. */
function normPath(p: string): string {
  return p.replace(/^\.\//, '').replace(/\/+$/, '').replace(/\\/g, '/')
}

/** Basit glob eşleşmesi (* çok karakter, ? tek). Yol ayracı da * ile eşleşir (kaba). */
function globMatch(pattern: string, path: string): boolean {
  if (!/[*?]/.test(pattern)) return false
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  )
  return re.test(path)
}

/**
 * Bir silme/taşıma hedefinin projedeki KAÇ dosyayı etkilediğini say.
 * - Birebir dosya yolu eşleşir.
 * - Klasör hedefi (recursive) → altındaki tüm dosyalar (prefix/).
 * - Glob (*) → desen eşleşen dosyalar.
 */
export function matchTargets(target: string, filePaths: string[], recursive: boolean): string[] {
  const t = normPath(target)
  if (!t || t === '.') return recursive ? filePaths.slice() : []
  const norm = filePaths.map(normPath)
  const hits = new Set<string>()
  for (let i = 0; i < norm.length; i++) {
    const f = norm[i]
    if (f === t) hits.add(filePaths[i])
    else if (f.startsWith(t + '/')) hits.add(filePaths[i]) // klasör altı
    else if (globMatch(t, f)) hits.add(filePaths[i])
  }
  return [...hits]
}

/**
 * Onay kutusu için insan-okur etki özeti. Yıkıcı değilse null.
 * `filePaths` = projenin mevcut dosya yolları (renderer store'undan).
 */
export function describeImpact(cmd: string, filePaths: string[], lang: 'tr' | 'en' = 'tr'): string | null {
  const { destructive, ops } = analyzeCommand(cmd)
  if (!destructive) return null
  const tr = lang === 'tr'

  const delTargets: string[] = []
  let delFiles = 0
  const delNames: string[] = []
  const owTargets: string[] = []

  for (const op of ops) {
    if (op.kind === 'delete') {
      for (const tgt of op.targets) {
        delTargets.push(tgt)
        const matched = matchTargets(tgt, filePaths, op.recursive)
        delFiles += matched.length
        // klasör/glob ise hedef adını, tek dosyaysa dosya adını göster
        delNames.push(matched.length > 1 ? `${normPath(tgt)}/ (${matched.length} ${tr ? 'dosya' : 'files'})` : normPath(tgt))
      }
    } else {
      for (const tgt of op.targets) {
        const exists = matchTargets(tgt, filePaths, false).length > 0
        owTargets.push(normPath(tgt) + (exists ? '' : tr ? ' (yeni)' : ' (new)'))
      }
    }
  }

  const parts: string[] = []
  if (delNames.length) {
    const head = tr ? '🗑 Silinecek' : '🗑 Will delete'
    parts.push(`${head}: ${delNames.slice(0, 6).join(', ')}${delNames.length > 6 ? ' …' : ''}`)
  }
  if (owTargets.length) {
    const head = tr ? '✏️ Üzerine yazılacak' : '✏️ Will overwrite'
    parts.push(`${head}: ${owTargets.slice(0, 6).join(', ')}${owTargets.length > 6 ? ' …' : ''}`)
  }
  return parts.length ? parts.join(' · ') : null
}
