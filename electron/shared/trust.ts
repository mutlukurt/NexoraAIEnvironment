/**
 * İki katmanlı güven (roadmap 7.5) — Codex'in en çok kopyalanan tasarımı,
 * Antigravity'nin D: silme vakası ders alınarak.
 *
 * KATMAN 1 — sandbox (bu modül): bir komutun teknik hükmü. Saf fonksiyon,
 * main süreç (agentService — derinlemesine savunma) ve renderer (izin akışı)
 * AYNI mantığı paylaşır; `npm run test:trust` doğrudan koşar.
 *
 *   'deny' → HİÇBİR onay seviyesi çalıştıramaz (Tam Erişim bile). Kök-yol
 *            hedefli yıkıcı komutlar, sudo/shutdown sınıfı, boru-ile-kabuk.
 *   'ask'  → sınırda: çalışma alanı dışına dokunuyor, ağa çıkıyor ya da
 *            tanınmayan komut. Onay politikası karar verir.
 *   'auto' → çalışma alanı içinde güvenli sınıf (npm/vite/git-okuma…).
 *
 * KATMAN 2 — onay politikası (renderer ayarı): ne zaman SORULUR.
 *   'read' (Salt Okunur)  → hiçbir komut/indirme çalışmaz, ajan yalnız önerir.
 *   'auto' (Otomatik)     → 'auto' serbest, 'ask' sorulur. VARSAYILAN.
 *   'full' (Tam Erişim)   → 'ask' da onaysız koşar; 'deny' YİNE koşmaz.
 *
 * Sessiz tam-otomatik yok: 'full' açıkça, proje başına ve gürültülü seçilir.
 */

import { screenInstallCommand } from './pkgShield'

export type TrustTier = 'read' | 'auto' | 'full'

export interface CommandVerdict {
  action: 'deny' | 'ask' | 'auto'
  /** İnsan-okur gerekçe — izin modalında ve Motor günlüğünde görünür. */
  reason: string
}

