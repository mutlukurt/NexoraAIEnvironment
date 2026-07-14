/**
 * 20.3 — Composer mikrofon düğmesi: offline dikte (whisper.cpp).
 *
 * getUserMedia(audio) → AudioContext ile Float32 PCM yakalar → 16 kHz mono WAV'a
 * çevirir → main'e (whisperService) yollar → yazı composer'a eklenir. Ses CİHAZDA
 * kalır, hiçbir yere gitmez. Binary yoksa zarif ipucu (kurulum yönlendirmesi).
 */
import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import type { Lang } from '@/lib/i18n'
import { resampleTo, encodeWav } from '@/lib/wav'

/** Yakalamayı kapat: mikrofon parçalarını durdur + AudioContext'i kapat (mic soğur). */
function teardown(cap: Capture | null): void {
  if (!cap) return
  try {
    cap.node.disconnect()
  } catch {
    /* ignore */
  }
  try {
    cap.stream.getTracks().forEach((t) => t.stop())
  } catch {
    /* ignore */
  }
  void cap.ctx.close().catch(() => undefined)
}

type RecState = 'idle' | 'recording' | 'busy'

interface Capture {
  stream: MediaStream
  ctx: AudioContext
  node: ScriptProcessorNode
  chunks: Float32Array[]
  sampleRate: number
}

export default function RecordButton({
  onText,
  language,
  disabled
}: {
  onText: (dictated: string) => void
  language: Lang
  disabled?: boolean
}) {
  const tr = language === 'tr'
  const [state, setState] = useState<RecState>('idle')
  const [hint, setHint] = useState<string | null>(null)
  const capRef = useRef<Capture | null>(null)

  // Bileşen kayıt sırasında unmount olursa (oturum değişimi vb.) mikrofonu SOĞUT:
  // aksi hâlde donanım mikrofonu sonsuza dek açık kalırdı (adversaryal bulgu).
  useEffect(() => {
    return () => {
      teardown(capRef.current)
      capRef.current = null
    }
  }, [])

  const start = async () => {
    setHint(null)
    // Binary yoksa kaydetmeden önce uyar (kullanıcının vaktini boşa harcama).
    try {
      const st = await window.nexora.whisper?.status()
      if (st?.ok && st.binary === false) {
        setHint(
          tr
            ? 'Whisper CLI bulunamadı — macOS: brew install whisper-cpp, Linux: whisper.cpp kur.'
            : 'Whisper CLI not found — macOS: brew install whisper-cpp, Linux: install whisper.cpp.'
        )
        return
      }
    } catch {
      /* status okunamazsa yine de kaydı dene */
    }
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const src = ctx.createMediaStreamSource(stream)
      const node = ctx.createScriptProcessor(4096, 1, 1)
      const chunks: Float32Array[] = []
      node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      // Sıfır-kazanç sink: ScriptProcessor'ın çalışması için bağlanmalı ama sesi
      // hoparlöre YANSITMAMALI (aksi hâlde geri-besleme/eko olur).
      const sink = ctx.createGain()
      sink.gain.value = 0
      src.connect(node)
      node.connect(sink)
      sink.connect(ctx.destination)
      capRef.current = { stream, ctx, node, chunks, sampleRate: ctx.sampleRate }
      setState('recording')
    } catch {
      // getUserMedia İZİN VERDİ ama AudioContext kurulumu patladıysa akan stream'i
      // burada kapat — yoksa mikrofon açık kalırdı (adversaryal bulgu).
      if (stream) stream.getTracks().forEach((t) => t.stop())
      setHint(tr ? 'Mikrofon açılamadı (izin verildi mi?).' : 'Could not access microphone (permission?).')
    }
  }

  const stop = async () => {
    const cap = capRef.current
    capRef.current = null
    if (!cap) {
      setState('idle')
      return
    }
    teardown(cap)
    const total = cap.chunks.reduce((n, c) => n + c.length, 0)
    const all = new Float32Array(total)
    let off = 0
    for (const c of cap.chunks) {
      all.set(c, off)
      off += c.length
    }
    if (all.length < cap.sampleRate * 0.3) {
      setState('idle')
      setHint(tr ? 'Çok kısa — biraz daha uzun konuşun.' : 'Too short — speak a little longer.')
      return
    }
    setState('busy')
    try {
      const ds = resampleTo(all, cap.sampleRate, 16000)
      const wav = encodeWav(ds, 16000)
      const res = await window.nexora.whisper.transcribe({ wav })
      if (res?.ok && res.text) {
        onText(res.text)
        setHint(null)
      } else {
        setHint(res?.error ?? (tr ? 'Yazıya çevrilemedi.' : 'Transcription failed.'))
      }
    } catch (e) {
      setHint((e as Error).message)
    }
    setState('idle')
  }

  const toggle = () => {
    if (state === 'busy') return
    if (state === 'recording') void stop()
    else void start()
  }

  const title =
    state === 'recording'
      ? tr
        ? 'Kaydı bitir + yazıya çevir'
        : 'Stop + transcribe'
      : state === 'busy'
        ? tr
          ? 'Yazıya çevriliyor…'
          : 'Transcribing…'
        : tr
          ? 'Sesle yaz (offline dikte)'
          : 'Dictate (offline)'

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || state === 'busy'}
        title={title}
        aria-label={title}
        className={
          'rounded-lg p-1.5 transition disabled:opacity-40 ' +
          (state === 'recording'
            ? 'bg-red-500/15 text-red-600 dark:text-red-400 animate-pulse'
            : 'text-ink-dim hover:bg-ink-hi hover:text-ink-mut')
        }
      >
        {state === 'busy' ? (
          <Loader2 className="h-4.5 w-4.5 animate-spin" />
        ) : state === 'recording' ? (
          <Square className="h-4.5 w-4.5" />
        ) : (
          <Mic className="h-4.5 w-4.5" />
        )}
      </button>
      {hint && (
        <div className="absolute bottom-full left-0 z-40 mb-1 w-64 rounded-lg border border-ink-line bg-ink-card px-3 py-2 text-[11px] font-medium text-ink-text shadow-xl">
          {hint}
        </div>
      )}
    </div>
  )
}
