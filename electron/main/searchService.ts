/**
 * 10.6 — Genel arama: oturumlar + projeler + bilgi tabanı + PROJE KODU tek yerden.
 *
 * Substring (grep-benzeri) eşleşme — içerik araması için doğru davranış (fuzzy
 * yalnız komut paletinde). Her kategori sınırlı sonuç döndürür; büyük/ikili
 * dosyalar atlanır. Salt-okur — hiçbir şeyi değiştirmez.
 */
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { listProjects, workspaceDir, scanProjectDir } from './agentService'
import { listKnowledge, readKnowledge } from './knowledgeService'
import { matches, snippetAround, MIN_QUERY } from '../shared/searchMatch'

const SESSIONS_DIR = join(homedir(), 'NexoraAI', 'Sessions')

export interface SearchResults {
  sessions: Array<{ id: string; title: string; snippet: string }>
  projects: Array<{ name: string; dir: string }>
  knowledge: Array<{ projectName: string; file: string; title: string; kind: string }>
  files: Array<{ projectName: string; path: string; line: number; snippet: string }>
}

const CAP = 8
const FILE_CAP = 12

async function searchSessions(q: string): Promise<SearchResults['sessions']> {
  const out: SearchResults['sessions'] = []
  let names: string[]
  try {
    names = (await readdir(SESSIONS_DIR)).filter((n) => n.endsWith('.json'))
  } catch {
    return out
  }
  for (const name of names) {
    if (out.length >= CAP) break
    try {
      const raw = await readFile(join(SESSIONS_DIR, name), 'utf8')
      const data = JSON.parse(raw) as { id: string; title: string; messages?: Array<{ content: string }> }
      const title = data.title || ''
      if (matches(title, q)) {
        out.push({ id: data.id, title, snippet: '' })
        continue
      }
      const hit = (data.messages || []).find((m) => typeof m.content === 'string' && matches(m.content, q))
      if (hit) out.push({ id: data.id, title, snippet: snippetAround(hit.content, q) })
    } catch {
      /* bozuk oturum dosyası — atla */
    }
  }
  return out
}

async function searchKnowledge(q: string, projects: Array<{ name: string }>): Promise<SearchResults['knowledge']> {
  const out: SearchResults['knowledge'] = []
  for (const p of projects) {
    if (out.length >= CAP) break
    let items: Awaited<ReturnType<typeof listKnowledge>>
    try {
      items = await listKnowledge(p.name)
    } catch {
      continue
    }
    for (const it of items) {
      if (out.length >= CAP) break
      if (matches(it.title, q)) {
        out.push({ projectName: p.name, file: it.file, title: it.title, kind: it.kind })
        continue
      }
      // başlık tutmadıysa gövdeye bak (yalnız birkaç madde için)
      try {
        const body = await readKnowledge(p.name, it.file)
        if (body && matches(body, q)) {
          out.push({ projectName: p.name, file: it.file, title: it.title, kind: it.kind })
        }
      } catch {
        /* atla */
      }
    }
  }
  return out
}

async function searchFiles(q: string, activeProject: string | undefined): Promise<SearchResults['files']> {
  const out: SearchResults['files'] = []
  if (!activeProject) return out
  let scan: Awaited<ReturnType<typeof scanProjectDir>>
  try {
    scan = await scanProjectDir(workspaceDir(activeProject))
  } catch {
    return out
  }
  for (const f of scan.files) {
    if (out.length >= FILE_CAP) break
    if (typeof f.content !== 'string' || f.content.length > 400_000) continue
    const lower = f.content.toLowerCase()
    const idx = lower.indexOf(q)
    if (idx < 0) continue
    const line = f.content.slice(0, idx).split('\n').length
    const lineText = f.content.split('\n')[line - 1] || ''
    out.push({ projectName: activeProject, path: f.path, line, snippet: snippetAround(lineText, q) })
  }
  return out
}

export async function globalSearch(query: string, activeProject?: string): Promise<SearchResults> {
  const q = query.trim().toLowerCase()
  const empty: SearchResults = { sessions: [], projects: [], knowledge: [], files: [] }
  if (q.length < MIN_QUERY) return empty

  let projects: Array<{ name: string; dir: string; linked: boolean; mtime: number }> = []
  try {
    projects = await listProjects()
  } catch {
    /* proje listesi alınamadı */
  }

  const [sessions, knowledge, files] = await Promise.all([
    searchSessions(q),
    searchKnowledge(q, projects),
    searchFiles(q, activeProject)
  ])

  return {
    sessions,
    projects: projects.filter((p) => matches(p.name, q)).slice(0, CAP).map((p) => ({ name: p.name, dir: p.dir })),
    knowledge,
    files
  }
}