/** Kök-sınıfı yol: /, ~, $HOME, C:\ d:\ … — yıkıcı komutla birleşince 'deny'. */
const ROOT_TOKEN = /^["']?(\/\*?|~\/?|\$HOME\/?|[a-z]:[\\/]?\*?)["']?$/i
/** Yıkıcı komut adları (dosya sistemi silme/biçimlendirme sınıfı). */
const DESTRUCTIVE = /^(rm|rmdir|rd|del|erase|format|mkfs(\.\w+)?|shred|dd)$/i
/** Koşulsuz yasak: ayrıcalık/kapatma/fork-bomb — hedef ne olursa olsun. */
const HARD_DENY = /(^|\s|;|&&|\|)\s*(sudo|doas|su)\b|\b(shutdown|reboot|poweroff|halt)\b|:\(\)\s*\{|\bmkfs(\.\w+)?\b/i
/** Boru-ile-kabuk: indirilen içerik doğrudan kabuğa akar — uzak kod çalıştırma. */
const PIPE_TO_SHELL = /\b(curl|wget)\b[^|;&]*\|\s*(\w+\s+)*(sh|bash|zsh|dash|node|python3?)\b/i
/** Çalışma alanı içinde güvenli sayılan komut başlangıçları ('auto' sınıfı). */
const AUTO_SAFE =
  /^(npm|npx|yarn|pnpm|node|vite|tsc|eslint|prettier|ls|cat|head|tail|wc|grep|echo|mkdir|touch|cp|mv)\b/i
/** git'in salt-okur alt komutları da 'auto'; yazanlar (push vb.) 'ask'. */
const GIT_READONLY = /^git\s+(status|log|diff|show|branch|remote\s+-v)\b/i

function tokensOf(cmd: string): string[] {
  return cmd.trim().split(/\s+/)
}

/** Komut zincirini parçala (;, &&, ||, |) — her halka ayrı yargılanır. */
function segmentsOf(cmd: string): string[] {
  return cmd
    .split(/;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Kullanıcı listesi eşleşmesi: satır, komutun BAŞLANGICI olarak yorumlanır. */
function matchesList(cmd: string, list: string[] | undefined): string | null {
  if (!list) return null
  const norm = cmd.trim().toLowerCase()
  for (const raw of list) {
    const p = raw.trim().toLowerCase()
    if (p && norm.startsWith(p)) return raw.trim()
  }
  return null
}

export function commandVerdict(
  cmd: string,
  opts?: { allowList?: string[]; denyList?: string[] }
): CommandVerdict {
  const c = cmd.trim()
  if (!c) return { action: 'deny', reason: 'boş komut' }

  // 0) Kullanıcının kendi yasağı her şeyden önce gelir.
  const denyHit = matchesList(c, opts?.denyList)
  if (denyHit) return { action: 'deny', reason: `kullanıcı yasak listesinde: "${denyHit}"` }

  // 1) Koşulsuz yasaklar — Tam Erişim bile aşamaz.
  if (HARD_DENY.test(c)) return { action: 'deny', reason: 'ayrıcalık yükseltme / sistem kapatma / fork-bomb sınıfı' }
  if (PIPE_TO_SHELL.test(c)) return { action: 'deny', reason: 'indirilen içerik doğrudan kabuğa akıyor (uzak kod çalıştırma)' }

  // 2) Yıkıcı komut + kök-sınıfı hedef ya da .. kaçışı → deny.
  //    (Antigravity vakası: `rmdir /s /q d:\` bir path-doğrulama hatasıyla
  //    tüm sürücüyü sildi — burada kök hedef YAPISAL olarak reddedilir.)
  for (const seg of segmentsOf(c)) {
    const toks = tokensOf(seg)
    if (toks.length === 0) continue
    if (DESTRUCTIVE.test(toks[0])) {
      for (const t of toks.slice(1)) {
        if (ROOT_TOKEN.test(t)) return { action: 'deny', reason: `yıkıcı komut kök yolu hedefliyor: ${toks[0]} ${t}` }
        if (/(^|[\\/])\.\.([\\/]|$)/.test(t)) return { action: 'deny', reason: `yıkıcı komut çalışma alanından kaçıyor (..): ${t}` }
        if (/^of=/i.test(t) && toks[0].toLowerCase() === 'dd') return { action: 'deny', reason: 'dd ile aygıta/dosyaya ham yazım' }
      }
    }
  }

  // 2.5) SAHTE PAKET KALKANI: kurulum komutu popülere yakın-yazımlı (typosquat)
  //      bir paket içeriyorsa 'auto' sınıfını 'ask'a yükselt. Model uydurma/sahte
  //      bir ad kurmaya kalkarsa kullanıcı önce görür. Kullanıcının izin listesinden
  //      ÖNCE gelir: allowlist komut ÖNEKİNİ kapsar, spesifik sahte paketi değil.
  const squat = screenInstallCommand(c)
  if (squat.suspicious) return { action: 'ask', reason: `sahte paket şüphesi — ${squat.reason}` }

  // 3) Kullanıcının kendi izin listesi → auto.
  const allowHit = matchesList(c, opts?.allowList)
  if (allowHit) return { action: 'auto', reason: `kullanıcı izin listesinde: "${allowHit}"` }

  // 4) Sınır denetimi: mutlak yol / ~ / .. — komut çalışma alanı dışına
  //    dokunuyor olabilir (ajanın cwd'si her zaman çalışma alanıdır; göreli
  //    yollar içeride kalır). Windows /s /q gibi tek harfli bayraklar hariç.
  for (const seg of segmentsOf(c)) {
    for (const t of tokensOf(seg).slice(1)) {
      const bare = t.replace(/^["']|["']$/g, '')
      if (/^\/[a-z0-9]$/i.test(bare)) continue // /s /q — Windows bayrağı
      if (/^(\/|~|\$HOME|[a-z]:[\\/])/i.test(bare) || /(^|[\\/])\.\.([\\/]|$)/.test(bare)) {
        return { action: 'ask', reason: `çalışma alanı dışına dokunuyor: ${bare.slice(0, 60)}` }
      }
    }
  }

  // 5) Güvenli sınıf → auto; ağ araçları ve tanınmayanlar → ask (varsayılan-sor).
  const allAuto = segmentsOf(c).every((seg) => AUTO_SAFE.test(seg) || GIT_READONLY.test(seg))
  if (allAuto) return { action: 'auto', reason: 'çalışma alanı içi güvenli komut sınıfı' }
  return { action: 'ask', reason: 'tanınmayan/ağa çıkan komut — onay ister' }
}

/**
 * KATMAN 2: hükmü onay politikasıyla birleştir → nihai karar.
 *   'run'   → çalıştır (sorma)
 *   'ask'   → kullanıcıya sor
 *   'block' → çalıştırma (nedeniyle raporla)
 */
export function decideCommand(
  cmd: string,
  tier: TrustTier,
  opts?: { allowList?: string[]; denyList?: string[]; projectAlways?: boolean }
): { decision: 'run' | 'ask' | 'block'; verdict: CommandVerdict } {
  const verdict = commandVerdict(cmd, opts)
  if (tier === 'read') return { decision: 'block', verdict: { ...verdict, reason: 'Salt Okunur kip: ajan yalnız önerir' } }
  if (verdict.action === 'deny') return { decision: 'block', verdict }
  if (verdict.action === 'auto') return { decision: 'run', verdict }
  // 'ask': Tam Erişim ya da proje-bazlı "hep izin ver" onaysız koşturur.
  if (tier === 'full' || opts?.projectAlways) return { decision: 'run', verdict }
  return { decision: 'ask', verdict }
}
