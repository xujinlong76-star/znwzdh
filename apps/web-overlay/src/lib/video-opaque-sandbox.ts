/**
 * 外部代码的「不透明源」执行客户端。
 *
 * 为什么要有这个文件：视频页的两个「即时运行」面板（沙盒工程 / 课后 TDD）此前用
 * `new Function` 在**页面自己的 realm** 里跑代码，而那份代码来自 AI 生成与用户粘贴。
 * 同源 realm 意味着它能读 localStorage 里的会话、拿 cookie、伪造 fetch、改写 DOM——
 * 等于把登录态交给任意一段被贴进输入框的文字。
 *
 * 顺带说一件改造后才查到的事实：本仓 CSP 是 `script-src 'self' 'unsafe-inline'`，
 * **没有** `'unsafe-eval'` ⇒ 那套 `new Function` 在真人浏览器里从来没跑通过，报的是
 * CSP 违规而不是代码错误。所以这不是「安全 vs 能用」的取舍，两边本来都坏。
 * 现在沙盒里也不求值：代码作为 `<script>` 元素的 textContent 进沙盒文档，
 * 由浏览器按普通内联脚本编译（`'unsafe-inline'` 允许，`'unsafe-eval'` 全程不需要）。
 *
 * 执行容器是 `<iframe sandbox="allow-scripts">`：**不给** `allow-same-origin`
 * ⇒ 该文档是不透明源（origin 字面量 "null"），拿不到父文档、cookie、localStorage，
 * 也不能顶层跳转或开弹窗。代码不进 HTML 字符串（harness 是常量，代码走 postMessage
 * 后原样交给 textContent），所以「在代码里贴一段 `</script>`」越不出 harness 的边界。
 *
 * 代价写清楚，别假装没有：
 *  - **顶层 `return` 不再是返回值**：经典脚本里那是语法错误。结果一律走 `exports`，
 *    这也是课后 TDD 一直用的口径；导出里的函数无法结构化克隆，界面显示占位文本；
 *  - 返回值只能走结构化克隆：class / DOM 节点 / 循环引用传不回来，调用方按 `valueText` 展示；
 *  - 沙盒 iframe 与页面**共用主线程** ⇒ 同步死循环仍会卡住标签页（与改造前相同，没更差）。
 *    要做到「卡住也不影响页面」得换 Worker，而 Worker 需要把 CSP 的 `worker-src` 放开到
 *    `blob:`——为省一次卡顿去放宽安全策略，方向不对；
 *  - 环境不具备（无 DOM、harness 被 CSP 拦掉、超时）时**不降级回同源执行**，
 *    直接给 `stopReason`，界面只做「阅读 + 复制」。降级回同源就等于白改。
 *
 * 名字取 `video-*` 前缀不是顺手：`scripts/typecheck-video-scope.mjs` 自动发现
 * `src/lib/video-*.ts` 并要求作用域内 0 类型错误 —— 这个文件正该被那道闸按住。
 */

/** 协议标记同时出现在 harness 与父侧；改一处必须改两处，否则 handshake 对不上 */
const PROTOCOL = 'navhub-opaque-sandbox-v1'

/**
 * 执行容器唯一的 sandbox 标记。
 * 加 `allow-same-origin` 就是把同源权限还回去，隔离当场消失——守卫测试钉的就是这一行。
 */
export const SANDBOX_FLAGS = 'allow-scripts'

/** 代码上限（字节）：超了直接拒，避免把几百 KB 塞进一次 postMessage 里卡死主线程 */
const MAX_CODE_BYTES = 200_000

/** 沙盒内最多回传多少行日志：`while(true) console.log()` 不该把父页面内存打满 */
const MAX_LOG_LINES = 400

const READY_TIMEOUT_MS = 4_000
const RUN_TIMEOUT_MS = 8_000

export type OpaqueLogLevel = 'log' | 'info' | 'warn' | 'error'

export type OpaqueStopReason = 'rejected' | 'unavailable' | 'timeout'

