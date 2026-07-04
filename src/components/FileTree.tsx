import { useMemo, useState } from 'react'
import { useArtifactsStore, type ArtifactFile } from '@/store/artifactsStore'
import { Folder, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { translations } from '@/lib/translations'

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  file?: ArtifactFile
}

function buildTree(files: Record<string, ArtifactFile>): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }
  const paths = Object.keys(files).sort()

  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    let acc = ''
    parts.forEach((part, i) => {
      acc = acc ? acc + '/' + part : part
      const isLast = i === parts.length - 1
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        child = {
          name: part,
          path: acc,
          isDir: !isLast,
          children: []
        }
        node.children.push(child)
      }
      if (isLast) child.file = files[p]
      node = child
    })
  }

  const sortNodes = (n: TreeNode): void => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    n.children.forEach(sortNodes)
  }
  sortNodes(root)
  return root.children
}

function Row({
  node,
  depth,
  selectedPath,
  writingPath,
  onSelect
}: {
  node: TreeNode
  depth: number
  selectedPath: string | null
  writingPath: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(true)
  const pad = 14 + depth * 14

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 py-2 pr-3 text-left text-sm font-bold text-ink-mut hover:bg-ink-hi transition"
          style={{ paddingLeft: pad }}
        >
          <span className="text-[10px] text-ink-dim">{open ? '▼' : '▶'}</span>
          {open ? (
            <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-amber-500 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children.map((c) => (
            <Row
              key={c.path}
              node={c}
              depth={depth + 1}
              selectedPath={selectedPath}
              writingPath={writingPath}
              onSelect={onSelect}
            />
          ))}
      </div>
    )
  }

  const active = selectedPath === node.path
  const writing = writingPath === node.path
  return (
    <button
      onClick={() => onSelect(node.path)}
      className={
        'flex w-full items-center gap-2 py-2 pr-3 text-left text-[13.5px] transition ' +
        (active
          ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 font-bold border-l-2 border-brand-500'
          : 'text-ink-mut hover:bg-ink-hi border-l-2 border-transparent')
      }
      style={{ paddingLeft: pad + 14 }}
    >
      <span className="truncate">{node.name}</span>
      {writing && <span className="ml-auto h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-500" />}
    </button>
  )
}

export default function FileTree() {
  const files = useArtifactsStore((s) => s.files)
  const selectedPath = useArtifactsStore((s) => s.selectedPath)
  const writingPath = useArtifactsStore((s) => s.writingPath)
  const selectFile = useArtifactsStore((s) => s.selectFile)
  const deleteFile = useArtifactsStore((s) => s.deleteFile)
  const createFile = useArtifactsStore((s) => s.createFile)

  const language = useAppStore((s) => s.language)
  const t = translations[language]

  const tree = useMemo(() => buildTree(files), [files])

  return (
    <div className="flex h-full flex-col bg-ink-card">
      <div className="flex items-center justify-between border-b border-ink-line px-4 py-3 bg-ink-card/50">
        <span className="text-xs font-extrabold uppercase tracking-wider text-ink-dim">
          {t.filesHeader} ({Object.keys(files).length})
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={() => createFile('index.html', '<!doctype html>\n<html>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>\n', 'html')}
            className="border border-ink-line bg-ink-card rounded-lg px-2.5 py-1 text-xs font-bold text-ink-mut hover:border-ink-dim hover:text-ink-text shadow-sm transition flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            <span>html</span>
          </button>
          <button
            onClick={() => createFile('App.jsx', "export default function App() {\n  return <h1>Hello</h1>\n}\n", 'javascript')}
            className="border border-ink-line bg-ink-card rounded-lg px-2.5 py-1 text-xs font-bold text-ink-mut hover:border-ink-dim hover:text-ink-text shadow-sm transition flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            <span>jsx</span>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {tree.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-ink-dim font-semibold">{t.noChats === 'Henüz sohbet yok' ? 'Henüz dosya yok' : 'No files yet'}</p>
        ) : (
          tree.map((n) => (
            <Row
              key={n.path}
              node={n}
              depth={0}
              selectedPath={selectedPath}
              writingPath={writingPath}
              onSelect={selectFile}
            />
          ))
        )}
      </div>
      {selectedPath && (
        <button
          onClick={() => deleteFile(selectedPath)}
          className="border-t border-ink-line px-4 py-2.5 bg-ink-card/50 text-left text-xs font-bold text-ink-dim hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/15 transition flex items-center gap-1.5"
        >
          <Trash2 className="h-4 w-4" />
          <span>{language === 'tr' ? `“${selectedPath.split('/').pop()}” dosyasını sil` : `Delete file “${selectedPath.split('/').pop()}”`}</span>
        </button>
      )}
    </div>
  )
}
