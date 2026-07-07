/**
 * Riskli agent eylemleri için izin istemi.
 *
 * Model [RUN] (kabuk komutu) ya da [FETCH] (internetten dosya indirme)
 * direktifi ürettiğinde, proje için kalıcı izin yoksa bu ekran açılır.
 * Kullanıcı NEYİN çalışacağını komut komut görür; "bu projede hep izin ver"
 * seçilirse aynı projede bir daha sorulmaz (localStorage, proje bazlı).
 */
import { useAppStore } from '@/store/appStore'
import { translations } from '@/lib/translations'
import { Terminal, Download, ShieldAlert } from 'lucide-react'

export default function PermissionModal() {
  const request = useAppStore((s) => s.permissionRequest)
  const language = useAppStore((s) => s.language)
  const t = translations[language]

  if (!request) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150">
        <header className="flex items-center gap-3 border-b border-ink-line px-5 py-4 bg-amber-500/10">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-ink-text">{t.permTitle}</p>
            <p className="text-[11px] font-medium text-ink-mut">{t.permSubtitle}</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-2">
            {request.items.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-xl border border-ink-line bg-ink-card/50 px-3.5 py-2.5">
                <span className={'mt-0.5 shrink-0 ' + (item.kind === 'run' ? 'text-red-600 dark:text-red-400' : 'text-sky-500')}>
                  {item.kind === 'run' ? <Terminal className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                    {item.kind === 'run' ? t.permRunLabel : t.permFetchLabel}
                  </p>
                  <p className="break-all font-mono text-xs font-semibold text-ink-text">{item.text}</p>
                  {item.reason && (
                    <p className="mt-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      {language === 'tr' ? 'neden soruluyor: ' : 'why asking: '}{item.reason}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-ink-line px-5 py-4 bg-ink-card/50">
          <div className="flex gap-2">
            <button
              onClick={() => request.resolve('deny')}
              className="flex-1 rounded-xl border border-ink-line bg-ink-card px-4 py-2.5 text-xs font-bold text-ink-mut hover:bg-ink-hi transition shadow-sm"
            >
              ⛔ {t.permDeny}
            </button>
            <button
              onClick={() => request.resolve('once')}
              className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-500 transition shadow-sm"
            >
              ✓ {t.permOnce}
            </button>
          </div>
          <button
            onClick={() => request.resolve('always')}
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 transition"
          >
            ✓✓ {t.permAlways}
          </button>
        </footer>
      </div>
    </div>
  )
}
