/**
 * 10.9 — Sağlayıcı API anahtarları: OS keychain'de (safeStorage) şifreli saklanır.
 *
 * Anahtarlar ASLA localStorage'a düz yazılmaz. safeStorage varsa OS keychain ile
 * şifrelenir; yoksa (bazı Linux ortamları) base64'e düşülür ve UI'de "şifreleme
 * yok" uyarısı verilir. Dosya: ~/NexoraAI/provider-keys.json (şifreli blob'lar).
 */
import { safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const KEYS_PATH = process.env.NEXORA_KEYS_PATH || join(homedir(), 'NexoraAI', 'provider-keys.json')

interface KeyStore {
  /** providerId → base64(şifreli veya düz). */
  keys: Record<string, string>
  /** safeStorage ile mi şifrelendi? */
  encrypted: boolean
}

async function readStore(): Promise<KeyStore> {
  try {
    const raw = await readFile(KEYS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as KeyStore
    return { keys: parsed.keys || {}, encrypted: parsed.encrypted === true }
  } catch {
    return { keys: {}, encrypted: false }
  }
}

async function writeStore(store: KeyStore): Promise<void> {
  await mkdir(dirname(KEYS_PATH), { recursive: true })
  await writeFile(KEYS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

function encAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function setProviderKey(providerId: string, key: string): Promise<{ ok: boolean; encrypted: boolean }> {
  const store = await readStore()
  const enc = encAvailable()
  const blob = enc ? safeStorage.encryptString(key).toString('base64') : Buffer.from(key, 'utf8').toString('base64')
  store.keys[providerId] = blob
  // Karışık şifreleme olmasın: tüm dosya tek moda ait (ilk yazımda belirlenir).
  store.encrypted = enc
  await writeStore(store)
  return { ok: true, encrypted: enc }
}

export async function getProviderKey(providerId: string): Promise<string | null> {
  const store = await readStore()
  const blob = store.keys[providerId]
  if (!blob) return null
  try {
    const buf = Buffer.from(blob, 'base64')
    return store.encrypted && encAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return null
  }
}

export async function deleteProviderKey(providerId: string): Promise<{ ok: boolean }> {
  const store = await readStore()
  delete store.keys[providerId]
  await writeStore(store)
  return { ok: true }
}

/** Anahtarı olan sağlayıcı id'leri (anahtarın kendisi ASLA dönmez). */
export async function listConfiguredProviders(): Promise<{ ids: string[]; encrypted: boolean }> {
  const store = await readStore()
  return { ids: Object.keys(store.keys), encrypted: store.encrypted }
}

export function encryptionAvailable(): boolean {
  return encAvailable()
}
