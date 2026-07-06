/**
 * Debug Engine 6.6 — repro denetimi: "bu hata HÂLÂ üretiliyor mu?"
 *
 * Sayfa görünmez pencerede taze yüklenir; Chromium yakalanmamış hataları
 * konsola düşürür (console-message level>=3) — verilen imzanın çekirdeği
 * görülürse hata YENİDEN ÜRETİLDİ demektir. İki kullanım:
 *  - Onarımdan ÖNCE: üretilemeyen (bayat/geçici) sinyale tur harcanmaz.
 *  - Onarımdan SONRA: "düzeltildi" iddiası pasif bekleme değil AKTİF kanıttır.
 */
import { BrowserWindow } from 'electron'
import { signatureMatches } from '../shared/reproSig'

export interface ReproResult {
  ok: boolean
  reproduced?: boolean
  /** Eşleşen ilk konsol hatası (kanıt). */
  evidence?: string
  error?: string
}

export async function reproCheck(url: string, signature: string, timeoutMs = 15000): Promise<ReproResult> {
  // 6.1 dersi: mutlak üst sınır — çağıran asla asılı kalmaz.
  return Promise.race([
    reproInner(url, signature),
    new Promise<ReproResult>((resolve) => setTimeout(() => resolve({ ok: false, error: 'repro üst zaman aşımı' }), timeoutMs))
  ])
}

async function reproInner(url: string, signature: string): Promise<ReproResult> {
  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { offscreen: true, sandbox: true }
    })
    let evidence: string | null = null
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 3 && !evidence && signatureMatches(message, signature)) evidence = message.slice(0, 200)
    })
    await win.loadURL(url)
    // Render + efektler + ilk etkileşimsiz hataların oturması için pay.
    await new Promise((r) => setTimeout(r, 4000))
    return { ok: true, reproduced: evidence !== null, evidence: evidence ?? undefined }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    try { win?.destroy() } catch { /* ignore */ }
  }
}
