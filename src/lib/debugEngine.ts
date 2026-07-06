/**
 * Debug Engine çekirdeği (roadmap 5.1) — tek boru hattı, tek beyin:
 * Yakala → Tanıla → Konumla → Onar → Doğrula.
 *
 * İlk sürüm statik taramayı (5.2) Onarım Merdiveni'ne bağlar: taramanın
 * bulduğu her deterministik sınıf, runtime'da yakalanmış gibi Kat 0'dan
 * (autoRepair, modelsiz) geçer; onarılamayanlar rapora "model turu ister"
 * olarak düşer. Runtime toplayıcı ve görsel öz-denetim beslemeleri sonraki
 * adımlarda bu çekirdeğe taşınacak — çağıran taraf değişir, boru değişmez.
 */
import { scanProject, type ScanFinding } from './debugScan'
import { autoRepair, type RepairFix } from './autoRepair'

export interface DebugScanReport {
  /** Taramanın bulduğu her şey (onarılanlar dahil). */
  findings: ScanFinding[]
  /** Kat 0'ın modelsiz onardıkları. */
  fixed: Array<{ finding: ScanFinding; note: string }>
  /** Kat 0'ın onaramadıkları — model turu ya da insan ister. */
  remaining: ScanFinding[]
  /** Onarımlar uygulanmış dosya içerikleri (yol → yeni içerik). */
  patched: Record<string, string>
}

type FileMap = Record<string, { path: string; content: string }>

/**
 * 5.7 çoklu-hata oturumu: onarım sırası VARIŞ sırası değil BAĞIMLILIK
 * sırasıdır — sözdizimi her şeyi maskeler (bozuk dosyada metin analizi
 * çalışmaz), import grafiği tanımlayıcı analizinden önce gelir.
 */
const CLASS_ORDER: Record<ScanFinding['cls'], number> = {
  syntax: 0,
  'import-unresolved': 1,
  'import-missing-export': 2,
  'hook-missing-import': 3,
  'jsx-undefined': 3,
  'data-undefined': 3,
  'ts-semantic': 3,
  'template-marker': 4,
  'package-json': 4
}

export async function runDebugScan(files: FileMap): Promise<DebugScanReport> {
  const fixed: Array<{ finding: ScanFinding; note: string }> = []
  const patched: Record<string, string> = {}
  const seen = new Set<string>()
  let firstFindings: ScanFinding[] | null = null
  let remaining: ScanFinding[] = []
  let working: FileMap = files

  // 5.7 çok-geçişli onarım: bir sınıfın onarımı başka bulguları GÖRÜNÜR
  // kılabilir (kesme işareti düzelince aynı dosyanın eksik import'u ortaya
  // çıkar). Yeni deterministik onarım çıkmayana dek yeniden taranır (≤3 tur).
  for (let pass = 0; pass < 3; pass++) {
    const findings = (await scanProject(working)).sort(
      (a, b) => CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls]
    )
    if (firstFindings === null) firstFindings = findings
    else {
      // Sonraki geçişlerde ortaya çıkan YENİ bulgular rapora eklenir.
      for (const f of findings) {
        const key = `${f.cls}|${f.path}|${f.message}`
        if (!seen.has(key) && !firstFindings.some((x) => x.cls === f.cls && x.path === f.path && x.message === f.message)) {
          firstFindings.push(f)
        }
      }
    }
    remaining = []
    let progressed = false
    for (const finding of findings) {
      const key = `${finding.cls}|${finding.path}|${finding.message}`
      if (seen.has(key)) continue
      if (!finding.deterministic) {
        remaining.push(finding)
        continue
      }
      const fixes: RepairFix[] = autoRepair(finding.diagnosis, working)
      if (fixes.length === 0) {
        remaining.push(finding)
        continue
      }
      for (const fix of fixes) {
        working = { ...working, [fix.path]: { path: fix.path, content: fix.content } }
        patched[fix.path] = fix.content
      }
      seen.add(key)
      fixed.push({ finding, note: fixes[0].note })
      progressed = true
    }
    if (!progressed) break
  }

  return { findings: firstFindings ?? [], fixed, remaining, patched }
}

/** Rapor chat mesajı (TR/EN) — motorun ne görüp ne yaptığının dürüst özeti. */
export function formatScanReport(r: DebugScanReport, tr: boolean): string {
  if (r.findings.length === 0) {
    return tr
      ? '🔍 Tarama temiz: sözdizimi, import grafiği, tanımsız bileşen/değişken, marker ve package.json denetimlerinden geçti.'
      : '🔍 Scan clean: syntax, import graph, undefined components/variables, markers and package.json all pass.'
  }
  const lines: string[] = []
  lines.push(
    tr
      ? `🔍 Tarama: ${r.findings.length} bulgu — ${r.fixed.length} tanesi modelsiz onarıldı${r.remaining.length ? `, ${r.remaining.length} tanesi model/insan istiyor` : ''}.`
      : `🔍 Scan: ${r.findings.length} finding(s) — ${r.fixed.length} repaired without a model${r.remaining.length ? `, ${r.remaining.length} need the model or a human` : ''}.`
  )
  for (const f of r.fixed) {
    lines.push(`  🔧 ${f.finding.path}${f.finding.line ? ':' + f.finding.line : ''} — ${f.note}`)
  }
  for (const f of r.remaining) {
    lines.push(`  ⚠️ ${f.path}${f.line ? ':' + f.line : ''} — ${f.message}`)
  }
  if (r.remaining.length > 0) {
    lines.push(tr ? 'Kalanlar için "düzelt" yazman yeterli.' : 'Type "fix" to hand the rest to the model.')
  }
  return lines.join('\n')
}
