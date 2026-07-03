import { useEffect, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { useArtifactsStore } from '@/store/artifactsStore'
import type { FileLanguage } from '@/store/artifactsStore'

function extensionsFor(lang: FileLanguage) {
  switch (lang) {
    case 'html':
      return [html()]
    case 'css':
      return [css()]
    case 'javascript':
      return [javascript({ jsx: true })]
    case 'typescript':
      return [javascript({ jsx: true, typescript: true })]
    case 'json':
      return [json()]
    case 'markdown':
    case 'text':
    default:
      return []
  }
}

export default function CodeEditor() {
  const selectedPath = useArtifactsStore((s) => s.selectedPath)
  const file = useArtifactsStore((s) => (s.selectedPath ? s.files[s.selectedPath] : null))
  const writingPath = useArtifactsStore((s) => s.writingPath)
  const updateFile = useArtifactsStore((s) => s.updateFile)

  const isWriting = !!file && writingPath === file.path
  const wrapRef = useRef<HTMLDivElement>(null)

  // VSCode/Bolt feel: follow the cursor — auto-scroll to the bottom while the AI writes.
  useEffect(() => {
    if (!isWriting) return
    const scroller = wrapRef.current?.querySelector('.cm-scroller')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [isWriting, file?.content])

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-zinc-600">
        <p>Düzenlemek için bir dosya seç</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs text-zinc-400">{file.path}</span>
          {isWriting && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              yazılıyor
            </span>
          )}
        </span>
        <span className="text-[10px] uppercase text-zinc-600">{file.language}</span>
      </div>
      <div ref={wrapRef} className="flex-1 overflow-auto">
        <CodeMirror
          key={selectedPath}
          value={file.content}
          theme={oneDark}
          height="100%"
          readOnly={isWriting}
          extensions={[...extensionsFor(file.language), EditorView.lineWrapping]}
          onChange={(val) => {
            if (!isWriting) updateFile(file.path, val)
          }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            autocompletion: true
          }}
          style={{ fontSize: 13, height: '100%' }}
        />
      </div>
    </div>
  )
}
