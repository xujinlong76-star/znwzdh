/**
 * Timeline-Driven Live Unit Test Runner & Assertion Engine
 * Sandboxed headless test runner validating learner code against chapter unit tests.
 *
 * 2026-11-01：被测代码改在不透明源沙盒里跑（见 lib/video-opaque-sandbox.ts）。
 * 用例因此从「一段能在页面 realm 里调用的 testFn 闭包」改成**纯数据**
 * （exportName / args / assertion）：闭包跨过沙盒边界就成了函数，传不过去，
 * 而「把用例写成数据」本来也更贴合这个产品的形态——课后测试集是教材内容，不是运行时回调。
 * 断言在父 realm 比对，比较的是结构化克隆出来的值，不执行任何用户代码。
 */

import {
  openOpaqueSession,
  type OpaqueLogEntry,
  type OpaqueSession,
  type OpaqueStopReason,
} from './video-opaque-sandbox'

export type LiveAssertion =
  | { kind: 'toBe'; expected: unknown }
  | { kind: 'toEqual'; expected: unknown }
  | { kind: 'toBeGreaterThan'; expected: number }
  | { kind: 'toContain'; expected: unknown }
  | { kind: 'toBeDefined' }
  /** 被测函数自己抛错即算通过；「导出根本不存在」不算 */
  | { kind: 'toThrow' }

export interface LiveTestCaseSpec {
  id: string
  title: string
  /** 沙盒里 `exports[exportName]` 的名字 */
  exportName: string
  args?: unknown[]
  assertion: LiveAssertion
}

export interface TestCaseResult {
  id: string
  title: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}

export interface TestSuiteResult {
  suiteTitle: string
  passedCount: number
  failedCount: number
  totalCount: number
  durationMs: number
  cases: TestCaseResult[]
  consoleLogs: string[]
  /**
   * 有值 ⇒ 整套用例**一行都没跑**（环境不给隔离执行）。
   * 界面必须把它显示成「仅阅读」，不能顶着「N 失败」骗用户去改代码。
   */
  blocked?: OpaqueStopReason
}

/** 测试注入点：不传就用真的不透明源沙盒 */
export interface LiveTestDeps {
  openSession?: () => Promise<OpaqueSession>
}

/**
 * Creates lightweight assertion matcher.
 */
export function createExpect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`断言失败: 期望值是 ${JSON.stringify(expected)}，但实际接收到的是 ${JSON.stringify(actual)}`)
      }
    },
    toEqual(expected: any) {
      const actStr = JSON.stringify(actual)
      const expStr = JSON.stringify(expected)
      if (actStr !== expStr) {
        throw new Error(`深度对象比对不一致: 期望 ${expStr}，实际得到 ${actStr}`)
      }
    },
    toBeGreaterThan(val: number) {
      if (typeof actual !== 'number' || actual <= val) {
        throw new Error(`数值断言失败: ${actual} 未大于 ${val}`)
      }
    },
    toContain(sub: any) {
      if (typeof actual === 'string') {
        if (!actual.includes(String(sub))) {
          throw new Error(`字符串包含断言失败: "${actual}" 未包含 "${sub}"`)
        }
      } else if (Array.isArray(actual)) {
        if (!actual.includes(sub)) {
          throw new Error(`数组未包含元素: ${JSON.stringify(sub)}`)
        }
      } else {
        throw new Error(`toContain 操作数类型不支持: ${typeof actual}`)
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error('断言失败: 期望值被定义，但收到了 undefined')
      }
    },
    toThrow() {
      if (typeof actual !== 'function') {
        throw new Error('toThrow 必须作用在函数上')
      }
      let threw = false
      try {
        actual()
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error('期望函数抛出异常，但函数正常返回')
      }
    },
  }
}

function toConsoleLine(entry: OpaqueLogEntry): string {
  if (entry.level === 'warn') return `[WARN] ${entry.text}`
  if (entry.level === 'error') return `[ERROR] ${entry.text}`
  return entry.text
}

