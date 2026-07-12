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

export interface DebugScanReport {
  /** Taramanın bulduğu her şey. */
  findings: ScanFinding[]
  /** Tümü modele yönlendirilir (deterministik araç-onarımı kaldırıldı). */
  remaining: ScanFinding[]
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
  // Deterministik araç-onarımı kaldırıldı (kullanıcı kararı, 2026-07-12): tarama
  // yalnız TESPİT eder, her bulgu modele yönlendirilir. Model niyet-tabanlı,
  // çok-dosya bakışıyla (maskelenen ardışık hatalar dahil) düzeltir.
  const findings = (await scanProject(files)).sort((a, b) => CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls])
  return { findings, remaining: findings }
}

/** Rapor chat mesajı (TR/EN) — taramanın ne bulduğunun dürüst özeti. */
export function formatScanReport(r: DebugScanReport, tr: boolean): string {
  if (r.findings.length === 0) {
    return tr
      ? '🔍 Tarama temiz: sözdizimi, import grafiği, tanımsız bileşen/değişken, marker ve package.json denetimlerinden geçti.'
      : '🔍 Scan clean: syntax, import graph, undefined components/variables, markers and package.json all pass.'
  }
  const lines: string[] = []
  lines.push(
    tr
      ? `🔍 Tarama: ${r.findings.length} bulgu yakalandı — model düzeltecek.`
      : `🔍 Scan: ${r.findings.length} finding(s) — the model will fix them.`
  )
  for (const f of r.findings) {
    lines.push(`  ⚠️ ${f.path}${f.line ? ':' + f.line : ''} — ${f.message}`)
  }
  lines.push(tr ? '"düzelt" yazman yeterli — hepsi modele verilir.' : 'Type "fix" — all handed to the model.')
  return lines.join('\n')
}
