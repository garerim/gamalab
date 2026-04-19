import { Component } from 'react'
import { ErrorScreen } from '@/components/ErrorScreen'

/**
 * Top-level React error boundary. Without this, any uncaught exception in a
 * descendant component blanks the whole app and leaves the user no recourse
 * but to relaunch. With it, we render a recoverable error screen instead.
 *
 * Three recovery levels are exposed by ErrorScreen:
 *   1. "Try again" — clears the boundary state, re-mounts children
 *   2. "Reload window" — full window.location.reload()
 *   3. "Reset state" — clears persisted store + reloads (last-resort nuke)
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[ErrorBoundary]', error, info)
  }

  handleReset = () => {
    this.setState({ error: null, info: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleHardReset = async () => {
    try {
      await window.gamalab?.store?.delete?.('connections')
      await window.gamalab?.store?.delete?.('queryHistory')
      await window.gamalab?.store?.delete?.('onboardingCompleted')
    } catch {
      /* ignore — we're nuking anyway */
    }
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorScreen
          error={this.state.error}
          info={this.state.info}
          onReset={this.handleReset}
          onReload={this.handleReload}
          onHardReset={this.handleHardReset}
        />
      )
    }
    return this.props.children
  }
}
