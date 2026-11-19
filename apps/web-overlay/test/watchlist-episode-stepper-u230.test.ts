/**
 * U-230 残留：追剧清单集数步进手动输入负数静默清零进度。
 *
 * 根因：EpisodeStepper.commit() 对负数不拦（Number.isFinite(-3) 为真，
 * 直接 onSet(-3)），下游 useWatchlist.setEpisode 把负数 clamp 成 0 写盘
 * ——用户一次手误就把整部剧进度静默重置为第 0 集，无提示、不可恢复。
 * 非法输入（NaN）静默丢弃无反馈；超 100000 静默截断；小数静默取整。
 *
 * vitest 无 jsdom 写不了渲染断言，沿用 history-delete-confirm.test.ts 的
 * p3-13 源码文本断言模式：读 overlay 源码，锁 commit() 的校验分支顺序、
 * 拒绝分支零 onSet、行内反馈（role="alert" + text-destructive-text）。
 * 真点按靠 CI E2E 闭合。
 *
 * 注意：本文件经 `pnpm mirror:web` 同步到 apps/web/test 后才生效；
 * overlaySource 按 p3-13 的口径优先读 overlay 源码。
 */
import { existsSync, readFileSync } from 'node:fs'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// mock 卫生兜底：本文件无跨模块 mock，但与同 worker 的后续文件隔离，
// 沿用 drama-due-badge.test.ts / search-plugin-results.test.ts 的口径。
afterAll(() => {
  vi.resetModules()
})

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const PAGE = overlaySource('src/app/me/watchlist/page.tsx')
const HOOK = overlaySource('src/hooks/useWatchlist.ts')

/** 断言若干标记在源码中按给定顺序出现（严格递增）。 */
function assertOrder(src: string, markers: string[], label: string): void {
  let prev = -1
  for (const m of markers) {
    const idx = src.indexOf(m, prev + 1)
    expect(idx, `${label}：应按顺序出现 ${JSON.stringify(m)}`).toBeGreaterThan(prev)
    prev = idx
  }
}

/** 截取 EpisodeStepper.commit 的函数体（从声明起到 return( 之前）。 */
function commitBody(src: string): string {
  const start = src.indexOf('const commit = () => {')
  expect(start, 'EpisodeStepper commit 应存在').toBeGreaterThanOrEqual(0)
  const end = src.indexOf('\n  }\n  return (', start)
  expect(end, 'commit 应在 return( 之前闭合').toBeGreaterThan(start)
  return src.slice(start, end)
}

/** 截取 EpisodeStepper 整段（从组件声明起到下一节注释之前）。 */
function stepperBody(src: string): string {
  const start = src.indexOf('function EpisodeStepper')
  expect(start, 'EpisodeStepper 应存在').toBeGreaterThanOrEqual(0)
  const end = src.indexOf('/* ------------------------------ 节奏改选', start)
  expect(end, 'EpisodeStepper 之后应有节奏改选节').toBeGreaterThan(start)
  return src.slice(start, end)
}

/** 截取 commit 内某一 if 分支（从分支条件起到其 return 之后）。 */
function branchToReturn(body: string, marker: string): string {
  const start = body.indexOf(marker)
  expect(start, `commit 应有分支 ${marker}`).toBeGreaterThanOrEqual(0)
  const ret = body.indexOf('return', start)
  expect(ret, `分支 ${marker} 应有 return`).toBeGreaterThan(start)
  return body.slice(start, ret + 'return'.length)
}

