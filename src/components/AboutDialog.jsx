import { useEffect, useState } from 'react'
import { Github, ExternalLink, ShieldCheck, ShieldAlert } from 'lucide-react'
import { Logo } from '@/components/Logo'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/appStore'

export function AboutDialog() {
  const { aboutOpen, setAboutOpen } = useAppStore()
  const [version, setVersion] = useState('')
  const [platform, setPlatform] = useState('')
  const [credsEncrypted, setCredsEncrypted] = useState(null)

  useEffect(() => {
    if (aboutOpen) {
      window.gamalab.app.version().then(setVersion).catch(() => {})
      window.gamalab.app.platform().then(setPlatform).catch(() => {})
      window.gamalab.credentials?.isEncrypted?.().then(setCredsEncrypted).catch(() => {})
    }
  }, [aboutOpen])

  return (
    <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">About GamaLab</DialogTitle>
          <DialogDescription className="sr-only">
            Your Database Laboratory
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-lab-blue/30 via-lab-green/20 to-lab-orange/20">
            <Logo className="h-12 w-12" />
            <span className="absolute -bottom-1 -right-1 text-2xl">🧪</span>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">GamaLab</h2>
            <p className="text-sm italic text-muted-foreground">Your Database Laboratory</p>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Experiment faster with PostgreSQL. Create and manage local databases via
            Docker with an interactive SQL editor.
          </p>
          <div className="flex gap-3 pt-2 text-xs text-muted-foreground">
            <span>v{version || '0.1.0'}</span>
            <span>·</span>
            <span>{platform || 'app'}</span>
            <span>·</span>
            <span>Electron + React</span>
          </div>

          {credsEncrypted !== null && (
            <div
              className={
                credsEncrypted
                  ? 'mt-1 inline-flex items-center gap-1.5 text-[11px] text-lab-green'
                  : 'mt-1 inline-flex items-center gap-1.5 text-[11px] text-lab-orange'
              }
              title={
                credsEncrypted
                  ? 'Connection passwords are encrypted using the OS keyring.'
                  : 'OS keyring unavailable — passwords are stored in plaintext.'
              }
            >
              {credsEncrypted ? (
                <>
                  <ShieldCheck className="h-3 w-3" />
                  Credentials encrypted via OS keyring
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3 w-3" />
                  Credentials stored in plaintext (OS keyring unavailable)
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-center">
          <Button variant="ghost" size="sm" asChild>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                window.gamalab.shell.openExternal('https://github.com')
              }}
              className="inline-flex items-center gap-1.5"
            >
              <Github className="h-3.5 w-3.5" />
              GitHub
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
          <Button variant="lab" size="sm" onClick={() => setAboutOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
