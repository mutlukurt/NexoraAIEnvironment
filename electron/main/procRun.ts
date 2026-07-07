/**
 * Akışlı süreç koşucu (roadmap 7.6) — görünür terminalin kalbi.
 *
 * runCommand'ın 20KB'lık ölü özet yakalaması yerine: her stdout/stderr
 * parçası anında onChunk'a akar (renderer'daki Terminal kartına canlı düşer),
 * dönüş değeri eski RunResult sözleşmesini korur (mevcut çağıranlar bozulmaz).
 *
 * Bilinçli olarak electron'suz saf modül — `npm run test:procrun` gerçek
 * süreçlerle doğrudan koşar.
 */
import { spawn } from 'child_process'

export interface StreamRunResult {
  ok: boolean
  output: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
}

export function runStreaming(
  cmd: string,
  cwd: string,
  opts?: {
    timeoutMs?: number
    maxOutput?: number
    env?: NodeJS.ProcessEnv
    onChunk?: (chunk: string) => void
  }
): Promise<StreamRunResult> {
  const timeoutMs = opts?.timeoutMs ?? 300_000
  const maxOutput = opts?.maxOutput ?? 20_000
  const started = Date.now()
  return new Promise((resolvePromise) => {
    // shell: true → Linux/macOS'ta /bin/sh, Windows'ta cmd.exe (runCommand
    // mirası). detached (POSIX): kabuk kendi süreç GRUBUNU alır — zaman
    // aşımında grubu öldürmek alt süreçleri de keser (test bulgusu: kabuğu
    // öldürmek `sleep 5`'i öldürmüyordu, stdio açık kaldığı için close olayı
    // komutun doğal bitişine dek gelmiyordu).
    const posix = process.platform !== 'win32'
    const child = spawn(cmd, { cwd, shell: true, env: opts?.env, detached: posix })
    let out = ''
    let timedOut = false
    let settled = false
    const settle = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({
        ok: code === 0,
        output: out.trim().slice(0, maxOutput),
        exitCode: code,
        durationMs: Date.now() - started,
        timedOut
      })
    }
    const push = (d: Buffer) => {
      const s = d.toString()
      if (out.length < maxOutput) out += s
      try {
        opts?.onChunk?.(s)
      } catch {
        /* dinleyici hatası süreci düşürmez */
      }
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)

    const timer = setTimeout(() => {
      timedOut = true
      push(Buffer.from('\n[NexoraAI] Komut zaman aşımına uğradı.'))
      try {
        if (posix && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
      // Yetim torun stdio'yu açık tutabilir — 'close' hiç gelmezse bile
      // sonuç 500ms içinde döner (alt süreçler grup-kill ile zaten öldü).
      setTimeout(() => settle(null), 500)
    }, timeoutMs)

    child.on('close', (code) => settle(code))
    child.on('error', (err) => {
      const msg = 'Komut başlatılamadı: ' + err.message
      if (out.length < maxOutput) out += msg
      try {
        opts?.onChunk?.(msg)
      } catch {
        /* ignore */
      }
      settle(null)
    })
  })
}
