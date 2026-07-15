import { create } from 'zustand'
import type { HfModelResult, LocalModel, HfProgressEvent } from '@shared/ipc'

const DIR_KEY = 'nexora.modelsDir'

export interface DownloadState {
  repo: string
  file: string
  downloaded: number
  total: number
  status: 'downloading' | 'done' | 'error' | 'cancelled'
  error?: string
}

interface HfState {
  dir: string
  results: HfModelResult[]
  searching: boolean
  searchError: string | null
  localModels: LocalModel[]
  loadingLocal: boolean
  downloads: Record<string, DownloadState>
  modalOpen: boolean
  /** Faz 13 — Model Tarayıcı kipi: metin (GGUF LLM) mi görsel-üretim modeli mi. */
  browserMode: 'text' | 'image'

  init: () => void
  setModalOpen: (v: boolean) => void
  setBrowserMode: (m: 'text' | 'image') => void
  search: (q: string) => Promise<void>
  refreshLocal: () => Promise<void>
  deleteLocal: (name: string) => Promise<{ ok: boolean; freedBytes?: number; error?: string }>
  changeDir: () => Promise<void>
  download: (repo: string, file: string) => Promise<void>
  cancel: (file: string) => Promise<void>
}

let progressUnsub: (() => void) | null = null

function defaultDir(): string {
  try {
    const stored = localStorage.getItem(DIR_KEY)
    if (stored) return stored
  } catch {
    /* ignore */
  }
  const home = window.nexora?.home ?? '/home'
  return `${home}/NexoraAI/models`
}

export const useHfStore = create<HfState>((set, get) => ({
  dir: '',
  results: [],
  searching: false,
  searchError: null,
  localModels: [],
  loadingLocal: false,
  downloads: {},
  modalOpen: false,
  browserMode: 'text',

  init: () => {
    if (get().dir) return
    const dir = defaultDir()
    set({ dir })
    void get().refreshLocal()

    if (!progressUnsub && window.nexora?.hf?.onProgress) {
      progressUnsub = window.nexora.hf.onProgress((event: HfProgressEvent) => {
        set((s) => {
          const cur = s.downloads[event.file]
          if (!cur && !('done' in event && event.done)) return {}
          if ('done' in event && event.done) {
            return {
              downloads: {
                ...s.downloads,
                [event.file]: {
                  ...(cur ?? { repo: '', file: event.file, downloaded: 0, total: 0, status: 'done' }),
                  status: 'done'
                }
              }
            }
          }
          return {
            downloads: {
              ...s.downloads,
              [event.file]: {
                ...(cur ?? { repo: '', file: event.file }),
                file: event.file,
                downloaded: event.downloaded,
                total: event.total,
                status: 'downloading'
              }
            }
          }
        })
        if ('done' in event && event.done) {
          void get().refreshLocal()
        }
      })
    }
  },

  setModalOpen: (v) => set({ modalOpen: v }),
  setBrowserMode: (m) => set({ browserMode: m }),

  search: async (q: string) => {
    set({ searching: true, searchError: null })
    try {
      const res = await window.nexora.hf.search(q)
      if (res.ok && res.results) {
        set({ results: res.results, searching: false })
      } else {
        set({ searching: false, searchError: res.error ?? 'Arama hatası' })
      }
    } catch (err) {
      set({ searching: false, searchError: (err as Error).message })
    }
  },

  refreshLocal: async () => {
    const dir = get().dir
    if (!dir) return
    set({ loadingLocal: true })
    try {
      const res = await window.nexora.hf.listLocal(dir)
      if (res.ok && res.models) {
        set({ localModels: res.models, loadingLocal: false })
      } else {
        set({ loadingLocal: false })
      }
    } catch {
      set({ loadingLocal: false })
    }
  },

  deleteLocal: async (name: string) => {
    const dir = get().dir
    if (!dir) return { ok: false, error: 'dizin yok' }
    const res = await window.nexora.hf.deleteLocal(dir, name)
    if (res.ok) await get().refreshLocal()
    return res
  },

  changeDir: async () => {
    const res = await window.nexora.hf.selectDir()
    if (res.ok && res.dir) {
      try {
        localStorage.setItem(DIR_KEY, res.dir)
      } catch {
        /* ignore */
      }
      set({ dir: res.dir })
      await get().refreshLocal()
    }
  },

  download: async (repo: string, file: string) => {
    set((s) => ({
      downloads: {
        ...s.downloads,
        [file]: { repo, file, downloaded: 0, total: 0, status: 'downloading' }
      }
    }))
    try {
      const res = await window.nexora.hf.download({ repo, file, dir: get().dir })
      set((s) => ({
        downloads: {
          ...s.downloads,
          [file]: res.ok
            ? { ...s.downloads[file], status: 'done' }
            : { ...s.downloads[file], status: 'error', error: res.error }
        }
      }))
      if (res.ok) await get().refreshLocal()
    } catch (err) {
      set((s) => ({
        downloads: {
          ...s.downloads,
          [file]: { ...s.downloads[file], status: 'error', error: (err as Error).message }
        }
      }))
    }
  },

  cancel: async (file: string) => {
    await window.nexora.hf.cancel()
    set((s) => ({
      downloads: {
        ...s.downloads,
        [file]: { ...s.downloads[file], status: 'cancelled' }
      }
    }))
  }
}))
