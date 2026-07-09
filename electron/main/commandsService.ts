/**
 * 10.8 — Slash-komut iş akışları: ~/NexoraAI/commands/<ad>.md dosyalarını okur.
 *
 * Her .md bir /komut olur. İsteğe bağlı frontmatter `description:`; gövde şablon.
 * `$ARGUMENTS` yer tutucusu çağrıdaki argümanlarla değişir. Dizin boşsa iki
 * örnek komut tohumlanır (kullanıcı deseni görsün). Salt-okur listeleme.
 */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const COMMANDS_DIR = process.env.NEXORA_COMMANDS_DIR || join(homedir(), 'NexoraAI', 'commands')

export interface SlashCommandFile {
  name: string
  description: string
  body: string
}

const SEEDS: Record<string, string> = {
  'refactor.md': `---
description: Seçili dosyayı/isteği daha temiz hâle getir
---
Aşağıdaki kodu daha okunur ve bakımı kolay hâle getir. Davranışı DEĞİŞTİRME, yalnız yapıyı iyileştir. Değişiklikleri kısaca açıkla.

$ARGUMENTS`,
  'explain.md': `---
description: Bir dosyayı/kavramı adım adım açıkla
---
Şunu yeni başlayan birine anlatır gibi, adım adım ve örnekle açıkla:

$ARGUMENTS`
}

async function ensureSeeded(): Promise<void> {
  try {
    await mkdir(COMMANDS_DIR, { recursive: true })
    const existing = (await readdir(COMMANDS_DIR)).filter((n) => n.endsWith('.md'))
    if (existing.length > 0) return
    for (const [name, body] of Object.entries(SEEDS)) {
      await writeFile(join(COMMANDS_DIR, name), body, 'utf8')
    }
  } catch {
    /* tohumlama başarısızsa sorun değil — boş liste döner */
  }
}

function parseCommand(fileName: string, raw: string): SlashCommandFile {
  const name = fileName.replace(/\.md$/i, '')
  let description = ''
  let body = raw
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (fm) {
    const desc = fm[1].match(/description:\s*(.+)/i)
    if (desc) description = desc[1].trim()
    body = fm[2]
  }
  if (!description) {
    const firstLine = body.split('\n').find((l) => l.trim())
    description = (firstLine || '').replace(/^#+\s*/, '').slice(0, 80)
  }
  return { name, description, body: body.trim() }
}

export async function listCommands(): Promise<SlashCommandFile[]> {
  await ensureSeeded()
  let names: string[]
  try {
    names = (await readdir(COMMANDS_DIR)).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }
  const out: SlashCommandFile[] = []
  for (const n of names) {
    try {
      const raw = await readFile(join(COMMANDS_DIR, n), 'utf8')
      const cmd = parseCommand(n, raw)
      if (cmd.name) out.push(cmd)
    } catch {
      /* atla */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function commandsDir(): string {
  return COMMANDS_DIR
}
