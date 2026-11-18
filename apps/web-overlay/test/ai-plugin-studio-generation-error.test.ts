import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * U-61：AI 插件工坊生成失败只靠 4 秒 toast，消失后无任何残留。
 *
 * 旧行为（复现）：handleGenerate 的三个失败分支（ok:false / 超时 / 抛错）
 * 只调 toast.error，无任何持久状态；toast 约 4 秒消失后弹窗内无迹可寻，
 * 用户既看不到失败原因，也没有地方点重试。
 *
 * 新行为（照搬 plugin-taps-modal.tsx 的 addError 范式）：
 * generationError 状态 + role="alert" 持久错误行 + 行内重试按钮；
 * 失败文案取自真实错误（响应体 error/errors、抛错 message、超时固定文案），不编造。
 * 重试复用上次尝试的提示词（lastAttemptedPrompt），即使用户已清空输入框也能重试。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了（见 handoff-card.test.ts 同款说明），接线走源码守卫体例。
 * 真机行为由 E2E 探针锁定（失败 → 错误行常驻 → 点重试 → 成功后错误行消失）。
 * 断言只可按新行为改写并在此写明原因，绝不删除。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRead(rel: string): string {
  const p = resolve(HERE, '..', '..', 'web-overlay', rel)
  if (!existsSync(p)) throw new Error('无法定位 overlay 文件 ' + p)
  return readFileSync(p, 'utf8')
}

/** 去掉块注释与行注释：守卫断言的是「代码真的用了」，不是「注释里提到了」 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const modal = stripComments(overlayRead('src/components/plugins/ai-plugin-studio-modal.tsx'))

/** 持久错误行的 JSX 块：从 {generationError && ( 起取一段，断言接线都在块内 */
function errorRowBlock(): string {
  const at = modal.indexOf('{generationError && (')
  expect(at).toBeGreaterThan(-1)
  return modal.slice(at, at + 900)
}

describe('U-61：生成失败有持久错误状态（不只靠 toast）', () => {
  it('generationError 状态存在（string | null，初始 null）', () => {
    expect(modal).toContain('const [generationError, setGenerationError] = useState<string | null>(null)')
  })

  it('新一次生成先清掉旧错误（重试开始即清行，不留 stale 文案）', () => {
    expect(modal).toContain('setGenerationError(null)')
    // 清理发生在 handleGenerate 开头：setGenerating(true) 附近即清错误
    const genAt = modal.indexOf('const handleGenerate')
    const clearAt = modal.indexOf('setGenerationError(null)', genAt)
    const generatingAt = modal.indexOf('setGenerating(true)', genAt)
    expect(clearAt).toBeGreaterThan(-1)
    expect(generatingAt).toBeGreaterThan(-1)
    expect(Math.abs(clearAt - generatingAt)).toBeLessThan(200)
  })

  it('ok:false 分支把真实服务端原因写进持久错误（不是通用文案）', () => {
    expect(modal).toContain('setGenerationError(errMsg)')
  })

  it('超时分支把超时文案写进持久错误（与 toast 同文，不编造新原因）', () => {
    expect(modal).toContain("setGenerationError('模型规划响应超时")
  })

  it('抛错分支把真实错误信息写进持久错误（不带“请求失败：”前缀）', () => {
    // 2026-11-18 双前缀修复：错误行本身已渲染「生成失败：」前缀，持久错误
    // 再带「请求失败：」会读成「生成失败：请求失败：尚未配置可用的模型密钥」
    // （U-61 探针实测文案）；toast 独立出现，仍保留自己的「请求失败：」前缀。
    expect(modal).toContain("setGenerationError(msg || '请检查模型配置或重试')")
    expect(modal).not.toContain('setGenerationError(`请求失败：')
  })

  it('没有任何 setGenerationError 调用带“请求失败”前缀（防双前缀复发）', () => {
    // 逐个检查全部 setGenerationError 调用参数；toast 的「请求失败：」不受影响，
    // toast 独立出现、需要自己的主语（见「失败 toast 原文案保留」）。
    const calls = [...modal.matchAll(/setGenerationError\(([\s\S]*?)\)/g)].map((m) => m[1])
    expect(calls.length).toBeGreaterThanOrEqual(4)
    expect(calls.some((arg) => arg.includes('请求失败'))).toBe(false)
    expect(modal).toContain('toast.error(`请求失败：')
  })

  it('三个失败分支都写持久错误（1 次清理 + 3 次写入 = 至少 4 处调用）', () => {
    const calls = modal.match(/setGenerationError\(/g) || []
    expect(calls.length).toBeGreaterThanOrEqual(4)
  })
})

describe('U-61：持久错误行常驻 + 行内重试', () => {
  it('错误行是 role="alert" 的持久行内元素，文案为真实错误（非写死）', () => {
    const block = errorRowBlock()
    expect(block).toContain('role="alert"')
    expect(block).toContain('生成失败：{generationError}')
    // a11y-token-contrast 守卫要求：destructive 文本用 text-destructive-text，不用裸 text-destructive
    expect(block).toContain('text-destructive-text')
    expect(block).not.toContain('text-destructive ')
  })

  it('行内有「重试」按钮，点它用上次提示词重新生成', () => {
    const block = errorRowBlock()
    expect(block).toContain('重试')
    expect(block).toContain('handleGenerate(lastAttemptedPrompt')
  })

  it('重试按钮生成中禁用（防重复提交）', () => {
    const block = errorRowBlock()
    expect(block).toContain('disabled={generating}')
  })

  it('lastAttemptedPrompt 状态存在，且每次生成都记下本次提示词', () => {
    expect(modal).toContain('const [lastAttemptedPrompt, setLastAttemptedPrompt] = useState<string | null>(null)')
    expect(modal).toContain('setLastAttemptedPrompt(text)')
  })

  it('成功分支清掉持久错误（成功后错误行消失）', () => {
    // 成功分支与开头清理二者至少其一在成功路径上：开头清理已钉死；
    // 此处再钉成功分支显式清理，防将来有人把开头清理挪走后成功仍留红行。
    const successAt = modal.indexOf("if (res.success && res.manifest)")
    expect(successAt).toBeGreaterThan(-1)
    const successBlock = modal.slice(successAt, successAt + 1200)
    expect(successBlock).toContain('setGenerationError(null)')
  })

  it('失败 toast 原文案保留（只加持久行，不删不改既有 toast）', () => {
    // 移植自 B 支 6fe32ffb 守卫第 6 项：A 支 diff 里 toast 行是未动的上下文行，
    // 行为上有保障，此处钉死「不删现有 toast」。
    expect(modal).toContain('toast.error(`生成失败: ${errMsg}`)')
    expect(modal).toContain('模型规划响应超时。已自动放宽时限，建议重试')
  })
})
