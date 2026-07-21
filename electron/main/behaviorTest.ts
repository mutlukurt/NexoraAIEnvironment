/**
 * Debug Engine 6.5 — davranışsal doğrulama: motor siteyi KULLANIR.
 *
 * Çalıştır'dan sonra sayfa görünmez pencerede açılır ve bir test mühendisi
 * gibi gezilir: menü bağlantıları gerçekten tıklanır (hedefe kaydırıyor mu?),
 * butonlara basılır (tıklama çökme üretiyor mu?), form doldurulup gönderilir,
 * görsellerin GERÇEKTEN yüklendiği ölçülür (naturalWidth > 0) ve her bölümün
 * ekran görüntüsü artifact olarak diske alınır (Antigravity paritesi).
 * "Doğrulandı" artık "render oldu" değil "çalışıyor" demektir.
 *
 * Gezinti sırasında sayfanın ürettiği hatalar zaten sayfa kancası üzerinden
 * toplayıcıya akar (5.4) — bu servis rapor + artifact üretir, onarım borusu
 * mevcut duyulardan beslenir.
 */
import { BrowserWindow } from 'electron'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { BehaviorReport } from '../shared/ipc'
import { snapshotChanged, classifyFormOutcome, type UiSnapshot } from '../shared/browserOutcome'

/** Sayfadan anlık-görüntü toplayan JS ifadesi (behaviorTest içinde executeJavaScript ile). */
const SNAP_JS =
  "({ url: location.href, title: document.title, domCount: document.querySelectorAll('*').length, textLen: (document.body.innerText||'').length, dialogOpen: !!document.querySelector('[role=dialog], dialog[open], .modal:not([hidden])') })"

const SHOT_DIR = join(homedir(), 'NexoraAI', 'cache', 'behavior')

export async function runBehaviorTest(url: string, timeoutMs = 45000): Promise<BehaviorReport> {
  // 6.1 dersi: iç akış nerede takılırsa takılsın çağıran ASLA asılı kalmaz.
  return Promise.race([
    behaviorInner(url),
    new Promise<BehaviorReport>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: 'davranış testi üst zaman aşımı' }), timeoutMs)
    )
  ])
}

