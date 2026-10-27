/**
 * Timeline-Driven Live Unit Test Runner & Assertion Engine
 * Sandboxed headless test runner validating learner code against chapter unit tests.
 */

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

/**
 * Executes user code concatenated with test cases in an isolated closure.
 */
export async function runLiveCodeTest(
  suiteTitle: string,
  userCode: string,
  testCases: Array<{
    id: string
    title: string
    testFn: (ctx: { expect: typeof createExpect; logs: string[] }) => void | Promise<void>
  }>
): Promise<TestSuiteResult> {
  const startTime = Date.now()
  const logs: string[] = []
  const cases: TestCaseResult[] = []

  // Mock console log collector
  const mockConsole = {
    log: (...args: any[]) => {
      logs.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
    },
    warn: (...args: any[]) => {
      logs.push('[WARN] ' + args.join(' '))
    },
    error: (...args: any[]) => {
      logs.push('[ERROR] ' + args.join(' '))
    },
  }

  // Evaluate user code in Function context
  let userScopeExports: any = {}
  try {
    const wrappedFn = new Function('console', 'exports', `
      ${userCode}
      return typeof exports !== 'undefined' ? exports : {};
    `)
    userScopeExports = wrappedFn(mockConsole, userScopeExports) || {}
  } catch (err: any) {
    return {
      suiteTitle,
      passedCount: 0,
      failedCount: testCases.length,
      totalCount: testCases.length,
      durationMs: Date.now() - startTime,
      cases: testCases.map(tc => ({
        id: tc.id,
        title: tc.title,
        status: 'failed',
        durationMs: 0,
        error: `代码编译执行语法错误: ${err?.message || String(err)}`,
      })),
      consoleLogs: logs,
    }
  }

  // Run each test assertion
  for (const tc of testCases) {
    const cStartTime = Date.now()
    try {
      await tc.testFn({ expect: createExpect, logs })
      cases.push({
        id: tc.id,
        title: tc.title,
        status: 'passed',
        durationMs: Math.max(1, Date.now() - cStartTime),
      })
    } catch (err: any) {
      cases.push({
        id: tc.id,
        title: tc.title,
        status: 'failed',
        durationMs: Math.max(1, Date.now() - cStartTime),
        error: err?.message || String(err),
      })
    }
  }

  const passedCount = cases.filter(c => c.status === 'passed').length
  const failedCount = cases.length - passedCount

  return {
    suiteTitle,
    passedCount,
    failedCount,
    totalCount: cases.length,
    durationMs: Date.now() - startTime,
    cases,
    consoleLogs: logs,
  }
}
