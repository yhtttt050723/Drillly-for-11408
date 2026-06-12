import { lazy, Suspense, useCallback, useState, type KeyboardEvent } from 'react'
import { handleCodeTextareaTabKey } from '../utils/codeEditorTab'

const Monaco = lazy(() => import('@monaco-editor/react'))

type Props = {
  language: string
  value: string
  onChange: (v: string) => void
  height?: string
}

const MONACO_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 14,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 4,
  insertSpaces: true,
  detectIndentation: false,
  tabCompletion: 'off' as const,
}

function CodeTextarea({
  value,
  onChange,
  height,
  onArm,
}: {
  value: string
  onChange: (v: string) => void
  height: string
  onArm?: () => void
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    handleCodeTextareaTabKey(e, value, onChange)
  }

  return (
    <div className="lazy-editor-fallback" style={{ position: 'relative' }}>
      <textarea
        className="code-fallback"
        style={{ height, width: '100%' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {onArm && (
        <button
          type="button"
          className="btn btn-primary"
          style={{ position: 'absolute', right: 8, bottom: 8, fontSize: '0.8rem' }}
          onClick={onArm}
        >
          加载完整编辑器
        </button>
      )}
    </div>
  )
}

export function LazyCodeEditor({ language, value, onChange, height = '220px' }: Props) {
  const [armed, setArmed] = useState(false)

  const onMount = useCallback(
    (editor: import('monaco-editor').editor.IStandaloneCodeEditor) => {
      editor.updateOptions({
        tabSize: 4,
        insertSpaces: true,
        detectIndentation: false,
      })
    },
    [],
  )

  if (!armed) {
    return (
      <CodeTextarea
        value={value}
        onChange={onChange}
        height={height}
        onArm={() => setArmed(true)}
      />
    )
  }

  return (
    <Suspense
      fallback={
        <CodeTextarea value={value} onChange={onChange} height={height} />
      }
    >
      <Monaco
        height={height}
        language={language === 'cpp' ? 'cpp' : language}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={onMount}
        theme="vs-dark"
        loading={
          <div style={{ height, background: '#1e1e1e', color: '#aaa', padding: 8 }}>
            编辑器加载中…
          </div>
        }
        options={MONACO_OPTIONS}
      />
    </Suspense>
  )
}
