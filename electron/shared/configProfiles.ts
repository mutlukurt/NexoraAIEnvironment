/**
 * 15.2 — Config Profiles (Piebald yol haritası): oturum-başına seçilebilen bir
 * DAVRANIŞ demeti. Mimari profillerden (react-spa/next/electron — prompts.ts,
 * OTOMATİK saptanır) DİKGENDİR: bunlar kullanıcının SEÇTİĞİ çalışma kipidir.
 *
 * Bir profil = { güven seviyesi + engellenen direktifler + sistem-prompt eklentisi
 * + örnekleme + etkin MCP sunucuları }. Üç önyükleme geliyor; kullanıcı kopyalayıp
 * özelleştirebilir. Bu modül SAF — `npm run test:profiles` doğrudan koşar.
 */

import type { TrustTier } from './trust'

export interface ConfigProfile {
  id: string
  name: string
  description: string
  /** true → önyükleme (silinemez; düzenlenirse kopya olur). */
  builtin: boolean
  /** Capability ceiling. A profile may restrict, but never silently elevate,
   * the trust tier selected in global settings. */
  trustTier: TrustTier
  /** Engellenen direktif türleri (BÜYÜK harf: RUN/FETCH/MCP/BUILD/PKG/FONT/DEV/IMG/EDIT/ASSET). */
  blockedDirectives: string[]
  /** Sistem prompt'una eklenen kip yönergesi. */
  systemPromptAddition: string
  /** Örnekleme temeli (UI + yumuşak override — hassas fix/fidelity turları korunur). */
  sampling: { temperature: number; topP: number; maxTokens: number }
  /** Bu profilde etkin MCP sunucuları (isim); boş dizi = TÜMÜ etkin. */
  enabledMcps: string[]
}

/** Tüm engellenebilir direktif türleri (UI onay kutuları + doğrulama için). */
export const DIRECTIVE_KINDS = ['RUN', 'FETCH', 'MCP', 'BUILD', 'PKG', 'FONT', 'DEV', 'IMG', 'EDIT', 'ASSET'] as const

const IDEATION: ConfigProfile = {
  id: 'ideation',
  name: 'Ideation',
  description: 'Beyin fırtınası & planlama — kod yazmaz, komut koşmaz. Salt-okur güven, yaratıcı örnekleme.',
  builtin: true,
  trustTier: 'read',
  // Üretim/yan-etki direktiflerinin tümü kapalı — yalnız düşün, öner, ara.
  blockedDirectives: ['RUN', 'FETCH', 'MCP', 'BUILD', 'PKG', 'FONT', 'DEV', 'IMG', 'EDIT', 'ASSET'],
  systemPromptAddition:
    'MODE: IDEATION. Brainstorm, propose approaches, and plan — do NOT build the project, write project files, or run commands yet. Ask clarifying questions and outline options. The user will switch to a build profile when ready.',
  sampling: { temperature: 0.7, topP: 0.95, maxTokens: 8192 },
  enabledMcps: []
}

const CODING: ConfigProfile = {
  id: 'coding',
  name: 'Coding',
  description: 'Tam yetki — çok-dosya üretim, komutlar, MCP. Tam güven, hassas örnekleme.',
  builtin: true,
  trustTier: 'full',
  blockedDirectives: [],
  systemPromptAddition:
    'MODE: CODING. Full implementation is expected — write complete files, run the project toolchain, and verify. Prefer deterministic, well-structured code.',
  sampling: { temperature: 0.2, topP: 0.9, maxTokens: 8192 },
  enabledMcps: []
}

const FRONTEND: ConfigProfile = {
  id: 'frontend-build',
  name: 'Frontend build',
  description: 'UI/UX odaklı üretim — bileşenler, stil, erişilebilirlik. Ask-first güven.',
  builtin: true,
  trustTier: 'auto',
  // Ağ + MCP kapalı (saf ön-yüz); RUN otomatik-güvenli sınıfta koşar.
  blockedDirectives: ['FETCH', 'MCP'],
  systemPromptAddition:
    'MODE: FRONTEND BUILD. Focus on polished UI/UX: semantic markup, responsive layout, accessible components, and clean styling. Keep the visual design coherent and modern.',
  sampling: { temperature: 0.3, topP: 0.95, maxTokens: 8192 },
  enabledMcps: []
}

/** Üç önyükleme profili — kullanıcı kopyalayıp özelleştirebilir. */
export const PRESET_PROFILES: ConfigProfile[] = [IDEATION, CODING, FRONTEND]

/** Varsayılan aktif profil — tam yetkili "Coding" (mevcut davranışa en yakın). */
export const DEFAULT_CONFIG_PROFILE_ID = 'coding'

export function getProfileById(profiles: ConfigProfile[], id: string | null | undefined): ConfigProfile | null {
  if (!id) return null
  return profiles.find((p) => p.id === id) ?? null
}

/** Bir direktif türü bu profilde İZİNLİ mi (engellenenler listesinde değil mi). */
export function directiveAllowed(profile: ConfigProfile | null, kind: string): boolean {
  if (!profile) return true
  return !profile.blockedDirectives.includes(kind.toUpperCase())
}

/** Effective trust is the more restrictive of global and profile settings. */
export function effectiveTrustTier(profile: ConfigProfile | null, globalTier: TrustTier): TrustTier {
  if (!profile) return globalTier
  const rank: Record<TrustTier, number> = { read: 0, auto: 1, full: 2 }
  return rank[profile.trustTier] < rank[globalTier] ? profile.trustTier : globalTier
}

/** Bir MCP sunucusu bu profilde etkin mi (boş enabledMcps = hepsi). */
export function mcpAllowed(profile: ConfigProfile | null, server: string): boolean {
  if (!profile || profile.enabledMcps.length === 0) return true
  return profile.enabledMcps.includes(server)
}
