/**
 * Deterministik bölüm planı — "deterministik iskelet, modelli dolgu".
 *
 * Canlı testlerin kesin dersi: küçük model FORMATI artık bozamıyor (gramer)
 * ama KARARLARI hâlâ bozuyor — berber sitesine "Teknoloji" sayfası planlıyor,
 * App.tsx'i monolite çeviriyor. Uygulamanın kendi ilkesi ("profesyonel yapı
 * deterministiktir, model üretmez") zincirin yukarısına taşındı:
 *
 *  - Web sitesi isteklerinde PLAN model çağrısı olmadan, istekten anahtar
 *    kelimeyle çıkarılır. Anında, saçmalamaz, bölüm uyduramaz.
 *  - Her bölümün yolu ve açıklaması, sectionTemplates eşleşmesini GARANTİ
 *    edecek şekilde seçilir (desc şablonun kendi anahtar kelimesini taşır).
 *  - App.tsx ve index.css model hiç görmeden KOD tarafından yazılır.
 *
 * Model planı yalnızca bu üretici yetersiz kaldığında (web-dışı/alışılmadık
 * istek) devreye giren yedektir.
 */

export interface PlannedSection {
  path: string
  desc: string
  /** sectionTemplates.id — dolgu turunda şablon zorunlu kılınır. */
  templateId: string
}

interface SectionRule {
  /** İstek/brief metninde aranan sinyal. */
  match: RegExp
  section: PlannedSection
}

// Sıra = sayfadaki yerleşim sırası. Navbar/Hero/Footer her sitede vardır.
const ALWAYS_TOP: PlannedSection[] = [
  { path: 'src/components/Navbar.tsx', desc: 'üst gezinme (navbar) ve marka [şablon: navbar]', templateId: 'navbar' },
  { path: 'src/components/Hero.tsx', desc: 'hero: başlık, değer önerisi, CTA [şablon: hero]', templateId: 'hero' }
]
const ALWAYS_BOTTOM: PlannedSection[] = [
  { path: 'src/components/Footer.tsx', desc: 'alt bilgi (footer) [şablon: footer]', templateId: 'footer' }
]

const OPTIONAL_RULES: SectionRule[] = [
  {
    // 8.6: kullanıcının galeri için gerçekten kullandığı kelimeler (galeri,
    // portfolyo, projeler, görsel…) bu bölümü TÜRETMİYORDU — sadece <2-sinyal
    // yedeği rastgele ekliyordu (canlı test: "plan Galeri'yi düşürdü"). Artık
    // gallery ŞABLONUNUN eşleşmesinin (sectionTemplates.ts) SÜPERKÜMESİ.
    match: /hizmet|servis|service|fiyat|price|menü|menu|ürün|product|paket|gallery|galeri|portfolio|portfoly|projeler|works|görsel|resim|fotoğraf/i,
    section: { path: 'src/components/Hizmetler.tsx', desc: 'fiyatlı ürün/hizmet kartları galerisi (menü ızgarası) [şablon: gallery]', templateId: 'gallery' }
  },
  {
    match: /özellik|feature|avantaj|neden\s*biz|benefit/i,
    section: { path: 'src/components/Ozellikler.tsx', desc: 'öne çıkan özellik kartları [şablon: features]', templateId: 'features' }
  },
  {
    match: /ekip|team|usta|berber|kadro|çalışan|hakkı(mızda|nda)|hikaye|about/i,
    section: { path: 'src/components/Hakkimizda.tsx', desc: 'hakkımızda / ekip tanıtımı ve istatistikler [şablon: about]', templateId: 'about' }
  },
  {
    match: /yorum|review|testimonial|müşteri|referans/i,
    section: { path: 'src/components/Yorumlar.tsx', desc: 'müşteri yorumları (testimonials) [şablon: testimonials]', templateId: 'testimonials' }
  },
  {
    match: /sss|sıkça|faq|soru/i,
    section: { path: 'src/components/Sss.tsx', desc: 'sıkça sorulan sorular (SSS/FAQ) [şablon: faq]', templateId: 'faq' }
  },
  {
    match: /abonelik|plan|paket|tarife|pricing\s*table/i,
    section: { path: 'src/components/Fiyatlandirma.tsx', desc: 'fiyat planları tablosu [şablon: pricing]', templateId: 'pricing' }
  },
  {
    match: /iletişim|contact|randevu|rezervasyon|ulaş|form/i,
    section: { path: 'src/components/Iletisim.tsx', desc: 'iletişim bilgileri ve form [şablon: contact]', templateId: 'contact' }
  }
]

/** Web sitesi niyeti var mı? (yedek model-planına düşme kararı için) */
const SITE_INTENT_RE = /site|web|sayfa|landing|tanıtım|portfoly|portfolio|dükkan|kafe|restoran|salon|şirket|firma|blog/i

