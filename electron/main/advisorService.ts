/**
 * Cihaz ölçümü — Donanım Danışmanı'nın veri kaynağı.
 * RAM/CPU Node'un os modülünden; GPU nvidia-smi'den (varsa) okunur.
 */
import { totalmem, freemem, cpus } from 'os'
import { execFile } from 'child_process'
import type { HardwareInfo } from '../shared/advisor'

function detectNvidia(): Promise<{ name: string; vramGb: number } | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null)
        const [name, mem] = stdout.trim().split('\n')[0].split(',').map((s) => s.trim())
        const vramGb = Number(mem) / 1024
        if (!name || !Number.isFinite(vramGb)) return resolve(null)
        resolve({ name, vramGb: Math.round(vramGb * 10) / 10 })
      }
    )
  })
}

/**
 * Kartta ŞU AN boş bellek (bayt). Co-residence kararı için (Faz 3): yazı modeli
 * zaten kartı doldurmuşsa bu değer düşer → ikincil iş (görsel) işlemciye yönlenir.
 * GPU yoksa / nvidia-smi başarısızsa 0 (çağıran taraf "kart yok gibi" davranır).
 */
export function detectFreeVramBytes(): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.free', '--format=csv,noheader,nounits'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(0)
        const freeMib = Number(stdout.trim().split('\n')[0].trim())
        resolve(Number.isFinite(freeMib) ? freeMib * 1024 * 1024 : 0)
      }
    )
  })
}

export async function detectHardware(): Promise<HardwareInfo> {
  const gpu = await detectNvidia()
  return {
    ramGb: Math.round((totalmem() / 1e9) * 10) / 10,
    freeRamGb: Math.round((freemem() / 1e9) * 10) / 10,
    cpuModel: cpus()[0]?.model?.trim() ?? 'Bilinmeyen CPU',
    cpuCores: cpus().length,
    gpu,
    platform: process.platform
  }
}

// ---------------------------------------------------------------------------
// Uzak model katalog manifesti (roadmap 4.4): Danışman kataloğu yeni uygulama
// sürümü çıkmadan güncellenebilsin. Uzak JSON alınır, doğrulanır, diske
// önbelleklenir ve gömülü katalogla BİRLEŞTİRİLİR (uzak yalnızca üzerine
// yazar/ekler — gömülü anahtarlar hep durur, buildPlan asla kırılmaz).
// Ulaşılamazsa: önbellek → yoksa gömülü katalog.
// ---------------------------------------------------------------------------
import { join } from 'path'
import { homedir } from 'os'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { buildPlan, EMBEDDED_CODERS, type AdvisorPlan } from '../shared/advisor'

const CATALOG_URL =
  'https://raw.githubusercontent.com/mutlukurt/NexoraAIEnvironment/main/model-catalog.json'
const CATALOG_CACHE = join(homedir(), 'NexoraAI', 'cache', 'model-catalog.json')

type CoderDef = (typeof EMBEDDED_CODERS)[string]

function isValidDef(d: unknown): d is CoderDef {
  const o = d as Record<string, unknown>
  return (
    !!o &&
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    typeof o.family === 'string' &&
    typeof o.repo === 'string' &&
    typeof o.file === 'string' &&
    typeof o.sizeGb === 'number' &&
    typeof o.quality === 'string'
  )
}

/** Uzak manifesti al + doğrula + önbelleğe yaz. Başarısızsa null. */
async function fetchRemoteCatalog(): Promise<Record<string, CoderDef> | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(CATALOG_URL, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = (await res.json()) as { coders?: Record<string, unknown> }
    const raw = json?.coders
    if (!raw || typeof raw !== 'object') return null
    const clean: Record<string, CoderDef> = {}
    for (const [k, v] of Object.entries(raw)) if (isValidDef(v)) clean[k] = v
    if (Object.keys(clean).length === 0) return null
    try {
      await mkdir(join(homedir(), 'NexoraAI', 'cache'), { recursive: true })
      await writeFile(CATALOG_CACHE, JSON.stringify({ coders: clean }), 'utf8')
    } catch {
      /* önbellek yazılamadıysa sorun değil */
    }
    return clean
  } catch {
    return null
  }
}

async function cachedCatalog(): Promise<Record<string, CoderDef> | null> {
  try {
    const json = JSON.parse(await readFile(CATALOG_CACHE, 'utf8')) as { coders?: Record<string, CoderDef> }
    return json?.coders ?? null
  } catch {
    return null
  }
}

/** Danışman planı: gömülü + (uzak ya da önbellek) katalog birleşimiyle. */
export async function getAdvisorPlan(allowNetwork = false): Promise<AdvisorPlan> {
  const hw = await detectHardware()
  const remote = (allowNetwork ? await fetchRemoteCatalog() : null) ?? (await cachedCatalog())
  const catalog = remote ? { ...EMBEDDED_CODERS, ...remote } : EMBEDDED_CODERS
  return buildPlan(hw, catalog)
}
