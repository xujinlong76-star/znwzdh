/**
 * 「继续追」续看卡片第二行溢出守卫（2026-11-13 22:22 轮）。
 *
 * 根因：卡片宽 w-56（224px），第二行是 flex 行（平台名 + 集数 + 角标）。
 * flex 子项默认 min-width:auto，`truncate` 单独写在平台名 span 上不会收缩：
 * 角标是 `continueBadge()` 的回落值，`cadenceLabel` 每周多日时为
 * 「每周一、三、五更新」（9 字，约 115px），加上三位数集数，
 * 平台名撑开后角标被顶出卡片圆角（412px 下实测推算约溢出 51px）。
 *
 * 修法：平台名 span 与第一行标题 span 同款写法
 * `min-w-0 flex-1 truncate` + title，让它成为行内唯一可收缩项；
 * 集数与角标保持 shrink-0 不动。
 *
 * 路径用仓库根相对定位：本文件经 mirror:web 在 apps/web 与
 * apps/web-overlay 双份存放，两边跑同一份断言。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const WEB_ROOT = resolve(REPO_ROOT, 'apps', 'web')
const OVERLAY_ROOT = resolve(REPO_ROOT, 'apps', 'web-overlay')
const REL = 'src/components/home-drama-cinema.tsx'

/** 第二行平台名 span：唯一可收缩项，截断后悬停仍可见全名 */
const PLATFORM_SPAN =
  '<span className="min-w-0 flex-1 truncate" title={e.platformTitle}>{e.platformTitle}</span>'
/** 旧写法：只有 truncate，没有 min-w-0，flex 行里不收缩 */
const PLATFORM_SPAN_BARE = '<span className="truncate">{e.platformTitle}</span>'

describe('「继续追」卡片第二行：平台名可收缩，角标不被顶出卡片', () => {
  for (const [name, root] of [
    ['apps/web', WEB_ROOT],
    ['apps/web-overlay', OVERLAY_ROOT],
  ] as const) {
    it(`${name}：平台名 span 带 min-w-0 flex-1 truncate + title`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(PLATFORM_SPAN)
      expect(src).not.toContain(PLATFORM_SPAN_BARE)
    })

    it(`${name}：集数与角标仍为 shrink-0，不参与收缩`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain('<span className="shrink-0">{e.episode > 0')
      expect(src).toContain('<span className="ml-auto shrink-0 rounded-full')
    })
  }
})
