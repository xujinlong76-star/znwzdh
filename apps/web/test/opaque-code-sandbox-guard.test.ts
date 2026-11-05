/**
 * 代码执行面的隔离守卫（A2，2026-11-01）。
 *
 * 要拦的事故：视频页的「即时运行」面板把 AI 生成 / 用户粘贴的代码用 `new Function`
 * 扔进**页面自己的 realm** 执行。同源 ⇒ 那段代码能读 localStorage 里的会话、带 cookie
 * 发请求、改写父 DOM。而本仓 CSP 不含 `unsafe-eval`，那条 API 在真人浏览器里报的根本
 * 是 CSP 违规 —— 安全与能用两件事一起坏。现在代码只经「脚本元素 + textContent」进
 * 不透明源帧，全仓零求值点。
 *
 * 六组判据，各自都会静默失效，所以分开钉：
 *   A 全仓零求值：src 树里 `new Function` / `eval` 的代码点为 0（harness 也没有豁免口），
 *     沙盒里那条「把字符串交给浏览器编译」的路只有脚本元素这一处，且 CSP 前提没被放宽；
 *   B 容器隔离性：凡是「我们自己造文档内容」的 iframe（srcdoc / createObjectURL），
 *     其 sandbox 值必须解析得出且不含 `allow-same-origin`；带 allow-same-origin 的
 *     容器全仓只许有一个，且必须是外部视频站内嵌（内容由对方源提供，不是我们造的）；
 *   C 回信验源：父侧每处 message 监听都必须先比 `event.source`，否则页面上其他 iframe
 *     （播放器内嵌）能伪造执行结果；
 *   D 不可用不降级：没有 DOM 的环境里跑一次，必须返回 blocked/unavailable **且日志为空**
 *     ——真降级回同源的话，那段代码会真的执行并打出日志，这条当场红；
 *   E 行为：stub 会话驱动两个消费者，覆盖成功 / 语法错 / 超时 / toThrow /
 *     「导出根本不存在不算 toThrow 通过」 / 返回值不可克隆 / 隔离不可用；
 *   F 扫描机没瞎：每种判据都喂一份应当被抓到的合成样本。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { SandboxRuntime, VirtualFileSystem } from '@/lib/video-code-sandbox-runtime'
import { runLiveCodeTest, type LiveTestCaseSpec } from '@/lib/video-live-test-runner'
import {
  SANDBOX_FLAGS,
  type OpaqueLogEntry,
  type OpaqueRunOutcome,
  type OpaqueSession,
} from '@/lib/video-opaque-sandbox'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listSources(full, out)
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, '/'))
  }
  return out.sort()
}

const SOURCES = listSources(join(ROOT, 'src'))
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** harness 所在的文件（它自己也在零求值范围内：2026-11-01 起没有豁免口） */
const HARNESS_FILE = 'src/lib/video-opaque-sandbox.ts'

