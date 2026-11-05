/**
 * In-Browser Interactive Multi-File Code Sandbox & Execution Container
 * Proposal [5]: WebContainer-based Live In-Browser Video Dev Environment
 * Provides an in-memory Virtual File System (VFS), multi-file dependency resolver,
 * isolated code execution with intercepted console logging, and HTML preview generator.
 *
 * 「isolated」在 2026-11-01 之前是假的：执行走 `new Function`，跑在**页面自己的 realm**，
 * 而这里的代码来自 AI 生成 + 用户粘贴，所以那一段文字能读 localStorage 里的会话。
 * 同一天还查到第二件事：本仓 CSP 不含 `unsafe-eval`，那行 `new Function` 在真人浏览器里
 * 报的是 CSP 违规 —— 这个「运行工程」按钮从来没真的跑通过。
 * 现在执行统一交给 lib/video-opaque-sandbox.ts 的不透明源 iframe；沙盒不可用时
 * 返回 success:false + stopReason='unavailable'，**不**退回同源执行（退回去等于白改）。
 */

import {
  openOpaqueSession,
  type OpaqueLogEntry,
  type OpaqueSession,
  type OpaqueStopReason,
} from './video-opaque-sandbox'

export interface VirtualFile {
  path: string
  content: string
  language: 'typescript' | 'javascript' | 'json' | 'html' | 'css'
  lastModified: number
}

export interface SandboxExecutionResult {
  success: boolean
  logs: Array<{ type: 'log' | 'warn' | 'error' | 'info'; text: string; timestamp: number }>
  /** 沙盒里的 `exports` 快照（没有导出就没有值；顶层 return 在脚本里是语法错误） */
  returnValue?: unknown
  /** 导出里有传不回来的东西（函数 / class / 循环引用…）时的纯文本，界面优先显示它 */
  returnValueText?: string
  executionTimeMs: number
  errorMessage?: string
  /**
   * 只有「根本没进沙盒跑」时才有值：
   * unavailable = 环境不给跑（界面该显示「仅阅读」），rejected = 代码超上限，timeout = 卡住。
   */
  stopReason?: OpaqueStopReason
}

/** 测试注入点：不传就用真的不透明源沙盒 */
export interface SandboxRuntimeDeps {
  openSession?: () => Promise<OpaqueSession>
}

function toSandboxLog(entry: OpaqueLogEntry): SandboxExecutionResult['logs'][number] {
  return { type: entry.level, text: entry.text, timestamp: entry.timestamp }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
  private deps: SandboxRuntimeDeps

  constructor(vfs?: VirtualFileSystem, deps: SandboxRuntimeDeps = {}) {
    this.deps = deps
    this.vfs = vfs || new VirtualFileSystem({
      '/index.ts': `// 欢迎来到视频即时联调沙盒
import { calculateThroughput } from './utils.ts'

const rate = calculateThroughput(1000, 42)
console.log("🔥 测得系统吞吐量:", rate, "req/s")

// 沙盒里代码是一段一段被浏览器编译的普通脚本，顶层 return 是语法错误；
// 要给外面看结果就往 exports 上挂（课后 TDD 也是按这个名字取函数的）。
exports.result = { status: "ready", rate }
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
   * Executes the bundled code inside the opaque-origin sandbox and captures logs & return value.
   */
  async execute(entryPath: string = '/index.ts'): Promise<SandboxExecutionResult> {
    const startTime = performance.now()
    const elapsed = () => Math.round((performance.now() - startTime) * 100) / 100

    // 先打包再开沙盒：入口文件不存在是「这次改动写错了」，不该为此白起一个 iframe，
    // 也不该让它被下面 catch 归因成「隔离沙盒不可用」（2026-10 的口径同类错误：
    // 环境问题与用户代码问题必须分得开）。
    let code: string
    try {
      code = this.bundle(entryPath)
    } catch (err) {
      return { success: false, logs: [], executionTimeMs: elapsed(), errorMessage: errorMessage(err) }
    }

    const open = this.deps.openSession ?? openOpaqueSession
    let session: OpaqueSession
    try {
      session = await open()
    } catch (err) {
      return {
        success: false,
        logs: [],
        executionTimeMs: elapsed(),
        errorMessage: `隔离沙盒不可用，代码未执行：${errorMessage(err)}`,
        stopReason: 'unavailable',
      }
    }

    try {
      const outcome = await session.load(code)
      const logs = [...session.logs].map(toSandboxLog)
      if (outcome.stopReason) {
        return {
          success: false,
          logs,
          executionTimeMs: elapsed(),
          errorMessage: outcome.errorText ?? '隔离沙盒未能完成执行',
          stopReason: outcome.stopReason,
        }
      }
      if (!outcome.ok) {
        return {
          success: false,
          logs,
          executionTimeMs: elapsed(),
          errorMessage: outcome.errorText ?? '未知执行错误',
        }
      }
      return {
        success: true,
        logs,
        returnValue: outcome.hasValue ? outcome.value : undefined,
        returnValueText: outcome.valueUnavailable ? outcome.valueText : undefined,
        executionTimeMs: elapsed(),
      }
    } catch (err) {
      return {
        success: false,
        logs: [...session.logs].map(toSandboxLog),
        errorMessage: errorMessage(err),
        executionTimeMs: elapsed(),
      }
    } finally {
      session.close()
    }
  }

  /**
   * Generates an interactive preview HTML document for iframes.
   *
   * 返回值是**未过滤的用户 HTML**，只能交给不透明源容器渲染
   * （`<iframe sandbox="allow-scripts">` + `srcDoc`）；把它写进同源文档的 innerHTML
   * 就是 lib/video-pip-content.ts 当初关掉的那个出口。守卫测试
   * test/opaque-code-sandbox-guard.test.ts 盯着所有 srcdoc/srcDoc 的容器属性。
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
