/**
 * 10.4 — Checkpoint listesi için saf yardımcılar (appStore'dan ayrı → test edilebilir).
 *
 * Checkpoint = bir görünür kullanıcı prompt'undan HEMEN ÖNCEki durum: kod
 * dosyaları (path→içerik) + sohbet konumu (messageIndex). Geri sarma bu duruma
 * döndürür; o checkpoint'ten SONRAKİLER geçersiz olur.
 */
import type { CheckpointEntry } from '@shared/ipc'

export const CHECKPOINT_CAP = 20

/** Yeni checkpoint'i ekler; en yeni CAP tanesi tutulur (oturum dosyası şişmesin). */
export function pushCheckpoint(list: CheckpointEntry[], cp: CheckpointEntry, cap = CHECKPOINT_CAP): CheckpointEntry[] {
  return [...list, cp].slice(-cap)
}

/** Verilen ts'ten SONRAKİ checkpoint'leri düşürür (geri sarınca gelecek geçersiz). */
export function dropAfter(list: CheckpointEntry[], ts: number): CheckpointEntry[] {
  return list.filter((c) => c.ts <= ts)
}

/** Sohbeti checkpoint konumuna kırpar (prompt ve sonrası gider). */
export function truncateMessages<T>(messages: T[], messageIndex: number): T[] {
  return messages.slice(0, Math.max(0, messageIndex))
}

/** Dosya kaydını checkpoint biçimine dönüştürür (dile-duyarlı meta korunur). */
export function snapshotFiles(
  files: Record<string, { path: string; content: string; language: string }>
): CheckpointEntry['files'] {
  return Object.fromEntries(
    Object.entries(files).map(([p, f]) => [p, { path: f.path, content: f.content, language: f.language }])
  )
}