export interface OpaqueLogEntry {
  level: OpaqueLogLevel
  text: string
  timestamp: number
}

export interface OpaqueRunOutcome {
  /** harness 是否跑完且没抛错 */
  ok: boolean
  /** 本次请求期间新产生的日志（会话级全量见 `session.logs`） */
  logs: OpaqueLogEntry[]
  /** 返回值是否存在且可结构化克隆 */
  hasValue: boolean
  value?: unknown
  /** 返回值不可克隆（函数 / class / 循环引用…）时给纯文本，界面照样能显示 */
  valueUnavailable?: boolean
  valueText?: string
  errorText?: string
  durationMs: number
  /** 调用的导出压根不存在 / 不是函数：与「函数自己抛错」区分开，`toThrow` 类用例靠它 */
  noExport?: boolean
  /** 只有「根本没执行成」时才有值：界面据此区分「代码有错」与「此处不给跑」 */
  stopReason?: OpaqueStopReason
}

export interface OpaqueSession {
  load(code: string): Promise<OpaqueRunOutcome>
  invoke(exportName: string, args?: unknown[]): Promise<OpaqueRunOutcome>
  /** 会话累计日志：跨请求的尾巴不至于丢 */
  readonly logs: OpaqueLogEntry[]
  close(): void
}

/** 环境层面跑不了隔离沙盒（与「用户代码写错了」是两回事，必须能分开） */
export class OpaqueSandboxUnavailableError extends Error {}

/**
 * 沙盒内的固定壳子。**逐字常量**：这里没有任何 `${}`，用户代码只能经 postMessage 进来。
 * 内部一律 `var` + 单引号 + 不用模板字符串，免得将来有人往这串里插东西时撞上外层模板语法。
 */
