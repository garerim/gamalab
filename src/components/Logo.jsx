import logoWhite from '@/assets/logo-white.png'
import logoDark from '@/assets/logo-dark.png'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

/**
 * GamaLab logo. Accepts the same className API as a lucide icon
 * (e.g. `h-5 w-5`) so it can replace FlaskConical usages verbatim.
 *
 * Automatically swaps between the white (dark theme) and dark (light
 * theme) variants based on the active app theme. Pass `variant` to force.
 */
export function Logo({ className, alt = 'GamaLab', variant, ...rest }) {
  const theme = useAppStore((s) => s.theme)
  const resolvedVariant = variant ?? (theme === 'dark' ? 'white' : 'dark')
  const src = resolvedVariant === 'white' ? logoWhite : logoDark

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={cn('select-none object-contain', className)}
      {...rest}
    />
  )
}
