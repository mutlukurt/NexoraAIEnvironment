/**
 * Debug Engine — değer probu (roadmap 5.7): tahmin etme, ÖLÇ.
 *
 * Property çökmesinde (undefined.map) motor şüpheli erişimi geçici olarak
 * ifade-düzeyinde sarar: `data.map(` → `window.__nxProbe('data', data).map(`.
 * __nxProbe (sayfa kancasında tanımlı) değeri toplayıcıya raporlar ve AYNEN
 * geri döndürür — davranış değişmez, çökme yine olur ama artık çökmeden
 * hemen önceki GERÇEK değer elimizdedir. Prob tek seferliktir: veri gelir
 * gelmez (ya da zaman aşımında) dosya orijinaline döndürülür.
 *
 * Saf metin dönüşümü — IO yok; uygulama/geri-alma appStore'dadır.
 */

export interface ProbeBuild {
  /** Problu içerik; kurulamadıysa null (desen bulunamadı). */
  probed: string | null
  /** İnsan-okur prob etiketi ("data" gibi) — rapor satırında kullanılır. */
  label: string
}

/**
 * `recv.prop` erişiminin İLK geçtiği yeri __nxProbe sarmalıyla değiştir.
 * Zaten problu içeriğe ikinci prob kurulmaz (idempotent).
 */
export function buildProbe(content: string, recv: string, prop: string): ProbeBuild {
  if (content.includes('__nxProbe')) return { probed: null, label: recv }
  const re = new RegExp(`\\b${recv}\\s*\\.\\s*${prop}\\b`)
  if (!re.test(content)) return { probed: null, label: recv }
  return {
    probed: content.replace(re, `window.__nxProbe('${recv}', ${recv}).${prop}`),
    label: recv
  }
}

/** Tanıdan prob hedefini çıkar: alıcı + property (yalnızca property çökmeleri). */
export function probeTarget(
  diagnosis: string,
  primaryContent: string
): { recv: string; prop: string } | null {
  const m = diagnosis.match(/Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([\w$]+)'\)/)
  if (!m) return null
  const prop = m[1]
  const rm = primaryContent.match(new RegExp(`([\\w$]+)\\s*\\.\\s*${prop}\\b`))
  if (!rm) return null
  return { recv: rm[1], prop }
}