const HARNESS_HTML = [
  '<!doctype html>',
  '<html lang="zh-CN"><head><meta charset="utf-8">',
  '<title>NavHub 隔离执行沙盒</title>',
  '</head><body></body>',
  '<script>',
  '(function () {',
  "  var PROTOCOL = 'navhub-opaque-sandbox-v1';",
  '  var MAX_LOG_LINES = 400;',
  '  var MAX_TEXT = 4000;',
  '  var nonce = null;',
  '  var loadTask = null;',
  '  var logLines = 0;',
  '  function post(message) {',
  '    message.protocol = PROTOCOL;',
  '    if (nonce !== null) message.nonce = nonce;',
  '    try { window.parent.postMessage(message, \'*\'); } catch (e) {}',
  '  }',
  '  function cut(text) {',
  "    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…（已截断）' : text;",
  '  }',
  '  function render(value) {',
  "    if (typeof value === 'string') return value;",
  '    if (value instanceof Error) return value.stack || (value.name + \': \' + value.message);',
  '    try {',
  '      var json = JSON.stringify(value);',
  '      if (json !== undefined) return json;',
  '    } catch (e) {}',
  '    return String(value);',
  '  }',
  '  function emit(level, args) {',
  '    if (logLines >= MAX_LOG_LINES) return;',
  '    logLines++;',
  '    var parts = [];',
  '    for (var i = 0; i < args.length; i++) parts.push(render(args[i]));',
  "    post({ kind: 'log', level: level, text: cut(parts.join(' ')) });",
  '  }',
  '  var sandboxConsole = {',
  "    log: function () { emit('log', arguments); },",
  "    info: function () { emit('info', arguments); },",
  "    warn: function () { emit('warn', arguments); },",
  "    error: function () { emit('error', arguments); },",
  "    debug: function () { emit('log', arguments); },",
  '  };',
  "  window.onerror = function (message, source, line, col, error) {",
  "    emit('error', ['未捕获错误: ' + (error && error.message ? error.message : message)]);",
  '    if (loadTask) failLoad(loadTask, error || new Error(String(message)));',
  '    return false;',
  '  };',
  "  window.addEventListener('unhandledrejection', function (event) {",
  "    emit('error', ['未处理的 Promise 拒绝: ' + render(event.reason)]);",
  '  });',
  '  function reply(id, ok, startedAt, value, error) {',
  '    var message = {',
  "      kind: 'result',",
  '      id: id,',
  '      ok: ok,',
  '      durationMs: Math.max(0, Date.now() - startedAt)',
  '    };',
  // 只回传 message 不回传 stack：调用方（课后 TDD / 沙盒控制台）原来打的就是
  // err.message，塞一整段带行号的栈进去会把面板撑没读。
  '    if (error) message.errorText = cut(error && error.message ? String(error.message) : render(error));',
  '    // 「导出根本不存在」和「函数自己抛错」必须分得开：否则 toThrow 用例会把它当成通过。',
  '    if (error && error.navhubNoExport) message.noExport = true;',
  '    if (ok) {',
  '      if (value === undefined) {',
  '        message.hasValue = false;',
  '      } else {',
  '        try {',
  '          structuredClone(value);',
  '          message.hasValue = true;',
  '          message.value = value;',
  '        } catch (e) {',
  '          message.hasValue = false;',
  '          message.valueUnavailable = true;',
  '          message.valueText = cut(render(value));',
  '        }',
  '      }',
  '    }',
  '    post(message);',
  '  }',
  '  function failLoad(task, error) {',
  '    if (task.done) return;',
  '    task.done = true;',
  '    if (loadTask === task) loadTask = null;',
  '    reply(task.id, false, task.started, undefined, error);',
  '  }',
  '  // 用户代码可能写 `var exports = {...}` 把全局换掉，所以每次都重新读窗口上的那一份',
  '  function currentExports() {',
  '    var bag = window.exports;',
  "    return bag && typeof bag === 'object' ? bag : {};",
  '  }',
  '  function exportsSnapshot() {',
  '    var bag = currentExports();',
  '    var keys = Object.keys(bag);',
  '    if (keys.length === 0) return undefined;',
  '    var out = {};',
  '    for (var i = 0; i < keys.length; i++) {',
  '      var value = bag[keys[i]];',
  "      out[keys[i]] = typeof value === 'function'",
  "        ? '[function ' + (value.name || 'anonymous') + ']'",
  '        : value;',
  '    }',
  '    return out;',
  '  }',
  '  function runLoad(id, code) {',
  '    window.exports = {};',
  '    window.console = sandboxConsole;',
  '    var started = Date.now();',
  '    var task = { id: id, started: started, done: false };',
  '    loadTask = task;',
  '    var el = document.createElement(\'script\');',
  '    // 这里是全仓唯一「把字符串变成可执行体」的地方：文本进的是脚本元素的 textContent，',
  '    // 不进 HTML 解析器，也不经求值器（本仓 CSP 没有 unsafe-eval，eval/new Function',
  '    // 在沙盒里同样会被拦）。能编译它的只有那个不透明源文档自己。',
  '    el.textContent = code;',
  '    try {',
  '      document.head.appendChild(el);',
  '      document.head.removeChild(el);',
  '    } catch (error) {',
  '      failLoad(task, error);',
  '      return;',
  '    }',
  '    // 内联脚本的异常（含语法错）是异步上报到 window.onerror 的，实测排在 timeout 任务',
  '    // 之前；done 闩锁保证只回一次话，宁可把成功判晚，也不把语法错判成跑通了。',
  '    setTimeout(function () {',
  '      if (task.done) return;',
  '      task.done = true;',
  '      if (loadTask === task) loadTask = null;',
  '      reply(id, true, started, exportsSnapshot(), null);',
  '    }, 0);',
  '  }',
  '  function runInvoke(id, exportName, args) {',
  '    var started = Date.now();',
  '    try {',
  '      var target = currentExports()[exportName];',
  "      if (typeof target !== 'function') {",
  '        var missing = new Error(',
  "          '导出 ' + exportName + ' 不存在或不是函数（要用 exports.' + exportName + ' = ... 暴露出来）',",
  '        );',
  "        missing.navhubNoExport = true;",
  '        throw missing;',
  '      }',
  '      reply(id, true, started, target.apply(null, args || []), null);',
  '    } catch (error) {',
  '      reply(id, false, started, undefined, error);',
  '    }',
  '  }',
  "  window.addEventListener('message', function (event) {",
  '    var data = event.data;',
  '    if (!data || data.protocol !== PROTOCOL) return;',
  "    if (data.kind === 'handshake') {",
  '      if (nonce === null) {',
  '        nonce = data.nonce;',
  "        post({ kind: 'ready' });",
  '      }',
  '      return;',
  '    }',
  '    if (nonce === null || data.nonce !== nonce) return;',
  "    if (data.kind === 'load') runLoad(data.id, String(data.code || ''));",
  "    else if (data.kind === 'invoke') runInvoke(data.id, String(data.exportName || ''), data.args);",
  '  });',
  "  post({ kind: 'hello' });",
  '})();',
  '</script>',
  '</html>',
].join('\n')

