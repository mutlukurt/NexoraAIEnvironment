/**
 * 10.9 — Sağlayıcı hub'ı orkestrasyonu: katalog + keychain + apiEngine + model çekme.
 *
 * activate(): seçilen sağlayıcının base URL/adapter'ını katalogdan, anahtarını
 * keychain'den alıp apiEngine'i kurar (hibrit off/fix/all + 9.5 escalation zaten
 * apiEngine üstünden çalışır). fetchModels(): sağlayıcının /models ucundan canlı
 * model listesi (hardcode gerekmez). YEREL VARSAYILAN korunur: seçim opt-in.
 */
import { findProvider } from '../shared/providers'
import { setApiConfig } from './apiEngine'
import { getProviderKey } from './providerKeysService'

export interface ActivateInput {
  providerId: string
  model: string
  mode: 'off' | 'fix' | 'all'
  /** custom/azure/bedrock gibi base URL'i kullanıcı giren sağlayıcılar için. */
  customBaseUrl?: string
}

export async function activateProvider(input: ActivateInput): Promise<{ ok: boolean; error?: string }> {
  const p = findProvider(input.providerId)
  if (!p) return { ok: false, error: 'sağlayıcı bulunamadı: ' + input.providerId }
  const baseUrl = (p.baseUrl || input.customBaseUrl || '').trim()
  if (!baseUrl && input.mode !== 'off') return { ok: false, error: 'base URL gerekli' }
  const apiKey = p.local ? '' : (await getProviderKey(input.providerId)) || ''
  setApiConfig({ baseUrl, apiKey, model: input.model, mode: input.mode, adapter: p.adapter })
  return { ok: true }
}

/** Sağlayıcının /models ucundan canlı model id listesi. */
export async function fetchProviderModels(
  providerId: string,
  customBaseUrl?: string
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const p = findProvider(providerId)
  if (!p) return { ok: false, models: [], error: 'sağlayıcı bulunamadı' }
  const base = (p.baseUrl || customBaseUrl || '').replace(/\/+$/, '')
  if (!base) return { ok: false, models: [], error: 'base URL yok' }
  const key = p.local ? '' : (await getProviderKey(providerId)) || ''
  const url = /\/v\d+/.test(base) || base.includes('/openai') ? `${base}/models` : `${base}/v1/models`
  try {
    const headers: Record<string, string> =
      p.adapter === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : key
          ? { authorization: `Bearer ${key}` }
          : {}
    const res = await fetch(url, { headers })
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` }
    const json = (await res.json()) as { data?: Array<{ id: string }> }
    const models = Array.isArray(json.data) ? json.data.map((m) => m.id).filter(Boolean) : []
    return { ok: true, models: models.sort() }
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message }
  }
}
