/**
 * 首页短剧影院标题行手机溢出守卫（2026-11-15 03:22 轮，UX #5）。
 *
 * 根因：标题行是单行 flex（标题 +「我的追剧」+「进入短剧专区」+ 翻页组），
 * 外层 section 带 overflow-hidden。360px 下内容宽 328px，行内合计约
 * 406px（标题 ~108 + 间距 12 + 操作组 ~286），溢出约 78px 被直接裁掉，
 * 最右侧的「向右翻页」按钮部分或完全不可见、点不到——而它恰是该区
 * 唯一的横向浏览动作。390px 溢出约 48px，414px 溢出约 24px。
 *
 * 修法：标题行允许换行（flex-wrap，sm 以上恢复单行 flex-nowrap）；
 * 操作组整体 shrink-0 + ml-auto，窄屏时整组换到第二行右对齐，不被
 * 挤压裁剪；两文字链与翻页组各自 shrink-0 + whitespace-nowrap，
 * 不参与收缩。桌面端（sm+，内容宽 ≥592px）单行合计约 422px，仍放得下，
 * 外观不变。翻页按钮本身仍为 32px（本轮只修可见性，不扩尺寸）。
 *
 * 宽度预算（360px 视口）：内容宽 328 = 操作组 286 ≤ 328，第二行放得下；
 * 桌面 640px：内容宽 592 ≥ 标题 108 + 间距 12 + 操作组 286 = 406，单行。
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

/** 标题行容器：可换行，sm 以上恢复单行 */
const HEADER_ROW =
  '<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:flex-nowrap sm:px-6">'
/** 旧写法：单行不换行，窄屏必溢出 */
const HEADER_ROW_OLD =
  '<div className="flex items-center justify-between px-4 pt-4 sm:px-6">'
/** 操作组：整组不收缩，换行后靠 ml-auto 右对齐 */
const ACTION_GROUP =
  '<div className="ml-auto flex shrink-0 items-center justify-end gap-2 sm:gap-4">'
/** 旧写法：无 ml-auto、无 shrink-0，窄屏被挤压 */
const ACTION_GROUP_OLD = '<div className="flex items-center gap-4">'
/** 翻页组：不收缩，始终完整可见 */
const PAGER_GROUP =
  '<div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="短剧海报翻页">'

describe('短剧影院标题行：窄屏换行不断翻页按钮，桌面单行不变', () => {
  for (const [name, root] of [
    ['apps/web', WEB_ROOT],
    ['apps/web-overlay', OVERLAY_ROOT],
  ] as const) {
    it(`${name}：标题行可换行，sm 以上单行`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(HEADER_ROW)
      expect(src).not.toContain(HEADER_ROW_OLD)
    })

    it(`${name}：操作组整组不收缩，换行后右对齐`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(ACTION_GROUP)
      expect(src).not.toContain(ACTION_GROUP_OLD)
    })

    it(`${name}：翻页按钮组不收缩`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(PAGER_GROUP)
    })

    it(`${name}：两文字入口不换行不断行`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain('shrink-0 items-center gap-0.5 whitespace-nowrap text-sm text-zinc-300')
    })
  }
})
