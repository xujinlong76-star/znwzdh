export type ColorVisionMode =
  | 'normal'
  | 'protanopia' // Red-blind
  | 'deuteranopia' // Green-blind
  | 'tritanopia' // Blue-blind
  | 'high-contrast'
  | 'monochrome'

export interface A11ySightGuardSettings {
  colorMode: ColorVisionMode
  fontSizeScale: number // 0.85 - 1.4
  dyslexicFont: boolean
  screenReaderAnnouncements: boolean
  keyboardFocusOutline: boolean
}

/**
 * Standard W3C SVG color transformation matrices for Color Vision Deficiency (CVD).
 */
export const CVD_COLOR_MATRICES: Record<ColorVisionMode, string> = {
  normal: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0',
  // Protanopia matrix
  protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
  // Deuteranopia matrix
  deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
  // Tritanopia matrix
  tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
  // High-Contrast enhanced luminance
  'high-contrast': '1.5 0 0 0 -0.1  0 1.5 0 0 -0.1  0 0 1.5 0 -0.1  0 0 0 1 0',
  // Monochrome luminance
  monochrome: '0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0',
}

/**
 * Generates an inline SVG Filter definition element for applying the CVD matrix to video elements.
 */
export function generateSvgFilterMarkup(mode: ColorVisionMode, filterId: string = 'cvd-filter'): string {
  const matrix = CVD_COLOR_MATRICES[mode] || CVD_COLOR_MATRICES.normal
  return `
<svg style="position: absolute; width: 0; height: 0; overflow: hidden;" aria-hidden="true">
  <filter id="${filterId}">
    <feColorMatrix type="matrix" values="${matrix}" />
  </filter>
</svg>
`.trim()
}

/**
 * Dispatches an accessible speech announcement to screen readers via ARIA live region.
 */
export function announceToScreenReader(
  message: string,
  politeness: 'polite' | 'assertive' = 'polite'
): void {
  if (typeof document === 'undefined') return

  let liveRegion = document.getElementById('a11y-live-announcer')
  if (!liveRegion) {
    liveRegion = document.createElement('div')
    liveRegion.id = 'a11y-live-announcer'
    liveRegion.setAttribute('aria-live', politeness)
    liveRegion.setAttribute('aria-atomic', 'true')
    liveRegion.style.position = 'absolute'
    liveRegion.style.width = '1px'
    liveRegion.style.height = '1px'
    liveRegion.style.margin = '-1px'
    liveRegion.style.overflow = 'hidden'
    liveRegion.style.clip = 'rect(0, 0, 0, 0)'
    liveRegion.style.whiteSpace = 'nowrap'
    document.body.appendChild(liveRegion)
  }

  liveRegion.textContent = ''
  setTimeout(() => {
    if (liveRegion) {
      liveRegion.textContent = message
    }
  }, 50)
}
