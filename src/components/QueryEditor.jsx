import { useCallback, useEffect, useRef } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import { format } from 'sql-formatter'
import { Wand2, Copy, Trash2, Bookmark, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/appStore'
import { useSchemaInfo } from '@/hooks/useSchemaInfo'

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
  const activeTab = useAppStore((s) =>
    s.queryTabs.find((t) => t.id === s.activeTabId) ?? null
  )
  const updateTabContent = useAppStore((s) => s.updateTabContent)
  const showToast = useAppStore((s) => s.showToast)
  const openSaveSnippetDialog = useAppStore((s) => s.openSaveSnippetDialog)
  const theme = useAppStore((s) => s.theme)
  const aiBarOpen = useAppStore((s) => s.aiBarOpen)
  const setAiBarOpen = useAppStore((s) => s.setAiBarOpen)
  const schemaInfo = useSchemaInfo()
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const schemaInfoRef = useRef([])
  const completionDisposableRef = useRef(null)
  const onRunRef = useRef(onRun)

  useEffect(() => {
    onRunRef.current = onRun
  }, [onRun])

  useEffect(() => {
    schemaInfoRef.current = schemaInfo
  }, [schemaInfo])

  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose?.()
      completionDisposableRef.current = null
    }
  }, [])

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
        onRunRef.current?.(sql)
      },
    })

    editor.addAction({
      id: 'format-query',
      label: 'Format SQL',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: () => formatSql(),
    })

    // Schema-aware SQL autocomplete — one provider registration that reads
    // the latest schemaInfo via ref (so it stays fresh without re-registering)
    completionDisposableRef.current?.dispose?.()
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' '],
      provideCompletionItems: (model, position) => {
        const info = schemaInfoRef.current || []
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const lineContent = model.getLineContent(position.lineNumber)
        const textBefore = lineContent.substring(0, position.column - 1)

        // "table." → columns of that table only
        const dotMatch = textBefore.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.(\w*)$/)
        if (dotMatch) {
          const tableName = dotMatch[1]
          const table = info.find(
            (t) => t.name === tableName || `${t.schema}.${t.name}` === tableName
          )
          if (table) {
            return {
              suggestions: table.columns.map((c) => ({
                label: c.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: c.udt_name || c.type,
                insertText: c.name,
                range,
                sortText: '0_' + c.name,
              })),
            }
          }
        }

        // Detect whether user is in a table-position (FROM / JOIN / INTO / UPDATE / TABLE)
        const textLower = textBefore
        const wantsTable = /\b(from|join|into|update|table|truncate)\s+[a-zA-Z0-9_."]*$/i.test(
          textLower
        )

        const suggestions = []
        for (const t of info) {
          const qualified = `${t.schema}.${t.name}`
          suggestions.push({
            label: t.name,
            kind:
              t.type === 'VIEW'
                ? monaco.languages.CompletionItemKind.Interface
                : monaco.languages.CompletionItemKind.Struct,
            detail: `${qualified}${t.type === 'VIEW' ? ' · view' : ''}`,
            insertText: t.name,
            range,
            sortText: (wantsTable ? '0_' : '2_') + t.name,
          })
        }
        if (!wantsTable) {
          // Column suggestions only when we're probably not typing a table
          for (const t of info) {
            for (const c of t.columns) {
              suggestions.push({
                label: c.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${t.name}.${c.name} · ${c.udt_name || c.type}`,
                insertText: c.name,
                range,
                sortText: '1_' + c.name,
              })
            }
          }
        }

        return { suggestions }
      },
    })
  }

  const formatSql = useCallback(() => {
    try {
      const value = editorRef.current?.getValue() || activeTab?.content || ''
      const formatted = format(value, { language: 'postgresql', keywordCase: 'upper' })
      if (editorRef.current) {
        editorRef.current.setValue(formatted)
      } else if (activeTab) {
        updateTabContent(activeTab.id, formatted)
      }
    } catch (err) {
      showToast(`Format failed: ${err.message}`, 'error')
    }
  }, [activeTab, updateTabContent, showToast])

  const copyQuery = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        editorRef.current?.getValue() || activeTab?.content || ''
      )
      showToast('Query copied', 'info')
    } catch {
      showToast('Copy failed', 'error')
    }
  }, [activeTab, showToast])

  const saveAsSnippet = () => {
    const sql = (editorRef.current?.getValue() ?? activeTab?.content ?? '').trim()
    if (!sql) {
      showToast('Write some SQL first, then save as snippet', 'warning')
      return
    }
    openSaveSnippetDialog({ sql })
  }

  const clearQuery = () => {
    if (editorRef.current) editorRef.current.setValue('')
    if (activeTab) updateTabContent(activeTab.id, '')
  }

  useEffect(() => {
    const handler = (e) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === 'Enter')) return
      // Skip if Monaco already handled it via its registered action.
      const active = document.activeElement
      const monacoEl = editorRef.current?.getDomNode?.()
      if (monacoEl && active && monacoEl.contains(active)) return
      e.preventDefault()
      onRun?.(editorRef.current?.getValue() ?? activeTab?.content ?? '')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab, onRun])

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
          <Button
            size="iconSm"
            variant="ghost"
            onClick={() => setAiBarOpen(!aiBarOpen)}
            title="AI assistant (Ctrl+I)"
            className={aiBarOpen ? 'text-lab-blue' : ''}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
          <Button size="iconSm" variant="ghost" onClick={copyQuery} title="Copy">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="iconSm"
            variant="ghost"
            onClick={saveAsSnippet}
            title="Save as snippet"
          >
            <Bookmark className="h-3.5 w-3.5" />
          </Button>
          <Button size="iconSm" variant="ghost" onClick={clearQuery} title="Clear">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          path={activeTab?.id ?? 'empty'}
          defaultLanguage="sql"
          theme={theme === 'dark' ? 'gamalab-dark' : 'gamalab-light'}
          value={activeTab?.content ?? ''}
          onChange={(v) => {
            if (activeTab) updateTabContent(activeTab.id, v ?? '')
          }}
          onMount={handleMount}
          options={{ ...MONACO_OPTIONS, readOnly: activeTab?.running ?? false }}
        />
      </div>
    </div>
  )
}
