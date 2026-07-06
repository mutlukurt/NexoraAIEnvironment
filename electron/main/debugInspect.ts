/**
 * Debug Engine 6.1 — GERÇEK runtime debugger.
 *
 * Dev sayfası görünmez bir pencerede, Electron'un webContents.debugger'ı
 * (CDP Debugger domain'i) takılı olarak açılır ve pauseOnExceptions kurulur.
 * Çökme ANINDA sanal makine durur: gerçek call frame'ler, her frame'in yerel
 * değişken DEĞERLERİ ve inline source map üzerinden orijinal kaynak satırı
 * okunur — dosyaya SIFIR dokunuş. 5.7'nin dosya-yamalı string problarının
 * yerini alır (prob, exception üretmeyen ölçümler için yedek olarak durur):
 * prob sahada 3/11 isabetliydi ve senkron yarışlarla boğuşuyordu; debugger
 * kancaya, HMR'a ve yeniden-render yarışlarına hiç bağımlı değildir.
 */
import { BrowserWindow } from 'electron'
import type { DebugFrameInfo, DebugInspectResult } from '../shared/ipc'
import { originalPosition, parseInlineSourceMap } from '../shared/sourceMapLine'

/** CDP Runtime.RemoteObject → kısa, insan-okur değer metni. */
function renderValue(v: { type?: string; subtype?: string; value?: unknown; description?: string }): string {
  if (v == null) return 'undefined'
  if (v.type === 'undefined') return 'undefined'
  if (v.subtype === 'null') return 'null'
  if (v.value !== undefined) {
    try {
      return JSON.stringify(v.value).slice(0, 100)
    } catch {
      return String(v.value).slice(0, 100)
    }
  }
  return (v.description ?? v.type ?? '?').slice(0, 100)
}

export async function inspectRuntimeException(url: string, timeoutMs = 12000): Promise<DebugInspectResult> {
  // MUTLAK üst sınır: iç akış nerede takılırsa takılsın çağıran ASLA asılı
  // kalmaz. Canlı ders (2026-07-06): iç zamanlayıcı `result` promise'ine
  // bağlıydı ama akış ondan ÖNCEKİ bir sendCommand await'inde takıldı —
  // renderer'daki runtime handler probing=true kilidiyle sonsuza dek sustu.
  return Promise.race([
    inspectInner(url, timeoutMs),
    new Promise<DebugInspectResult>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: 'debugger üst zaman aşımı (iç akış takıldı)' }), timeoutMs + 4000)
    )
  ])
}

