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
 *
 * px10 字段（本轮新增）：该文件尚未转换的 `text-[10px]` 剩余个数。
 * 本轮替补文件 admin/plugins/page.tsx 只换了 11px，仍有 15 处 10px
 * 未动——按 Top 2 原样登记会红（`not.toContain('text-[10px]')`），
 * 故用 px10 精确钉住剩余数（增减都要改登记），而不是放任不管；
 * rem10 仍按原口径 = `text-[0.625rem]` 个数（本文件为 0）。
 *
 * 本轮替补说明（2026-11-25 09:22 进化轮）：原 Top 3 文件
 * search-palette.tsx 与 open PR #97 实质冲突（PR #97 改写其中 4 行
 * 目标行），按指令换替补文件 admin/plugins/page.tsx，不得碰
 * search-palette.tsx。Top 1（data-safety-card）与 Top 2
 * （account-view）均未合入 main，其行暂缓登记，见下方注释。
 *
 * 五家合流（2026-11-25 13:22 进化轮，rebase 到 main fe3e1311）：
 * 本分支只落地 admin/plugins 一切片，故只有它一行激活；其余四家
 * （spotlight-modal 33/px10:19、settings-panel 32/px10:14、
 * account-view 10、data-safety-card 10）的转换仍在各自的分
 * 支上、未合入 main，在本分支上仍是 px 形态——其行保持注释，
 * 数字已按各家分支守卫文件逐一核对（1022 分支登记 spotlight-modal
 * { rem11: 33, px10: 19 }、1122 分支登记 settings-panel
 * { rem11: 32, px10: 14 }、0922/1022 两分支注释行均登记
 * account-view 与 data-safety-card 各 { rem11: 10 }），合流只合并
 * 登记表，不丢弃他分支登记；待各家分支合入 main 后按落地文件实测
 * 数取消注释再登记——现在激活会红。
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
const CONVERTED: Array<{ file: string; rem10: number; rem11: number; rem12?: number; px10?: number }> = [
  // 本轮 Top 3 替补（E1）：admin/plugins/page.tsx，38 处 text-[11px] → text-[0.6875rem]；
  // 15 处 text-[10px] 未动（本轮范围外），px10: 15 精确钉住。
  { file: 'src/app/admin/plugins/page.tsx', rem10: 0, rem11: 38, px10: 15 },
  // 1022 轮（E1）：spotlight-modal.tsx 未合入 main，其行暂缓登记。
  // 待其分支合入 main 后，按落地文件实测数取消注释再登记——
  // 现在登记会红（该文件在本分支上仍是 px 形态）。
  // 1022 轮（E1）：spotlight-modal.tsx，33 处 text-[11px] → text-[0.6875rem]；
  // 19 处 text-[10px] 未动，px10: 19 精确钉住。
  // { file: 'src/components/search/spotlight-modal.tsx', rem10: 0, rem11: 33, px10: 19 },
  // 1122 轮（E1）：settings-panel.tsx 未合入 main，其行暂缓登记。
  // 待其分支合入 main 后，按落地文件实测数取消注释再登记——
  // 现在登记会红（该文件在本分支上仍是 px 形态）。
  // 1122 轮（E1）：settings-panel.tsx，32 处 text-[11px] → text-[0.6875rem]；
  // 14 处 text-[10px] 未动，px10: 14 精确钉住。
  // { file: 'src/components/user-center/settings-panel.tsx', rem10: 0, rem11: 32, px10: 14 },
  // Top 2（account-view.tsx）未合入 main，其行暂缓登记。
  // 待其分支合入 main 后，按落地文件实测数取消注释再登记——
  // 现在登记会红（该文件在 main 上仍是 px 形态）。
  // Top 2 轮（E1）：account-view.tsx，10 处 text-[11px] → text-[0.6875rem]。
  // { file: 'src/app/me/account/account-view.tsx', rem10: 0, rem11: 10 },
  // Top 1（data-safety-card.tsx）未合入 main，其行暂缓登记。
  // 待其分支合入 main 后，按落地文件实测数取消注释再登记——
  // 现在登记会红（该文件在 main 上仍是 px 形态）。
  // Top 1 轮（E1）：data-safety-card.tsx，10 处 text-[11px] → text-[0.6875rem]。
  // { file: 'src/components/user-center/data-safety-card.tsx', rem10: 0, rem11: 10 },
]

describe('rem 字号守卫（已转换文件不回退 px）', () => {
  for (const entry of CONVERTED) {
    it(`${entry.file}：px 不回退，rem 个数精确`, () => {
      const src = overlaySource(entry.file)
      // 11px 维度：本轮已清零，永不回退。
      expect(src).not.toContain('text-[11px]')
      // 10px 维度：已清零的文件断言“无 px”；仍有剩余的文件用 px10 精确钉住个数。
      if (entry.px10 !== undefined) {
        expect(count(src, 'text-[10px]')).toBe(entry.px10)
      } else {
        expect(src).not.toContain('text-[10px]')
      }
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
