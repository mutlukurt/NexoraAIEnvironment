/**
 * 10.9 — Sağlayıcı API anahtarları: OS keychain'de (safeStorage) şifreli saklanır.
 *
 * Anahtarlar ASLA localStorage'a veya base64 "fallback" depoya düz yazılmaz.
 * OS safeStorage kullanılamıyorsa kayıt açıkça reddedilir.
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

export async function setProviderKey(providerId: string, key: string): Promise<{ ok: boolean; encrypted: boolean; error?: string }> {
  const store = await readStore()
  const enc = encAvailable()
  if (!enc) return { ok: false, encrypted: false, error: 'OS secure storage is unavailable; the credential was not saved.' }
  const blob = safeStorage.encryptString(key).toString('base64')
  store.keys[providerId] = blob
  // Karışık şifreleme olmasın: tüm dosya tek moda ait (ilk yazımda belirlenir).
  store.encrypted = enc
  await writeStore(store)
  return { ok: true, encrypted: enc }
}

export async function getProviderKey(providerId: string): Promise<string | null> {
  const store = await readStore()
  if (!store.encrypted || !encAvailable()) return null
  const blob = store.keys[providerId]
  if (!blob) return null
  try {
    const buf = Buffer.from(blob, 'base64')
    return safeStorage.decryptString(buf)
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
  const secure = store.encrypted && encAvailable()
  return { ids: secure ? Object.keys(store.keys) : [], encrypted: secure }
}

export function encryptionAvailable(): boolean {
  return encAvailable()
}
