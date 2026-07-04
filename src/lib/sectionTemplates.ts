/**
 * Bölüm şablon bankası (roadmap 2.4).
 *
 * Elle yazılmış, tasarımı kanıtlanmış parametrik bölüm iskeletleri. Planlı
 * dosya-dosya üretimde (2.2) dosyanın türü ada/açıklamaya göre tespit edilir
 * ve eşleşen iskelet o dosyanın prompt'una gömülür: model sıfırdan tasarım
 * icat etmek yerine kanıtlanmış yapıyı brief'in içeriği ve temasıyla doldurur.
 * Küçük modeller kural listesine değil örneğe uyar — 3B + iyi şablon,
 * 14B + boş sayfadan iyi sonuç verir.
 *
 * Kurallar: her şablon kendi kendine yeter (yalnız react + lucide-react),
 * tek default-export bileşen, Tailwind, responsive, hover/geçiş içerir.
 * Yer tutucu metinler bilinçli olarak "değiştirilecek" hissi verir.
 */

export interface SectionTemplate {
  id: string
  /** Dosya adı + plan açıklaması üzerinde aranan sinyaller (TR + EN). */
  match: RegExp
  code: string
}

const T = (s: string): string => s.trim() + '\n'

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: 'hero',
    match: /hero|banner|karşılama|landing\s*top|jumbotron/i,
    code: T(`
import { ArrowRight, Sparkles } from 'lucide-react'

export default function Hero() {
  return (
    <section id="home" className="relative overflow-hidden bg-gradient-to-b from-violet-50 via-white to-white">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-violet-200/40 blur-3xl" />
      <div className="mx-auto flex max-w-4xl flex-col items-center px-4 pb-24 pt-20 text-center sm:px-6">
        <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
          <Sparkles className="h-3.5 w-3.5" /> {{BADGE_TEXT}}
        </span>
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-6xl">
          {{HEADLINE_PLAIN}} <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">{{HEADLINE_ACCENT}}</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          {{VALUE_PROPOSITION}}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href="#contact" className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 hover:shadow-violet-600/30">
            {{PRIMARY_CTA}} <ArrowRight className="h-4 w-4" />
          </a>
          <a href="#services" className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
            {{SECONDARY_CTA}}
          </a>
        </div>
      </div>
    </section>
  )
}`)
  },
  {
    id: 'navbar',
    match: /navbar|header|üst\s*menü|nav\b|navigation/i,
    code: T(`
import { useState } from 'react'
import { Menu, X } from 'lucide-react'

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const links = [
    { label: 'Ana Sayfa', href: '#home' },
    { label: 'Hizmetler', href: '#services' },
    { label: 'Hakkımızda', href: '#about' },
    { label: 'İletişim', href: '#contact' }
  ]
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#home" className="text-lg font-extrabold tracking-tight text-slate-900">
          {{BRAND_A}}<span className="text-violet-600">{{BRAND_B}}</span>
        </a>
        <ul className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-sm font-medium text-slate-600 transition hover:text-violet-600">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <a href="#contact" className="hidden rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 md:block">
          {{NAV_CTA}}
        </a>
        <button onClick={() => setOpen(!open)} className="rounded-lg p-2 text-slate-700 md:hidden" aria-label="Menü">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-slate-100 bg-white px-4 py-3 md:hidden">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {l.label}
            </a>
          ))}
        </div>
      )}
    </header>
  )
}`)
  },
  {
    id: 'features',
    match: /feature|service|hizmet|özellik|avantaj|neden\s*biz|benefits?/i,
    code: T(`
import { Zap, ShieldCheck, HeartHandshake } from 'lucide-react'

export default function Features() {
  const items = [
    { icon: Zap, title: '{{FEATURE_1_TITLE}}', text: '{{FEATURE_1_TEXT}}' },
    { icon: ShieldCheck, title: '{{FEATURE_2_TITLE}}', text: '{{FEATURE_2_TEXT}}' },
    { icon: HeartHandshake, title: '{{FEATURE_3_TITLE}}', text: '{{FEATURE_3_TEXT}}' }
  ]
  return (
    <section id="services" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{{SECTION_TITLE}}</h2>
        <p className="mt-3 text-slate-600">{{SECTION_SUBTITLE}}</p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="group rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-violet-200 hover:shadow-lg">
            <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-violet-600 transition group-hover:bg-violet-600 group-hover:text-white">
              <it.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-bold text-slate-900">{it.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{it.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}`)
  },
  {
    id: 'gallery',
    match: /gallery|galeri|menü|menu|ürünler|products|portfolio|portfoly|projeler|works/i,
    code: T(`
export default function Gallery() {
  const items = [
    { title: '{{ITEM_1_NAME}}', desc: '{{ITEM_1_DESC}}', price: '{{ITEM_1_PRICE}}', img: 'https://picsum.photos/seed/one/640/480' },
    { title: '{{ITEM_2_NAME}}', desc: '{{ITEM_2_DESC}}', price: '{{ITEM_2_PRICE}}', img: 'https://picsum.photos/seed/two/640/480' },
    { title: '{{ITEM_3_NAME}}', desc: '{{ITEM_3_DESC}}', price: '{{ITEM_3_PRICE}}', img: 'https://picsum.photos/seed/three/640/480' },
    { title: '{{ITEM_4_NAME}}', desc: '{{ITEM_4_DESC}}', price: '{{ITEM_4_PRICE}}', img: 'https://picsum.photos/seed/four/640/480' },
    { title: '{{ITEM_5_NAME}}', desc: '{{ITEM_5_DESC}}', price: '{{ITEM_5_PRICE}}', img: 'https://picsum.photos/seed/five/640/480' },
    { title: '{{ITEM_6_NAME}}', desc: '{{ITEM_6_DESC}}', price: '{{ITEM_6_PRICE}}', img: 'https://picsum.photos/seed/six/640/480' }
  ]
  return (
    <section id="menu" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{{SECTION_TITLE}}</h2>
        <p className="mt-3 text-slate-600">{{SECTION_SUBTITLE}}</p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <article key={it.title} className="group overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
            <div className="aspect-[4/3] overflow-hidden">
              <img src={it.img} alt={it.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
            </div>
            <div className="flex items-start justify-between gap-3 p-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">{it.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{it.desc}</p>
              </div>
              <span className="shrink-0 rounded-lg bg-violet-50 px-2.5 py-1 text-sm font-bold text-violet-700">{it.price}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}`)
  },
  {
    id: 'pricing',
    match: /pricing|fiyat|plan|paket|ücret|tarif+e/i,
    code: T(`
import { Check } from 'lucide-react'

export default function Pricing() {
  const plans = [
    { name: 'Başlangıç', price: '₺0', period: '/ay', popular: false, features: ['{{PLAN_FEATURE_1}}', '{{PLAN_FEATURE_2}}', '{{PLAN_FEATURE_3}}'] },
    { name: 'Profesyonel', price: '₺249', period: '/ay', popular: true, features: ['{{PLAN_FEATURE_1}}', '{{PLAN_FEATURE_2}}', '{{PLAN_FEATURE_3}}', '{{PLAN_FEATURE_4}}'] },
    { name: 'Kurumsal', price: 'Özel', period: '', popular: false, features: ['{{PLAN_FEATURE_1}}', '{{PLAN_FEATURE_2}}', '{{PLAN_FEATURE_3}}'] }
  ]
  return (
    <section id="pricing" className="bg-slate-50 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{{SECTION_TITLE}}</h2>
          <p className="mt-3 text-slate-600">{{SECTION_SUBTITLE}}</p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <div key={p.name} className={'relative rounded-2xl border bg-white p-7 shadow-sm transition hover:shadow-lg ' + (p.popular ? 'border-violet-400 ring-2 ring-violet-500/20' : 'border-slate-200/70')}>
              {p.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-0.5 text-xs font-bold text-white">En popüler</span>
              )}
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">{p.name}</h3>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tracking-tight text-slate-900">{p.price}</span>
                <span className="text-sm font-medium text-slate-500">{p.period}</span>
              </p>
              <ul className="mt-6 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" /> {f}
                  </li>
                ))}
              </ul>
              <a href="#contact" className={'mt-7 block rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ' + (p.popular ? 'bg-violet-600 text-white hover:bg-violet-700' : 'border border-slate-300 text-slate-700 hover:bg-slate-50')}>
                Planı seç
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}`)
  },
  {
    id: 'testimonials',
    match: /testimonial|review|yorum|müşteri\s*(görüş|yorum)|referans|social\s*proof/i,
    code: T(`
import { Star } from 'lucide-react'

export default function Testimonials() {
  const items = [
    { name: '{{PERSON_1}}', role: '{{ROLE_1}}', text: '{{QUOTE_1}}', stars: 5 },
    { name: '{{PERSON_2}}', role: '{{ROLE_2}}', text: '{{QUOTE_2}}', stars: 5 },
    { name: '{{PERSON_3}}', role: '{{ROLE_3}}', text: '{{QUOTE_3}}', stars: 4 }
  ]
  return (
    <section id="testimonials" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{{SECTION_TITLE}}</h2>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {items.map((t) => (
          <figure key={t.name} className="flex flex-col rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
            <div className="flex gap-0.5 text-amber-400">
              {Array.from({ length: t.stars }).map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-current" />
              ))}
            </div>
            <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-slate-600">“{t.text}”</blockquote>
            <figcaption className="mt-5 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
                {t.name.split(' ').map((w) => w[0]).join('')}
              </span>
              <span>
                <span className="block text-sm font-bold text-slate-900">{t.name}</span>
                <span className="block text-xs text-slate-500">{t.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}`)
  },
  {
    id: 'faq',
    match: /faq|sss|sıkça|sorular|questions/i,
    code: T(`
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  const items = [
    { q: '{{QUESTION_1}}', a: '{{ANSWER_1}}' },
    { q: '{{QUESTION_2}}', a: '{{ANSWER_2}}' },
    { q: '{{QUESTION_3}}', a: '{{ANSWER_3}}' },
    { q: '{{QUESTION_4}}', a: '{{ANSWER_4}}' }
  ]
  return (
    <section id="faq" className="bg-slate-50 py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Sıkça sorulan sorular</h2>
        <div className="mt-10 space-y-3">
          {items.map((it, i) => (
            <div key={it.q} className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
              <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                {it.q}
                <ChevronDown className={'h-4 w-4 text-slate-400 transition-transform ' + (open === i ? 'rotate-180' : '')} />
              </button>
              {open === i && <p className="border-t border-slate-100 px-5 py-4 text-sm leading-relaxed text-slate-600">{it.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}`)
  },
  {
    id: 'cta',
    match: /\bcta\b|call\s*to\s*action|çağrı|harekete/i,
    code: T(`
import { ArrowRight } from 'lucide-react'

export default function Cta() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 px-6 py-16 text-center shadow-xl sm:px-16">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{{CTA_TITLE}}</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-violet-100 sm:text-base">
          {{CTA_TEXT}}
        </p>
        <a href="#contact" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-violet-700 shadow-lg transition hover:bg-violet-50">
          {{CTA_BUTTON}} <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  )
}`)
  },
  {
    id: 'contact',
    match: /contact|iletişim|form|ulaş|rezervasyon|booking|appointment|randevu/i,
    code: T(`
import { Mail, MapPin, Phone } from 'lucide-react'

export default function Contact() {
  const info = [
    { icon: Phone, label: 'Telefon', value: '{{PHONE}}' },
    { icon: Mail, label: 'E-posta', value: '{{EMAIL}}' },
    { icon: MapPin, label: 'Adres', value: '{{ADDRESS}}' }
  ]
  return (
    <section id="contact" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">İletişime geçin</h2>
          <p className="mt-3 max-w-md text-slate-600">{{CONTACT_INVITE}}</p>
          <ul className="mt-8 space-y-5">
            {info.map((it) => (
              <li key={it.label} className="flex items-center gap-4">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-violet-600">
                  <it.icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">{it.label}</span>
                  <span className="block text-sm font-semibold text-slate-800">{it.value}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <form className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm sm:p-8" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">Ad Soyad</span>
              <input className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10" placeholder="Adınız" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-semibold text-slate-700">E-posta</span>
              <input type="email" className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10" placeholder="ornek@mail.com" />
            </label>
          </div>
          <label className="mt-4 block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Mesaj</span>
            <textarea rows={4} className="w-full resize-none rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10" placeholder="Mesajınız…" />
          </label>
          <button className="mt-5 w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700">
            Gönder
          </button>
        </form>
      </div>
    </section>
  )
}`)
  },
  {
    id: 'footer',
    match: /footer|alt\s*bilgi|altbilgi/i,
    code: T(`
export default function Footer() {
  const cols = [
    { title: 'Ürün', links: ['Özellikler', 'Fiyatlandırma', 'SSS'] },
    { title: 'Şirket', links: ['Hakkımızda', 'İletişim', 'Blog'] },
    { title: 'Yasal', links: ['Gizlilik', 'Kullanım Şartları'] }
  ]
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div>
          <p className="text-lg font-extrabold tracking-tight text-slate-900">
            {{BRAND_A}}<span className="text-violet-600">{{BRAND_B}}</span>
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">{{BRAND_SUMMARY}}</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{c.title}</h3>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l}>
                  <a href="#" className="text-sm text-slate-600 transition hover:text-violet-600">{l}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 py-5 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} {{BRAND_A}}{{BRAND_B}}. Tüm hakları saklıdır.
      </div>
    </footer>
  )
}`)
  },
  {
    id: 'about',
    match: /about|hakkı(mızda|nda)|story|hikaye|biz\s*kimiz|team|ekip/i,
    code: T(`
export default function About() {
  const stats = [
    { value: '{{STAT_1}}', label: '{{STAT_1_LABEL}}' },
    { value: '{{STAT_2}}', label: '{{STAT_2_LABEL}}' },
    { value: '{{STAT_3}}', label: '{{STAT_3_LABEL}}' }
  ]
  return (
    <section id="about" className="bg-slate-50 py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl shadow-lg">
          <img src="https://picsum.photos/seed/about/800/600" alt="Hakkımızda" className="h-full w-full object-cover" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{{SECTION_TITLE}}</h2>
          <p className="mt-4 leading-relaxed text-slate-600">
            {{ABOUT_STORY}}
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200/70 bg-white p-4 text-center shadow-sm">
                <dt className="text-2xl font-extrabold text-violet-600">{s.value}</dt>
                <dd className="mt-1 text-xs font-medium text-slate-500">{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}`)
  }
]

/** Dosya yolu + plan açıklamasına göre uyan şablonu bul (ilk eşleşme kazanır). */
export function findSectionTemplate(path: string, desc: string): SectionTemplate | null {
  const hay = `${path} ${desc}`
  for (const t of SECTION_TEMPLATES) {
    if (t.match.test(hay)) return t
  }
  return null
}