async function behaviorInner(url: string): Promise<BehaviorReport> {
  let win: BrowserWindow | null = null
  const consoleErrors: string[] = []
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { offscreen: true, sandbox: true }
    })
    // Buton/form tıklamaları sayfayı başka yere götüremesin.
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 3 && consoleErrors.length < 10) consoleErrors.push(message.slice(0, 160))
    })
    const exec = <T>(js: string): Promise<T> => win!.webContents.executeJavaScript(js, true) as Promise<T>

    await win.loadURL(url)
    await new Promise((r) => setTimeout(r, 2500))

    // 1) Görseller gerçekten yüklendi mi?
    const images = await exec<{ total: number; broken: string[] }>(`(() => {
      const imgs = [...document.querySelectorAll('img')]
      return { total: imgs.length, broken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.src.slice(0, 120)).slice(0, 6) }
    })()`)

    // 2) Menü bağlantıları: tıkla, hedef bölüm var mı + sayfa kaydı mı?
    const nav = await exec<Array<{ href: string; target: boolean; moved: boolean }>>(`(async () => {
      const out = []
      for (const a of [...document.querySelectorAll('a[href^="#"]')].slice(0, 8)) {
        const href = a.getAttribute('href') || ''
        const before = scrollY
        a.click()
        await new Promise((r) => setTimeout(r, 700))
        out.push({ href, target: href.length > 1 && !!document.querySelector(href.replace(/([^\\w#-])/g, '\\\\$1')), moved: Math.abs(scrollY - before) > 10 || before > 0 })
      }
      window.scrollTo(0, 0)
      return out
    })()`)

    // 3) Butonlar: Faz 4 — tıklamak GERÇEKTEN bir şey yapıyor mu? Her butonun
    // ÖNCE/SONRA anlık-görüntüsü alınır; hiçbir şey değişmeyen = ÖLÜ buton.
    const errorsBeforeButtons = consoleErrors.length
    const btnRun = await exec<{ total: number; clicked: number; runs: Array<{ before: UiSnapshot; after: UiSnapshot; ok: boolean }> }>(`(async () => {
      const snap = () => (${SNAP_JS})
      const btns = [...document.querySelectorAll('button')].slice(0, 8)
      const runs = []; let clicked = 0
      for (const b of btns) {
        const before = snap()
        let ok = true; try { b.click() } catch (e) { ok = false }
        if (ok) clicked++
        await new Promise((r) => setTimeout(r, 300))
        runs.push({ before, after: snap(), ok })
      }
      return { total: btns.length, clicked, runs }
    })()`)
    const buttonErrors = consoleErrors.length - errorsBeforeButtons
    const changed = btnRun.runs.filter((r) => r.ok && snapshotChanged(r.before, r.after)).length
    const dead = btnRun.runs.filter((r) => r.ok && !snapshotChanged(r.before, r.after)).length
    const buttons = { total: btnRun.total, clicked: btnRun.clicked, errors: buttonErrors, changed, dead }

    // 4) Form: Faz 4 — doldur, gönder, GERÇEK SONUCU gözle (yönlendirme/doğrulama/
    // mesaj/temizlenme). Sonuç yoksa 'none' → ölü form (sadece "gönderildi" yetmez).
    const formRun = await exec<{ present: boolean; before?: UiSnapshot; after?: UiSnapshot; invalidCount?: number; cleared?: boolean }>(`(async () => {
      const snap = () => (${SNAP_JS})
      const f = document.querySelector('form')
      if (!f) return { present: false }
      const before = snap()
      const fields = [...f.querySelectorAll('input, textarea')]
      for (const i of f.querySelectorAll('input')) {
        if (i.type === 'checkbox' || i.type === 'radio') continue
        i.value = i.type === 'email' ? 'test@nexora.dev' : 'Test'
        i.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const ta = f.querySelector('textarea')
      if (ta) { ta.value = 'Merhaba, deneme mesajı.'; ta.dispatchEvent(new Event('input', { bubbles: true })) }
      const valsBefore = fields.map((x) => x.value)
      ;(f.querySelector('button[type="submit"]') ?? f.querySelector('button'))?.click()
      await new Promise((r) => setTimeout(r, 700))
      const invalidCount = f.querySelectorAll(':invalid').length
      const cleared = fields.some((x, i) => valsBefore[i] && !x.value)
      return { present: true, before, after: snap(), invalidCount, cleared }
    })()`)
    const form = formRun.present
      ? {
          present: true,
          submitted: true,
          outcome: classifyFormOutcome(formRun.before!, formRun.after!, {
            invalidCount: formRun.invalidCount ?? 0,
            cleared: !!formRun.cleared
          })
        }
      : { present: false }

    // 5) Bölüm bölüm ekran şeridi (artifact).
    await rm(SHOT_DIR, { recursive: true, force: true })
    await mkdir(SHOT_DIR, { recursive: true })
    const sections = await exec<Array<{ id: string; y: number }>>(`(() =>
      [...document.querySelectorAll('header, section, footer')].slice(0, 8).map((s, i) => ({ id: s.id || s.tagName.toLowerCase() + '-' + i, y: Math.max(0, s.getBoundingClientRect().top + scrollY - 40) }))
    )()`)
    const shots: string[] = []
    for (const s of sections) {
      await exec(`window.scrollTo(0, ${Math.round(s.y)}); true`)
      await new Promise((r) => setTimeout(r, 450))
      const img = await win.webContents.capturePage()
      const p = join(SHOT_DIR, `${shots.length + 1}-${s.id.replace(/[^\w-]/g, '')}.png`)
      await writeFile(p, img.toPNG())
      shots.push(p)
    }

    return {
      ok: true,
      images,
      nav,
      buttons,
      form,
      consoleErrors: consoleErrors.slice(0, 6),
      shots
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    try { win?.destroy() } catch { /* ignore */ }
  }
}
