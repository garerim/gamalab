import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/store/appStore'

const PING_INTERVAL_HEALTHY_MS = 30_000
const PING_INTERVAL_BROKEN_MS = 5_000
const SLOW_PING_MS = 1_500

/**
 * Background health-check for the active connection.
 *
 * Pings `SELECT 1` and writes the result into the store under
 * `connectionHealth[id]`. Surfaces 4 states:
 *   - healthy:  ping succeeded under 1.5s
 *   - degraded: ping succeeded but slow (e.g. saturated network, busy server)
 *   - broken:   ping failed (connection lost, server gone, network down)
 *   - unknown:  no ping yet
 *
 * Polling is adaptive: every 30s when healthy/degraded, but tightened to
 * every 5s while broken so recovery is detected quickly.
 *
 * Returns a `refreshHealth()` callback so callers (e.g. a clickable status
 * dot) can force an immediate re-ping.
 */
export function useHealthCheck() {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setConnectionHealth = useAppStore((s) => s.setConnectionHealth)
  const connectionHealth = useAppStore((s) => s.connectionHealth)
  const showToast = useAppStore((s) => s.showToast)
  const previousStatusRef = useRef(null)
  const pingNowRef = useRef(null)

  const currentStatus = activeConnectionId
    ? connectionHealth[activeConnectionId]?.status
    : null

  useEffect(() => {
    if (!activeConnectionId) {
      pingNowRef.current = null
      return
    }
    let cancelled = false
    previousStatusRef.current = null

    const runPing = async () => {
      try {
        const result = await window.gamalab.db.ping(activeConnectionId)
        if (cancelled) return
        let status
        if (!result.ok) status = 'broken'
        else if (result.duration > SLOW_PING_MS) status = 'degraded'
        else status = 'healthy'

        setConnectionHealth(activeConnectionId, {
          status,
          latencyMs: result.duration,
          error: result.error || null,
        })

        // Toast on transitions, not on every ping
        if (status === 'broken' && previousStatusRef.current !== 'broken') {
          showToast('Lost connection — auto-retry on next query', 'warning')
        } else if (
          status !== 'broken' &&
          previousStatusRef.current === 'broken'
        ) {
          showToast('Connection restored', 'success')
        }
        previousStatusRef.current = status
      } catch {
        if (cancelled) return
        setConnectionHealth(activeConnectionId, { status: 'broken', latencyMs: null })
      }
    }

    pingNowRef.current = runPing

    // First ping immediately so the sidebar gets a status without waiting
    runPing()

    // Adaptive interval: tighter when broken so recovery shows up quickly
    const interval =
      currentStatus === 'broken' ? PING_INTERVAL_BROKEN_MS : PING_INTERVAL_HEALTHY_MS
    const id = setInterval(runPing, interval)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [activeConnectionId, currentStatus, setConnectionHealth, showToast])

  const refreshHealth = useCallback(() => {
    if (pingNowRef.current) pingNowRef.current()
  }, [])

  // Stash the callback in the store so any component can trigger a ping
  const setForceHealthRefresh = useAppStore((s) => s.setForceHealthRefresh)
  useEffect(() => {
    setForceHealthRefresh(refreshHealth)
    return () => setForceHealthRefresh(null)
  }, [refreshHealth, setForceHealthRefresh])

  return { refreshHealth }
}