export function deriveSectionPlan(requestText: string): PlannedSection[] | null {
  if (!SITE_INTENT_RE.test(requestText)) return null
  const picked: PlannedSection[] = []
  for (const rule of OPTIONAL_RULES) {
    if (rule.match.test(requestText) && !picked.some((p) => p.templateId === rule.section.templateId)) {
      picked.push(rule.section)
    }
  }
  // Çok az sinyal varsa makul varsayılan set (tanıtım sitesi standardı).
  if (picked.length < 2) {
    for (const id of ['gallery', 'about', 'contact']) {
      const r = OPTIONAL_RULES.find((x) => x.section.templateId === id)!
      if (!picked.some((p) => p.templateId === id)) picked.push(r.section)
    }
  }
  const sections = [...ALWAYS_TOP, ...picked, ...ALWAYS_BOTTOM]
  return sections
}

/** Onay kartında gösterilen plan metni ("N. yol — açıklama" formatı korunur). */
export function planText(sections: PlannedSection[]): string {
  const lines = sections.map((s, i) => `${i + 1}. ${s.path} — ${s.desc}`)
  lines.push(`${sections.length + 1}. src/index.css — Tailwind taban stilleri (otomatik)`)
  lines.push(`${sections.length + 2}. src/App.tsx — bölümlerin kompozisyonu (otomatik)`)
  return lines.join('\n')
}

/** App.tsx'i KOD üretir: planlanan bölümleri sırayla import et ve render et. */
export function composeAppTsx(sections: PlannedSection[]): string {
  const names = sections.map((s) => {
    const base = s.path.split('/').pop()!.replace(/\.tsx$/, '')
    return { name: base, rel: './components/' + base }
  })
  return (
    names.map((n) => `import ${n.name} from '${n.rel}'`).join('\n') +
    `\nimport './index.css'\n\nexport default function App() {\n  return (\n    <div className="min-h-screen bg-white">\n` +
    names.map((n) => `      <${n.name} />`).join('\n') +
    `\n    </div>\n  )\n}\n`
  )
}

export const BASE_INDEX_CSS = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n'

// ---------------------------------------------------------------------------
// "Bu mesaj gerçekten bir proje/build isteği mi?" — canlı-test bulgusu:
// boş oturumda "Merhaba, kendini tanıt" gibi sohbet mesajları da Prompt
// Güçlendir + Plan hattını tetikleyip site brief'i / plan üretiyordu. Enhance
// ve plan artık YALNIZCA build isteklerinde çalışsın; sohbet düz cevap alsın.
// visionIntent.isBuildIntent'in kanıtlanmış "isim + fiil BİRLİKTE" felsefesi
// (tek kelime kökü yanıltıcı — "ne YAPabilirsin"deki "yap" gibi).
// ---------------------------------------------------------------------------

// İsim ekleri (sitesi, sayfası, uygulamayı…) tolere edilsin diye çoğunda
// SON sınır yok; yalnızca yanlış eşleşme riski olan kısa köklerde \b var.
const ARTIFACT_RE =
  /\b(site|web|sayfa|landing|portfoly?o|dashboard|panel|uygulama|app\b|aray[üu]z|e-?ticaret|market\b|blog|oyun|game\b|form\b|tema\b|template|men[üu]|clone|klon)/i

// NOT: `creat\w*`/`generat\w*` — kesik kök + trailing \b "create"/"generate"i
// KAÇIRIYORDU (creat+e arasında sınır yok). Canlı bug (VOLTA): "Create a … website"
// build sayılmadı. \w* eki -e/-ing/-ed formlarını yakalar.
const MAKE_RE =
  /\b(yap|yapar\s*m[ıi]s[ıi]n|oluştur|olustur|kur\b|kodla|tasarla|üret|uret|geliştir|gelistir|hazırla|hazirla|inşa|insa|build|make|creat\w*|implement\w*|generat\w*|design\w*|develop\w*|klonla|kopyala)\b/i

// Açık istek/ihtiyaç kalıpları (fiil olmadan da build sayılır: "… sitesi lazım")
const WANT_RE = /\b(istiyorum|ister\s*misin|laz[ıi]m|ihtiyac[ıi]m|olsun|gerek(iyor)?)\b/i

const SIMILARITY_RE =
  /\b(bunun gibi|buna benze|şunun gibi|aynısı|aynisi|birebir|klonla|clone|like this|similar to)\b/i

/**
 * v0.14.3 — Plan turu (Önce Plan) YALNIZCA yeni/boş oturumda kurulur. Mevcut
 * projede "Önce Plan" açık olsa bile istekler doğrudan UPDATE turuna gider:
 *  (a) GÜVENLİK: plan turu dosya İÇERİĞİ görmez; mevcut projede uydurma çok-
 *      dosyalık yeniden-inşa planı önerip projeyi EZERDİ (canlı 3.1 + 6.x + 8.x
 *      dersleri — "başlığı değiştir"/"id ekle" küçük isteği 12-dosya planına döndü);
 *  (b) SINIFLANDIRMA: zayıf modelde "Hero başlığına id ekle ki menü kaysın" gibi
 *      küçük bir istek bile artefakt kelimesi ("menü") + fiil ("yap") yüzünden
 *      looksLikeBuildRequest'e takılıp re-plana giriyordu.
 * Mevcut projede güvenli tek yol UPDATE (cerrahi/whole-file — gerisini korur).
 * Kullanıcı sıfırdan yeniden inşa istiyorsa "Yeni Sohbet" yolu var.
 */
