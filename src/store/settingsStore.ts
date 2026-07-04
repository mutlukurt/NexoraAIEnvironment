import { create } from 'zustand'
import { nanoid } from 'nanoid'

const SETTINGS_KEY = 'nexora.settings'

/** Kullanıcı tanımlı hızlı komut: tek tıkla giriş kutusuna dolan şablon. */
export interface CustomCommand {
  id: string
  label: string
  prompt: string
}

export interface Settings {
  customSystemPrompt: string
  enableGpu: boolean
  customCommands: CustomCommand[]
}

const DEFAULT_SETTINGS: Settings = {
  customSystemPrompt: '',
  enableGpu: false,
  customCommands: []
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      customSystemPrompt: parsed.customSystemPrompt ?? '',
      enableGpu: parsed.enableGpu ?? false,
      customCommands: Array.isArray(parsed.customCommands)
        ? parsed.customCommands.filter(
            (c: CustomCommand) => c && typeof c.label === 'string' && typeof c.prompt === 'string'
          )
        : []
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

interface SettingsState extends Settings {
  setCustomSystemPrompt: (v: string) => void
  setEnableGpu: (v: boolean) => void
  addCommand: () => void
  updateCommand: (id: string, patch: Partial<Pick<CustomCommand, 'label' | 'prompt'>>) => void
  removeCommand: (id: string) => void
  save: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),
  setCustomSystemPrompt: (v) => set({ customSystemPrompt: v }),
  setEnableGpu: (v) => set({ enableGpu: v }),
  addCommand: () =>
    set((s) => ({ customCommands: [...s.customCommands, { id: nanoid(), label: '', prompt: '' }] })),
  updateCommand: (id, patch) =>
    set((s) => ({
      customCommands: s.customCommands.map((c) => (c.id === id ? { ...c, ...patch } : c))
    })),
  removeCommand: (id) =>
    set((s) => ({ customCommands: s.customCommands.filter((c) => c.id !== id) })),
  save: () => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          customSystemPrompt: get().customSystemPrompt,
          enableGpu: get().enableGpu,
          // Boş satırlar (etiket ve prompt ikisi de boş) kaydedilmez.
          customCommands: get().customCommands.filter((c) => c.label.trim() || c.prompt.trim())
        })
      )
    } catch {
      /* ignore */
    }
  }
}))
