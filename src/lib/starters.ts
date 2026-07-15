/**
 * BAŞLANGIÇ ŞABLONLARI (roadmap 26 — Delight & onboarding). Boş sohbet ekranında
 * tıklanabilir örnek kartlar; tıklayınca giriş kutusu DETAYLI, sadakat-motorunu
 * (fidelity) tetikleyecek türden iyi bir istekle dolar. Kullanıcı (özellikle
 * teknik olmayan) sıfırdan yazmak zorunda kalmaz — güçlü bir başlangıç alır, düzenler.
 *
 * SAFtır: yalnız veri + seçici. Model çağrısı yok. `npm run test:starters` kilitler.
 * NOT: bu NİYET belirlemez — kullanıcı kartı seçip metni GÖRÜR, gönderirse üretim
 * yine niyet-tabanlı motordan geçer (buildReq detaylı isteği zaten build sayar).
 */

export interface Starter {
  id: string
  emoji: string
  label: { tr: string; en: string }
  prompt: { tr: string; en: string }
}

export const STARTERS: Starter[] = [
  {
    id: 'portfolio',
    emoji: '🎨',
    label: { tr: 'Portfolyo', en: 'Portfolio' },
    prompt: {
      tr: 'Modern, minimal bir kişisel portfolyo sitesi yap. Koyu tema (arka plan #0F172A, mor vurgu #6366F1). Bölümler: üstte isim + kısa tanıtım ve iki buton (Projelerim, İletişim); altında 3 proje kartı (görsel + başlık + açıklama); bir yetenekler şeridi; en altta iletişim ve sosyal medya linkleri. Yumuşak gölgeler, yuvarlak köşeler, mobil uyumlu.',
      en: 'Build a modern, minimal personal portfolio site. Dark theme (background #0F172A, purple accent #6366F1). Sections: name + short intro and two buttons (My Projects, Contact) at top; 3 project cards (image + title + description); a skills strip; contact and social links at the bottom. Soft shadows, rounded corners, responsive.'
    }
  },
  {
    id: 'cafe',
    emoji: '☕',
    label: { tr: 'Kafe / Restoran', en: 'Café / Restaurant' },
    prompt: {
      tr: 'Şık bir kafe web sitesi yap. Sıcak renkler (krem #FAF3E0, kahve #6F4E37, amber vurgu #F59E0B). Bölümler: tam ekran hero (kafe fotoğrafı + slogan + "Menüyü Gör" butonu); öne çıkan 3 ürün kartı (görsel + isim + fiyat); kısa "Hakkımızda"; çalışma saatleri ve adres alanı; footer. Zarif tipografi, mobil uyumlu.',
      en: 'Build an elegant café website. Warm colors (cream #FAF3E0, coffee #6F4E37, amber accent #F59E0B). Sections: full-screen hero (café photo + slogan + "See Menu" button); 3 featured product cards (image + name + price); a short "About"; hours and address; footer. Elegant typography, responsive.'
    }
  },
  {
    id: 'landing',
    emoji: '🚀',
    label: { tr: 'Ürün açılış sayfası', en: 'Product landing' },
    prompt: {
      tr: 'Bir mobil uygulama için modern açılış sayfası yap. Temiz beyaz zemin + canlı mor vurgu (#7C3AED). Bölümler: navbar (logo + menü + "Ücretsiz Dene" butonu); büyük hero (başlık + alt başlık + iki buton + telefon mockup görseli); ikonlu 3 özellik kartı; müşteri yorumları; 3 planlı fiyatlandırma; footer. Yumuşak gradyanlar, mobil uyumlu.',
      en: 'Build a modern landing page for a mobile app. Clean white background + vivid purple accent (#7C3AED). Sections: navbar (logo + menu + "Try Free" button); large hero (title + subtitle + two buttons + phone mockup image); 3 feature cards with icons; testimonials; 3-tier pricing; footer. Soft gradients, responsive.'
    }
  },
  {
    id: 'dashboard',
    emoji: '📊',
    label: { tr: 'Yönetim paneli', en: 'Dashboard' },
    prompt: {
      tr: 'Bir yönetim paneli arayüzü yap. Sol kenarda menü (Genel Bakış, Satışlar, Kullanıcılar, Ayarlar); üstte arama kutusu + profil. İçerikte 4 istatistik kartı (renkli ikon + sayı + yüzde değişim); bir çubuk grafik alanı; son işlemler tablosu. Açık tema, temiz ve kurumsal, mobil uyumlu.',
      en: 'Build an admin dashboard UI. Left sidebar menu (Overview, Sales, Users, Settings); top bar with search + profile. Content: 4 stat cards (colored icon + number + percent change); a bar chart area; a recent-activity table. Light theme, clean and corporate, responsive.'
    }
  },
  {
    id: 'login',
    emoji: '🔐',
    label: { tr: 'Giriş ekranı', en: 'Login screen' },
    prompt: {
      tr: 'Modern bir giriş (login) ekranı yap. Ortada cam efektli (glassmorphism) bir kart: logo, "Tekrar hoş geldin" başlığı, e-posta ve şifre alanları (ikonlu), "Beni hatırla" + "Şifremi unuttum", büyük "Giriş Yap" butonu, altında "Google ile devam et" seçeneği ve "Hesabın yok mu? Kayıt ol" linki. Arka planda yumuşak mor-mavi gradyan, mobil uyumlu, form doğrulama görünümü.',
      en: 'Build a modern login screen. A centered glassmorphism card: logo, "Welcome back" heading, email and password fields (with icons), "Remember me" + "Forgot password", a large "Sign In" button, a "Continue with Google" option below, and a "Don\'t have an account? Sign up" link. Soft purple-blue gradient background, responsive, with form-validation styling.'
    }
  },
  {
    id: 'blog',
    emoji: '✍️',
    label: { tr: 'Blog', en: 'Blog' },
    prompt: {
      tr: 'Sade, okunaklı bir blog ana sayfası yap. Bol beyaz alan, zarif serif başlıklar. Üstte site başlığı + kısa açıklama; altında öne çıkan yazı (büyük görsel + başlık + özet); sonra 3\'lü grid halinde yazı kartları (görsel + tarih + başlık + özet); en altta bülten abonelik alanı + footer. Mobil uyumlu.',
      en: 'Build a clean, readable blog homepage. Generous whitespace, elegant serif headings. Top: site title + short description; a featured post (large image + title + excerpt); then a 3-column grid of post cards (image + date + title + excerpt); a newsletter signup + footer at the bottom. Responsive.'
    }
  }
]

/** Seçilen şablonun, dile göre giriş kutusuna basılacak metni. */
export function starterPrompt(s: Starter, lang: 'tr' | 'en'): string {
  return s.prompt[lang] ?? s.prompt.en
}

/** Şablonun dile göre kısa etiketi. */
export function starterLabel(s: Starter, lang: 'tr' | 'en'): string {
  return s.label[lang] ?? s.label.en
}
