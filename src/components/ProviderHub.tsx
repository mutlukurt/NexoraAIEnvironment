/**
 * 10.9 — Sağlayıcı Hub'ı (Ayarlar içinde).
 *
 * OpenCode'daki TÜM sağlayıcılar (60+) — ara, seç, anahtar gir (OS keychain),
 * model çek, hibrit kipi belirle. YEREL VARSAYILAN: hiçbir şey seçili değilken
 * motor tamamen yereldir; sağlayıcı OPT-IN ve her biri "veri nereye gider"
 * etiketli. Katalog çevrimdışı gömülü — listeyi göstermek ağ istemez.
 */
import { useEffect, useState } from 'react'
import { Search, KeyRound, Check, Trash2, Download, Cpu, ShieldCheck, ShieldAlert } from 'lucide-react'
import { PROVIDERS, findProvider, dataDestinationNote } from '@shared/providers'
import { useSettingsStore } from '@/store/settingsStore'
import { fuzzyFilter } from '@/lib/fuzzy'

export default function ProviderHub({ language }: { language: 'tr' | 'en' }) {
  const tr = language === 'tr'
  const provider = useSettingsStore((s) => s.provider)
  const providerModel = useSettingsStore((s) => s.providerModel)
  const apiMode = useSettingsStore((s) => s.apiMode)
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl)
  const setProvider = useSettingsStore((s) => s.setProvider)

  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [configured, setConfigured] = useState<string[]>([])
  const [encrypted, setEncrypted] = useState(true)
  const [keyInput, setKeyInput] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchErr, setFetchErr] = useState('')

  const refreshConfigured = () => {
    void window.nexora.providers?.listConfigured().then((r: { ids: string[]; encrypted: boolean }) => {
      setConfigured(r.ids)
      setEncrypted(r.encrypted)
    }).catch(() => setConfigured([]))
  }
  useEffect(() => {
    refreshConfigured()
  }, [])

  const sel = provider ? findProvider(provider) : undefined
  const filtered = fuzzyFilter(query, PROVIDERS, (p) => p.name + ' ' + p.id)
  const shown = showAll || query ? filtered : filtered.slice(0, 12)

  const pick = (id: string) => {
    setProvider({ provider: id, providerModel: '' })
    setKeyInput('')
    setModels([])
    setFetchErr('')
  }

  const saveKey = async () => {
    if (!sel || !keyInput.trim()) return
    await window.nexora.providers.setKey({ providerId: sel.id, key: keyInput.trim() })
    setKeyInput('')
    refreshConfigured()
    // anahtar geldi → aktivasyonu tazele
    setProvider({})
  }
  const deleteKey = async () => {
    if (!sel) return
    await window.nexora.providers.deleteKey(sel.id)
    refreshConfigured()
  }
  const fetchModels = async () => {
    if (!sel) return
    setFetching(true)
    setFetchErr('')
    try {
      const r = await window.nexora.providers.fetchModels({ providerId: sel.id, customBaseUrl: apiBaseUrl })
      if (r.ok) setModels(r.models)
      else setFetchErr(r.error || 'liste alınamadı')
    } finally {
      setFetching(false)
    }
  }

  const needsBaseUrl = sel && !sel.baseUrl
  const hasKey = sel ? configured.includes(sel.id) : false

  return (
    <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-brand-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
          {tr ? 'Sağlayıcılar (BYO-key)' : 'Providers (BYO-key)'}
        </span>
        <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-bold text-brand-600 dark:text-brand-300">{PROVIDERS.length}</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-ink-dim">
          {encrypted ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> : <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />}
          {encrypted ? (tr ? 'keychain' : 'keychain') : (tr ? 'şifreleme yok' : 'no encryption')}
        </span>
      </div>
      <p className="mt-1 text-[11px] font-medium leading-normal text-ink-dim">
        {tr
          ? 'YEREL varsayılan kalır. Sağlayıcı seçmek OPT-IN — anahtar OS keychain\'de saklanır, veri seçtiğin sağlayıcıya gider. Çoğu OpenAI-uyumlu; Anthropic native.'
          : 'LOCAL stays default. Picking a provider is OPT-IN — the key is stored in the OS keychain, data goes to that provider. Most are OpenAI-compatible; Anthropic is native.'}
      </p>

      {/* Hibrit kip */}
      <div className="mt-3 flex items-center gap-1.5">
        <span className="text-[11px] font-bold text-ink-mut">{tr ? 'Kip:' : 'Mode:'}</span>
        {(['off', 'fix', 'all'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setProvider({ apiMode: m })}
            className={
              'rounded-lg px-2.5 py-1 text-[11px] font-bold transition ' +
              (apiMode === m ? 'bg-brand-600 text-white' : 'border border-ink-line text-ink-mut hover:bg-ink-hi')
            }
          >
            {m === 'off' ? (tr ? 'Yalnız yerel' : 'Local only') : m === 'fix' ? (tr ? 'Düzeltmede' : 'On fix') : (tr ? 'Her tur' : 'Every turn')}
          </button>
        ))}
      </div>

      {/* Arama + liste */}
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-dim" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr ? 'sağlayıcı ara (OpenAI, Groq, OpenRouter, Ollama…)' : 'search providers…'}
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-ink-text placeholder-ink-dim focus:outline-none"
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {shown.map((p) => {
          const active = p.id === provider
          const conf = configured.includes(p.id)
          return (
            <button
              key={p.id}
              onClick={() => pick(p.id)}
              className={
                'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ' +
                (active ? 'border-brand-500 bg-brand-500/10' : 'border-ink-line/60 bg-ink-panel hover:bg-ink-hi/50')
              }
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-bold text-ink-text">{p.name}</span>
                <span className="block truncate text-[9px] text-ink-dim">{p.local ? (tr ? 'yerel' : 'local') : p.gateway ? 'gateway' : p.id}</span>
              </span>
              {p.local && <Cpu className="h-3 w-3 shrink-0 text-emerald-500" />}
              {conf && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
            </button>
          )
        })}
      </div>
      {!query && filtered.length > 12 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-1.5 text-[11px] font-bold text-brand-600 hover:underline dark:text-brand-300">
          {showAll ? (tr ? 'daha az göster' : 'show less') : (tr ? `daha fazla göster (${filtered.length - 12})` : `show more (${filtered.length - 12})`)}
        </button>
      )}

      {/* Seçili sağlayıcı yapılandırması */}
      {sel && (
        <div className="mt-3 rounded-lg border border-brand-500/30 bg-brand-500/5 p-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-ink-text">{sel.name}</span>
            <span className="text-[10px] font-semibold text-ink-dim">· {dataDestinationNote(sel, language)}</span>
          </div>

          {needsBaseUrl && (
            <input
              value={apiBaseUrl}
              onChange={(e) => setProvider({ apiBaseUrl: e.target.value })}
              placeholder={tr ? 'base URL (OpenAI-uyumlu uç)' : 'base URL (OpenAI-compatible)'}
              className="mt-2 w-full rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 font-mono text-xs text-ink-text placeholder-ink-dim focus:border-brand-500 focus:outline-none"
            />
          )}

          {!sel.local && (
            <div className="mt-2 flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-dim" />
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={hasKey ? (tr ? 'anahtar kayıtlı — değiştirmek için yaz' : 'key saved — type to change') : (sel.keyEnv || 'API key')}
                className="min-w-0 flex-1 rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 font-mono text-xs text-ink-text placeholder-ink-dim focus:border-brand-500 focus:outline-none"
              />
              <button onClick={saveKey} disabled={!keyInput.trim()} className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-brand-500 disabled:opacity-40">
                {tr ? 'Kaydet' : 'Save'}
              </button>
              {hasKey && (
                <button onClick={deleteKey} title={tr ? 'Anahtarı sil' : 'Delete key'} className="shrink-0 rounded-lg p-1.5 text-ink-dim transition hover:bg-red-500/10 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={providerModel}
              onChange={(e) => setProvider({ providerModel: e.target.value })}
              placeholder={tr ? 'model id (örn. gpt-4o-mini)' : 'model id (e.g. gpt-4o-mini)'}
              list="nexora-provider-models"
              className="min-w-0 flex-1 rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 font-mono text-xs text-ink-text placeholder-ink-dim focus:border-brand-500 focus:outline-none"
            />
            <datalist id="nexora-provider-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button onClick={fetchModels} disabled={fetching} className="flex shrink-0 items-center gap-1 rounded-lg border border-ink-line px-2.5 py-1.5 text-[11px] font-bold text-ink-mut transition hover:bg-ink-hi disabled:opacity-40">
              <Download className={'h-3.5 w-3.5 ' + (fetching ? 'animate-pulse' : '')} /> {tr ? 'Modelleri çek' : 'Fetch models'}
            </button>
          </div>
          {models.length > 0 && <p className="mt-1 text-[10px] font-semibold text-ink-dim">{models.length} {tr ? 'model bulundu' : 'models'}</p>}
          {fetchErr && <p className="mt-1 text-[10px] font-semibold text-red-500">{fetchErr}</p>}
          {sel.docs && <p className="mt-1.5 font-mono text-[9px] text-ink-dim">{sel.docs}</p>}
        </div>
      )}
    </div>
  )
}