describe('U-230 残留：集数步进负数/非法输入拒绝 + 行内反馈', () => {
  it('断言 1：负数拒绝——onSet 零调用、原集数不变、有行内反馈', () => {
    const body = commitBody(PAGE)
    // 负数分支先于一切 onSet 调用：条件 → 报错文案 → 清 draft → return。
    assertOrder(
      body,
      ['if (n < 0) {', 'setError(`集数不能为负数，已恢复为第 ${entry.episode} 集`)', 'setDraft(null)', 'return'],
      'commit 负数分支',
    )
    // 拒绝分支内无 onSet：负数到不了 setEpisode，也就到不了下游 clamp 写 0。
    expect(branchToReturn(body, 'if (n < 0) {')).not.toContain('onSet')
    // 负数分支在两处 onSet 之前：正常提交与截断提交都在其后。
    expect(body.indexOf('if (n < 0) {')).toBeLessThan(body.indexOf('onSet(100000)'))
    expect(body.indexOf('if (n < 0) {')).toBeLessThan(body.indexOf('onSet(n)'))
  })

  it('断言 2：非数字拒绝——onSet 零调用、原集数不变、有行内反馈', () => {
    const body = commitBody(PAGE)
    // 先取 Number 再判有限：非数字（NaN）进拒绝分支，不静默丢弃。
    assertOrder(
      body,
      ['const raw = Number(draft)', 'if (!Number.isFinite(raw)) {', "setError('请输入数字')", 'setDraft(null)', 'return'],
      'commit 非数字分支',
    )
    expect(branchToReturn(body, 'if (!Number.isFinite(raw)) {')).not.toContain('onSet')
  })

  it('断言 3：超上限截断并明示——记为 100000 且文案说明已被截断', () => {
    const body = commitBody(PAGE)
    assertOrder(
      body,
      ['if (n > 100000) {', "setError('最多 100000 集，已记为 100000 集')", 'onSet(100000)', 'return'],
      'commit 超上限分支',
    )
    // 超上限分支先报错、再写盘：用户看到截断说明的同时进度已落盘。
    // 输入框的 max 属性仍在（拦不住手输，但与分支口径一致）。
    expect(PAGE).toContain('max={100000}')
  })

  it('断言 4：空白回归——恢复原值、不调 onSet（U-230 5a3472cb 行为不变）', () => {
    const body = commitBody(PAGE)
    assertOrder(
      body,
      ["if (draft.trim() === '') {", 'setError(null)', 'setDraft(null)', 'return'],
      'commit 空值分支',
    )
    expect(branchToReturn(body, "if (draft.trim() === '') {")).not.toContain('onSet')
    // 空值守卫仍在所有转换/onSet 之前：空值到不了写盘。
    expect(body.indexOf('onSet(n)')).toBeGreaterThan(body.indexOf("if (draft.trim() === '') {"))
    expect(body.indexOf('Number(draft)')).toBeGreaterThan(body.indexOf("if (draft.trim() === '') {"))
  })

  it('断言 5：小数保留取整——Math.trunc 仍在，无整数独占拒绝分支', () => {
    const body = commitBody(PAGE)
    // 取整行为保留（常规整数输入语义，与改前一致，不另提示）。
    expect(body).toContain('const n = Math.trunc(raw)')
    expect(body).not.toContain('Number.isInteger')
    // 正常提交路径：清反馈、清 draft、调 onSet(n)。
    assertOrder(body, ['setError(null)', 'setDraft(null)', 'onSet(n)'], 'commit 正常提交')
  })

  it('断言 6：反馈渲染——role="alert" 行内文案，用已提档的 destructive token', () => {
    const stepper = stepperBody(PAGE)
    expect(stepper).toContain('const [error, setError] = useState<string | null>(null)')
    // 行内错误文案：role="alert"（不抢焦点）+ text-destructive-text。
    expect(stepper).toContain('role="alert"')
    expect(stepper).toContain('text-destructive-text')
    // 不用裸 text-destructive（深色下 1.98:1，a11y-token-contrast 冷区禁令）。
    expect(stepper).not.toMatch(/text-destructive(?!-text)/)
    // 不新增错误条底色（bg-destructive/10 已提档 /15，行内文案无底色）。
    expect(stepper).not.toContain('bg-destructive')
    // 本页无 toast 基建：反馈只走行内文案，不引入 toast。
    expect(PAGE).not.toContain('useToast')
    // 用户重新输入即清旧反馈，不让过期文案赖着不走。
    expect(stepper).toContain('setError(null)')
  })

  it('断言 7：+/- 按钮行为不变；唯一 onSet 调用点仍是 setEpisode', () => {
    const stepper = stepperBody(PAGE)
    expect(stepper).toContain('onClick={() => onSet(entry.episode - 1)}')
    expect(stepper).toContain('disabled={entry.episode <= 0}')
    expect(stepper).toContain('onClick={() => onSet(entry.episode + 1)}')
    // onSet 全仓唯一调用点仍是 EntryRow 的 setEpisode 接线。
    expect(PAGE).toContain('onSet={(n) => watchlist.setEpisode(entry.key, n)}')
  })

  it('断言 8：下游兜底不变——setEpisode 的 clamp（负数→0）仍在，只防编程错误', () => {
    // UI 层拒绝负数后，下游 clamp 只剩防御性兜底；锁死它，防止后人
    // “修掉兜底”又把 UI 校验当唯一防线。
    expect(HOOK).toContain('Math.min(Math.max(Math.trunc(episode) || 0, 0), 100_000)')
  })
})
