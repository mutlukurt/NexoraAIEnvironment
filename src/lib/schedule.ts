/**
 * 10.7 — Zamanlanmış/tekrarlayan yerel görevlerin saf mantığı (store'dan ayrı → test).
 *
 * YEREL-ÖNCE: gizli arka plan daemon'u YOK. Zamanlayıcı yalnız uygulama AÇIKKEN
 * çalışır (renderer tick'i); bir görev vadesi gelince prompt'u mevcut görev
 * kuyruğuna koyar (enqueueTask) ve motor boşalınca koşar. Jitter, birden çok
 * görevin aynı ana çakışmasını dağıtır.
 */
export interface ScheduledTask {
  id: string
  label: string
  prompt: string
  /** Tekrar aralığı (dakika). */
  everyMinutes: number
  /** Rastgele gecikme tavanı (sn) — çakışmayı dağıtır. */
  jitterSec: number
  enabled: boolean
  lastRunTs: number
  nextRunTs: number
  /** 19.3: bu görev kaç kez koştu — öz-sonlandırma sayacı (eski kayıtlarda yok → 0 varsay). */
  runCount?: number
  /** 19.3: bu kadar koşudan SONRA görev kendini emekli eder (0/undefined = sınırsız, sürekli). */
  maxRuns?: number
}

/** Bir sonraki koşu zamanı: now + aralık + [0, jitterSec) rastgele gecikme.
 *  jitterFraction dışarıdan verilir (app Math.random(), test sabit) → deterministik test. */
export function nextRunAfter(task: Pick<ScheduledTask, 'everyMinutes' | 'jitterSec'>, now: number, jitterFraction = 0): number {
  const base = Math.max(1, Math.round(task.everyMinutes)) * 60_000
  const jitter = Math.max(0, Math.floor(jitterFraction * Math.max(0, task.jitterSec) * 1000))
  return now + base + jitter
}

/** 19.3: görev harcandı mı — maxRuns'a ulaştıysa artık koşmaz (öz-sonlandırma). */
export function isSpent(task: ScheduledTask): boolean {
  return !!task.maxRuns && task.maxRuns > 0 && (task.runCount ?? 0) >= task.maxRuns
}

/** 19.3: harcanmış (öz-sonlanmış) görevleri listeden çıkar — status-conditional cleanup. */
export function pruneSpent(tasks: ScheduledTask[]): ScheduledTask[] {
  return tasks.filter((t) => !isSpent(t))
}

/** Görev şimdi koşmalı mı? (etkin + vakti gelmiş + HARCANMAMIŞ). */
export function isDue(task: ScheduledTask, now: number): boolean {
  return task.enabled && task.nextRunTs > 0 && now >= task.nextRunTs && !isSpent(task)
}

/** Vadesi gelen görevler (etkin + due). */
export function dueTasks(tasks: ScheduledTask[], now: number): ScheduledTask[] {
  return tasks.filter((t) => isDue(t, now))
}

/** Yeni görev: ilk koşu bir aralık SONRA (uygulama açılışında hemen patlamasın). */
export function makeScheduled(id: string, label: string, prompt: string, everyMinutes: number, now: number, jitterSec = 30, maxRuns = 0): ScheduledTask {
  const t = { everyMinutes, jitterSec }
  return {
    id,
    label: label.trim(),
    prompt: prompt.trim(),
    everyMinutes: Math.max(1, Math.round(everyMinutes)),
    jitterSec: Math.max(0, Math.round(jitterSec)),
    enabled: true,
    lastRunTs: 0,
    nextRunTs: nextRunAfter(t, now),
    runCount: 0,
    // 19.3: >0 ise N koşudan sonra öz-sonlanır (tek-atış = 1); 0 = sınırsız.
    maxRuns: maxRuns > 0 ? Math.round(maxRuns) : undefined
  }
}

/** Koştuktan sonra ilerlet: lastRun=now, nextRun ileriye (kaçan koşuları BİRİKTİRMEZ), runCount++. */
export function advanceAfterRun(task: ScheduledTask, now: number, jitterFraction = 0): ScheduledTask {
  return { ...task, lastRunTs: now, nextRunTs: nextRunAfter(task, now, jitterFraction), runCount: (task.runCount ?? 0) + 1 }
}
