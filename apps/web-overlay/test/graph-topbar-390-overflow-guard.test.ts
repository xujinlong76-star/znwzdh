/**
 * `/graph` 顶部控制栏 390px 溢出守卫（U-444，2026-11-26）。
 *
 * 根因（纯 main be8fb8c5 实测，390px）：
 * 顶部栏两行都不换行、第 1 行左组 shrink-0。第 1 行按内容定宽 587px，
 * 场景胶囊组被挤到 8px 宽且推出视口（胶囊右缘 929px）、实时抽样徽章
 * 被裁 174.8px（右缘 564.8px）；第 2 行三组固定控件（换一批 116 +
 * 搜索 112 + 缩放 92）把图例条挤到约 22px 窄条，图例过滤与生态簇
 * chips 几乎不可见。页面本身无横向滚动条（main overflow-hidden），
 * 溢出部分是被直接裁掉、不是可滚到的。
 *
 * 修法：两行都允许换行（flex-wrap）；第 1 行左组去掉 shrink-0、标题
 * 去掉 whitespace-nowrap、h1 加 min-w-0，让标题/徽章在行内折行，
 * 场景胶囊换到第二行满宽展示；第 2 行图例条改 w-full sm:w-auto，
 * 窄屏占满一行，换一批 + 搜索 + 缩放换到第二行（合计 360px ≤ 390px）。
 * 桌面端（1366px）两行内容都放得下单行，布局不变。
 *
 * 宽度预算（390px 视口，内容宽 366px）：
 * 第 1 行：左组缩到 366px 内折行；场景组第二行 366px ≥ 胶囊合计 355px。
 * 第 2 行：图例条第一行 366px；第二行 116 + 8 + 112 + 8 + 92 = 336 ≤ 366。
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
const REL = 'src/components/ecosystem-graph.tsx'

/** 第 1 行：可换行 */
const ROW1 =
  '<div className="flex flex-wrap items-center gap-3 px-3 sm:px-6 pt-2 pb-1.5">'
const ROW1_OLD =
  '<div className="flex items-center gap-3 px-3 sm:px-6 pt-2 pb-1.5">'
/** 第 1 行左组：可收缩（旧写法 shrink-0 按内容定宽 565px） */
const LEFT_GROUP = '<div className="flex min-w-0 items-center gap-3">'
const LEFT_GROUP_OLD = 'flex items-center gap-3 min-w-0 shrink-0'
/** 标题：允许折行（旧写法 whitespace-nowrap 顶宽 h1） */
const TITLE = '<span>工具链关系图谱与平替雷达</span>'
const TITLE_OLD = 'whitespace-nowrap">工具链关系图谱与平替雷达'
/** 第 2 行：可换行 */
const ROW2 =
  '<div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 pb-2 pt-0.5">'
const ROW2_OLD =
  '<div className="flex items-center gap-2 px-3 sm:px-6 pb-2 pt-0.5">'
/** 图例条：窄屏占满一行（旧写法 flex-1 被固定控件挤到约 22px） */
const LEGEND_STRIP =
  'min-w-0 grow items-center gap-2 overflow-x-auto no-scrollbar w-full sm:w-auto'
const LEGEND_STRIP_OLD = 'overflow-x-auto no-scrollbar min-w-0 flex-1'

describe('/graph 顶部控制栏：390px 换行不裁控件，桌面单行不变', () => {
  for (const [name, root] of [
    ['apps/web', WEB_ROOT],
    ['apps/web-overlay', OVERLAY_ROOT],
  ] as const) {
    it(`${name}：第 1 行可换行，左组可收缩`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(ROW1)
      expect(src).not.toContain(ROW1_OLD)
      expect(src).toContain(LEFT_GROUP)
      expect(src).not.toContain(LEFT_GROUP_OLD)
    })

    it(`${name}：标题可折行，不再 whitespace-nowrap 顶宽`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(TITLE)
      expect(src).not.toContain(TITLE_OLD)
    })

    it(`${name}：第 2 行可换行，图例条窄屏占满一行`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(ROW2)
      expect(src).not.toContain(ROW2_OLD)
      expect(src).toContain(LEGEND_STRIP)
      expect(src).not.toContain(LEGEND_STRIP_OLD)
    })

    it(`${name}：全部工具栏控件仍在（未为修溢出删功能）`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      for (const token of [
        'aria-label="场景切换"',
        'aria-label="图例过滤"',
        '换一批生态簇',
        'aria-label="搜索图谱节点"',
        'aria-label="放大"',
        'aria-label="缩小"',
        'aria-label="重置视图"',
        '实时抽样 ',
      ]) {
        expect(src).toContain(token)
      }
    })
  }
})
