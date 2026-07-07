/**
 * Görev kuyruğu (roadmap 7.7) — saf çekirdek: delege et → sırayla işle → incele.
 *
 * 16 GB gerçeği: tek yerel model, SAHTE paralellik yok — görevler kuyrukta
 * bekler, teker teker koşar. Codex tab-to-queue paritesi: tur koşarken
 * yazılan istek koşan turu KESMEZ, kuyruğa girer. Biten iş gelen kutusuna
 * durumuyla düşer: verified (doğrulama yeşil) / needs-review (bakılmalı).
 *
 * Bu modül liste üzerinde saf geçişlerdir — `npm run test:queue` doğrudan
 * koşar. Store köprüsü appStore'dadır (sendMessage'a tek yönlü bağ).
 */

import type { QueuedTask } from '@shared/ipc'
export type { QueuedTask }

/** Uçtan uca durum makinesi: hangi geçiş nereden yapılabilir. */
const LEGAL: Record<QueuedTask['state'], Array<QueuedTask['state']>> = {
  queued: ['running', 'cancelled'],
  running: ['verified', 'needs-review', 'failed'],
  verified: [],
  'needs-review': [],
  failed: [],
  cancelled: []
}

export function makeTask(id: string, prompt: string, now: number): QueuedTask {
  const title = prompt.trim().split('\n')[0].slice(0, 60)
  return { id, prompt: prompt.trim(), title, state: 'queued', createdAt: now }
}

/** Sıradaki işlenecek görev — FIFO; koşan varken YENİSİ başlatılmaz. */
export function nextRunnable(tasks: QueuedTask[]): QueuedTask | null {
  if (tasks.some((t) => t.state === 'running')) return null
  return tasks.find((t) => t.state === 'queued') ?? null
}

/**
 * Durum geçişi — yasadışı geçiş SESSİZ no-op (yarışta çifte-bitirme,
 * iptal-sonrası-başlatma gibi durumlar kuyruğu asla bozamaz).
 */
export function transition(
  tasks: QueuedTask[],
  id: string,
  to: QueuedTask['state'],
  now: number,
  summary?: string
): QueuedTask[] {
  return tasks.map((t) => {
    if (t.id !== id || !LEGAL[t.state].includes(to)) return t
    return {
      ...t,
      state: to,
      startedAt: to === 'running' ? now : t.startedAt,
      finishedAt: to !== 'running' ? now : t.finishedAt,
      summary: summary ?? t.summary
    }
  })
}

/** Bitmiş (terminal durumdaki) görevleri temizle — koşan/sıradaki yaşar. */
export function clearFinished(tasks: QueuedTask[]): QueuedTask[] {
  return tasks.filter((t) => t.state === 'queued' || t.state === 'running')
}

/** Gelen kutusu rozeti: dikkat isteyen iş sayısı (bekleyen + incelenecek). */
export function inboxBadge(tasks: QueuedTask[]): number {
  return tasks.filter((t) => t.state === 'queued' || t.state === 'running' || t.state === 'needs-review').length
}

/** Oturum diskten yüklenirken yarıda kalmış koşu dürüstçe kapanır. */
export function deactivateTasks(tasks: QueuedTask[], now: number): QueuedTask[] {
  return tasks.map((t) =>
    t.state === 'running'
      ? { ...t, state: 'needs-review' as const, finishedAt: now, summary: t.summary ?? 'oturum yeniden açıldı — koşu yarıda kalmıştı' }
      : t
  )
}
