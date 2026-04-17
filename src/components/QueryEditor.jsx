import { useCallback, useEffect, useRef } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import { format } from 'sql-formatter'
import { Wand2, Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/appStore'

loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs',
  },
})

const MONACO_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 14,
  fontFamily:
    "'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
  lineNumbersMinChars: 3,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  renderLineHighlight: 'all',
  automaticLayout: true,
  padding: { top: 12, bottom: 12 },
  tabSize: 2,
  wordWrap: 'on',
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
}

export function QueryEditor({ onRun }) {
  const { currentQuery, setCurrentQuery, queryRunning, showToast, theme } = useAppStore()
  const editorRef = useRef(null)
  const monacoRef = useRef(null)

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    monaco.editor.defineTheme('gamalab-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword.sql', foreground: '6EB6FF', fontStyle: 'bold' },
        { token: 'string.sql', foreground: '9ECE6A' },
        { token: 'number.sql', foreground: 'FF9E64' },
        { token: 'comment.sql', foreground: '565f89', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#0a0a0a',
        'editor.foreground': '#e5e5e5',
        'editorLineNumber.foreground': '#3a3a3a',
        'editorLineNumber.activeForeground': '#6EB6FF',
        'editor.lineHighlightBackground': '#141414',
        'editorCursor.foreground': '#6EB6FF',
        'editor.selectionBackground': '#264f7850',
      },
    })
    monaco.editor.defineTheme('gamalab-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword.sql', foreground: '0369A1', fontStyle: 'bold' },
        { token: 'string.sql', foreground: '15803D' },
        { token: 'number.sql', foreground: 'B45309' },
        { token: 'comment.sql', foreground: '64748B', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#1E293B',
        'editorLineNumber.foreground': '#CBD5E1',
        'editorLineNumber.activeForeground': '#0369A1',
        'editor.lineHighlightBackground': '#F1F5F9',
        'editorCursor.foreground': '#0369A1',
        'editor.selectionBackground': '#BAE6FD80',
      },
    })
    monaco.editor.setTheme(theme === 'dark' ? 'gamalab-dark' : 'gamalab-light')

    editor.addAction({
      id: 'run-query',
      label: 'Run Query',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      ],
      run: () => {
        const sql = editor.getModel().getValue()
        onRun?.(sql)
      },
    })

    editor.addAction({
      id: 'format-query',
      label: 'Format SQL',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: () => formatSql(),
    })
  }

  const formatSql = useCallback(() => {
    try {
      const value = editorRef.current?.getValue() || currentQuery
      const formatted = format(value, { language: 'postgresql', keywordCase: 'upper' })
      if (editorRef.current) {
        editorRef.current.setValue(formatted)
      } else {
        setCurrentQuery(formatted)
      }
    } catch (err) {
      showToast(`Format failed: ${err.message}`, 'error')
    }
  }, [currentQuery, setCurrentQuery, showToast])

  const copyQuery = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editorRef.current?.getValue() || currentQuery)
      showToast('Query copied', 'info')
    } catch {
      showToast('Copy failed', 'error')
    }
  }, [currentQuery, showToast])

  const clearQuery = () => {
    if (editorRef.current) editorRef.current.setValue('')
    setCurrentQuery('')
  }

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onRun?.(editorRef.current?.getValue() || currentQuery)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentQuery, onRun])

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(theme === 'dark' ? 'gamalab-dark' : 'gamalab-light')
    }
  }, [theme])

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-9 items-center justify-between border-b border-border bg-card px-2">
        <div className="flex items-center gap-2 pl-1 text-xs font-medium text-muted-foreground">
          <span className="text-lab-blue">SQL</span>
          <span>Editor</span>
          <span className="ml-2 text-[10px]">(Ctrl/Cmd+Enter to run)</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="iconSm" variant="ghost" onClick={formatSql} title="Format (Shift+Alt+F)">
            <Wand2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="iconSm" variant="ghost" onClick={copyQuery} title="Copy">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="iconSm" variant="ghost" onClick={clearQuery} title="Clear">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme={theme === 'dark' ? 'gamalab-dark' : 'gamalab-light'}
          value={currentQuery}
          onChange={(v) => setCurrentQuery(v ?? '')}
          onMount={handleMount}
          options={{ ...MONACO_OPTIONS, readOnly: queryRunning }}
        />
      </div>
    </div>
  )
}
