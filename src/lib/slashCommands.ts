/**
 * 10.8 — Slash-komut iş akışları: .md → /komut.
 *
 * Kullanıcı ~/NexoraAI/commands/<ad>.md yazar; sohbette "/ad argümanlar" onun
 * gövdesine genişler ($ARGUMENTS argümanlarla değişir, yoksa sona eklenir).
 * Ayarlardaki hızlı komutlar da aynı listeye katılır. Saf mantık → test edilebilir.
 */
export interface SlashCommand {
  name: string
  description: string
  body: string
  source: 'file' | 'custom'
}

/** "/ad ..." girdisini komut gövdesine genişletir; komut değilse aynen döner. */
export function expandSlashCommand(input: string, commands: SlashCommand[]): string {
  const m = input.match(/^\/([\w-]+)(?:[ \t]+([\s\S]*))?$/)
  if (!m) return input
  const cmd = commands.find((c) => c.name.toLowerCase() === m[1].toLowerCase())
  if (!cmd) return input
  const args = (m[2] || '').trim()
  if (cmd.body.includes('$ARGUMENTS')) return cmd.body.split('$ARGUMENTS').join(args)
  return args ? cmd.body + '\n\n' + args : cmd.body
}

/** Girdi henüz komut adı yazılıyorsa (boşluk yok) eşleşen komutları döndür (autocomplete). */
export function matchSlash(input: string, commands: SlashCommand[]): SlashCommand[] {
  const m = input.match(/^\/([\w-]*)$/)
  if (!m) return []
  const prefix = m[1].toLowerCase()
  return commands.filter((c) => c.name.toLowerCase().startsWith(prefix)).slice(0, 8)
}

/** Girdi bir slash-komut çağrısı mı (bilinen bir komuta çözülüyor mu)? */
export function isSlashInvocation(input: string, commands: SlashCommand[]): boolean {
  const m = input.match(/^\/([\w-]+)(?:[ \t]+[\s\S]*)?$/)
  if (!m) return false
  return commands.some((c) => c.name.toLowerCase() === m[1].toLowerCase())
}
