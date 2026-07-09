/**
 * 10.12.1 — Kalıcı proje bağlamı: ~/NexoraAI/Projects/<slug>/proje-gecmisi.md
 *
 * AMAÇ: model YEREL↔API geçince (ya da oturuma sonradan dönünce) yeni model KV
 * cache'i kaybeder — bağlam yeniden-enjekte edilebilir METİNDE yaşamalı. Bu
 * dosya, projenin ne olduğunu / mimarisini / kararlarını / son değişikliklerini
 * tutan İNSAN-OKUR bir .md'dir; her tur bütçeli olarak prompt'a girer → hangi
 * model olursa olsun "kaldığı yeri" anlar.
 *
 * YEREL-ÖNCE + UCUZ: yazımlar DETERMİNİSTİK (motorun zaten ürettiği sinyallerden;
 * model çağrısı YOK). Bölümler tavanlı → dosya şişmez (compaction = deterministik
 * kırpma, GPU'da özet turu gerektirmez). knowledgeService.ts ile aynı disiplin;
 * electron'suz saf modül → `npm run test:history` gerçek diskte koşar.
 */
import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'

const MAX_CHANGES = 20
const MAX_DECISIONS = 15

// Sabit şema (Türkçe başlıklar) — sıra korunur.
const SECTIONS = ['Amaç', 'Teknoloji Yığını', 'Mimari', 'Özellikler', 'Kararlar', 'Son Değişiklikler', 'Bilinen Sorunlar / Sonraki Adımlar'] as const
type Section = (typeof SECTIONS)[number]

function slugOf(projectName: string): string {
  return projectName.replace(/[^\w.-]/g, '_')
}
function fileOf(projectName: string): string {
  return join(homedir(), 'NexoraAI', 'Projects', slugOf(projectName), 'proje-gecmisi.md')
}
// Test override: NEXORA_HISTORY_DIR verilirse oraya yazar.
function pathFor(projectName: string): string {
  const base = process.env.NEXORA_HISTORY_DIR
  return base ? join(base, slugOf(projectName) + '.md') : fileOf(projectName)
}

export interface HistoryDoc {
  projectName: string
  updatedAt: number
  lastModel: string
  sections: Record<Section, string[]>
}

function emptyDoc(projectName: string): HistoryDoc {
  const sections = {} as Record<Section, string[]>
  for (const s of SECTIONS) sections[s] = []
  return { projectName, updatedAt: 0, lastModel: '', sections }
}

// ── Parse / serialize ───────────────────────────────────────────────────────

export function parseHistory(md: string, projectName: string): HistoryDoc {
  const doc = emptyDoc(projectName)
  if (!md) return doc
  const meta = md.match(/updatedAt:\s*(\d+)/)
  if (meta) doc.updatedAt = Number(meta[1])
  const model = md.match(/model:\s*(.+?)\s*-->/)
  if (model) doc.lastModel = model[1].trim() === '-' ? '' : model[1].trim()
  // Bölümlere böl: "## Başlık" satırları
  const parts = md.split(/^##\s+/m)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    if (nl < 0) continue
    const header = part.slice(0, nl).trim()
    const match = SECTIONS.find((s) => header === s)
    if (!match) continue
    const body = part
      .slice(nl + 1)
      .split('\n')
      .map((l) => l.replace(/^-\s?/, '').trimEnd())
      .filter((l) => l.trim())
    doc.sections[match] = body
  }
  return doc
}

export function serializeHistory(doc: HistoryDoc): string {
  const lines: string[] = []
  lines.push(`<!-- nexora-proje-gecmisi v1 | updatedAt: ${doc.updatedAt} | model: ${doc.lastModel || '-'} -->`)
  lines.push(`# Proje Geçmişi: ${doc.projectName}`)
  for (const s of SECTIONS) {
    lines.push('')
    lines.push(`## ${s}`)
    const body = doc.sections[s]
    if (body.length === 0) lines.push('-')
    else for (const b of body) lines.push(`- ${b}`)
  }
  return lines.join('\n') + '\n'
}

async function read(projectName: string): Promise<HistoryDoc> {
  try {
    const raw = await fs.readFile(pathFor(projectName), 'utf8')
    return parseHistory(raw, projectName)
  } catch {
    return emptyDoc(projectName)
  }
}

async function write(doc: HistoryDoc): Promise<void> {
  doc.updatedAt = Date.now()
  const p = pathFor(doc.projectName)
  await fs.mkdir(join(p, '..'), { recursive: true })
  await fs.writeFile(p, serializeHistory(doc), 'utf8')
}

// ── Deterministik yazımlar (model çağrısı YOK) ──────────────────────────────

/** Son Değişiklikler'e (en yeni üste) bir satır ekle; tavanda en eski düşer. */
export async function recordChange(projectName: string, text: string, model?: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  const doc = await read(projectName)
  if (model) doc.lastModel = model
  const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')
  const line = `${stamp} · ${t}`.slice(0, 200)
  // Aynı satırı tekrar ekleme (ardışık dedupe).
  if (doc.sections['Son Değişiklikler'][0]?.slice(14) === t.slice(0, 186)) return
  doc.sections['Son Değişiklikler'].unshift(line)
  doc.sections['Son Değişiklikler'] = doc.sections['Son Değişiklikler'].slice(0, MAX_CHANGES)
  await write(doc)
}

