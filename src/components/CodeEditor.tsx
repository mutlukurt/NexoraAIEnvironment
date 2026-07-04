import { useEffect, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { useArtifactsStore } from '@/store/artifactsStore'
import { useAppStore } from '@/store/appStore'
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
  const theme = useAppStore((s) => s.theme)

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
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-dim">
        <p>Düzenlemek için bir dosya seç</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-line bg-ink-card/60 px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs text-ink-mut">{file.path}</span>
          {isWriting && (
            <span className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-600 dark:text-brand-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              yazılıyor
            </span>
          )}
        </span>
        <span className="text-[10px] uppercase text-ink-dim">{file.language}</span>
      </div>
      <div ref={wrapRef} className="flex-1 overflow-auto">
        <CodeMirror
          key={selectedPath}
          value={file.content}
          theme={theme === 'dark' ? oneDark : 'light'}
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
