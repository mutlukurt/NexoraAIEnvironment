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
    match: /hizmet|servis|service|fiyat|price|menü|menu|ürün|product|paket/i,
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
