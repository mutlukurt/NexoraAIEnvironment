/**
 * 15.2 — Config Profiller paneli (Ayarlar). Önyükleme + kullanıcı profillerini
 * listeler, aktifini seçtirir, aktif profili düzenletir. Profil = seçilen çalışma
 * kipi (güven + engellenen direktifler + sistem-prompt + örnekleme). Mimari
 * profillerden (react-spa/next…) dikgendir.
 */
import { tt } from '@/lib/i18n'
import { useAppStore } from '@/store/appStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useProfilesStore } from '@/store/profilesStore'
import { DIRECTIVE_KINDS, type ConfigProfile } from '@shared/configProfiles'
import type { TrustTier } from '@shared/trust'
import { SlidersHorizontal, Check, Copy, Trash2, Lock } from 'lucide-react'

const TIERS: Array<{ id: TrustTier; label: string }> = [
  { id: 'read', label: 'Salt Okunur' },
  { id: 'auto', label: 'Otomatik' },
  { id: 'full', label: 'Tam Erişim' }
]

export default function ProfilesPanel() {
  const language = useAppStore((s) => s.language)
  const modelInfo = useAppStore((s) => s.modelInfo)
  const custom = useSettingsStore((s) => s.customSystemPrompt)

  const profiles = useProfilesStore((s) => s.profiles)
  const activeId = useProfilesStore((s) => s.activeProfileId)
  const setActive = useProfilesStore((s) => s.setActive)
  const upsert = useProfilesStore((s) => s.upsertProfile)
  const createFrom = useProfilesStore((s) => s.createFrom)
  const deleteProfile = useProfilesStore((s) => s.deleteProfile)

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]

  // Profil değişince (ya da kip yönergesi düzenlenince) yerel modelin sistem
  // prompt'unu yeniden uygula — yüklüyse anında etki eder.
  const reapplySystemPrompt = (p: ConfigProfile): void => {
    if (!modelInfo) return
    const sys = [custom, p.systemPromptAddition].filter(Boolean).join('\n\n')
    void window.nexora.model.setSystemPrompt?.(sys)
  }

  const selectProfile = (id: string): void => {
    setActive(id)
    const p = profiles.find((x) => x.id === id)
    if (p) reapplySystemPrompt(p)
  }

  const patch = (over: Partial<ConfigProfile>): void => {
    const next = { ...active, ...over }
    upsert(next)
    if (next.id === activeId) reapplySystemPrompt(next)
  }

  const toggleDirective = (kind: string): void => {
    const blocked = active.blockedDirectives.includes(kind)
      ? active.blockedDirectives.filter((k) => k !== kind)
      : [...active.blockedDirectives, kind]
    patch({ blockedDirectives: blocked })
  }

  return (
    <div className={'rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm'}>
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-brand-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
          {tt(language, "Config Profiles")}
        </span>
      </div>
      <p className="mt-1 text-[11px] font-medium text-ink-dim">
        {tt(language, "A selectable work mode: trust tier, blocked directives, system-prompt nudge and sampling. Applies to every turn.")}
      </p>

      {/* Profil listesi */}
      <div className="mt-3 flex flex-wrap gap-2">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => selectProfile(p.id)}
            className={
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-bold transition ' +
              (p.id === activeId
                ? 'border-brand-500/60 bg-brand-500/15 text-brand-700 dark:text-brand-200'
                : 'border-ink-line/60 bg-ink-panel/40 text-ink-mut hover:border-brand-500/30 hover:text-ink-text')
            }
          >
            {p.id === activeId && <Check className="h-3.5 w-3.5" />}
            {p.name}
            {p.builtin && <Lock className="h-3 w-3 text-ink-dim" />}
          </button>
        ))}
        <button
          onClick={() => selectProfile(createFrom(activeId, `${active.name} kopyası`))}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-ink-line px-3 py-1.5 text-[12px] font-bold text-ink-mut transition hover:border-brand-500/50 hover:text-brand-600 dark:hover:text-brand-300"
        >
          <Copy className="h-3.5 w-3.5" /> {tt(language, "Duplicate")}
        </button>
      </div>

      {/* Aktif profil detayı */}
      <div className="mt-4 space-y-4 rounded-lg border border-ink-line/60 bg-ink-panel/30 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <input
            value={active.name}
            onChange={(e) => patch({ name: e.target.value })}
            disabled={active.builtin}
            className="min-w-0 flex-1 rounded-md border border-ink-line/60 bg-ink-card px-2.5 py-1.5 text-[13px] font-bold text-ink-text disabled:opacity-60"
          />
          {!active.builtin && (
            <button
              onClick={() => deleteProfile(active.id)}
              title={tt(language, "Delete profile")}
              className="rounded-lg p-1.5 text-ink-dim transition hover:bg-red-500/10 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        {active.builtin && (
          <p className="text-[10.5px] font-medium text-ink-dim">
            {tt(language, "Built-in profile — edits are saved; delete is disabled. Duplicate to start fresh.")}
          </p>
        )}

        {/* Güven seviyesi */}
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-dim">{tt(language, "Trust tier")}</span>
          <div className="mt-1.5 flex gap-1.5">
            {TIERS.map((tr) => (
              <button
                key={tr.id}
                onClick={() => patch({ trustTier: tr.id })}
                className={
                  'flex-1 rounded-md border px-2 py-1.5 text-[11.5px] font-bold transition ' +
                  (active.trustTier === tr.id
                    ? 'border-brand-500/60 bg-brand-500/15 text-brand-700 dark:text-brand-200'
                    : 'border-ink-line/60 text-ink-mut hover:text-ink-text')
                }
              >
                {tt(language, tr.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Engellenen direktifler */}
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-dim">{tt(language, "Blocked directives")}</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DIRECTIVE_KINDS.map((k) => {
              const blocked = active.blockedDirectives.includes(k)
              return (
                <button
                  key={k}
                  onClick={() => toggleDirective(k)}
                  className={
                    'rounded-md border px-2 py-1 text-[11px] font-bold transition ' +
                    (blocked
                      ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300 line-through'
                      : 'border-ink-line/60 text-ink-mut hover:text-ink-text')
                  }
                >
                  [{k}]
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[10.5px] font-medium text-ink-dim">{tt(language, "Blocked = the agent may not use that directive in this profile.")}</p>
        </div>

        {/* Örnekleme sıcaklığı */}
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-dim">
            {tt(language, "Temperature")} · {active.sampling.temperature.toFixed(2)}
          </span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={active.sampling.temperature}
            onChange={(e) => patch({ sampling: { ...active.sampling, temperature: Number(e.target.value) } })}
            className="mt-1.5 w-full accent-brand-500"
          />
        </div>

        {/* Sistem-prompt eklentisi */}
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-dim">{tt(language, "System-prompt nudge")}</span>
          <textarea
            value={active.systemPromptAddition}
            onChange={(e) => patch({ systemPromptAddition: e.target.value })}
            rows={3}
            className="mt-1.5 w-full resize-none rounded-md border border-ink-line/60 bg-ink-card px-2.5 py-2 text-[12px] text-ink-text"
          />
        </div>
      </div>
    </div>
  )
}
