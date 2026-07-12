/**
 * Onarım yardımcıları — MODEL onarım turu için bağlam üreten saf fonksiyonlar.
 *
 * NOT (2026-07-12): Deterministik "araç" onarımı (eski Kat 0: eksik import /
 * tanımsız ikon / kesme işareti sınıflarını modelsiz düzeltme) KALDIRILDI —
 * kullanıcı kararı: "kat 0 bir boka yaramıyor; sorunu modele verince iyi bir
 * yerel model niyet-tabanlı, tek turda düzeltir, API zaten düzeltir." Artık her
 * tanı doğrudan modele gider. Buradan yalnız model turuna verilecek satır-numaralı
 * bağlam (numberedSnippet) ve üretim-anı kesme-işareti önlemesi (fixTurkishApostrophes)
 * kaldı; tespit (debugScan) ayrı modülde yaşar.
 */

/**
 * Türkçe kesme işareti sanitizasyonu — ÖNLEME katmanı (kabul testi bulgusu):
 * 3B, `{ q: 'Atlas Berber'ın hizmetleri nedir?', a: '...' }` gibi aynı satırda
 * birden çok, içi kesme işaretli tek-tırnak string üretiyor; string erken
 * kapanıp derleme patlıyor. Kural: string İÇİNDEKİ kesme işareti hemen ardından
 * harf/rakam gelir ("Berber'ın"); KAPATAN tırnaksa gelmez (`',` `' }`).
 * İçinde kesme olan tek-tırnak string'ler çift tırnağa çevrilir (çift tırnak
 * içerenler dokunulmaz). Bu sınıf artık diske hiç ULAŞAMAZ.
 */
export function fixTurkishApostrophes(content: string): string {
  if (!content.includes("'")) return content
  return content
    .split('\n')
    .map((line) => {
      if (!line.includes("'") || line.includes('\\')) return line
      return line.replace(
        /'((?:[^'"\n]|'(?=[\p{L}0-9]))*)'(?![\p{L}0-9])/gu,
        (m, inner: string) => (inner.includes("'") ? '"' + inner + '"' : m)
      )
    })
    .join('\n')
}

/** Tanı metninden hedef dosya yolunu çek ("File: src/App.tsx" ya da vite "src/App.tsx:12:5"). */
export function fileFromDiagnosis(diagnosis: string, knownPaths: string[]): string | null {
  const m = diagnosis.match(/File:\s*([^\s\n]+)/)
  if (m && knownPaths.includes(m[1])) return m[1]
  for (const p of knownPaths) {
    if (diagnosis.includes(p)) return p
  }
  return null
}

/** Tanıdan satır numarası çek ("(12:5)", ":12:5", "line 12"). */
function lineFromDiagnosis(diagnosis: string): number | null {
  const m = diagnosis.match(/\((\d+):\d+\)/) ?? diagnosis.match(/:(\d+):\d+/) ?? diagnosis.match(/line\s+(\d+)/i)
  return m ? Number(m[1]) : null
}

/**
 * Model onarım turuna verilecek satır-numaralı pasaj: hata satırının ±12 satır
 * çevresi, SEARCH bloğunun birebir kopyalanabilmesi için (no-op turların ana
 * nedeni modelin dosyayı ezberden yazması).
 */
export function numberedSnippet(
  diagnosis: string,
  files: Record<string, { path: string; content: string }>
): string {
  const target = fileFromDiagnosis(diagnosis, Object.keys(files))
  if (!target) return ''
  const line = lineFromDiagnosis(diagnosis) ?? 1
  const lines = files[target].content.split('\n')
  const from = Math.max(0, line - 1 - 12)
  const to = Math.min(lines.length, line - 1 + 12)
  const body = lines
    .slice(from, to)
    .map((l, i) => `${String(from + i + 1).padStart(4)}| ${l}`)
    .join('\n')
  return `\n--- ${target} (hata satırı ${line} çevresi, satır numaralı) ---\n${body}\n--- SON ---\nSEARCH bloğun, yukarıdaki pasajdan (satır numaraları OLMADAN) birebir kopyalanmış ardışık satırlar olmak ZORUNDA.`
}
