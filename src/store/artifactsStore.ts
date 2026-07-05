import { create } from 'zustand'
import { nanoid } from 'nanoid'

export type FileLanguage = 'html' | 'css' | 'javascript' | 'typescript' | 'json' | 'markdown' | 'text'

export interface ArtifactFile {
  path: string
  content: string
  language: FileLanguage
  updatedAt: number
}

export type ArtifactView = 'preview' | 'code' | 'tree' | 'history'

interface ArtifactsState {
  files: Record<string, ArtifactFile>
  selectedPath: string | null
  view: ArtifactView
  pendingChanges: boolean
  writingPath: string | null
  _snapshot: string | null
  /** Zaman çizelgesi: her üretim turunun ÖNCESİ (en yenisi sonda, en çok 20). */
  _undoStack: string[]
  _redoStack: string[]
  canUndo: boolean
  canRedo: boolean

  createFile: (path: string, content: string, language?: FileLanguage) => string
  upsertFile: (path: string, content: string, language?: FileLanguage) => void
  applyFiles: (entries: Array<{ path: string; content: string; language?: FileLanguage }>) => void
  streamUpdateFile: (path: string, content: string, language?: FileLanguage, follow?: boolean) => void
  updateFile: (path: string, content: string) => void
  deleteFile: (path: string) => void
  selectFile: (path: string) => void
  setView: (v: ArtifactView) => void
  clearAll: () => void
  renameFile: (path: string, newPath: string) => void
  snapshot: () => void
  restoreSnapshot: () => void
  acceptChanges: () => void
  /** Oturum yükleme: dosya setini bekleyen-değişiklik üretmeden komple değiştir. */
  replaceAll: (files: Record<string, ArtifactFile>, selectedPath: string | null) => void
  /** Üretim turları arasında geri/ileri gezinme (tek adımlık Reddet'in ötesi). */
  undo: () => void
  redo: () => void
  setWritingPath: (path: string | null) => void
  finishStreaming: () => void
}

export function detectLanguage(path: string): FileLanguage {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html'
    case 'css':
      return 'css'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'json':
      return 'json'
    case 'md':
    case 'markdown':
      return 'markdown'
    default:
      return 'text'
  }
}

