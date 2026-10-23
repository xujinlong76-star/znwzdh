import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * /custom 的首屏占位锁（2026-10-23 Lighthouse：CLS 0.43）。
 *
 * 本地布局必须等 chunk 下载完、effect 读完 localStorage 才能渲染。两个过渡态
 * （动态 loading / !initialized）都曾只有 420px / py-20，页脚先落在折叠线内，
 * 画布展开后被顶到 2000px 外 —— 占比最大的两条 layout shift 都来自这里。
 * 占位至少一屏，页脚在内容就绪前始终留在折叠线以下。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('模块化画布首屏占位', () => {
  it('动态 loading 占位至少一屏，不再退回 420px', () => {
    const client = overlayFile('src/components/modular/modular-canvas-client.tsx')
    expect(client).toContain('min-h-[100vh]')
    expect(client).not.toContain('min-h-[420px]')
  })

  it('初始化态与 loading 占位同高，不会二次塌陷', () => {
    const canvas = overlayFile('src/components/modular/modular-canvas.tsx')
    expect(canvas).toContain('min-h-[100vh] py-20')
  })
})
