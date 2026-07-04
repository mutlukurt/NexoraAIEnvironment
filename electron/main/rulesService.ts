/**
 * Proje kuralları — kullanıcının kalıcı tercihleri (AGENTS.md ruhu).
 *
 * Her proje çalışma alanında düz bir KURALLAR.md dosyası yaşar
 * (~/NexoraAI/Projects/<proje>/KURALLAR.md). Kullanıcı Ayarlar'dan ya da
 * herhangi bir editörden düzenleyebilir; içerik her istekle modele eklenir
 * ("bu projede hep koyu tema" gibi tercihler tekrar yazılmaz).
 */
import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'

const PROJECTS_DIR = join(homedir(), 'NexoraAI', 'Projects')

function fileOf(projectName: string): string {
  const safe = projectName.replace(/[^\w.-]/g, '_') || 'nexora-projesi'
  return join(PROJECTS_DIR, safe, 'KURALLAR.md')
}

export async function getRules(projectName: string): Promise<string> {
  try {
    return await fs.readFile(fileOf(projectName), 'utf8')
  } catch {
    return ''
  }
}

export async function setRules(projectName: string, content: string): Promise<void> {
  const path = fileOf(projectName)
  await fs.mkdir(join(path, '..'), { recursive: true })
  if (!content.trim()) {
    // Boş kural = dosyayı sil, çalışma alanında çöp bırakma.
    try {
      await fs.unlink(path)
    } catch {
      /* yoksa sorun değil */
    }
    return
  }
  await fs.writeFile(path, content, 'utf8')
}
