import { create } from 'zustand'

const SETTINGS_KEY = 'nexora.settings'

export interface Settings {
  customSystemPrompt: string
  enableGpu: boolean
}

const DEFAULT_SETTINGS: Settings = {
  customSystemPrompt: '',
  enableGpu: false
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      customSystemPrompt: parsed.customSystemPrompt ?? '',
      enableGpu: parsed.enableGpu ?? false
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

interface SettingsState extends Settings {
  setCustomSystemPrompt: (v: string) => void
  setEnableGpu: (v: boolean) => void
  save: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),
  setCustomSystemPrompt: (v) => set({ customSystemPrompt: v }),
  setEnableGpu: (v) => set({ enableGpu: v }),
  save: () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        customSystemPrompt: get().customSystemPrompt,
        enableGpu: get().enableGpu
      }))
    } catch {
      /* ignore */
    }
  }
}))
