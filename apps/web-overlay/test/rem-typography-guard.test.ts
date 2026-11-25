/**
 * rem 字号守卫（E1）：已换成 rem 的文件不许改回 px。
 *
 * 防的是“已换成 rem 的文件被人改回 px”（复制粘贴旧代码、rebase 冲突
 * 解决时选错边、后续需求顺手写回 `text-[11px]`）。只覆盖已落地文件，
 * 不做全仓断言——全仓尚有大量未换的 px 字号，全仓 `not.toContain`
 * 上线第一天就红，没有意义。
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
 * px10 字段：该文件尚未转换的 `text-[10px]` 剩余个数。
 * 本轮文件 settings-panel.tsx 只换了 11px，仍有 14 处 10px
 * 未动——按原样登记会红（`not.toContain('text-[10px]')`），
 * 故用 px10 精确钉住剩余数（增减都要改登记），而不是放任不管；
 * rem10 仍按原口径 = `text-[0.625rem]` 个数（本文件为 0）。
 *
 * 本轮切片说明（2026-11-25 11:22 进化轮）：选定文件
 * settings-panel.tsx，32 处 text-[11px] → text-[0.6875rem]。
 *
 * 合流注意：1022 轮已在自家分支上建了同名守卫文件（登记
 * spotlight-modal.tsx），尚未合入 main；本分支是 main 上首次新建，
 * 登记表只需登记本切片。合流时须合并两份登记表，不由本轮处理。
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
  // 本轮切片（E1）：settings-panel.tsx，32 处 text-[11px] → text-[0.6875rem]；
  // 14 处 text-[10px] 未动（本轮范围外），px10: 14 精确钉住。
  { file: 'src/components/user-center/settings-panel.tsx', rem10: 0, rem11: 32, px10: 14 },
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
