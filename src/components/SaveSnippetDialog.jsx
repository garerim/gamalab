// src/components/SaveSnippetDialog.jsx
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store/appStore'
import { useSnippets } from '@/hooks/useSnippets'

export function SaveSnippetDialog() {
  const open = useAppStore((s) => s.saveSnippetDialogOpen)
  const editingSnippet = useAppStore((s) => s.editingSnippet)
  const prefilledSql = useAppStore((s) => s.saveSnippetDialogPrefilledSql)
  const closeDialog = useAppStore((s) => s.closeSaveSnippetDialog)
  const { saveSnippet } = useSnippets()

  const isEdit = !!editingSnippet
  const sqlToShow = editingSnippet?.sql ?? prefilledSql ?? ''

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset / hydrate fields when the dialog opens
  useEffect(() => {
    if (!open) return
    if (editingSnippet) {
      setName(editingSnippet.name || '')
      setDescription(editingSnippet.description || '')
    } else {
      setName('')
      setDescription('')
    }
  }, [open, editingSnippet])

  const canSave = name.trim().length > 0 && !saving

  const onSave = async () => {
    if (!canSave) return
    setSaving(true)
    let result
    try {
      result = isEdit
        ? await saveSnippet({
            id: editingSnippet.id,
            name,
            sql: editingSnippet.sql,
            description,
          })
        : await saveSnippet({ name, sql: sqlToShow, description })
    } finally {
      setSaving(false)
    }
    if (result) closeDialog()
  }

  const onOpenChange = (next) => {
    if (!next) closeDialog()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit snippet' : 'Save snippet'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Top users last 7d"
              autoFocus
              disabled={saving}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) {
                  e.preventDefault()
                  onSave()
                }
              }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Description (optional)
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="What does this query do?"
              disabled={saving}
              className="resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              SQL (read-only)
            </span>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] leading-snug">
              {sqlToShow || <em className="text-muted-foreground">(empty)</em>}
            </pre>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!canSave}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
