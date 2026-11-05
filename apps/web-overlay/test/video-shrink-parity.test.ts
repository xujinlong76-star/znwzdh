/**
 * 缩水保护的判据：前端副本必须与中枢逐字一致。
 *
 * 背景：`videos.json` 的整包覆盖写有两道同判据的守卫——中枢
 * （apps/api/src/storage.ts 的 evaluateVideoShrink）与前端
 * （lib/video-write-guard.ts 的 evaluateVideoShrink，被 video-library-store 用）。
 * 前端那份是**故意的副本**：Web 生产镜像只含 overlay，跨包引用中枢会构建失败
 * （与 lib/health-state.ts 同一取舍）。
 *
 * 真正的风险不是复制，而是悄悄分叉：
 *   - 数字分叉：前端按 90% 拦、中枢按 80% 放行，操作者带满确认参数还是撞 409；
 *   - 边界分叉：一边 `>=` 一边 `>`，正好 80% 那次一边放一边拦；
 *   - 错误码分串：中枢新加一种拦截码，前端的 isVideoShrinkBlock 认不出来，
 *     就会被当成「版本冲突」重放三次，最后还给用户一句误导性的「请刷新重试」
 *     （这正是 video-shrink-confirm.test.ts 第 3 条钉过的坑）。
 * 这里用中枢自己的源码文本作为事实源，逐字比对，而不是在测试里再抄第三份数字。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  evaluateVideoShrink,
  isVideoShrinkBlock,
  SHRINK_BLOCK_CODES,
  VIDEO_SHRINK_KEEP_RATIO,
  VIDEO_SHRINK_MIN_BASELINE,
} from '../src/lib/video-write-guard'

function repoRoot(): string {
  let root = __dirname
  for (let i = 0; i < 6 && !existsSync(resolve(root, 'pnpm-workspace.yaml')); i++) {
    root = dirname(root)
  }
  if (!existsSync(resolve(root, 'pnpm-workspace.yaml'))) throw new Error('无法定位仓库根')
  return root
}

const ROOT = repoRoot()
/** 中枢事实源：不是测试里的手抄副本，改中枢不需要同时改这个测试 */
const HUB = readFileSync(resolve(ROOT, 'apps/api/src/storage.ts'), 'utf8').replace(/\r\n/g, '\n')

/** 提取 `export const NAME = <number>;`——提不到就红，避免「常量改名后守卫静默放行」 */
function hubNumber(name: string): number {
  const hit = new RegExp(`export const ${name} = ([0-9.]+);`).exec(HUB)
  if (!hit) throw new Error(`中枢里找不到 export const ${name} = <数字>;（改名或换写法了，请同步本守卫）`)
  return Number(hit[1])
}

