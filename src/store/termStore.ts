/**
 * Görünür terminal (roadmap 7.6) — ajanın dünyası görünmez olmaktan çıkar.
 *
 * Her [RUN]/[DEV] yürütmesi ve kullanıcının kendi komutu burada bir karttır:
 * canlı stdout/stderr akışı, çıkış kodu, süre. Ayrı store: appStore ↔
 * agentActions import döngüsüne girmeden her iki taraf da besleyebilir.
 *
 * TERM_OUTPUT IPC olayları modül yüklenirken abone olunur — kart, olayı
 * kendisi kaydolmadan önce gelen yürütmelerde de kaybolmaz (register
 * çağrısı execId'yi olaydan ÖNCE üretir, sıra her zaman güvenlidir).
 */
import { create } from 'zustand'
import { nanoid } from 'nanoid'

export interface TermEntry {
  id: string
  cmd: string
  /** Kaynak: ajan direktifi, kullanıcının kendi komutu ya da dev sunucusu. */
  source: 'agent' | 'user' | 'dev'
  output: string
  running: boolean
  ok?: boolean
  exitCode?: number | null
  startedAt: number
  durationMs?: number
  /** Sandbox engellediyse: gerekçe (çalışmadan kapanan kart). */
  blockedReason?: string
}

const MAX_ENTRIES = 40
const MAX_OUTPUT = 64_000

interface TermState {
  entries: TermEntry[]
  /** Yeni yürütme kartı aç; execId döner (IPC'ye aynen gider). */
  register: (cmd: string, source: TermEntry['source']) => string
  append: (id: string, chunk: string) => void
  finish: (id: string, r: { ok?: boolean; exitCode?: number | null; durationMs?: number; fallbackOutput?: string }) => void
  /** Sandbox'ın çalıştırmadan kestiği komut — dürüst, kapalı kart. */
  blocked: (cmd: string, source: TermEntry['source'], reason: string) => void
  clear: () => void
}

export const useTermStore = create<TermState>((set) => ({
  entries: [],
  register: (cmd, source) => {
    const id = nanoid()
    set((s) => ({
      entries: [
        ...s.entries.slice(-(MAX_ENTRIES - 1)),
        { id, cmd, source, output: '', running: true, startedAt: Date.now() }
      ]
    }))
    return id
  },
  append: (id, chunk) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id && e.output.length < MAX_OUTPUT ? { ...e, output: e.output + chunk } : e
      )
    })),
  finish: (id, r) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id
          ? {
              ...e,
              running: false,
              ok: r.ok ?? e.ok,
              exitCode: r.exitCode ?? e.exitCode,
              durationMs: r.durationMs ?? Date.now() - e.startedAt,
              // Canlı olaylar hiç ulaşmadıysa (worker yedeği vb.) özet çıktı kalır.
              output: e.output || r.fallbackOutput || ''
            }
          : e
      )
    })),
  blocked: (cmd, source, reason) =>
    set((s) => ({
      entries: [
        ...s.entries.slice(-(MAX_ENTRIES - 1)),
        {
          id: nanoid(),
          cmd,
          source,
          output: '',
          running: false,
          ok: false,
          exitCode: null,
          startedAt: Date.now(),
          durationMs: 0,
          blockedReason: reason
        }
      ]
    })),
  clear: () => set({ entries: [] })
}))

// TERM_OUTPUT canlı akışına abone ol. Electron'da preload window.nexora'yı
// modüllerden önce kurar; TARAYICI modunda mock main.tsx GÖVDESİNDE kurulur
// ve import zinciri (main → appStore → agentActions → termStore) bu modülü
// mock'tan ÖNCE çalıştırır — o yüzden ilk deneme boşa düşerse bir tick sonra
// yeniden denenir (canlı testte kartların fallback'e düşme nedeni buydu).
function subscribeTermEvents(): boolean {
  try {
    const sub = window.nexora?.agent?.onTermOutput
    if (typeof sub !== 'function') return false
    sub((ev: import('@shared/ipc').TermOutputEvent) => {
      if (ev.chunk) useTermStore.getState().append(ev.execId, ev.chunk)
      if (ev.done) useTermStore.getState().finish(ev.execId, { ok: ev.ok, exitCode: ev.exitCode, durationMs: ev.durationMs })
    })
    return true
  } catch {
    return false
  }
}
if (!subscribeTermEvents()) {
  setTimeout(() => {
    subscribeTermEvents() // yine yoksa kartlar finish fallback'iyle dolar
  }, 0)
}
