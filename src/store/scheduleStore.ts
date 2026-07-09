/**
 * 10.7 — Zamanlanmış görevler store'u (localStorage kalıcı, renderer-side cron).
 *
 * runDue(now, enqueue) her tick'te çağrılır: vadesi gelen etkin görevlerin
 * prompt'unu kuyruğa koyar ve nextRun'ı ileriye alır. Yalnız uygulama açıkken
 * çalışır (yerel-önce; gizli daemon yok).
 */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { makeScheduled, advanceAfterRun, dueTasks, type ScheduledTask } from '@/lib/schedule'

const KEY = 'nexora.scheduled'

function load(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((t: ScheduledTask) => t && typeof t.prompt === 'string' && typeof t.everyMinutes === 'number')
  } catch {
    return []
  }
}

interface ScheduleState {
  tasks: ScheduledTask[]
  add: (label: string, prompt: string, everyMinutes: number, jitterSec?: number) => void
  update: (id: string, patch: Partial<Pick<ScheduledTask, 'label' | 'prompt' | 'everyMinutes' | 'jitterSec' | 'enabled'>>) => void
  remove: (id: string) => void
  /** Vadesi gelenleri kuyruğa koy + ilerlet. Fırlatılan görev sayısını döndürür. */
  runDue: (now: number, enqueue: (prompt: string) => void) => number
}

function persist(tasks: ScheduledTask[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tasks))
  } catch {
    /* ignore */
  }
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  tasks: load(),
  add: (label, prompt, everyMinutes, jitterSec = 30) => {
    if (!prompt.trim()) return
    const t = makeScheduled(nanoid(), label, prompt, everyMinutes, Date.now(), jitterSec)
    const tasks = [...get().tasks, t]
    persist(tasks)
    set({ tasks })
  },
  update: (id, patch) => {
    const tasks = get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
    persist(tasks)
    set({ tasks })
  },
  remove: (id) => {
    const tasks = get().tasks.filter((t) => t.id !== id)
    persist(tasks)
    set({ tasks })
  },
  runDue: (now, enqueue) => {
    const due = dueTasks(get().tasks, now)
    if (due.length === 0) return 0
    const dueIds = new Set(due.map((d) => d.id))
    for (const t of due) enqueue(t.prompt)
    const tasks = get().tasks.map((t) => (dueIds.has(t.id) ? advanceAfterRun(t, now, Math.random()) : t))
    persist(tasks)
    set({ tasks })
    return due.length
  }
}))