/** 提取 `export type X = | "a" | "b";` 的成员，同上：提不到就红 */
function hubUnionMembers(name: string): string[] {
  const hit = new RegExp(`export type ${name} =([^;]*);`).exec(HUB)
  if (!hit) throw new Error(`中枢里找不到 export type ${name} = ...;（改名或换写法了，请同步本守卫）`)
  const members = [...hit[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  if (members.length === 0) throw new Error(`${name} 的成员提取为空，判定口径已经变了`)
  return members
}

describe('前端缩水判据与中枢逐字一致', () => {
  it('两个数字与中枢完全相同', () => {
    expect(VIDEO_SHRINK_MIN_BASELINE).toBe(hubNumber('VIDEO_SHRINK_MIN_BASELINE'))
    expect(VIDEO_SHRINK_KEEP_RATIO).toBe(hubNumber('VIDEO_SHRINK_KEEP_RATIO'))
  })

  it('判定公式的三行形状仍与中枢一致（换算法就必须同时换前端）', () => {
    // 中枢把判据写成「基线不够 → 不判」「保留够 → 不判」「否则给出下限」，
    // 比较方向（< / >=）与取整方式（Math.ceil）都算判据的一部分。
    for (const shape of [
      /export function evaluateVideoShrink\(existingCount: number, incomingCount: number\)[^\n]*\{[\s\S]{0,400}?if \(existingCount < VIDEO_SHRINK_MIN_BASELINE\) return null;/,
      /if \(incomingCount >= existingCount \* VIDEO_SHRINK_KEEP_RATIO\) return null;/,
      /minimumAllowed: Math\.ceil\(existingCount \* VIDEO_SHRINK_KEEP_RATIO\)/,
    ]) {
      expect(HUB, `中枢的判定形状变了：${shape.source}`).toMatch(shape)
    }
  })

  it('三种拦截码逐字一致（少一种就会把缩水 409 当版本冲突重放）', () => {
    expect([...SHRINK_BLOCK_CODES].sort()).toEqual(hubUnionMembers('VideoShrinkBlockCode').sort())
    // 中枢的导航快照域另有三个 navigation_* 码：那条链路只在中枢判定，
    // 前端这份副本不该混进去（混进去会把「快照缩水」的文案当成视频错误）。
    expect(SHRINK_BLOCK_CODES.some((c) => c.startsWith('navigation_'))).toBe(false)
  })

  it('中枢确实把两种域的常量分开（前端只跟视频域，不越权改导航域）', () => {
    expect(hubNumber('NAVIGATION_SHRINK_MIN_BASELINE')).toBeGreaterThan(0)
    expect(hubNumber('NAVIGATION_SHRINK_KEEP_RATIO')).toBeGreaterThan(0)
  })

  it('isVideoShrinkBlock 认得中枢的每一种视频拦截码', () => {
    for (const code of hubUnionMembers('VideoShrinkBlockCode')) {
      expect(isVideoShrinkBlock({ message: `保存失败：${code}（待写入 10 个）` }), code).toBe(true)
    }
    expect(isVideoShrinkBlock({ message: 'navigation_shrink_requires_confirmation' })).toBe(false)
    expect(isVideoShrinkBlock({ message: 'version conflict' })).toBe(false)
  })
})

describe('同一批输入，前端与中枢必须同结论', () => {
  // 期望值由「中枢文本里提取到的数字」现算，测试里没有第三份 100 / 0.8
  const MIN = hubNumber('VIDEO_SHRINK_MIN_BASELINE')
  const RATIO = hubNumber('VIDEO_SHRINK_KEEP_RATIO')

  function expected(existing: number, incoming: number) {
    if (existing < MIN) return null
    if (incoming >= existing * RATIO) return null
    return { existingCount: existing, incomingCount: incoming, minimumAllowed: Math.ceil(existing * RATIO) }
  }

  const CASES: Array<[number, number]> = [
    [0, 0],
    [MIN - 1, 0], // 刚好不到基线：首次导入不该被拦
    [MIN, 0],
    [MIN, Math.ceil(MIN * RATIO) - 1], // 差一条就够下限
    [MIN, Math.ceil(MIN * RATIO)], // 正好等于下限
    [1000, 800],
    [1000, 799],
    [1000, 1000], // 原样覆盖写
    [6007, 4806],
    [6007, 4805],
    [20000, 1], // 极端：整库抹平
  ]

  it.each(CASES.map(([existing, incoming]) => [`${existing} -> ${incoming}`, existing, incoming] as const))(
    '%s',
    (_label, existing, incoming) => {
      expect(evaluateVideoShrink(existing, incoming)).toEqual(expected(existing, incoming))
    },
  )

  it('下限随基线单调收紧（判据不是写死的一个数）', () => {
    const small = evaluateVideoShrink(MIN, 0)
    const big = evaluateVideoShrink(MIN * 10, 0)
    expect(small).not.toBeNull()
    expect(big).not.toBeNull()
    expect(big!.minimumAllowed).toBe(Math.ceil(MIN * 10 * RATIO))
    expect(big!.minimumAllowed).toBeGreaterThan(small!.minimumAllowed)
  })
})

describe('提取器本身没瞎', () => {
  it('数字与拦截码都真从中枢文本里取到了', () => {
    expect(hubNumber('VIDEO_SHRINK_MIN_BASELINE')).toBe(VIDEO_SHRINK_MIN_BASELINE)
    expect(hubUnionMembers('VideoShrinkBlockCode')).toHaveLength(SHRINK_BLOCK_CODES.length)
    // 抄一份假的文本进去应当取不到，而不是默默给 0
    const fake = 'export const SOMETHING_ELSE = 7;'
    expect(() => {
      const hit = /export const VIDEO_SHRINK_MIN_BASELINE = ([0-9.]+);/.exec(fake)
      if (!hit) throw new Error('missing')
    }).toThrow('missing')
  })

  it('前端 store 仍按这条判据拦截，且确认条件没有放宽', () => {
    const store = readFileSync(resolve(ROOT, 'apps/web-overlay/src/lib/video-library-store.ts'), 'utf8')
    expect(store).toContain('const shrink = evaluateVideoShrink(initialCount, nextCount)')
    expect(store).toContain('if (!shrinkConfirmed && shrink)')
    // 放行必须是「两段都要 + 条数逐字相等」，退化成单布尔要红
    expect(store).toContain('options.confirmLargeDeletion === true && options.expectedCount === nextCount')
    expect(store).not.toMatch(/initialCount >= \d+ && nextCount < initialCount \* 0?\.\d/)
  })
})
