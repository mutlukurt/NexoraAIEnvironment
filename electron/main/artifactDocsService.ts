/**
 * Artifact belgeleri (roadmap 7.2) — kanıt sohbet balonu değil, BELGEDİR.
 *
 * Her oturumun yanında görünür bir klasör: ~/NexoraAI/Sessions/<id>.artifacts/
 *   implementation_plan.md — onaylanan plan (üretimden önce)
 *   task.md                — görev listesi (7.1 kartının kalıcı hali)
 *   walkthrough.md         — iş bitince: ne değişti, nasıl test edilir, kanıt
 *
 * Sürümleme (Antigravity'nin .resolved.N deseni): aynı ada yeni içerik
 * yazılırken eski içerik <ad>.resolved.N olarak kenara alınır — plan nasıl
 * evrildi görülebilir, hiçbir sürüm kaybolmaz. Aynı bayt yeniden yazılmaz.
 */
import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { ArtifactDocMeta } from '../shared/ipc'

const SESSIONS_DIR = join(homedir(), 'NexoraAI', 'Sessions')

/** Yazılabilir belge adları — IPC'den gelen ad diske yol olarak sızamaz. */
const DOC_NAMES = ['implementation_plan.md', 'task.md', 'walkthrough.md'] as const
export type ArtifactDocName = (typeof DOC_NAMES)[number]

function dirOf(sessionId: string): string {
  return join(SESSIONS_DIR, sessionId.replace(/[^\w-]/g, '_') + '.artifacts')
}

function isDocName(name: string): name is ArtifactDocName {
  return (DOC_NAMES as readonly string[]).includes(name)
}

export async function saveArtifactDoc(
  sessionId: string,
  name: string,
  content: string
): Promise<{ ok: boolean; version?: number; error?: string }> {
  if (!sessionId || !isDocName(name)) return { ok: false, error: 'geçersiz belge adı' }
  const dir = dirOf(sessionId)
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, name)
  let version = 0
  try {
    const existing = await fs.readFile(file, 'utf8')
    if (existing === content) return { ok: true, version: 0 } // aynı bayt: sürüm şişirme yok
    // Eski içerik kenara: bir sonraki boş .resolved.N
    const taken = (await fs.readdir(dir)).filter((n) => n.startsWith(name + '.resolved.'))
    version = taken.length
    await fs.writeFile(join(dir, `${name}.resolved.${version}`), existing, 'utf8')
    version += 1
  } catch {
    /* ilk yazım */
  }
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, file)
  return { ok: true, version }
}

export async function listArtifactDocs(sessionId: string): Promise<ArtifactDocMeta[]> {
  if (!sessionId) return []
  try {
    const dir = dirOf(sessionId)
    const names = await fs.readdir(dir)
    const metas: ArtifactDocMeta[] = []
    for (const n of names) {
      if (!isDocName(n)) continue
      const st = await fs.stat(join(dir, n))
      metas.push({
        name: n,
        updatedAt: st.mtimeMs,
        versions: names.filter((x) => x.startsWith(n + '.resolved.')).length,
        sizeBytes: st.size
      })
    }
    // Okuma sırası sabit: plan → görevler → walkthrough
    const order = (x: string): number => DOC_NAMES.indexOf(x as ArtifactDocName)
    return metas.sort((a, b) => order(a.name) - order(b.name))
  } catch {
    return []
  }
}

export async function readArtifactDoc(
  sessionId: string,
  name: string,
  version?: number
): Promise<string | null> {
  if (!sessionId || !isDocName(name)) return null
  try {
    const file =
      version != null
        ? join(dirOf(sessionId), `${name}.resolved.${version}`)
        : join(dirOf(sessionId), name)
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}
