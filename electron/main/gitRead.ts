/**
 * Git-gerçeği okuma (roadmap 7.3) — inceleme panelinin veri kaynağı.
 *
 * Bir git referansındaki (HEAD / nexora-green / kısa hash) dosya içeriklerini
 * SALT-OKUR döndürür: çalışma ağacına, index'e, HEAD'e dokunmaz — inceleme
 * paneli farkı gösterir, geri almayı store yapar, commit'i yine 3.4 atar.
 *
 * Bilinçli olarak electron'suz saf modül: `npm run test:review` gerçek bir
 * geçici repoda bu dosyayı doğrudan koşar (gitService electron'a dokunur).
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export interface RefFile {
  path: string
  content: string
}

function runGit(dir: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((res) => {
    const child = spawn('git', args, { cwd: dir })
    let out = ''
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => res({ ok: false, out: 'git yok' }))
    child.on('close', (code) => res({ ok: code === 0, out }))
  })
}

/** İnceleme kapsamına giren metin dosyaları — scanProjectDir ile aynı ruh. */
const TEXT_EXT = /\.(tsx?|jsx?|css|html?|json|md|svg|txt|mjs|cjs)$/i
const MAX_FILES = 300
const MAX_FILE_BYTES = 400_000

/**
 * ref'teki proje dosyalarını oku. ref beyaz-listeli: HEAD, nexora-green ya da
 * kısa/uzun hash — IPC'den gelen serbest metin asla git argümanına sızmaz.
 */
export async function filesAtRef(
  dir: string,
  ref: string
): Promise<{ ok: boolean; files?: RefFile[]; error?: string }> {
  if (!/^(HEAD|nexora-green|[0-9a-f]{4,40})$/i.test(ref)) return { ok: false, error: 'geçersiz ref' }
  if (!existsSync(join(dir, '.git'))) return { ok: false, error: 'bu projede git geçmişi yok' }
  const ls = await runGit(dir, ['ls-tree', '-r', '--name-only', ref])
  if (!ls.ok) {
    return {
      ok: false,
      error: /not a valid object|unknown revision/i.test(ls.out) ? `'${ref}' bulunamadı` : ls.out.slice(0, 160)
    }
  }
  const names = ls.out
    .split('\n')
    .map((s) => s.trim())
    .filter((n) => n && TEXT_EXT.test(n) && !n.startsWith('node_modules/'))
    .slice(0, MAX_FILES)
  const files: RefFile[] = []
  for (const path of names) {
    // ls-tree'den gelen yol zaten repo-göreli; show ref:path salt-okurdur.
    const show = await runGit(dir, ['show', `${ref}:${path}`])
    if (!show.ok || show.out.length > MAX_FILE_BYTES) continue
    files.push({ path, content: show.out })
  }
  return { ok: true, files }
}
