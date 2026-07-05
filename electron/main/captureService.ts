/**
 * Görsel öz-denetim (roadmap 3.3) — sayfa yakalama.
 *
 * Çalıştır'dan sonra dev sunucusunun sayfası görünmez bir pencerede açılır ve
 * ekran görüntüsü diske yazılır; görüntü, uygulamanın kendi vizyon modeline
 * "boş bölüm / taşma / bozuk yerleşim var mı" diye gösterilir. Uygulama
 * zaten görebiliyordu — artık kendi işine de bakıyor.
 */
import { BrowserWindow } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const CAPTURE_PATH = join(homedir(), 'NexoraAI', 'cache', 'visual-review.png')

/** Vizyon modeli diskte hazır mı? (Run tetiklenince sürpriz GB'lık indirme olmasın.) */
export function visionModelPresent(): boolean {
  const models = join(homedir(), 'NexoraAI', 'models')
  return (
    existsSync(join(models, 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf')) ||
    existsSync(join(models, 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf'))
  )
}

/**
 * Neredeyse tek renk (boş) sayfa oranı: örneklenen piksellerin en baskın
 * renge (±8 tolerans) oranı. Deterministik boşluk tespiti — canlı testte
 * VL-3B bembeyaz sayfaya "OK" dedi; boşluğu modele sormak yerine ölçüyoruz.
 */
function dominantColorRatio(bitmap: Buffer, width: number, height: number): number {
  const counts = new Map<number, number>()
  const stride = 7 // her 7. piksel — 1280x900'de ~165k örnek yerine ~23k
  let sampled = 0
  for (let i = 0; i < width * height; i += stride) {
    const o = i * 4
    // BGRA → 5 bitlik kovalara indir (yakın tonlar aynı kovada toplansın)
    const key = ((bitmap[o] >> 3) << 10) | ((bitmap[o + 1] >> 3) << 5) | (bitmap[o + 2] >> 3)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    sampled++
  }
  let max = 0
  for (const v of counts.values()) if (v > max) max = v
  return sampled > 0 ? max / sampled : 0
}

export async function capturePage(url: string): Promise<{
  ok: boolean
  path?: string
  visionReady?: boolean
  /** 0-1: sayfanın tek-renk (boş) oranı; ≥0.98 fiilen bomboş sayfa demek. */
  blankRatio?: number
  error?: string
}> {
  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { offscreen: true, sandbox: true }
    })
    await win.loadURL(url)
    // İlk boyamanın oturması + animasyonların yerleşmesi için kısa pay.
    await new Promise((r) => setTimeout(r, 3000))
    const img = await win.webContents.capturePage()
    await mkdir(dirname(CAPTURE_PATH), { recursive: true })
    await writeFile(CAPTURE_PATH, img.toPNG())
    const size = img.getSize()
    const blankRatio = dominantColorRatio(img.toBitmap(), size.width, size.height)
    return { ok: true, path: CAPTURE_PATH, visionReady: visionModelPresent(), blankRatio }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    try {
      win?.destroy()
    } catch {
      /* ignore */
    }
  }
}
