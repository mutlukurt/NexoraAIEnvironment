/**
 * 10.11.2 — Oturum türü + projeye göre gruplama (Sidebar'dan ayrı → test edilebilir).
 *
 * Sohbet oturumları ile proje-geliştirme oturumları AYRI görünür. Tür açık
 * değilse çıkarım: dosya üretilmişse 'project', yoksa 'chat' (eski oturumlar).
 */
export interface SessionLike {
  id: string
  title: string
  updatedAt: number
  fileCount: number
  kind?: 'chat' | 'project'
  projectName?: string
}

export function sessionKind(s: Pick<SessionLike, 'kind' | 'fileCount'>): 'chat' | 'project' {
  return s.kind ?? (s.fileCount > 0 ? 'project' : 'chat')
}

/** Oturumları sohbet / proje olarak ayır. */
export function splitSessions<T extends SessionLike>(sessions: T[]): { chats: T[]; projects: T[] } {
  return {
    chats: sessions.filter((s) => sessionKind(s) === 'chat'),
    projects: sessions.filter((s) => sessionKind(s) === 'project')
  }
}

/** Proje oturumlarını projelerine göre grupla (projectName → oturumlar). */
export function groupByProject<T extends SessionLike>(projectSessions: T[], fallback = 'proje'): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const s of projectSessions) {
    const key = s.projectName || s.title || fallback
    const arr = m.get(key) ?? []
    arr.push(s)
    m.set(key, arr)
  }
  return m
}
