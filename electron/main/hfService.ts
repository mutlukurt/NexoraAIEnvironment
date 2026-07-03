import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import type { ModelDownloader } from 'node-llama-cpp'

type LlamaModule = typeof import('node-llama-cpp')

let mod: LlamaModule | null = null
async function getMod(): Promise<LlamaModule> {
  if (!mod) mod = await import('node-llama-cpp')
  return mod
}

export interface HfGgufFile {
  rfilename: string
}

export interface HfModelResult {
  id: string
  author?: string
  downloads?: number
  likes?: number
  tags?: string[]
  ggufFiles: string[]
}

export interface LocalModel {
  name: string
  path: string
  sizeBytes: number
}

export async function searchModels(query: string): Promise<HfModelResult[]> {
  const q = query.trim()
  if (!q) return []
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&full=true&limit=80`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HuggingFace arama başarısız: ${res.status}`)
  const data = (await res.json()) as Array<{
    id: string
    author?: string
    downloads?: number
    likes?: number
    tags?: string[]
    siblings?: Array<{ rfilename: string }>
  }>

  return data
    .filter((m) => m.siblings?.some((s) => s.rfilename?.toLowerCase().endsWith('.gguf')))
    .map((m) => ({
      id: m.id,
      author: m.author,
      downloads: m.downloads,
      likes: m.likes,
      tags: m.tags,
      ggufFiles: m.siblings
        ?.filter((s) => s.rfilename?.toLowerCase().endsWith('.gguf'))
        .map((s) => s.rfilename) ?? []
    }))
    .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
}

export async function listLocalModels(dir: string): Promise<LocalModel[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const ggufs = entries.filter((f) => f.toLowerCase().endsWith('.gguf'))
  const out: LocalModel[] = []
  for (const f of ggufs) {
    const p = join(dir, f)
    try {
      const s = await stat(p)
      out.push({ name: f, path: p, sizeBytes: s.size })
    } catch {
      /* skip */
    }
  }
  return out
}

let activeDownloader: ModelDownloader | null = null
let abortController: AbortController | null = null

export async function downloadModel(
  uri: string,
  dir: string,
  onProgress: (downloaded: number, total: number) => void
): Promise<string> {
  const m = await getMod()
  abortController = new AbortController()
  const downloader = await m.createModelDownloader({
    modelUri: uri,
    dirPath: dir,
    skipExisting: true,
    onProgress: (status: { totalSize: number; downloadedSize: number }) => {
      onProgress(status.downloadedSize, status.totalSize)
    }
  })
  activeDownloader = downloader
  const modelPath = await downloader.download({ signal: abortController.signal })
  activeDownloader = null
  abortController = null
  return modelPath
}

export async function cancelDownload(): Promise<void> {
  abortController?.abort()
  try {
    await activeDownloader?.cancel({ deleteTempFile: true })
  } catch {
    /* ignore */
  }
  activeDownloader = null
  abortController = null
}
