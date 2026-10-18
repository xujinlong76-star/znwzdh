/**
 * 插件契约的「双份一致性」守门。
 *
 * 事实源在 packages/core/src/plugin-manifest.ts，前端运行时镜像在
 * apps/web-overlay/src/lib/plugins/plugin-manifest.ts（再镜像到 apps/web）。
 * 两侧除头部注释外必须字节级一致——改了 core 忘镜像、或镜像被手改，
 * 这里会直接红。这是仓库里第一个对「core ↔ 前端副本」做自动校验的守卫
 * （弥补《CODEBASE_OVERVIEW》风险清单 P1「算法双份无校验」）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateAndCleanPluginManifest } from '../src/lib/plugins/plugin-manifest.ts'

const ROOT = new URL('../../../', import.meta.url)
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8')

const START = '// @plugin-manifest:parity-ignore-start'
const END = '// @plugin-manifest:parity-ignore-end'

function stripParityHeader(source: string): string {
  const start = source.indexOf(START)
  const end = source.indexOf(END)
  if (start === -1 || end === -1) {
    throw new Error(`插件契约缺少 parity 标记（${START} / ${END}）`)
  }
  return (source.slice(0, start) + source.slice(end + END.length)).replace(/\r\n/g, '\n')
}

describe('插件契约双份一致性（core ↔ overlay ↔ web）', () => {
  const core = read('packages/core/src/plugin-manifest.ts')
  const overlay = read('apps/web-overlay/src/lib/plugins/plugin-manifest.ts')
  const web = read('apps/web/src/lib/plugins/plugin-manifest.ts')

  it('core 事实源与 overlay 镜像正文一致', () => {
    expect(stripParityHeader(overlay)).toBe(stripParityHeader(core))
  })

  it('overlay 与 apps/web 镜像全文件一致（丢镜像 = 丢部署）', () => {
    expect(web.replace(/\r\n/g, '\n')).toBe(overlay.replace(/\r\n/g, '\n'))
  })

  it('镜像可被前端运行时加载并完成一次真实校验', () => {
    const res = validateAndCleanPluginManifest({
      manifestVersion: 1,
      kind: 'theme',
      name: '镜像烟测',
      version: '1.0.0',
      payload: { tokens: { '--primary': '262 83% 58%' } },
    })
    expect(res.ok).toBe(true)
  })
})
