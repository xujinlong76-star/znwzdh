/**
 * In-Browser Interactive Multi-File Code Sandbox & Execution Container
 * Proposal [5]: WebContainer-based Live In-Browser Video Dev Environment
 * Provides an in-memory Virtual File System (VFS), multi-file dependency resolver,
 * isolated code evaluation with intercepted console logging, and HTML preview generator.
 */

export interface VirtualFile {
  path: string
  content: string
  language: 'typescript' | 'javascript' | 'json' | 'html' | 'css'
  lastModified: number
}

export interface SandboxExecutionResult {
  success: boolean
  logs: Array<{ type: 'log' | 'warn' | 'error' | 'info'; text: string; timestamp: number }>
  returnValue?: any
  executionTimeMs: number
  errorMessage?: string
}

/**
 * Virtual In-Memory File System for sandbox workspaces.
 */
export class VirtualFileSystem {
  private files: Map<string, VirtualFile> = new Map()

  constructor(initialFiles: Record<string, string> = {}) {
    Object.entries(initialFiles).forEach(([p, content]) => {
      this.writeFile(p, content)
    })
  }

  writeFile(path: string, content: string): void {
    const normalized = path.startsWith('/') ? path : `/${path}`
    let language: VirtualFile['language'] = 'typescript'
    if (normalized.endsWith('.json')) language = 'json'
    else if (normalized.endsWith('.html')) language = 'html'
    else if (normalized.endsWith('.css')) language = 'css'
    else if (normalized.endsWith('.js')) language = 'javascript'

    this.files.set(normalized, {
      path: normalized,
      content,
      language,
      lastModified: Date.now(),
    })
  }

  readFile(path: string): string | null {
    const normalized = path.startsWith('/') ? path : `/${path}`
    const f = this.files.get(normalized)
    return f ? f.content : null
  }

  deleteFile(path: string): boolean {
    const normalized = path.startsWith('/') ? path : `/${path}`
    return this.files.delete(normalized)
  }

  listFiles(): VirtualFile[] {
    return Array.from(this.files.values())
  }

  hasFile(path: string): boolean {
    const normalized = path.startsWith('/') ? path : `/${path}`
    return this.files.has(normalized)
  }
}

/**
 * In-Memory Bundler & Code Execution Runtime.
 */
export class SandboxRuntime {
  private vfs: VirtualFileSystem

  constructor(vfs?: VirtualFileSystem) {
    this.vfs = vfs || new VirtualFileSystem({
      '/index.ts': `// 欢迎来到视频即时联调沙盒
import { calculateThroughput } from './utils.ts'

const rate = calculateThroughput(1000, 42)
console.log("🔥 测得系统吞吐量:", rate, "req/s")
return { status: "ready", rate }
`,
      '/utils.ts': `export function calculateThroughput(requests: number, latencyMs: number): number {
  if (latencyMs <= 0) return 0
  return Math.round((requests / latencyMs) * 1000)
}
`,
      '/package.json': `{
  "name": "video-live-sandbox",
  "version": "1.0.0",
  "main": "index.ts"
}`,
    })
  }

  getVFS(): VirtualFileSystem {
    return this.vfs
  }

  /**
   * Bundles imported modules into a single executable closure.
   */
  bundle(entryPath: string = '/index.ts'): string {
    const entryContent = this.vfs.readFile(entryPath)
    if (!entryContent) {
      throw new Error(`Entry file not found: ${entryPath}`)
    }

    // Resolves simple relative imports: e.g. import { ... } from './utils.ts'
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"]/g
    let resolvedCode = entryContent.replace(importRegex, (_, imports, relPath) => {
      const fullPath = `/${relPath.replace(/\.ts$/, '')}.ts`
      const depContent = this.vfs.readFile(fullPath)
      if (depContent) {
        // Strip export keyword in dep
        const strippedDep = depContent.replace(/export\s+/g, '')
        return `// [Inlined from ${fullPath}]\n${strippedDep}\n`
      }
      return `// [Missing dependency ${fullPath}]`
    })

    // Clean TypeScript type annotations
    resolvedCode = resolvedCode
      .replace(/:\s*(string|number|boolean|any|void|Record<[^>]+>)/g, '')
      .replace(/interface\s+\w+\s*\{[^}]*\}/g, '')

    return resolvedCode
  }

  /**
   * Executes the bundled code and captures execution logs & return values.
   */
  async execute(entryPath: string = '/index.ts'): Promise<SandboxExecutionResult> {
    const startTime = performance.now()
    const capturedLogs: SandboxExecutionResult['logs'] = []

    try {
      const code = this.bundle(entryPath)
      const fakeConsole = {
        log: (...args: any[]) => {
          capturedLogs.push({
            type: 'log',
            text: args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
            timestamp: Date.now(),
          })
        },
        warn: (...args: any[]) => {
          capturedLogs.push({
            type: 'warn',
            text: args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
            timestamp: Date.now(),
          })
        },
        error: (...args: any[]) => {
          capturedLogs.push({
            type: 'error',
            text: args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
            timestamp: Date.now(),
          })
        },
      }

      // Execute inside Function scope
      const runnerFn = new Function('console', code)
      const returnValue = runnerFn(fakeConsole)

      return {
        success: true,
        logs: capturedLogs,
        returnValue,
        executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      }
    } catch (err: any) {
      return {
        success: false,
        logs: capturedLogs,
        errorMessage: err?.message || String(err),
        executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      }
    }
  }

  /**
   * Generates an interactive preview HTML document for iframes.
   */
  generateIframePreview(htmlPath: string = '/index.html'): string {
    const html = this.vfs.readFile(htmlPath) || `<!DOCTYPE html>
<html>
  <head>
    <style>body { font-family: system-ui; background: #09090b; color: #f4f4f5; padding: 1rem; }</style>
  </head>
  <body>
    <h3>🔥 视频沙盒 DOM 预览模式</h3>
    <p>可以在此渲染前端组件或可交互页面原型。</p>
  </body>
</html>`
    return html
  }
}