/** Kararlar'a (en yeni üste) bir mimari/tasarım kararı ekle. */
export async function recordDecision(projectName: string, text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  const doc = await read(projectName)
  if (doc.sections['Kararlar'].includes(t)) return
  doc.sections['Kararlar'].unshift(t.slice(0, 200))
  doc.sections['Kararlar'] = doc.sections['Kararlar'].slice(0, MAX_DECISIONS)
  await write(doc)
}

/** İlk build: Amaç/Teknoloji/Mimari yalnız BOŞSA doldurulur (üzerine yazmaz). */
export async function seedOverview(
  projectName: string,
  seed: { purpose?: string; techStack?: string[]; architecture?: string[] }
): Promise<void> {
  const doc = await read(projectName)
  let changed = false
  if (seed.purpose && doc.sections['Amaç'].length === 0) {
    doc.sections['Amaç'] = [seed.purpose.trim().slice(0, 400)]
    changed = true
  }
  if (seed.techStack && seed.techStack.length && doc.sections['Teknoloji Yığını'].length === 0) {
    doc.sections['Teknoloji Yığını'] = seed.techStack.slice(0, 12)
    changed = true
  }
  if (seed.architecture && seed.architecture.length && doc.sections['Mimari'].length === 0) {
    doc.sections['Mimari'] = seed.architecture.slice(0, 20)
    changed = true
  }
  if (changed) await write(doc)
}

/** Model geçişi izi (yerel↔API) — sonraki model "devraldığını" görür. */
export async function recordModelSwitch(projectName: string, toModel: string): Promise<void> {
  await recordChange(projectName, `🔀 modele geçildi: ${toModel} (bağlam bu dosyadan devralındı)`, toModel)
}

// ── Bütçeli enjeksiyon (her tur, comment-stripped, ASLA boş-sızmaz) ─────────

/**
 * Prompt'a gömülecek metin. Bölümler öncelik sırasıyla eklenir; bütçe dolunca
 * Son Değişiklikler kuyruğu KIRPILIR ama Bilinen Sorunlar/Sonraki Adımlar ASLA
 * atılmaz (kritik bağlam). Comment satırları çıkarılır.
 */
export async function historyContext(projectName: string, budget = 1500): Promise<string> {
  const doc = await read(projectName)
  const has = SECTIONS.some((s) => doc.sections[s].length > 0)
  if (!has) return ''
  const out: string[] = []
  let used = 0
  const push = (label: string, items: string[], limit?: number) => {
    const take = limit ? items.slice(0, limit) : items
    if (take.length === 0) return
    const block = [`## ${label}`, ...take.map((i) => `- ${i}`)]
    const cost = block.join('\n').length
    if (used + cost > budget && out.length > 0) return
    out.push(...block)
    used += cost
  }
  // Öncelik: kim-neyi (Amaç/Teknoloji/Mimari), kararlar, sorunlar KORUNUR;
  // son değişiklikler en son ve kuyruğu kırpılabilir.
  push('Amaç', doc.sections['Amaç'])
  push('Teknoloji', doc.sections['Teknoloji Yığını'], 10)
  push('Mimari', doc.sections['Mimari'], 14)
  push('Özellikler', doc.sections['Özellikler'], 12)
  push('Kararlar', doc.sections['Kararlar'], 8)
  // Sorunlar/Sonraki Adımlar: ASLA atlanmaz (bütçe dolsa bile zorla ekle).
  const issues = doc.sections['Bilinen Sorunlar / Sonraki Adımlar']
  if (issues.length) {
    out.push('## Sorunlar / Sonraki', ...issues.slice(0, 8).map((i) => `- ${i}`))
  }
  // Son değişiklikler: kalan bütçeye göre kuyruk kırpılır (en az 3 garanti).
  const changes = doc.sections['Son Değişiklikler']
  if (changes.length) {
    const remaining = Math.max(0, budget - used)
    const picked: string[] = []
    let c = 0
    for (const ch of changes) {
      if (c + ch.length > remaining && picked.length >= 3) break
      picked.push(ch)
      c += ch.length
    }
    out.push('## Son Değişiklikler', ...picked.map((i) => `- ${i}`))
  }
  return out.join('\n')
}

// ── UI erişimi ──────────────────────────────────────────────────────────────

export async function getHistoryRaw(projectName: string): Promise<{ path: string; content: string }> {
  const p = pathFor(projectName)
  try {
    return { path: p, content: await fs.readFile(p, 'utf8') }
  } catch {
    return { path: p, content: '' }
  }
}

export async function setHistoryRaw(projectName: string, content: string): Promise<{ ok: boolean }> {
  const doc = parseHistory(content, projectName)
  await write(doc)
  return { ok: true }
}