async function inspectInner(url: string, timeoutMs: number): Promise<DebugInspectResult> {
  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { offscreen: true, sandbox: true }
    })
    const dbg = win.webContents.debugger
    dbg.attach('1.3')
    const send = (method: string, params?: Record<string, unknown>): Promise<Record<string, never>> =>
      dbg.sendCommand(method, params) as Promise<Record<string, never>>

    // scriptId → url + sourceMapURL kaydı (paused geldiğinde çözmek için)
    const scripts = new Map<string, { url: string; sourceMapURL: string }>()

    const result = new Promise<DebugInspectResult>((resolve) => {
      let settled = false
      const finish = (r: DebugInspectResult): void => {
        if (settled) return
        settled = true
        resolve(r)
      }
      const timer = setTimeout(
        () => finish({ ok: false, error: 'zaman aşımı — sayfa exception üretmedi (sağlıklı olabilir)' }),
        timeoutMs
      )

      // Canlı ders (2026-07-06): React render hatasını İÇERİDE yakalayıp
      // commitRootImpl'den YENİDEN fırlatır — 'uncaught' duraklaması o anda
      // tetiklenir ve kullanıcı frame'i (List, data ile birlikte) stack'ten
      // çoktan düşmüştür; yereller React iç yapıları çıkar. Doğrusu: 'all'
      // modunda İLK fırlatmada durup kullanıcı-kodu frame'i aramak, vendor
      // duraklamalarını resume'layıp geçmek (tavan: 60 duraklamada pes).
      let pausesSeen = 0
      dbg.on('message', (_e, method, params: Record<string, unknown>) => {
        if (method === 'Debugger.scriptParsed') {
          const p = params as { scriptId: string; url?: string; sourceMapURL?: string }
          scripts.set(p.scriptId, { url: p.url ?? '', sourceMapURL: p.sourceMapURL ?? '' })
          return
        }
        if (method !== 'Debugger.paused') return
        const p = params as {
          reason: string
          data?: { description?: string }
          callFrames: Array<{
            functionName: string
            location: { scriptId: string; lineNumber: number; columnNumber?: number }
            scopeChain: Array<{ type: string; object: { objectId?: string } }>
          }>
        }
        if (p.reason !== 'exception' && p.reason !== 'promiseRejection') {
          void send('Debugger.resume').catch(() => undefined)
          return
        }
        const isUserFrame = (f: { location: { scriptId: string } }): boolean => {
          const u = scripts.get(f.location.scriptId)?.url ?? ''
          return !!u && !u.includes('node_modules') && !u.startsWith('data:') && u.startsWith('http')
        }
        const interesting = p.callFrames.filter(isUserFrame).slice(0, 3)
        if (interesting.length === 0) {
          // Vendor-içi (muhtemelen yakalanan) exception — geç, asıl fırlatmayı bekle.
          pausesSeen++
          void send('Debugger.resume').catch(() => undefined)
          if (pausesSeen > 60) {
            clearTimeout(timer)
            finish({ ok: false, error: "kullanıcı-kodu frame'i görülmedi (60 duraklama)" })
          }
          return
        }
        void (async () => {
          try {
            const frames: DebugFrameInfo[] = []
            for (const f of interesting) {
              const script = scripts.get(f.location.scriptId)
              const locals: Record<string, string> = {}
              // local + en yakın closure: çökme anındaki GERÇEK değerler.
              for (const scope of f.scopeChain.filter((s) => s.type === 'local' || s.type === 'closure').slice(0, 2)) {
                if (!scope.object.objectId) continue
                try {
                  const props = (await send('Runtime.getProperties', {
                    objectId: scope.object.objectId,
                    ownProperties: true
                  })) as unknown as { result: Array<{ name: string; value?: Record<string, unknown> }> }
                  for (const prop of props.result.slice(0, 15)) {
                    if (Object.keys(locals).length >= 12) break
                    if (prop.value) locals[prop.name] = renderValue(prop.value)
                  }
                } catch {
                  /* scope okunamadı — kalanlarla devam */
                }
              }
              // Inline source map → orijinal satır (5.3'ün ± kayma sınırı kapanır)
              let source: string | null = null
              let origLine: number | null = null
              if (script?.sourceMapURL) {
                const map = parseInlineSourceMap(script.sourceMapURL)
                if (map) {
                  const pos = originalPosition(map, f.location.lineNumber, f.location.columnNumber ?? 0)
                  source = pos.source
                  origLine = pos.line
                }
              }
              frames.push({
                fn: f.functionName || '(anonim)',
                url: script?.url ?? '',
                line: f.location.lineNumber + 1,
                source,
                origLine,
                locals
              })
            }
            clearTimeout(timer)
            finish({ ok: true, message: p.data?.description?.slice(0, 300), frames })
          } catch (err) {
            clearTimeout(timer)
            finish({ ok: false, error: (err as Error).message })
          } finally {
            void send('Debugger.resume').catch(() => undefined)
          }
        })()
      })
    })

    // Canlı ders (2026-07-06): hiç navigasyon görmemiş webContents'te
    // debugger komutları ÇÖZÜLMÜYOR ("enable aşaması"nda sonsuz bekleme).
    // Önce about:blank commit edilir, debugger o belgeye bağlanır, kurallar
    // kurulur, SONRA gerçek URL'e gidilir — attach navigasyonlarda kalıcıdır,
    // pause kuralı gerçek sayfanın tüm script'lerine uygulanır.
    await win.loadURL('about:blank')
    console.log('[debugInspect] enable aşaması')
    await send('Runtime.enable')
    await send('Debugger.enable')
    await send('Debugger.setPauseOnExceptions', { state: 'all' })
    console.log('[debugInspect] yükleme:', url)
    void win.loadURL(url).catch(() => undefined)

    return await result
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    try {
      win?.webContents.debugger.detach()
    } catch {
      /* zaten kopuk */
    }
    try {
      win?.destroy()
    } catch {
      /* ignore */
    }
  }
}
