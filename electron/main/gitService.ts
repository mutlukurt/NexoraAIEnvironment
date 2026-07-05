/**
 * Git tabanlı üretim geçmişi (roadmap 3.4).
 *
 * Her kabul edilen üretim, projenin çalışma alanında bir git commit'i olur —
 * 20 adımlık undo tamponunun ötesinde sınırsız bir zaman çizelgesi.
 *
 * Sınırlar (bilinçli):
 *  - git bulunamazsa özellik SESSİZCE devre dışı — uygulama git'siz de tam çalışır.
 *  - Bağlı (içe aktarılmış) klasörlerde ASLA çalışmaz: kullanıcının kendi
 *    reposuna otomatik commit atmak ya da klasörüne .git dikmek kabul edilemez;
 *    orada zaman çizelgesi kullanıcının kendi VCS'idir.
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import {
  workspaceDir,
  linkedFolderFor,
  syncWorkspace,
  scanProjectDir,
  type ProjectFileInput
} from './agentService'

export interface HistoryEntry {
  hash: string
  subject: string
  /** Unix saniyesi. */
  time: number
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

let gitAvailable: boolean | null = null
async function hasGit(): Promise<boolean> {
  if (gitAvailable === null) {
    gitAvailable = (await runGit(process.cwd(), ['--version'])).ok
  }
  return gitAvailable
}

/** Depoyu hazırla (yoksa init + yerel kimlik + node_modules ignore). */
async function ensureRepo(dir: string): Promise<boolean> {
  if (!existsSync(join(dir, '.git'))) {
    if (!(await runGit(dir, ['init'])).ok) return false
    await runGit(dir, ['config', 'user.name', 'NexoraAI'])
    await runGit(dir, ['config', 'user.email', 'nexora@local'])
  }
  // add -A node_modules'ü yutmasın: ignore yoksa yaz (varsa dokunma).
  const gi = join(dir, '.gitignore')
  if (!existsSync(gi)) {
    await writeFile(gi, 'node_modules/\ndist/\n.vite/\n', 'utf8')
  }
  return true
}

/**
 * Kabul edilen üretimi commit'le. Dönen skipped:
 * 'no-git' = git kurulu değil, 'linked' = içe aktarılmış klasör (dokunulmaz),
 * 'clean' = değişiklik yoktu.
 */
export async function historyCommit(
  projectName: string,
  files: ProjectFileInput[],
  message: string,
  green?: boolean
): Promise<{ ok: boolean; hash?: string; skipped?: 'no-git' | 'linked' | 'clean'; error?: string }> {
  if (linkedFolderFor(projectName)) return { ok: true, skipped: 'linked' }
  if (!(await hasGit())) return { ok: true, skipped: 'no-git' }
  const dir = await syncWorkspace(projectName, files)
  if (!(await ensureRepo(dir))) return { ok: false, error: 'git init başarısız' }
  await runGit(dir, ['add', '-A'])
  const msg = (message || 'üretim').replace(/\s+/g, ' ').slice(0, 72)
  const c = await runGit(dir, ['commit', '-m', msg])
  const committed = c.ok || /nothing to commit|değişiklik yok/i.test(c.out)
  if (!committed) return { ok: false, error: c.out.slice(0, 200) }
  // Onarım merdiveni (Kat 3): doğrulamadan GEÇEN sürüm "yeşil" etiketlenir —
  // düzeltme merdiveni tükenirse buraya güvenle dönülür.
  if (green) await runGit(dir, ['tag', '-f', 'nexora-green'])
  if (!c.ok) return { ok: true, skipped: 'clean' }
  const h = await runGit(dir, ['rev-parse', '--short', 'HEAD'])
  return { ok: true, hash: h.out.trim() }
}

/** Çalışan (yeşil) son sürüme dön — düzeltilemeyen hatada dürüst güvenlik ağı. */
export async function historyRestoreGreen(
  projectName: string
): Promise<{ ok: boolean; files?: ProjectFileInput[]; hash?: string; error?: string }> {
  if (linkedFolderFor(projectName)) return { ok: false, error: 'Bağlı klasörde geçerli değil.' }
  if (!(await hasGit())) return { ok: false, error: 'git yok' }
  const dir = workspaceDir(projectName)
  if (!existsSync(join(dir, '.git'))) return { ok: false, error: 'geçmiş yok' }
  const rev = await runGit(dir, ['rev-parse', '--short', 'nexora-green'])
  if (!rev.ok) return { ok: false, error: 'yeşil sürüm yok' }
  const hash = rev.out.trim()
  const r = await historyRestore(projectName, hash)
  return { ...r, hash }
}

export async function historyList(projectName: string): Promise<HistoryEntry[]> {
  if (linkedFolderFor(projectName) || !(await hasGit())) return []
  const dir = workspaceDir(projectName)
  if (!existsSync(join(dir, '.git'))) return []
  const r = await runGit(dir, ['log', '--pretty=format:%h%x09%s%x09%ct', '-n', '50'])
  if (!r.ok) return []
  return r.out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, ct] = line.split('\t')
      return { hash, subject: subject ?? '', time: Number(ct) || 0 }
    })
}

/**
 * Belirli bir sürüme dön: önce mevcut durum güvenlik commit'i olarak saklanır,
 * sonra çalışma ağacı o sürümün ağacına eşitlenir (sonradan eklenen izlenen
 * dosyalar da silinir) ve dönüş yeni bir commit olarak kaydedilir — geçmiş
 * hiç kaybolmaz, "geri dönüşten geri dönmek" de mümkündür.
 */
export async function historyRestore(
  projectName: string,
  hash: string
): Promise<{ ok: boolean; files?: ProjectFileInput[]; error?: string }> {
  if (linkedFolderFor(projectName)) return { ok: false, error: 'İçe aktarılmış klasörde zaman çizelgesi kullanılmaz.' }
  if (!(await hasGit())) return { ok: false, error: 'git bulunamadı' }
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) return { ok: false, error: 'Geçersiz sürüm.' }
  const dir = workspaceDir(projectName)
  if (!existsSync(join(dir, '.git'))) return { ok: false, error: 'Bu projede geçmiş yok.' }

  await runGit(dir, ['add', '-A'])
  await runGit(dir, ['commit', '-m', 'geri dönüş öncesi otomatik kayıt', '--allow-empty'])
  const rt = await runGit(dir, ['read-tree', '-u', '--reset', hash])
  if (!rt.ok) return { ok: false, error: rt.out.slice(0, 200) }
  await runGit(dir, ['add', '-A'])
  await runGit(dir, ['commit', '-m', `↩️ ${hash} sürümüne dönüldü`, '--allow-empty'])

  const { files } = await scanProjectDir(dir)
  return { ok: true, files }
}