/** 沙盒把字符串变成可执行体的**唯一**允许形状：脚本元素 + textContent */
const SCRIPT_INJECTION = {
  name: "createElement('script')",
  // harness 是字符串数组，源文件里那对引号前面还有个反斜杠转义
  re: /createElement\(\s*\\?['"]script\\?['"]\s*\)/,
}

/** 取 CSP 里某条指令的完整值（next.config.js 的 CSP_DIRECTIVES 是唯一事实源） */
function cspDirective(name: string): string {
  const config = read('next.config.js')
  const start = config.indexOf('const CSP_DIRECTIVES')
  const block = config.slice(start, config.indexOf('].join', start))
  // 值里就带单引号（'self'），所以只能按「整行一条指令、首尾同种引号」来切；
  // 读不到就返回空串，让上层判据红，而不是猜一个。
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim().replace(/,$/, '')
    const edge = line[0]
    if (edge !== '"' && edge !== "'" && edge !== '`') continue
    if (line[line.length - 1] !== edge || line.length < 2) continue
    const value = line.slice(1, -1)
    if (value === name || value.startsWith(`${name} `)) return value
  }
  return ''
}

/* --------------------------- A：全仓零求值 --------------------------- */

/** 只认「真的在构造可执行体」的形状；注释里提一句 `new Function` 不算（都不带左括号） */
const EVAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'new Function(', re: /\bnew\s+Function\s*\(/ },
  { name: "Function('…')", re: /\bFunction\s*\(\s*['"`]/ },
  { name: 'eval(', re: /\beval\s*\(/ },
]

/** 按行计数：`new Function('console', …)` 同时命中两种形状，算一处求值点而不是两处 */
function evalSites(text: string): string[] {
  const hits: string[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const names = EVAL_PATTERNS.filter((pattern) => pattern.re.test(line)).map((pattern) => pattern.name)
    if (names.length > 0) hits.push(`${i + 1}[${names.join('+')}] ${line.trim()}`)
  })
  return hits
}

describe('A：全仓一个求值点都不许有', () => {
  it('src 树里 new Function / eval 的代码点为 0（harness 也不例外）', () => {
    const offenders: string[] = []
    for (const file of SOURCES) {
      for (const site of evalSites(read(file))) offenders.push(`${file} ${site}`)
    }
    expect(offenders, '这些行会把字符串编译成代码：\n' + offenders.join('\n')).toEqual([])
  })

  it('沙盒把代码交给浏览器的形状：脚本元素 + textContent，没有第二条路', () => {
    const text = read(HARNESS_FILE)
    expect(
      text.split(/\r?\n/).filter((line) => SCRIPT_INJECTION.re.test(line)).length,
      'harness 里造脚本元素的地方必须恰好一处',
    ).toBe(1)
    expect(text).toContain('el.textContent = code;')
    // harness 是逐字数组：出现 ${ 就说明有人开始往壳子里拼字符串
    const harnessBlock = text.slice(text.indexOf('const HARNESS_HTML = ['), text.indexOf('].join'))
    expect(harnessBlock, 'harness 里不许有 ${} 插值').not.toContain('${')
  })

  it('本仓 CSP 不含 unsafe-eval——这正是「求值路径根本不存在」的前提', () => {
    const scriptSrc = cspDirective('script-src')
    expect(scriptSrc, 'CSP 的 script-src 读不到了，判据要跟着改').not.toBe('')
    expect(scriptSrc, '一旦放进 unsafe-eval，前面那条「零求值」就变成可自行绕过的门').not.toContain(
      'unsafe-eval',
    )
    // 反过来，内联脚本是被允许的：沙盒靠它编译用户代码，这条前提变了就得换机制
    expect(scriptSrc).toContain("'unsafe-inline'")
  })

  it('两个消费者都改走沙盒，且不再有各自的求值', () => {
    for (const rel of ['src/lib/video-code-sandbox-runtime.ts', 'src/lib/video-live-test-runner.ts']) {
      const text = read(rel)
      expect(text, `${rel} 没有引入不透明源沙盒`).toContain('./video-opaque-sandbox')
      expect(evalSites(text), `${rel} 又出现了页面内求值`).toEqual([])
    }
  })

  it('课后用例是数据不是闭包（闭包跨不过沙盒边界）', () => {
    const pane = read('src/components/video-live-test-pane.tsx')
    expect(pane, '用例又变回 testFn 闭包了').not.toMatch(/testFn\s*:/)
    for (const needle of ['exportName:', 'assertion:', 'type LiveTestCaseSpec']) {
      expect(pane, `面板缺少数据化用例的 ${needle}`).toContain(needle)
    }
  })

  it('沙盒的契约写在示例代码里：结果走 exports，不走顶层 return', () => {
    const runtime = read('src/lib/video-code-sandbox-runtime.ts')
    expect(runtime, '默认示例又用回顶层 return：脚本里那是语法错误').toContain('exports.result =')
    expect(runtime, '示例里的顶层 return 回来了').not.toContain('return { status: "ready"')
  })
})

/* --------------------------- B：容器的隔离性 --------------------------- */

/**
 * 「我们自己造文档内容」的容器：srcdoc 直接写文档；blob URL 喂给帧的 src 也算。
 * blob 只认**真的接进 .src** 的形状——仓里十几处 createObjectURL 都是 CSV 导出用的
 * 下载链接（配 `<iframe` 不同处），按「同文件出现过就算」会一片误伤。
 */
const BLOB_SRC = /\.src\s*=\s*URL\.createObjectURL|createObjectURL\([^)]*\)\s*&&?\s*\w+\.src\s*=|\bsrc\s*=\s*\{[^}]*blob[^}]*\}/i

