export interface DocumentPipOptions {
  width?: number
  height?: number
  disallowReturnToOpener?: boolean
}

export interface DocumentPipController {
  isOpen: () => boolean
  open: (renderContainer: (pipDocument: Document) => void) => Promise<boolean>
  close: () => void
  getWindow: () => Window | null
}

/**
 * Checks if Chrome Document Picture-in-Picture API is supported.
 */
export function isDocumentPipSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window
}

/**
 * Copies all active style tags and linked stylesheets from main document into PiP window document.
 */
export function copyStylesheetsToPipWindow(targetDoc: Document): void {
  if (typeof document === 'undefined') return

  const styleElements = document.querySelectorAll('style, link[rel="stylesheet"]')
  styleElements.forEach((el) => {
    targetDoc.head.appendChild(el.cloneNode(true))
  })
}

/**
 * Creates a Document Picture-in-Picture window controller.
 */
export function createDocumentPipController(
  defaultOptions?: DocumentPipOptions
): DocumentPipController {
  let pipWindow: Window | null = null

  return {
    isOpen: () => pipWindow !== null && !pipWindow.closed,
    open: async (renderContainer: (pipDocument: Document) => void) => {
      if (!isDocumentPipSupported()) {
        return false
      }

      try {
        const docPip = (window as any).documentPictureInPicture
        const width = defaultOptions?.width || 480
        const height = defaultOptions?.height || 280

        pipWindow = await docPip.requestWindow({
          width,
          height,
          disallowReturnToOpener: defaultOptions?.disallowReturnToOpener || false,
        })

        if (!pipWindow) return false

        copyStylesheetsToPipWindow(pipWindow.document)

        // Inject dark theme baseline
        pipWindow.document.body.className = 'dark bg-zinc-950 text-zinc-100 m-0 p-2 overflow-hidden'

        renderContainer(pipWindow.document)

        pipWindow.addEventListener('pagehide', () => {
          pipWindow = null
        })

        return true
      } catch {
        return false
      }
    },
    close: () => {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.close()
        pipWindow = null
      }
    },
    getWindow: () => pipWindow,
  }
}
