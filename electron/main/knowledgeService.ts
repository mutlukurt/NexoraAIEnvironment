/**
 * Proje bilgi tabanı (roadmap 7.8) — öğrenme çekirdek ilkedir.
 *
 * Antigravity Knowledge-Item ölçeği, NexoraAI disipliniyle: maddeler MODEL
 * damıtmasıyla değil, motorun zaten ürettiği sinyallerden DETERMİNİSTİK
 * doğar (kat0 onarım kalıpları, repro-doğrulanmış onarımlar, kullanıcının
 * inceleme yorumları). Her madde ~/NexoraAI/Projects/<slug>/knowledge/
 * altında görünür bir .md dosyasıdır: elle düzenlenir, silinir.
 *
 * Çift yönlü disiplin (6.7 önselleriyle aynı): tek karşı-kanıt maddeyi
 * emekli eder — repro-failed imzası eşleşen "doğrulanmış-onarım" düşer.
 *
 * Bilinçli olarak electron'suz saf modül — `npm run test:knowledge`
 * gerçek diskte doğrudan koşar.
 */
import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { KnowledgeItemMeta } from '../shared/ipc'

const MAX_ITEMS = 30
const KINDS: KnowledgeItemMeta['kind'][] = ['repair-pattern', 'verified-fix', 'user-preference', 'note']

function dirOf(projectName: string): string {
  const slug = projectName.replace(/[^\w.-]/g, '_')
  return join(homedir(), 'NexoraAI', 'Projects', slug, 'knowledge')
}

/** Deterministik kimlik: aynı bilgi aynı dosyaya düşer (dedupe temeli). */
function hashOf(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

interface ParsedItem extends KnowledgeItemMeta {
  body: string
  sig?: string
}

function serialize(i: ParsedItem): string {
  return [
    `<!-- kind: ${i.kind} | hits: ${i.hits} | updatedAt: ${i.updatedAt}${i.sig ? ` | sig: ${i.sig}` : ''} -->`,
    `# ${i.title}`,
    '',
    i.body.trim(),
    ''
  ].join('\n')
}

function parse(file: string, raw: string): ParsedItem | null {
  const meta = raw.match(
    /^<!--\s*kind:\s*([\w-]+)\s*\|\s*hits:\s*(\d+)\s*\|\s*updatedAt:\s*(\d+)(?:\s*\|\s*sig:\s*([^>]+?))?\s*-->/
  )
  const title = raw.match(/^#\s+(.+)$/m)?.[1]
  if (!meta || !title) return null
  const kind = (KINDS as string[]).includes(meta[1]) ? (meta[1] as KnowledgeItemMeta['kind']) : 'note'
  const body = raw.slice(raw.indexOf(title) + title.length).trim()
  return { file, kind, title, hits: Number(meta[2]) || 1, updatedAt: Number(meta[3]) || 0, sig: meta[4]?.trim(), body }
}

async function readAll(projectName: string): Promise<ParsedItem[]> {
  try {
    const dir = dirOf(projectName)
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.md'))
    const items: ParsedItem[] = []
    for (const n of names) {
      try {
        const p = parse(n, await fs.readFile(join(dir, n), 'utf8'))
        if (p) items.push(p)
      } catch {
        /* bozuk madde listeyi düşürmesin */
      }
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

/**
 * Deterministik öğrenme: aynı tür+başlık aynı maddeye düşer (hits artar,
 * tarih tazelenir — şişme yok); tavan aşılırsa EN AZ vurulan en eski düşer.
 */
export async function learnKnowledge(
  projectName: string,
  input: { kind: KnowledgeItemMeta['kind']; title: string; body: string; sig?: string }
): Promise<{ ok: boolean; file?: string; hits?: number }> {
  const title = input.title.trim().slice(0, 120)
  if (!title || !projectName) return { ok: false }
  const dir = dirOf(projectName)
  await fs.mkdir(dir, { recursive: true })
  const file = `ki-${hashOf(input.kind + '|' + title)}.md`
  const existing = parse(file, await fs.readFile(join(dir, file), 'utf8').catch(() => '')) ?? null
  const item: ParsedItem = {
    file,
    kind: input.kind,
    title,
    body: input.body.trim().slice(0, 1000) || title,
    sig: input.sig?.trim().slice(0, 200) || existing?.sig,
    hits: (existing?.hits ?? 0) + 1,
    updatedAt: Date.now()
  }
  await fs.writeFile(join(dir, file), serialize(item), 'utf8')
  // Tavan: en az güvenilen (hits), eşitlikte en eski madde düşer.
  const all = await readAll(projectName)
  if (all.length > MAX_ITEMS) {
    const victim = [...all].sort((a, b) => a.hits - b.hits || a.updatedAt - b.updatedAt)[0]
    if (victim && victim.file !== file) await fs.unlink(join(dir, victim.file)).catch(() => undefined)
  }
  return { ok: true, file, hits: item.hits }
}

/** Karşı-kanıt: imzası eşleşen maddeler emekli olur (tek kanıt yeter — 6.7). */
export async function retireKnowledgeBySig(projectName: string, sig: string): Promise<{ retired: number }> {
  const needle = sig.trim().slice(0, 200)
  if (!needle) return { retired: 0 }
  const all = await readAll(projectName)
  let retired = 0
  for (const item of all) {
    if (item.sig && (item.sig.includes(needle) || needle.includes(item.sig))) {
      await fs.unlink(join(dirOf(projectName), item.file)).catch(() => undefined)
      retired++
    }
  }
  return { retired }
}

export async function listKnowledge(projectName: string): Promise<KnowledgeItemMeta[]> {
  return (await readAll(projectName)).map(({ body: _b, sig: _s, ...meta }) => meta)
}

export async function readKnowledge(projectName: string, file: string): Promise<string | null> {
  if (!/^ki-[a-z0-9]+\.md$/.test(file)) return null
  try {
    return await fs.readFile(join(dirOf(projectName), file), 'utf8')
  } catch {
    return null
  }
}

export async function deleteKnowledge(projectName: string, file: string): Promise<{ ok: boolean }> {
  if (!/^ki-[a-z0-9]+\.md$/.test(file)) return { ok: false }
  await fs.unlink(join(dirOf(projectName), file)).catch(() => undefined)
  return { ok: true }
}

/**
 * Bağlam bloğu: gelecekteki turların başına iliştirilecek özet — bütçeli.
 * En güvenilir (hits) ve taze maddeler önce; başlık her zaman, gövdenin ilk
 * satırı bütçe elverdikçe. Boş projede boş string (tura hiçbir şey eklenmez).
 */
export async function knowledgeContext(projectName: string, budget = 1200): Promise<string> {
  const all = await readAll(projectName)
  if (all.length === 0) return ''
  const ranked = [...all].sort((a, b) => b.hits - a.hits || b.updatedAt - a.updatedAt)
  const lines: string[] = []
  let used = 0
  for (const item of ranked) {
    const head = `- [${item.kind}] ${item.title}${item.hits > 1 ? ` (×${item.hits})` : ''}`
    if (used + head.length > budget) {
      // En az bir madde garantisi: ilk başlık bütçeden uzunsa kırpılarak
      // girer — "bilgi var ama blok boş" durumu olamaz (test bulgusu).
      if (lines.length === 0) lines.push(head.slice(0, Math.max(20, budget - 1)) + '…')
      break
    }
    lines.push(head)
    used += head.length
    const body = item.body.split('\n')[0].slice(0, 160)
    if (body && body !== item.title && used + body.length + 4 < budget) {
      lines.push(`  ${body}`)
      used += body.length + 2
    }
  }
  return lines.join('\n')
}
