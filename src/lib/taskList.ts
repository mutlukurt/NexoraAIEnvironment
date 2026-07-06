/**
 * Canlı görev listesi (roadmap 7.1) — saf çekirdek.
 *
 * Ajan çok adımlı bir işe girdiğinde (planlı üretim, çoklu-hata onarım
 * oturumu) sohbete tek bir görev kartı düşer ve adımlar çalıştıkça YERİNDE
 * güncellenir — kullanıcı motorun planın neresinde olduğunu görür.
 *
 * Bu modül yalnızca ChatMessage[] üzerinde saf dönüşümler yapar: store'a,
 * pencereye, yan etkiye dokunmaz — `npm run test:tasklist` doğrudan bunu
 * koşar. Store tarafındaki ince sarmalayıcılar appStore.ts'dedir.
 */
import type { ChatMessage, TaskStep } from '@shared/ipc'

/** Yeni bir görev kartı mesajı üretir (listeye eklemek çağıranın işi). */
export function makeTaskCard(id: string, title: string, steps: TaskStep[]): ChatMessage {
  return { id, role: 'assistant', content: '', tasks: { title, steps, active: true } }
}

/**
 * Tek adımı günceller. Bilinmeyen mesaj/indeks sessiz no-op — bir görev
 * kartı yarışta silinmişse (yeni oturum) güncelleme sohbeti bozamaz.
 */
export function patchTaskStep(
  messages: ChatMessage[],
  msgId: string,
  index: number,
  patch: Partial<TaskStep>
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== msgId || !m.tasks || index < 0 || index >= m.tasks.steps.length) return m
    return {
      ...m,
      tasks: {
        ...m.tasks,
        steps: m.tasks.steps.map((st, i) => (i === index ? { ...st, ...patch } : st))
      }
    }
  })
}

/**
 * Listeye yeni adımlar ekler (7.1: konuşma ortası eklemeler listeyi
 * SIFIRLAMAZ, tazeler). Bitmiş (active=false) karta ekleme yapılmaz.
 */
export function appendTaskSteps(messages: ChatMessage[], msgId: string, steps: TaskStep[]): ChatMessage[] {
  return messages.map((m) =>
    m.id === msgId && m.tasks && m.tasks.active
      ? { ...m, tasks: { ...m.tasks, steps: [...m.tasks.steps, ...steps] } }
      : m
  )
}

/**
 * Kartı kapatır: koşan adımlar dürüstçe 'failed' olur (yarıda kesildi),
 * bekleyenler bekler görünür (hiç başlamadılar). İsteğe bağlı bitiş notu
 * ("⏹ durduruldu") başlığın yanında gösterilir.
 */
export function finishTaskCard(messages: ChatMessage[], msgId: string, note?: string): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== msgId || !m.tasks) return m
    return {
      ...m,
      tasks: {
        ...m.tasks,
        active: false,
        note: note ?? m.tasks.note,
        steps: m.tasks.steps.map((st) =>
          st.status === 'running' ? { ...st, status: 'failed', detail: st.detail ?? 'yarıda kesildi' } : st
        )
      }
    }
  })
}

/** Oturum diskten yüklenirken bayat kartlar kapanır (streaming:false gibi). */
export function deactivateTaskCards(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.tasks?.active ? finishTaskCard([m], m.id)[0] : m))
}