function uniquePath(base: string, files: Record<string, ArtifactFile>): string {
  if (!files[base]) return base
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let i = 2
  let candidate = `${stem}-${i}${ext}`
  while (files[candidate]) {
    i++
    candidate = `${stem}-${i}${ext}`
  }
  return candidate
}

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  files: {},
  selectedPath: null,
  view: 'code',
  pendingChanges: false,
  writingPath: null,
  _snapshot: null,
  _undoStack: [],
  _redoStack: [],
  canUndo: false,
  canRedo: false,

  createFile: (path, content, language) => {
    const lang = language ?? detectLanguage(path)
    const finalPath = uniquePath(path, get().files)
    set((s) => ({
      files: { ...s.files, [finalPath]: { path: finalPath, content, language: lang, updatedAt: Date.now() } },
      selectedPath: finalPath,
      view: 'code',
      pendingChanges: true
    }))
    return finalPath
  },

  upsertFile: (path, content, language) => {
    const lang = language ?? detectLanguage(path)
    set((s) => ({
      files: { ...s.files, [path]: { path, content, language: lang, updatedAt: Date.now() } },
      selectedPath: path,
      view: s.files[path] ? s.view : 'code',
      pendingChanges: true
    }))
  },

  applyFiles: (entries) => {
    if (entries.length === 0) return
    set((s) => {
      const files = { ...s.files }
      let entryPath = ''
      for (const e of entries) {
        const lang = e.language ?? detectLanguage(e.path)
        files[e.path] = { path: e.path, content: e.content, language: lang, updatedAt: Date.now() }
        if (!entryPath || e.path === 'src/App.tsx' || e.path === 'App.tsx' || e.path === 'App.jsx' || e.path === 'index.html') {
          entryPath = e.path
        }
      }
      return {
        files,
        selectedPath: entryPath || entries[0].path,
        view: 'code',
        pendingChanges: true
      }
    })
  },

  streamUpdateFile: (path, content, language, follow = true) => {
    const lang = language ?? detectLanguage(path)
    set((s) => {
      const files = { ...s.files }
      files[path] = { path, content, language: lang, updatedAt: Date.now() }
      if (!follow) {
        return { files, pendingChanges: true }
      }
      // Bolt-style: follow the file being written, live, in the code view.
      return {
        files,
        selectedPath: path,
        view: 'code',
        writingPath: path,
        pendingChanges: true
      }
    })
  },

  updateFile: (path, content) => {
    set((s) => {
      const f = s.files[path]
      if (!f) return {}
      // Manual user edit — no accept/reject cycle for the user's own changes.
      return { files: { ...s.files, [path]: { ...f, content, updatedAt: Date.now() } } }
    })
  },

  deleteFile: (path) => {
    set((s) => {
      const files = { ...s.files }
      delete files[path]
      return { files, selectedPath: s.selectedPath === path ? null : s.selectedPath }
    })
  },

  renameFile: (path, newPath) => {
    set((s) => {
      const f = s.files[path]
      if (!f || s.files[newPath]) return {}
      const files = { ...s.files }
      delete files[path]
      files[newPath] = { ...f, path: newPath, language: detectLanguage(newPath) }
      return { files, selectedPath: s.selectedPath === path ? newPath : s.selectedPath }
    })
  },

  selectFile: (path) => set({ selectedPath: path, view: 'code' }),

  setView: (view) => set({ view }),

  clearAll: () =>
    set({
      files: {},
      selectedPath: null,
      view: 'code',
      pendingChanges: false,
      writingPath: null,
      _snapshot: null,
      _undoStack: [],
      _redoStack: [],
      canUndo: false,
      canRedo: false
    }),

  replaceAll: (files, selectedPath) =>
    set({
      files,
      selectedPath: selectedPath && files[selectedPath] ? selectedPath : (Object.keys(files)[0] ?? null),
      view: 'code',
      pendingChanges: false,
      writingPath: null,
      _snapshot: null,
      _undoStack: [],
      _redoStack: [],
      canUndo: false,
      canRedo: false
    }),

  snapshot: () => {
    const snap = JSON.stringify(get().files)
    set((s) => {
      // Aynı durumu üst üste yığma (boş/başarısız turlar gürültü yapmasın).
      const push = s._undoStack[s._undoStack.length - 1] !== snap
      const _undoStack = push ? [...s._undoStack.slice(-19), snap] : s._undoStack
      return { _snapshot: snap, _undoStack, _redoStack: [], canUndo: _undoStack.length > 0, canRedo: false }
    })
  },

  restoreSnapshot: () => {
    const snap = get()._snapshot
    if (snap) {
      const files = JSON.parse(snap) as Record<string, ArtifactFile>
      const paths = Object.keys(files)
      const prevSelected = get().selectedPath
      set((s) => {
        // Reddedilen turun yığın girdisi restorasyonla aynı — düşür ki undo
        // "hiçbir şey değişmedi" adımı göstermesin.
        const _undoStack =
          s._undoStack[s._undoStack.length - 1] === snap ? s._undoStack.slice(0, -1) : s._undoStack
        return {
          files,
          pendingChanges: false,
          writingPath: null,
          _snapshot: null,
          selectedPath: prevSelected && files[prevSelected] ? prevSelected : paths[0] ?? null,
          view: 'code',
          _undoStack,
          canUndo: _undoStack.length > 0
        }
      })
    }
  },

  undo: () => {
    const s = get()
    const cur = JSON.stringify(s.files)
    const stack = [...s._undoStack]
    let prev = stack.pop()
    while (prev === cur && stack.length) prev = stack.pop()
    if (!prev || prev === cur) {
      set({ _undoStack: stack, canUndo: stack.length > 0 })
      return
    }
    const files = JSON.parse(prev) as Record<string, ArtifactFile>
    set({
      files,
      selectedPath: s.selectedPath && files[s.selectedPath] ? s.selectedPath : (Object.keys(files)[0] ?? null),
      pendingChanges: false,
      writingPath: null,
      _snapshot: null,
      _undoStack: stack,
      _redoStack: [...s._redoStack.slice(-19), cur],
      canUndo: stack.length > 0,
      canRedo: true,
      view: 'code'
    })
  },

  redo: () => {
    const s = get()
    const cur = JSON.stringify(s.files)
    const stack = [...s._redoStack]
    let next = stack.pop()
    while (next === cur && stack.length) next = stack.pop()
    if (!next || next === cur) {
      set({ _redoStack: stack, canRedo: stack.length > 0 })
      return
    }
    const files = JSON.parse(next) as Record<string, ArtifactFile>
    set({
      files,
      selectedPath: s.selectedPath && files[s.selectedPath] ? s.selectedPath : (Object.keys(files)[0] ?? null),
      pendingChanges: false,
      writingPath: null,
      _snapshot: null,
      _undoStack: [...s._undoStack.slice(-19), cur],
      _redoStack: stack,
      canUndo: true,
      canRedo: stack.length > 0,
      view: 'code'
    })
  },

  acceptChanges: () => {
    set({ pendingChanges: false, _snapshot: null, writingPath: null })
  },

  setWritingPath: (path) => set({ writingPath: path }),

  finishStreaming: () => {
    set((s) => {
      const paths = Object.keys(s.files)
      if (paths.length === 0) return { writingPath: null }
      const previewEntry = [
        'index.html', 'src/App.tsx', 'App.tsx', 'src/App.jsx', 'App.jsx',
        'app/page.tsx', 'app/page.jsx', 'src/main.tsx'
      ].find((p) => s.files[p])
      if (previewEntry) {
        // Generation finished → jump to live preview (Bolt behavior).
        return { writingPath: null, view: 'code', selectedPath: previewEntry }
      }
      // Not previewable (Electron/Tauri/RN/FastAPI…) → show the professional file tree.
      return { writingPath: null, view: 'tree', selectedPath: paths[0] }
    })
  }
}))

export { nanoid }