export function planEligible(planFirst: boolean, isBuildScale: boolean, hasProject: boolean): boolean {
  return planFirst && isBuildScale && !hasProject
}

/** Mesaj gerçekten bir proje/build isteği mi? (sohbet/soru DEĞİL) */
export function looksLikeBuildRequest(text: string): boolean {
  if (SIMILARITY_RE.test(text)) return true
  const hasArtifact = ARTIFACT_RE.test(text)
  if (!hasArtifact) return false
  return MAKE_RE.test(text) || WANT_RE.test(text)
}

// Net DÜZENLEME fiilleri — bunlar varsa mesaj sohbet DEĞİL, projeye müdahaledir.
const EDIT_VERB_RE =
  /\b(ekle|ekler\s*misin|ekleyebilir|yap|yapar\s*m[ıi]s[ıi]n|oluştur|olustur|de[ğg]i[şs]tir|d[üu]zelt|kald[ıi]r|\bsil\b|silebilir|g[üu]ncelle|ta[şs][ıi]|ayarla|d[üu]zenle|uygula|yerle[şs]tir|kodla|inşa|insa|create|add|make|change|fix|update|remove|delete|build|implement|refactor|rename|replace|move)\b/i
// Selam/teşekkür — açık sosyal mesaj.
const CHAT_GREET_RE =
  /^\s*(merhaba|selam|s\.?a\b|hey|naber|nas[ıi]ls[ıi]n|te[şs]ekk[üu]r|sa[ğg]\s?ol|g[üu]nayd[ıi]n|iyi\s?(ak[şs]am|g[üu]nler|geceler)|hi\b|hello|thanks|thank\s?you|good\s?(morning|evening))/i
// Soru/açıklama niyeti — cevaplanmalı, inşa edilmemeli.
const CHAT_QUESTION_RE =
  /(^|\s)(ne(dir|den|reye|rede|zaman)?\b|ni[çc]in|niye|nas[ıi]l|kim(dir)?\b|ka[çc]\b|hangi|nerede|a[çc][ıi]kla|anlat|tan[ıi]mla|ne\s?demek|sen\s?kimsin|fark[ıi]?\s?ne|\bwhat\b|\bwhy\b|\bhow\b|\bwho\b|\bwhich\b|\bwhere\b|explain|describe|difference)/i

/**
 * Mesaj net bir SOHBET/SORU mu? (proje oturumunda bile cevaplanmalı, build/edit
 * DEĞİL). Yüksek-hassasiyet: düzenleme fiili varsa ASLA sohbet sayılmaz (edit
 * kaçmasın); yalnız selam / soru-kelimesi / "?" ile biten kısa mesaj sohbettir.
 * CANLI BUG: proje oturumunda "endüstri ilişkilerini anlat" build sanılıyordu.
 */
export function looksLikeChatIntent(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (EDIT_VERB_RE.test(t)) return false
  if (looksLikeBuildRequest(t)) return false
  if (CHAT_GREET_RE.test(t)) return true
  if (CHAT_QUESTION_RE.test(t)) return true
  if (/\?\s*$/.test(t) && t.length < 240) return true
  if (looksLikeAgentActionIntent(t)) return true
  return false
}

// Terminal/sistem eylemi: bir aracı/komutu KONTROL ET / KUR / ÇALIŞTIR / İNCELE —
// proje KODU (React bileşeni) DEĞİL. Bu turlar sohbet/agent yolundan gitmeli
// (kod personası dosya DÖKMESİN); model [RUN] ile gerçek komutu çalıştırır ve
// sonucu raporlar. Kullanıcı: "ne dersem yapabilmeli, kontrol et dediğimde YAPSIN".
// Unicode-farkında sınırlar (ASCII \b Türkçe'de bozuluyor — bkz. prompts.ts notu).
const AGENT_ACTION_RE = new RegExp(
  '(?<![\\p{L}\\p{N}_])(' +
    ['kontrol\\s*et','kontrol\\s*ed','denetle','yüklü\\s*m[üu]','yuklu\\s*mu','kurulu\\s*mu','var\\s*m[ıi]','mevcut\\s*mu',
     'çalışıyor\\s*mu','calisiyor\\s*mu','çalışır\\s*m[ıi]','hangi\\s*s[üu]r[üu]m','s[üu]r[üu]m[üu]?\\s*(ne|nedir|ka[çc])',
     'test\\s*et','çalıştır','calistir','run','komut','terminal','npm','npx','pip','clone','klonla','derle','build\\s*et',
     'curl','wget','kur','yükle','yukle','install','check','verify','installed','is\\s*there','is\\s*running','version','status'].join('|') +
    ')(?![\\p{L}\\p{N}_])',
  'iu'
)

/** Sistem/terminal eylemi mi? (build/edit DEĞİL — o zaman false döner). */
export function looksLikeAgentActionIntent(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (looksLikeBuildRequest(t)) return false // "bana bir site kur/yap" build'dir
  return AGENT_ACTION_RE.test(t)
}
