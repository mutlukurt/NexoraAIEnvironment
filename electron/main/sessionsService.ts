/**
 * Kalıcı oturumlar — sohbet + proje dosyaları diskte yaşar.
 *
 * Her oturum ~/NexoraAI/Sessions/<id>.json dosyasıdır (models/Projects
 * geleneğiyle aynı kökte: görünür, yedeklenebilir, senkronlanabilir).
 * Liste istendiğinde dosyalar okunup yalnızca meta döndürülür; içerik
 * (mesajlar + dosyalar) sadece yükleme sırasında renderer'a gider.
 *
 * Not: model bağlamı (llama worker) diske yazılMAZ — eski oturum açılınca
 * taze bağlam kurulur; iterasyonlar zaten güncel dosyalarla çalışır.
 */
import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { SessionData, SessionMeta } from '../shared/ipc'

const SESSIONS_DIR = join(homedir(), 'NexoraAI', 'Sessions')

async function ensureDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true })
}

function fileOf(id: string): string {
  // id nanoid'dir; yine de yol ayracı vb. sızmasın.
  return join(SESSIONS_DIR, id.replace(/[^\w-]/g, '_') + '.json')
}

function toMeta(d: SessionData): SessionMeta {
  return {
    id: d.id,
    title: d.title,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    msgCount: d.msgCount,
    fileCount: d.fileCount,
    // 10.11.2: türü taşı; eski oturumlarda çıkarım (dosya varsa proje, yoksa sohbet).
    kind: d.kind ?? (d.fileCount > 0 ? 'project' : 'chat'),
    projectName: d.projectName,
    // 15.3: son-bilinen durum rozetini listeye taşı — pasif oturum kartı için (yoksa
    // kenar çubuğu rozeti asla görünmezdi: canlı test bulgusu).
    statusBadge: d.statusBadge,
    // 20.1: dal kökenini listeye taşı — sidebar "🌿 <ebeveyn>" rozeti diskteki metadan.
    branchedFrom: d.branchedFrom
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  await ensureDir()
  const names = (await fs.readdir(SESSIONS_DIR)).filter((n) => n.endsWith('.json'))
  const metas: SessionMeta[] = []
  for (const name of names) {
    try {
      const raw = await fs.readFile(join(SESSIONS_DIR, name), 'utf8')
      metas.push(toMeta(JSON.parse(raw) as SessionData))
    } catch {
      // Bozuk dosya listeyi düşürmesin.
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveSession(data: SessionData): Promise<void> {
  await ensureDir()
  const tmp = fileOf(data.id) + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
  await fs.rename(tmp, fileOf(data.id))
}

export async function loadSession(id: string): Promise<SessionData | null> {
  try {
    const raw = await fs.readFile(fileOf(id), 'utf8')
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await fs.unlink(fileOf(id))
  } catch {
    // yoksa sorun değil
  }
}
