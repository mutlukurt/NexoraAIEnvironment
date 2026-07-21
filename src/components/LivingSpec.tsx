/**
 * Faz 4 — Living Spec: düzenlenebilir kabul kriterleri paneli.
 *
 * Kullanıcı "olması gerekenler" maddelerini ekler/düzenler/siler (oturumla saklanır);
 * her madde her turda GERÇEK kanıta göre ✓/✗/? işaretlenir. Otomatik (kanıttan) maddeler
 * de listeye katılır (salt-okunur). Değerlendirme MEKANİK (livingSpec.ts) — niyet tahmini yok.
 */
import { useState } from 'react'
import { Check, X, HelpCircle, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useArtifactsStore } from '@/store/artifactsStore'
import { tt } from '@/lib/i18n'
import { criteriaFromEvidence, formatEars } from '@/lib/ears'
import { reconcileSpec, specCounts, type SpecItem } from '@/lib/livingSpec'

function StatusIcon({ status }: { status: SpecItem['status'] }) {
  if (status === 'passed') return <Check size={14} className="shrink-0 text-emerald-500" />
  if (status === 'failed') return <X size={14} className="shrink-0 text-red-500" />
  return <HelpCircle size={14} className="shrink-0 text-amber-500" />
}

export default function LivingSpec() {
  const language = useAppStore((s) => s.language)
  const userItems = useAppStore((s) => s.livingSpecItems)
  const ledger = useAppStore((s) => s.verificationLedger)
  const addSpecItem = useAppStore((s) => s.addSpecItem)
  const editSpecItem = useAppStore((s) => s.editSpecItem)
  const removeSpecItem = useAppStore((s) => s.removeSpecItem)
  const files = useArtifactsStore((s) => s.files)
  const tr = language === 'tr'

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const fileList = Object.values(files).map((f) => ({ path: f.path, content: f.content }))
  const autoItems: SpecItem[] = criteriaFromEvidence(ledger, undefined, tr).map((c) => ({
    id: c.id,
    text: formatEars(c, tr),
    source: 'auto',
    status: c.status
  }))
  const items = reconcileSpec(userItems, autoItems, fileList)
  const counts = specCounts(items)

  const submitAdd = () => {
    if (!draft.trim()) return
    addSpecItem(draft)
    setDraft('')
  }
  const submitEdit = (id: string) => {
    editSpecItem(id, editText)
    setEditingId(null)
  }

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-2.5 text-xs">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold uppercase tracking-wide text-[10px] opacity-70">{tt(language, 'Acceptance criteria')}</span>
        {items.length > 0 && (
          <span className="tabular-nums opacity-70">
            <span className="text-emerald-500">{counts.passed}</span> · <span className="text-red-500">{counts.failed}</span> · <span className="text-amber-500">{counts.unverified}</span>
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="opacity-50 py-1">{tt(language, 'No acceptance criteria yet — the app adds its own after a build; add yours above.')}</p>
      ) : (
        <ul className="space-y-1 mb-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-1.5 group">
              <span className="mt-0.5"><StatusIcon status={it.status} /></span>
              {editingId === it.id ? (
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => submitEdit(it.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitEdit(it.id); if (e.key === 'Escape') setEditingId(null) }}
                  className="flex-1 bg-transparent border-b border-black/20 dark:border-white/20 outline-none"
                />
              ) : (
                <span
                  className={`flex-1 leading-snug ${it.source === 'user' ? 'cursor-text' : 'opacity-80'}`}
                  onClick={() => { if (it.source === 'user') { setEditingId(it.id); setEditText(it.text) } }}
                  title={it.source === 'user' ? (tr ? 'Düzenlemek için tıkla' : 'Click to edit') : ''}
                >
                  {it.text}
                </span>
              )}
              {it.source === 'user' && editingId !== it.id && (
                <button
                  onClick={() => removeSpecItem(it.id)}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition"
                  title={tr ? 'Sil' : 'Delete'}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <Plus size={13} className="opacity-40 shrink-0" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitAdd() }}
          placeholder={tt(language, 'Add a criterion the app should meet…')}
          className="flex-1 bg-transparent outline-none placeholder:opacity-40"
        />
      </div>
    </div>
  )
}
