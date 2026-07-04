/**
 * Cihaz ölçümü — Donanım Danışmanı'nın veri kaynağı.
 * RAM/CPU Node'un os modülünden; GPU nvidia-smi'den (varsa) okunur.
 */
import { totalmem, freemem, cpus } from 'os'
import { execFile } from 'child_process'
import type { HardwareInfo } from '../shared/advisor'

function detectNvidia(): Promise<{ name: string; vramGb: number } | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null)
        const [name, mem] = stdout.trim().split('\n')[0].split(',').map((s) => s.trim())
        const vramGb = Number(mem) / 1024
        if (!name || !Number.isFinite(vramGb)) return resolve(null)
        resolve({ name, vramGb: Math.round(vramGb * 10) / 10 })
      }
    )
  })
}

export async function detectHardware(): Promise<HardwareInfo> {
  const gpu = await detectNvidia()
  return {
    ramGb: Math.round((totalmem() / 1e9) * 10) / 10,
    freeRamGb: Math.round((freemem() / 1e9) * 10) / 10,
    cpuModel: cpus()[0]?.model?.trim() ?? 'Bilinmeyen CPU',
    cpuCores: cpus().length,
    gpu,
    platform: process.platform
  }
}