interface HarnessMessage {
  protocol?: string
  nonce?: string
  kind?: string
  id?: string
  level?: OpaqueLogLevel
  text?: string
  ok?: boolean
  hasValue?: boolean
  value?: unknown
  valueText?: string
  valueUnavailable?: boolean
  errorText?: string
  noExport?: boolean
  durationMs?: number
}

interface PendingRun {
  resolve: (outcome: OpaqueRunOutcome) => void
  logsFrom: number
  timer: ReturnType<typeof setTimeout>
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function newNonce(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID()
  // 没 WebCrypto 也要有值：nonce 只用来「别把别的 iframe 的回信当成我的」，不是密钥
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

class IframeOpaqueSession implements OpaqueSession {
  private readonly pending = new Map<string, PendingRun>()
  private readonly listener: (event: MessageEvent) => void
  private nextId = 1
  private closed = false
  readonly logs: OpaqueLogEntry[] = []

  constructor(
    private readonly frame: HTMLIFrameElement,
    private readonly nonce: string,
  ) {
    this.listener = (event) => this.handle(event)
    window.addEventListener('message', this.listener)
  }

  load(code: string): Promise<OpaqueRunOutcome> {
    return this.send({ kind: 'load', code })
  }

  invoke(exportName: string, args: unknown[] = []): Promise<OpaqueRunOutcome> {
    return this.send({ kind: 'invoke', exportName, args })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    window.removeEventListener('message', this.listener)
    for (const [id, run] of this.pending) {
      clearTimeout(run.timer)
      this.pending.delete(id)
      run.resolve(this.stopped(run, 'unavailable', '沙盒已关闭，本次执行没有结果'))
    }
    this.frame.remove()
  }

  private stopped(run: PendingRun, stopReason: OpaqueStopReason, errorText: string): OpaqueRunOutcome {
    return { ok: false, logs: this.logs.slice(run.logsFrom), hasValue: false, stopReason, errorText, durationMs: 0 }
  }

  private handle(event: MessageEvent): void {
    const data = event.data as HarnessMessage | null
    if (!data || data.protocol !== PROTOCOL || data.nonce !== this.nonce) return
    // 光比对协议字符串会被伪造：本页还嵌着视频站的 iframe，它们同样能向 parent 发消息。
    if (event.source !== this.frame.contentWindow) return
    if (data.kind === 'log') {
      this.logs.push({ level: data.level ?? 'log', text: data.text ?? '', timestamp: Date.now() })
      if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES)
      return
    }
    if (data.kind !== 'result' || !data.id) return
    const run = this.pending.get(data.id)
    if (!run) return
    this.pending.delete(data.id)
    clearTimeout(run.timer)
    run.resolve({
      ok: Boolean(data.ok),
      logs: this.logs.slice(run.logsFrom),
      hasValue: Boolean(data.hasValue),
      value: data.hasValue ? data.value : undefined,
      valueUnavailable: data.valueUnavailable,
      valueText: data.valueText,
      errorText: data.errorText,
      noExport: data.noExport,
      durationMs: data.durationMs ?? 0,
    })
  }

  private send(payload: { kind: 'load' | 'invoke'; code?: string; exportName?: string; args?: unknown[] }) {
    if (this.closed) {
      return Promise.resolve({
        ok: false,
        logs: [],
        hasValue: false,
        stopReason: 'unavailable' as OpaqueStopReason,
        errorText: '隔离沙盒已关闭',
        durationMs: 0,
      })
    }
    if (typeof payload.code === 'string' && byteLength(payload.code) > MAX_CODE_BYTES) {
      return Promise.resolve({
        ok: false,
        logs: [],
        hasValue: false,
        stopReason: 'rejected' as OpaqueStopReason,
        errorText: `代码超过隔离沙盒上限（${Math.floor(MAX_CODE_BYTES / 1024)}KB），未执行`,
        durationMs: 0,
      })
    }
    const target = this.frame.contentWindow
    if (!target) {
      return Promise.resolve({
        ok: false,
        logs: [],
        hasValue: false,
        stopReason: 'unavailable' as OpaqueStopReason,
        errorText: '隔离沙盒窗口已不存在',
        durationMs: 0,
      })
    }
    const id = `r${this.nextId++}`
    const logsFrom = this.logs.length
    return new Promise<OpaqueRunOutcome>((resolve) => {
      const timer = setTimeout(() => {
        const run = this.pending.get(id)
        if (!run) return
        this.pending.delete(id)
        run.resolve(this.stopped(run, 'timeout', `隔离沙盒执行超过 ${RUN_TIMEOUT_MS}ms，已放弃等待`))
      }, RUN_TIMEOUT_MS)
      this.pending.set(id, { resolve, logsFrom, timer })
      // 父→帧只能发 '*'：不透明源的 origin 字面量就是 "null"，各浏览器写法不一致；
      // 而这里发出去的是本来就要交给这段代码执行的输入，没有任何机密可泄。
      target.postMessage({ protocol: PROTOCOL, nonce: this.nonce, id, ...payload }, '*')
    })
  }
}

/**
 * 开一个隔离会话。失败只抛 {@link OpaqueSandboxUnavailableError} —— 调用方必须把它
 * 当成「这里不给跑」，而不是退回去用同源 `new Function` 再试一次。
 */
export function openOpaqueSession(timeoutMs: number = READY_TIMEOUT_MS): Promise<OpaqueSession> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) {
    return Promise.reject(new OpaqueSandboxUnavailableError('当前环境没有 DOM，隔离沙盒不可用'))
  }
  const nonce = newNonce()
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', SANDBOX_FLAGS)
  frame.setAttribute('title', 'NavHub 代码隔离执行沙盒')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.style.cssText = 'position:fixed;left:-2px;top:-2px;width:1px;height:1px;border:0;visibility:hidden'
  frame.srcdoc = HARNESS_HTML

  return new Promise<OpaqueSession>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('message', onHello)
    }
    const giveUp = (reason: string) => {
      cleanup()
      frame.remove()
      reject(new OpaqueSandboxUnavailableError(reason))
    }
    function onHello(event: MessageEvent) {
      const data = event.data as HarnessMessage | null
      if (!data || data.protocol !== PROTOCOL || data.kind !== 'hello') return
      if (event.source !== frame.contentWindow) return
      cleanup()
      // 会话监听器在这里同步注册，一定早于 harness 的 ready 投递任务。
      const session = new IframeOpaqueSession(frame, nonce)
      frame.contentWindow?.postMessage({ protocol: PROTOCOL, kind: 'handshake', nonce }, '*')
      resolve(session)
    }
    timer = setTimeout(() => giveUp('隔离沙盒没有就绪（内联脚本可能被 CSP 拦掉了）'), timeoutMs)
    window.addEventListener('message', onHello)
    document.body.appendChild(frame)
  })
}