/** 在父 realm 比对一个已经克隆出来的值；这里不执行任何用户代码 */
function applyAssertion(actual: unknown, assertion: LiveAssertion): void {
  const expect = createExpect(actual)
  switch (assertion.kind) {
    case 'toBe':
      expect.toBe(assertion.expected)
      return
    case 'toEqual':
      expect.toEqual(assertion.expected)
      return
    case 'toBeGreaterThan':
      expect.toBeGreaterThan(assertion.expected)
      return
    case 'toContain':
      expect.toContain(assertion.expected)
      return
    case 'toBeDefined':
      expect.toBeDefined()
      return
    case 'toThrow':
      // toThrow 靠沙盒的抛出状态判定（见下面的分支），不走值比对
      throw new Error('toThrow 由被测函数是否抛错来判定，不应进入值比对')
  }
}

function failedSuite(
  suiteTitle: string,
  specs: LiveTestCaseSpec[],
  errorOf: (spec: LiveTestCaseSpec) => string,
  consoleLogs: string[],
  startedAt: number,
  blocked?: OpaqueStopReason,
): TestSuiteResult {
  return {
    suiteTitle,
    passedCount: 0,
    failedCount: specs.length,
    totalCount: specs.length,
    durationMs: Date.now() - startedAt,
    cases: specs.map((tc) => ({
      id: tc.id,
      title: tc.title,
      status: 'failed' as const,
      durationMs: 0,
      error: errorOf(tc),
    })),
    consoleLogs,
    ...(blocked ? { blocked } : {}),
  }
}

/**
 * Runs the learner code in the opaque sandbox, then invokes each exported case and
 * compares the cloned result against the declared assertion.
 */
export async function runLiveCodeTest(
  suiteTitle: string,
  userCode: string,
  specs: LiveTestCaseSpec[],
  deps: LiveTestDeps = {},
): Promise<TestSuiteResult> {
  const startTime = Date.now()
  const open = deps.openSession ?? openOpaqueSession

  let session: OpaqueSession
  try {
    session = await open()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return failedSuite(
      suiteTitle,
      specs,
      () => `隔离沙盒不可用，用例未运行：${reason}`,
      [],
      startTime,
      'unavailable',
    )
  }

  try {
    const loaded = await session.load(userCode)
    const consoleLogs = [...session.logs].map(toConsoleLine)

    if (loaded.stopReason) {
      return failedSuite(
        suiteTitle,
        specs,
        () => loaded.errorText ?? '隔离沙盒未能完成准备',
        consoleLogs,
        startTime,
        loaded.stopReason,
      )
    }
    if (!loaded.ok) {
      // 语法/运行期错误：保持「整套判失败 + 一条原因」的旧形状，红了能直接看到是哪句
      return failedSuite(suiteTitle, specs, () => `代码编译执行语法错误: ${loaded.errorText ?? ''}`, consoleLogs, startTime)
    }

    const cases: TestCaseResult[] = []
    for (const tc of specs) {
      const cStartTime = Date.now()
      const outcome = await session.invoke(tc.exportName, tc.args ?? [])
      try {
        if (tc.assertion.kind === 'toThrow') {
          if (outcome.noExport) throw new Error(`导出 ${tc.exportName} 不存在或不是函数`)
          if (outcome.stopReason) throw new Error(outcome.errorText ?? '隔离沙盒未能完成执行')
          if (outcome.ok) throw new Error(`期望 ${tc.exportName} 抛出异常，但它正常返回了`)
        } else if (!outcome.ok) {
          throw new Error(outcome.errorText ?? `调用 ${tc.exportName} 失败`)
        } else if (outcome.valueUnavailable) {
          throw new Error(
            `${tc.exportName} 的返回值无法跨沙盒传递（${outcome.valueText ?? '不可克隆'}），` +
              `${tc.assertion.kind} 需要可比对的值`,
          )
        } else {
          applyAssertion(outcome.hasValue ? outcome.value : undefined, tc.assertion)
        }
        cases.push({
          id: tc.id,
          title: tc.title,
          status: 'passed',
          durationMs: Math.max(1, Date.now() - cStartTime),
        })
      } catch (err) {
        cases.push({
          id: tc.id,
          title: tc.title,
          status: 'failed',
          durationMs: Math.max(1, Date.now() - cStartTime),
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const passedCount = cases.filter((c) => c.status === 'passed').length
    return {
      suiteTitle,
      passedCount,
      failedCount: cases.length - passedCount,
      totalCount: cases.length,
      durationMs: Date.now() - startTime,
      cases,
      consoleLogs: [...session.logs].map(toConsoleLine),
    }
  } finally {
    session.close()
  }
}
