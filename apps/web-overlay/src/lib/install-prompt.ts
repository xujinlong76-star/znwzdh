export const INSTALL_VISIT_KEY = 'navhub:install-visits:v1'
export const INSTALL_DISMISS_KEY = 'navhub:install-dismissed:v1'
export const INSTALL_MIN_VISITS = 3
export const INSTALL_DISMISS_DAYS = 14

export function parseVisitCount(raw: string | null): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
export function bumpVisitCount(raw: string | null): number {
  return parseVisitCount(raw) + 1
}

export function installDismissedUntil(now: number): number {
  return now + INSTALL_DISMISS_DAYS * 86_400_000
}
export interface InstallOfferInput {
  visits: number
  dismissedUntil: number
  now: number
  standalone: boolean
  canPrompt: boolean
}
export function shouldOfferInstall(input: InstallOfferInput): boolean {
  if (input.standalone || !input.canPrompt) return false
  if (input.visits < INSTALL_MIN_VISITS) return false
  return input.now >= input.dismissedUntil
}
