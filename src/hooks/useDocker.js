import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store/appStore'

export function useDocker() {
  const {
    dockerStatus,
    containers,
    loadingContainers,
    setDockerStatus,
    setContainers,
    setLoadingContainers,
    showToast,
  } = useAppStore()

  const pollingRef = useRef(null)

  const checkDocker = useCallback(async () => {
    try {
      const status = await window.gamalab.docker.check()
      setDockerStatus(status)
      return status
    } catch (err) {
      setDockerStatus({ installed: false, running: false, error: err.message })
      return null
    }
  }, [setDockerStatus])

  const refreshContainers = useCallback(async () => {
    setLoadingContainers(true)
    try {
      const list = await window.gamalab.docker.list()
      setContainers(list)
      return list
    } catch (err) {
      showToast(err.message, 'error')
      return []
    } finally {
      setLoadingContainers(false)
    }
  }, [setContainers, setLoadingContainers, showToast])

  const createContainer = useCallback(
    async (config) => {
      try {
        const container = await window.gamalab.docker.create(config)
        showToast(`Container "${container.name}" created on port ${container.port}`, 'success')
        await refreshContainers()
        return container
      } catch (err) {
        showToast(err.message, 'error')
        throw err
      }
    },
    [refreshContainers, showToast]
  )

  const startContainer = useCallback(
    async (id) => {
      try {
        await window.gamalab.docker.start(id)
        showToast('Container started', 'success')
        await refreshContainers()
      } catch (err) {
        showToast(err.message, 'error')
      }
    },
    [refreshContainers, showToast]
  )

  const stopContainer = useCallback(
    async (id) => {
      try {
        await window.gamalab.docker.stop(id)
        showToast('Container stopped', 'info')
        await refreshContainers()
      } catch (err) {
        showToast(err.message, 'error')
      }
    },
    [refreshContainers, showToast]
  )

  const restartContainer = useCallback(
    async (id) => {
      try {
        await window.gamalab.docker.restart(id)
        showToast('Container restarted', 'success')
        await refreshContainers()
      } catch (err) {
        showToast(err.message, 'error')
      }
    },
    [refreshContainers, showToast]
  )

  const removeContainer = useCallback(
    async (id, removeVolume = false) => {
      const confirmed = await window.gamalab.dialog.confirm({
        title: 'Delete container',
        message: 'Are you sure you want to delete this container?',
        detail: removeVolume
          ? 'This will permanently delete the container and its data volume.'
          : 'The container will be deleted, but the data volume will be preserved.',
      })
      if (!confirmed) return false
      try {
        await window.gamalab.docker.remove(id, removeVolume)
        showToast('Container deleted', 'info')
        await refreshContainers()
        return true
      } catch (err) {
        showToast(err.message, 'error')
        return false
      }
    },
    [refreshContainers, showToast]
  )

  useEffect(() => {
    checkDocker().then((status) => {
      if (status?.running) refreshContainers()
    })
  }, [checkDocker, refreshContainers])

  useEffect(() => {
    if (!dockerStatus.running) return
    pollingRef.current = setInterval(() => {
      refreshContainers()
    }, 10000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [dockerStatus.running, refreshContainers])

  return {
    dockerStatus,
    containers,
    loadingContainers,
    checkDocker,
    refreshContainers,
    createContainer,
    startContainer,
    stopContainer,
    restartContainer,
    removeContainer,
  }
}
