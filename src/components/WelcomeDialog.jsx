import { useEffect, useState } from 'react'
import {
  Download,
  Play,
  Cable,
  Loader2,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Container,
  ArrowRight,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { useAppStore } from '@/store/appStore'
import { useDocker } from '@/hooks/useDocker'

const DOCKER_DOWNLOAD_URL = 'https://www.docker.com/products/docker-desktop/'

export function WelcomeDialog() {
  const {
    welcomeDialogOpen,
    setWelcomeDialogOpen,
    markOnboardingComplete,
    setConnectRemoteDialogOpen,
    dockerStatus,
  } = useAppStore()
  const { checkDocker } = useDocker()

  const [launching, setLaunching] = useState(false)
  const [launched, setLaunched] = useState(false)

  // Auto-close when Docker becomes running — the user is ready to go
  useEffect(() => {
    if (welcomeDialogOpen && dockerStatus.running) {
      markOnboardingComplete()
      setWelcomeDialogOpen(false)
    }
  }, [welcomeDialogOpen, dockerStatus.running])

  // While the welcome dialog is open and Docker isn't running, poll every 2s
  useEffect(() => {
    if (!welcomeDialogOpen || dockerStatus.running) return
    const id = setInterval(() => {
      checkDocker()
    }, 2000)
    return () => clearInterval(id)
  }, [welcomeDialogOpen, dockerStatus.running, checkDocker])

  const installed = dockerStatus.installed
  const running = dockerStatus.running

  const openDownloadPage = () => {
    window.gamalab.shell.openExternal(DOCKER_DOWNLOAD_URL)
  }

  const handleLaunchDocker = async () => {
    setLaunching(true)
    try {
      const result = await window.gamalab.docker.launchDesktop()
      if (result.launched) {
        setLaunched(true)
      }
    } finally {
      setLaunching(false)
    }
  }

  const handleConnectRemote = () => {
    markOnboardingComplete()
    setWelcomeDialogOpen(false)
    setConnectRemoteDialogOpen(true)
  }

  const handleSkip = () => {
    markOnboardingComplete()
    setWelcomeDialogOpen(false)
  }

  return (
    <Dialog open={welcomeDialogOpen} onOpenChange={setWelcomeDialogOpen}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center justify-center pt-2 pb-1">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-lab-blue/30 via-lab-green/20 to-lab-orange/20">
              <Logo className="h-10 w-10" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Welcome to GamaLab</DialogTitle>
          <DialogDescription className="text-center">
            Your Database Laboratory
          </DialogDescription>
        </DialogHeader>

        {!installed ? (
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-md border border-lab-orange/30 bg-lab-orange/5 px-3 py-2.5 text-sm">
              <div className="flex items-start gap-2">
                <Container className="mt-0.5 h-4 w-4 shrink-0 text-lab-orange" />
                <div>
                  <div className="font-semibold">Docker is not installed</div>
                  <div className="text-xs text-muted-foreground">
                    GamaLab uses Docker to spin up isolated Postgres containers locally.
                    You can still connect to any remote Postgres without Docker.
                  </div>
                </div>
              </div>
            </div>

            <OptionCard
              icon={Download}
              title="Install Docker Desktop"
              description="Get the free app from docker.com. After installing, come back here."
              action={
                <Button size="sm" variant="lab" onClick={openDownloadPage}>
                  Open download page
                  <ExternalLink className="h-3 w-3" />
                </Button>
              }
            />

            <OptionCard
              icon={Cable}
              title="Connect to an existing Postgres"
              description="Use Supabase, Neon, RDS, a VPS… anything with host and password."
              action={
                <Button size="sm" variant="ghost" onClick={handleConnectRemote}>
                  Connect now
                  <ArrowRight className="h-3 w-3" />
                </Button>
              }
            />
          </div>
        ) : !running ? (
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-md border border-lab-blue/30 bg-lab-blue/5 px-3 py-2.5 text-sm">
              <div className="flex items-start gap-2">
                <Container className="mt-0.5 h-4 w-4 shrink-0 text-lab-blue" />
                <div>
                  <div className="font-semibold">Docker is installed but not running</div>
                  <div className="text-xs text-muted-foreground">
                    Start Docker Desktop so GamaLab can create Postgres containers.
                    {launched && ' Waiting for the daemon to come up…'}
                  </div>
                </div>
              </div>
            </div>

            <OptionCard
              icon={Play}
              title="Start Docker Desktop"
              description="Launch Docker — we'll detect it automatically when it's ready."
              action={
                <Button
                  size="sm"
                  variant="lab"
                  onClick={handleLaunchDocker}
                  disabled={launching || launched}
                >
                  {launching ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Launching…
                    </>
                  ) : launched ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Waiting for Docker…
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      Start Docker
                    </>
                  )}
                </Button>
              }
            />

            <OptionCard
              icon={Cable}
              title="Connect to an existing Postgres instead"
              description="Skip Docker and use a remote server (Supabase, Neon, RDS…)."
              action={
                <Button size="sm" variant="ghost" onClick={handleConnectRemote}>
                  Connect now
                  <ArrowRight className="h-3 w-3" />
                </Button>
              }
            />

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Checking Docker every 2s…
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-10 w-10 text-lab-green" />
            <div className="text-center">
              <div className="font-semibold">Docker is ready</div>
              <div className="text-xs text-muted-foreground">You're all set — closing…</div>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-center">
          <Button variant="ghost" size="sm" onClick={handleSkip}>
            Skip setup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OptionCard({ icon: Icon, title, description, action }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background">
        <Icon className="h-4 w-4 text-lab-blue" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
