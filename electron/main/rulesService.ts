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

// --- 7.8: hiyerarşik kurallar (AGENTS.md standardının keşif kuralı) ---
// Global katman ~/NexoraAI/KURALLAR.md: her projede geçerli tercihlerin evi.
// Birleşim TAMAMLAYICIDIR: global önce gelir, proje kuralı üstüne yazılır —
// yakın olan (proje) çelişkide kazanır, çünkü modele daha sonra ve
// "project rules override" başlığıyla verilir.
const GLOBAL_RULES = join(homedir(), 'NexoraAI', 'KURALLAR.md')

export async function getGlobalRules(): Promise<string> {
  try {
    return await fs.readFile(GLOBAL_RULES, 'utf8')
  } catch {
    return ''
  }
}

export async function setGlobalRules(content: string): Promise<void> {
  await fs.mkdir(join(GLOBAL_RULES, '..'), { recursive: true })
  if (!content.trim()) {
    try {
      await fs.unlink(GLOBAL_RULES)
    } catch {
      /* yoksa sorun değil */
    }
    return
  }
  await fs.writeFile(GLOBAL_RULES, content, 'utf8')
}

/** Birleşik görünüm: global + proje (proje çelişkide kazanır — sona yazılır). */
export async function getMergedRules(projectName: string): Promise<{ global: string; project: string; merged: string }> {
  const [global, project] = await Promise.all([getGlobalRules(), getRules(projectName)])
  const parts: string[] = []
  if (global.trim()) parts.push('--- GLOBAL RULES (all projects) ---\n' + global.trim())
  if (project.trim()) parts.push('--- PROJECT RULES (override global on conflict) ---\n' + project.trim())
  return { global, project, merged: parts.join('\n\n') }
}
