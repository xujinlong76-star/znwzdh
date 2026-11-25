/**
 * rem 字号守卫（E1）：已换成 rem 的文件不许改回 px。
 *
 * 防的是“已换成 rem 的文件被人改回 px”（复制粘贴旧代码、rebase 冲突
 * 解决时选错边、后续需求顺手写回 `text-[11px]`）。只覆盖已落地文件，
 * 不做全仓断言——全仓尚有 1700+ 处未换，全仓 `not.toContain` 上线
 * 第一天就红，没有意义（W4 §4.1）。
 *
 * 做法：纯源码字符串读取（与 me-data-safety.test.ts 的 overlaySource
 * 同款），零渲染、零新依赖。登记表是唯一新增维护点：每落地一切片
 * 加一行，数字 = 该文件转换后的 rem 计数，以 main 落地后的文件实测
 * 为准，不许按分支 Compare 数直接登记。
 *
 * 注意：测试从 apps/web/test 镜像运行（vitest.config.ts 注释），但
 * overlaySource 读的是 overlay 源文件；新建本文件后须先跑
 * `pnpm mirror:web` 同步到 apps/web/test，
 * 再跑测试（见实施清单第 5、6 步）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function count(src: string, token: string): number {
  return src.split(token).length - 1
}

// 登记表：每落地一切片加一行，数字 = 该文件转换后的 rem 计数。
// 只有已合入 main 的切片才能登记——数字以 main 落地后的文件实测为准。
const CONVERTED: Array<{ file: string; rem10: number; rem11: number; rem12?: number }> = [
  // 本轮 Top 1（E1）：data-safety-card.tsx，10 处 text-[11px] → text-[0.6875rem]。
  { file: 'src/components/user-center/data-safety-card.tsx', rem10: 0, rem11: 10 },
  // 0122 / 0322 尚未合入 main（main 仍为 9e3797e80），以下行暂缓登记。
  // 待对应分支合入 main 后，按落地文件实测数逐行取消注释再登记——
  // 现在取消注释会红（那些文件在 main 上仍是 px 形态）。
  // 0122 轮（7 overlay + 1 web 镜像；数字按 W4 §4.2，取消注释前须实测复核）：
  // { file: 'src/components/search-palette.tsx', rem10: 18, rem11: 33 },
  // { file: 'src/app/search/search-results.tsx', rem10: 3, rem11: 14 },
  // { file: 'src/components/navigation-card.tsx', rem10: 12, rem11: 1 },
  // { file: 'src/components/navigation-content.tsx', rem10: 2, rem11: 0 },
  // { file: 'src/components/mobile-nav.tsx', rem10: 0, rem11: 2, rem12: 1 },
  // { file: 'src/components/navigation-toolbar.tsx', rem10: 2, rem11: 0 },
  // { file: 'src/components/category-quick-jump-bar.tsx', rem10: 2, rem11: 0 },
  // 0322 轮：
  // { file: 'src/components/category-site-filter-bar.tsx', rem10: 3, rem11: 7 },
  // 注意：navigation-content.tsx 还有一份 apps/web 镜像，不在 overlay 测试
  // 的读取范围内——按 W4 §4.2，要么在 web 侧测试里加一行等价断言，要么
  // 在本文件里用 readWeb 先例（me-data-prune-events-profile-copy.test.ts）
  // 另读它；不在本文件的 CONVERTED 里登记。
]

describe('rem 字号守卫（已转换文件不回退 px）', () => {
  for (const entry of CONVERTED) {
    it(`${entry.file}：px 不回退，rem 个数精确`, () => {
      const src = overlaySource(entry.file)
      expect(src).not.toContain('text-[10px]')
      expect(src).not.toContain('text-[11px]')
      // 个数守卫：既防回退（数少了），也防实现轮手滑多写（数多了）
      expect(count(src, 'text-[0.625rem]')).toBe(entry.rem10)
      expect(count(src, 'text-[0.6875rem]')).toBe(entry.rem11)
      if (entry.rem12 !== undefined) {
        expect(src).not.toContain('text-[12px]')
        expect(count(src, 'text-[0.75rem]')).toBe(entry.rem12)
      }
    })
  }
})
