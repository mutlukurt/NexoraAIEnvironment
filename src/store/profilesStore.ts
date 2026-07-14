/**
 * 15.2 — Config profil deposu (renderer). Önyükleme profilleri + kullanıcı profilleri
 * localStorage'da; aktif profil oturum-üstü seçimdir (SessionData.activeProfileId per-session
 * override'ı da appStore'da okunur). appStore bu depoyu hook-dışı okur:
 * `useProfilesStore.getState().getActive()`.
 */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  PRESET_PROFILES,
  DEFAULT_CONFIG_PROFILE_ID,
  getProfileById,
  type ConfigProfile
} from '@shared/configProfiles'

const PROFILES_KEY = 'nexora.configProfiles'
const ACTIVE_KEY = 'nexora.activeProfile'

function loadProfiles(): ConfigProfile[] {
  let stored: ConfigProfile[] = []
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (raw) stored = JSON.parse(raw) as ConfigProfile[]
  } catch {
    /* bozuksa önyüklemelere düş */
  }
  if (!Array.isArray(stored) || stored.length === 0) return PRESET_PROFILES.map((p) => ({ ...p }))
  // Kodda eklenen yeni önyükleme profilleri her zaman görünsün.
  const ids = new Set(stored.map((p) => p.id))
  const missing = PRESET_PROFILES.filter((p) => !ids.has(p.id)).map((p) => ({ ...p }))
  return [...missing, ...stored]
}

function loadActiveId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || DEFAULT_CONFIG_PROFILE_ID
  } catch {
    return DEFAULT_CONFIG_PROFILE_ID
  }
}

function persist(profiles: ConfigProfile[], activeId: string): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
    localStorage.setItem(ACTIVE_KEY, activeId)
  } catch {
    /* kota dolu — sessiz */
  }
}

interface ProfilesState {
  profiles: ConfigProfile[]
  activeProfileId: string
  /** Aktif profili çöz (bilinmeyen id → null → tüm kısıtlar kapalı, güvenli varsayılan). */
  getActive: () => ConfigProfile | null
  setActive: (id: string) => void
  /** Ekle ya da (id eşleşiyorsa) güncelle. */
  upsertProfile: (p: ConfigProfile) => void
  /** Boş bir kopya ile yeni profil oluştur (kaynaktan türet). */
  createFrom: (sourceId: string, name: string) => string
  deleteProfile: (id: string) => void
}

export const useProfilesStore = create<ProfilesState>((set, get) => ({
  profiles: loadProfiles(),
  activeProfileId: loadActiveId(),

  getActive: () => getProfileById(get().profiles, get().activeProfileId),

  setActive: (id) => {
    set({ activeProfileId: id })
    persist(get().profiles, id)
  },

  upsertProfile: (p) => {
    set((s) => {
      const exists = s.profiles.some((x) => x.id === p.id)
      const profiles = exists ? s.profiles.map((x) => (x.id === p.id ? p : x)) : [...s.profiles, p]
      persist(profiles, s.activeProfileId)
      return { profiles }
    })
  },

  createFrom: (sourceId, name) => {
    const src = getProfileById(get().profiles, sourceId) ?? PRESET_PROFILES[1]
    const id = 'custom-' + nanoid(6)
    const copy: ConfigProfile = { ...src, id, name: name.trim() || `${src.name} kopyası`, builtin: false }
    get().upsertProfile(copy)
    return id
  },

  deleteProfile: (id) => {
    set((s) => {
      const target = s.profiles.find((x) => x.id === id)
      if (!target || target.builtin) return s // önyükleme silinemez
      const profiles = s.profiles.filter((x) => x.id !== id)
      const activeProfileId = s.activeProfileId === id ? DEFAULT_CONFIG_PROFILE_ID : s.activeProfileId
      persist(profiles, activeProfileId)
      return { profiles, activeProfileId }
    })
  }
}))