function authorsDocument(text: string): boolean {
  return /\bsrcdoc\s*=|\bsrcDoc\s*=/.test(text) || BLOB_SRC.test(text)
}

const STRING_CONST = (name: string, text: string): string | null => {
  const m = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*['"]([^'"]*)['"]`).exec(text)
  return m ? m[1] : null
}

/**
 * 把一个 sandbox 表达式解析成实际标记串。
 * 带引号 ⇒ 直接是值；裸标识符 ⇒ 去查常量定义（先本文件，再 harness 文件）；
 * 都查不出来 ⇒ 返回哨兵让判据红，绝不「解析不了就当没问题」。
 */
function resolveFlags(expr: string, ownText: string): string {
  const value = expr.trim()
  const quoted = /^['"]([^'"]*)['"]$/.exec(value)
  if (quoted) return quoted[1]
  if (/^[A-Za-z0-9_]+$/.test(value)) {
    return STRING_CONST(value, ownText) ?? STRING_CONST(value, read(HARNESS_FILE)) ?? '<无法解析>'
  }
  return '<无法解析>'
}

function sandboxFlagsOf(text: string): string[] {
  const found: string[] = []
  // 1) JSX/HTML 字面量：捕获组本身就是值，不能再当标识符去解析
  const literal = /sandbox\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = literal.exec(text))) found.push(m[1])
  // 2) setAttribute('sandbox', X) 与 sandbox={X}：X 可能是字符串常量名
  const exprs = [/setAttribute\(\s*['"]sandbox['"]\s*,\s*([A-Za-z0-9_'"{}]+)\s*\)/g, /sandbox\s*=\s*\{\s*([A-Za-z0-9_]+)\s*\}/g]
  for (const re of exprs) {
    while ((m = re.exec(text))) found.push(resolveFlags(m[1].replace(/[{}]/g, ''), text))
  }
  return found
}

describe('B：执行容器必须是不透明源', () => {
  it('SANDBOX_FLAGS 只有 allow-scripts', () => {
    expect(SANDBOX_FLAGS).toBe('allow-scripts')
    expect(SANDBOX_FLAGS).not.toContain('allow-same-origin')
  })

  it('凡是自造内容的 iframe，其 sandbox 都不许带 allow-same-origin', () => {
    const authored = SOURCES.filter((f) => authorsDocument(read(f)))
    expect(authored.length, '一个自造内容的容器都扫不到，判据已经空转').toBeGreaterThan(0)
    for (const file of authored) {
      const flags = sandboxFlagsOf(read(file))
      expect(flags.length, `${file} 造了文档内容却没声明 sandbox`).toBeGreaterThan(0)
      for (const flag of flags) {
        expect(flag, `${file} 的 sandbox 标记解析不出来：宁可红也不放过`).not.toBe('<无法解析>')
        expect(flag, `${file} 的容器带了 allow-same-origin，隔离等于没做`).not.toContain('allow-same-origin')
      }
    }
    // 显式点名三个已知容器，防止哪天整文件被改名后这条判据悄悄空转
    for (const file of [
      HARNESS_FILE,
      'src/components/video-code-sandbox.tsx',
      'src/components/video-sandbox-runner-pane.tsx',
    ]) {
      expect(authored, `${file} 不再自造文档内容了？判据范围要跟着改`).toContain(file)
    }
  })

  it('带 allow-same-origin 的容器全仓只有一个，且是外站内嵌（src= 而非自造）', () => {
    const withSameOrigin = SOURCES.filter((f) =>
      /sandbox\s*=\s*"[^"]*allow-same-origin/.test(read(f)),
    )
    expect(withSameOrigin).toEqual(['src/components/video-mini-player.tsx'])
    const embed = read('src/components/video-mini-player.tsx')
    // 那一处给的是对方站点自己源的文档：allow-same-origin 只是让它保住 YouTube 的源，
    // 摘掉会直接播不了；但它绝不能同时是我们写的 srcdoc。
    expect(embed).toContain('src={embedUrl}')
    expect(authorsDocument(embed)).toBe(false)
  })
})

/* --------------------------- C：回信必须验源 --------------------------- */

describe('C：父侧监听要认得自己那个帧', () => {
  it('沙盒客户端两处校验 event.source（hello 握手 + 会话回信）', () => {
    const text = read(HARNESS_FILE)
    expect((text.match(/event\.source\s*!==/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('预览面板也只收自己 iframe 的消息', () => {
    const pane = read('src/components/video-code-sandbox.tsx')
    expect(pane).toMatch(/if\s*\(e\.source\s*!==\s*iframeRef\.current\?\.contentWindow\)\s*return/)
  })
})

/* --------------------------- D：不可用时不降级（行为） --------------------------- */

describe('D：没有隔离环境就一行代码都不许跑', () => {
  /** 只要有一条同源回退路径，这段代码就会真的执行并打出日志 */
  const TRIPPY_CODE = 'console.log("这段代码被同源执行了"); exports.boom = function () { return 1; };'

  it('runLiveCodeTest 在无 DOM 环境里判 blocked，且不执行任何代码', async () => {
    const specs: LiveTestCaseSpec[] = [
      { id: 'tc-1', title: '样例', exportName: 'boom', args: [], assertion: { kind: 'toBe', expected: 1 } },
    ]
    const res = await runLiveCodeTest('无隔离环境', TRIPPY_CODE, specs)
    expect(res.blocked, '沙盒不可用时却跑完了 ⇒ 有同源回退').toBe('unavailable')
    expect(res.consoleLogs, '用户代码真的跑了').toEqual([])
    expect(res.passedCount).toBe(0)
    expect(res.totalCount).toBe(1)
    expect(res.cases[0].error).toContain('隔离沙盒不可用')
  })

  it('SandboxRuntime.execute 在无 DOM 环境里同样不跑', async () => {
    const runtime = new SandboxRuntime(new VirtualFileSystem({ '/index.ts': TRIPPY_CODE }))
    const execution = await runtime.execute('/index.ts')
    expect(execution.success).toBe(false)
    expect(execution.stopReason).toBe('unavailable')
    expect(execution.logs, '用户代码真的跑了').toEqual([])
    expect(execution.errorMessage).toContain('代码未执行')
  })
})

/* --------------------------- E：行为（stub 会话驱动） --------------------------- */

function outcome(partial: Partial<OpaqueRunOutcome>): OpaqueRunOutcome {
  return { ok: true, logs: [], hasValue: false, durationMs: 1, ...partial }
}

class StubSession implements OpaqueSession {
  readonly logs: OpaqueLogEntry[] = []
  closed = 0
  constructor(
    private readonly onLoad?: (code: string) => OpaqueRunOutcome,
    private readonly onInvoke?: (exportName: string, args: unknown[]) => OpaqueRunOutcome,
  ) {}

  async load(code: string): Promise<OpaqueRunOutcome> {
    const result = this.onLoad ? this.onLoad(code) : outcome({})
    this.logs.push(...result.logs)
    return result
  }

  async invoke(exportName: string, args: unknown[] = []): Promise<OpaqueRunOutcome> {
    if (!this.onInvoke) return outcome({ ok: false, errorText: 'stub 没实现 invoke' })
    const result = this.onInvoke(exportName, args)
    this.logs.push(...result.logs)
    return result
  }

  close(): void {
    this.closed += 1
  }
}

function logEntry(text: string, level: OpaqueLogEntry['level'] = 'log'): OpaqueLogEntry {
  return { level, text, timestamp: 1 }
}

describe('E：SandboxRuntime 经沙盒执行', () => {
  const vfs = () =>
    new VirtualFileSystem({
      '/index.ts': "import { multiply } from './math.ts'\nconst res = multiply(6, 7)\nconsole.log('Answer is:', res)\nexports.answer = res",
      '/math.ts': 'export function multiply(a, b) { return a * b; }',
    })

  it('成功：返回值与日志都从沙盒读回，且会话一定被关闭', async () => {
    const stub = new StubSession(() =>
      outcome({ hasValue: true, value: 42, logs: [logEntry('Answer is: 42')] }),
    )
    const execution = await new SandboxRuntime(vfs(), { openSession: async () => stub }).execute('/index.ts')
    expect(execution.success).toBe(true)
    expect(execution.returnValue).toBe(42)
    expect(execution.logs).toHaveLength(1)
    expect(execution.logs[0].text).toContain('Answer is: 42')
    expect(stub.closed, '会话没关掉 ⇒ 每次运行泄漏一个 iframe').toBe(1)
  })

  it('代码报错：判失败但不算 blocked（是用户的问题，不是环境的）', async () => {
    const stub = new StubSession(() => outcome({ ok: false, errorText: 'Unexpected token }' }))
    const execution = await new SandboxRuntime(vfs(), { openSession: async () => stub }).execute('/index.ts')
    expect(execution.success).toBe(false)
    expect(execution.stopReason, '用户代码写错不该被算成「环境不给跑」').toBeUndefined()
    expect(execution.errorMessage).toBe('Unexpected token }')
    expect(stub.closed).toBe(1)
  })

  it('超时与拒收都如实带 stopReason', async () => {
    const timeout = new StubSession(() => outcome({ ok: false, stopReason: 'timeout', errorText: '跑太久' }))
    const first = await new SandboxRuntime(vfs(), { openSession: async () => timeout }).execute('/index.ts')
    expect(first.stopReason).toBe('timeout')
    expect(first.errorMessage).toBe('跑太久')

    const rejected = new StubSession(() => outcome({ ok: false, stopReason: 'rejected', errorText: '代码超过上限' }))
    const second = await new SandboxRuntime(vfs(), { openSession: async () => rejected }).execute('/index.ts')
    expect(second.stopReason).toBe('rejected')
  })

  it('返回值不可克隆时给纯文本，界面不会显示 undefined', async () => {
    const stub = new StubSession(() =>
      outcome({ valueUnavailable: true, valueText: 'function () { [native code] }' }),
    )
    const execution = await new SandboxRuntime(vfs(), { openSession: async () => stub }).execute('/index.ts')
    expect(execution.success).toBe(true)
    expect(execution.returnValue).toBeUndefined()
    expect(execution.returnValueText).toBe('function () { [native code] }')
  })

  it('送进沙盒的就是打包后的代码（求值搬走，打包这一步没退化）', async () => {
    let seen = ''
    const stub = new StubSession((code) => {
      seen = code
      return outcome({ hasValue: true, value: 42 })
    })
    const execution = await new SandboxRuntime(vfs(), { openSession: async () => stub }).execute('/index.ts')
    expect(execution.success).toBe(true)
    expect(seen, '依赖没被内联进交给沙盒的代码').toContain('function multiply')
    expect(seen).not.toContain("from './math.ts'")
    const missing = new SandboxRuntime(new VirtualFileSystem({ '/a.ts': "import { x } from './nope.ts'" }))
    expect(missing.bundle('/a.ts')).toContain('[Missing dependency /nope.ts]')
  })

  it('入口文件不存在时如实报错，且不白起沙盒', async () => {
    let opened = 0
    const runtime = new SandboxRuntime(new VirtualFileSystem({ '/other.ts': 'export const a = 1' }), {
      openSession: async () => {
        opened += 1
        return new StubSession()
      },
    })
    const execution = await runtime.execute('/missing.ts')
    expect(execution.success).toBe(false)
    expect(execution.errorMessage).toContain('Entry file not found')
    expect(execution.stopReason, '打包失败是代码问题，不该算成环境不可用').toBeUndefined()
    expect(opened, '入口都不存在还先去开沙盒').toBe(0)
  })
})

describe('E：runLiveCodeTest 经沙盒跑课后用例', () => {
  const specs: LiveTestCaseSpec[] = [
    { id: 'tc-1', title: '加法', exportName: 'add', args: [2, 3], assertion: { kind: 'toBe', expected: 5 } },
    { id: 'tc-2', title: '边界', exportName: 'add', args: [0, 0], assertion: { kind: 'toBe', expected: 1 } },
  ]

  it('通过 / 失败各判各的，日志按级别加前缀', async () => {
    const stub = new StubSession(
      () => outcome({ logs: [logEntry('ready'), logEntry('坏了', 'error'), logEntry('注意', 'warn')] }),
      (name, args) =>
        name === 'add' ? outcome({ hasValue: true, value: Number(args[0]) + Number(args[1]) }) : outcome({ ok: false }),
    )
    const res = await runLiveCodeTest('套件', 'exports.add = (a,b)=>a+b', specs, { openSession: async () => stub })
    expect(res.passedCount).toBe(1)
    expect(res.failedCount).toBe(1)
    expect(res.cases[1].error).toContain('期望值是 1')
    expect(res.consoleLogs).toEqual(['ready', '[ERROR] 坏了', '[WARN] 注意'])
    expect(res.blocked).toBeUndefined()
    expect(stub.closed).toBe(1)
  })

  it('准备阶段就没跑成 ⇒ 整套判 blocked，不误导用户去改代码', async () => {
    const stub = new StubSession(() => outcome({ ok: false, stopReason: 'rejected', errorText: '代码超过上限' }))
    const res = await runLiveCodeTest('套件', 'x', specs, { openSession: async () => stub })
    expect(res.blocked).toBe('rejected')
    expect(res.failedCount).toBe(2)
    expect(res.cases.every((c) => c.error === '代码超过上限')).toBe(true)
  })

  it('toThrow：函数抛错算过，导出根本不存在不算过', async () => {
    const throwing: LiveTestCaseSpec[] = [
      { id: 't1', title: '该抛错', exportName: 'boom', args: [], assertion: { kind: 'toThrow' } },
    ]
    const viaThrow = new StubSession(undefined, () => outcome({ ok: false, errorText: '自己抛的' }))
    expect((await runLiveCodeTest('s', 'x', throwing, { openSession: async () => viaThrow })).passedCount).toBe(1)

    const viaMissing = new StubSession(
      undefined,
      () => outcome({ ok: false, noExport: true, errorText: '导出 boom 不存在或不是函数' }),
    )
    const missing = await runLiveCodeTest('s', 'x', throwing, { openSession: async () => viaMissing })
    expect(missing.passedCount, '导出没有却被 toThrow 判成通过').toBe(0)
    expect(missing.cases[0].error).toContain('不存在或不是函数')
  })

  it('返回值不可克隆时如实失败（不能拿 undefined 去比对）', async () => {
    const one: LiveTestCaseSpec[] = [
      { id: 'c', title: '克隆不了', exportName: 'add', args: [], assertion: { kind: 'toBeDefined' } },
    ]
    const stub = new StubSession(undefined, () => outcome({ valueUnavailable: true, valueText: 'function add' }))
    const res = await runLiveCodeTest('s', 'x', one, { openSession: async () => stub })
    expect(res.failedCount).toBe(1)
    expect(res.cases[0].error).toContain('无法跨沙盒传递')
  })

  it('断言种类覆盖：toEqual / toBeGreaterThan / toContain', async () => {
    const cases: LiveTestCaseSpec[] = [
      { id: 'a', title: 'toEqual', exportName: 'f', args: [], assertion: { kind: 'toEqual', expected: { ok: true } } },
      { id: 'b', title: 'gt', exportName: 'f', args: [], assertion: { kind: 'toBeGreaterThan', expected: 3 } },
      { id: 'c', title: 'contains', exportName: 'f', args: [], assertion: { kind: 'toContain', expected: 'x' } },
    ]
    const values: Record<string, unknown> = { a: { ok: true }, b: 4, c: 'axb' }
    const stub = new StubSession(undefined, (_name, args) =>
      outcome({ hasValue: true, value: values[(args?.[0] as { k: string }).k] }),
    )
    const keyed: LiveTestCaseSpec[] = cases.map((c) => ({ ...c, args: [{ k: c.id }] }))
    const res = await runLiveCodeTest('s', 'x', keyed, { openSession: async () => stub })
    expect(res.passedCount, JSON.stringify(res.cases)).toBe(3)
  })
})

/* --------------------------- F：扫描机没瞎 --------------------------- */

describe('F：判据本身有效', () => {
  it('求值扫描能抓到重新引回来的同源执行', () => {
    expect(evalSites('const fn = new Function("console", code)')).toHaveLength(1)
    expect(evalSites('window.eval(payload)')).toHaveLength(1)
    expect(evalSites("const getter = Function('return this')()")).toHaveLength(1)
    // 而注释里讨论这个 API 不算（否则每个说明都要挂豁免）
    expect(evalSites('// 以前这里用 new Function 跑代码')).toEqual([])
    expect(evalSites(' * 严格 0-eval：永不执行 eval / new Function；')).toEqual([])
    // `\b` 挡住了标识符内部的 eval(（retrieval( 不含求值）
    expect(evalSites('const list = await getRetrieval(page)')).toEqual([])
  })

  it('脚本元素扫描认得出 harness 里的写法，也不误伤别的 createElement', () => {
    // harness 源文件里那对引号前面带反斜杠（它本身是字符串数组的元素）
    expect(SCRIPT_INJECTION.re.test("  '    var el = document.createElement(\\'script\\');',")).toBe(true)
    expect(SCRIPT_INJECTION.re.test('const el = document.createElement("script")')).toBe(true)
    expect(SCRIPT_INJECTION.re.test("const holder = document.createElement('div')")).toBe(false)
    expect(SCRIPT_INJECTION.re.test("// 用 createElement('script') 也行……如果只是想想")).toBe(true)
  })

  it('CSP 指令读取得到真值，取不到时如实为空而不是蒙混', () => {
    expect(cspDirective('script-src')).toBe("script-src 'self' 'unsafe-inline'")
    expect(cspDirective('img-src')).toBe("img-src 'self' data: https:")
    expect(cspDirective('no-such-src')).toBe('')
  })

  it('sandbox 解析能认出被加回去的 allow-same-origin', () => {
    expect(sandboxFlagsOf('<iframe sandbox="allow-scripts allow-same-origin" />')).toEqual([
      'allow-scripts allow-same-origin',
    ])
    expect(sandboxFlagsOf("frame.setAttribute('sandbox', SANDBOX_FLAGS)")).toEqual([SANDBOX_FLAGS])
    expect(sandboxFlagsOf('<iframe sandbox={SOME_LOCAL} />')).toEqual(['<无法解析>'])
    expect(authorsDocument('iframe.srcdoc = harness')).toBe(true)
    expect(authorsDocument('f.src = URL.createObjectURL(blob)')).toBe(true)
    expect(authorsDocument('<iframe src={blobUrl} />')).toBe(true)
    // 纯下载链接不算——否则仓里十几处 CSV 导出全被误伤，判据会因为嫌烦而被删掉
    expect(authorsDocument('const url = URL.createObjectURL(blob); a.href = url')).toBe(false)
    expect(authorsDocument('<iframe src={embedUrl} />')).toBe(false)
  })

  it('自造内容的容器清单确实非空且都是预期那几个', () => {
    const authored = SOURCES.filter((f) => authorsDocument(read(f)))
    expect(authored).toContain(HARNESS_FILE)
    expect(authored).toContain('src/components/video-code-sandbox.tsx')
    expect(authored).toContain('src/components/video-sandbox-runner-pane.tsx')
  })
})
