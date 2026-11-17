/**
 * P1-2 同类「失败不诚实」边角：export-plugin-modal 校验静默吞错。
 *
 * 链路（已核实）：
 *   - 服务端 `POST /api/plugins/validate` 清单非法时回 400
 *     `{ ok: false, error: '插件清单格式不合法', errors: [...] }`
 *    （apps/api/src/routes/plugins/p2-detail-and-tools.ts）。
 *   - 客户端 `sendJson`（src/lib/navhub-api.ts）对 `!res.ok` 一律抛
 *     `hubError`，所以 `validatePlugin` 在清单非法时是抛错而不是
 *     返回 `{ ok: false }`。
 *   - modal 预检 effect 的 catch 原先是空的（`// 网络异常容错`），
 *     抛出的 400 被吞掉，`validationErrors` 保持 `[]`，界面反而渲染
 *     「清单符合…校验 100% 通过」的假绿灯。
 *   - 发布页 `handleValidate` 的 catch 是正确口径：
 *     `setValidationResult({ ok: false, errors: [err.message] })`。
 *
 * 本文件钉住两点（仓库 vitest 是 node 环境、无 jsdom，组件挂载测不了，
 * modal 接线走源码守卫体例，同 plugin-install-modal-selection.test.ts）：
 *   1. `validatePlugin` 在 400 时确实抛错、错误消息就是服务端原话；
 *   2. modal 预检 catch 必须按发布页口径把错误回填进 `validationErrors`
 *     （修前空 catch → 第 2 组断言失败；修后通过）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePlugin } from '@/lib/navhub-api'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 定位 overlay 里的源码文件。测试文件有两份（overlay 源 + apps/web 里的镜像），
 * 相对路径不同，因此按「路径里必须含 web-overlay」消歧 —— 镜像副本若误指向
 * apps/web/src，就会去校验上游底座那份文件，断言失去意义。
 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)].map(
    (p) => p,
  )
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error(`无法定位 overlay 的 ${rel}（候选：${candidates.join(' | ')}）`)
  return readFileSync(hit, 'utf8')
}

/** 去掉块注释与行注释：守卫断言的是「代码真的用了」，不是「注释里提到了」 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const modalSrc = overlaySource('src/components/plugins/export-plugin-modal.tsx')
const code = stripComments(modalSrc)

/**
 * 预检 effect 里 `validatePlugin(manifest)` 之后的 catch 块体。
 * handlePublish 的 catch 是 `catch (err: any)`，形状不同，不会误取。
 */
function precheckCatchBody(): string {
  const fromValidate = code.indexOf('validatePlugin(manifest)')
  expect(fromValidate).toBeGreaterThan(-1)
  const tail = code.slice(fromValidate)
  const m = tail.match(/catch\s*(?:\(\s*err\s*\))?\s*\{([\s\S]*?)\}\s*finally/)
  expect(m).not.toBeNull()
  return m![1]
}

describe('export-plugin-modal：校验失败不能静默吞错', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: '插件清单格式不合法',
            errors: ['name 不能为空'],
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('validatePlugin：服务端 400 时抛错，错误消息就是服务端原话（不是 { ok: false } 返回）', async () => {
    const err = await validatePlugin({ kind: 'site-pack' }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('插件清单格式不合法')
    expect((err as Error & { status?: number }).status).toBe(400)
  })

  it('modal 预检 catch：必须把抛出的校验错误回填进 validationErrors（不能是空 catch）', () => {
    const body = precheckCatchBody()
    expect(body.trim()).not.toBe('')
    expect(body).toContain('setValidationErrors')
  })

  it('modal 预检 catch：回填口径与发布页 handleValidate 一致（err.message / String(err)）', () => {
    const body = precheckCatchBody()
    expect(body).toContain('err instanceof Error ? err.message : String(err)')
  })

  it('回填的错误能显示：modal 仍有 validationErrors 错误行渲染（「清单校验未通过」）', () => {
    expect(code).toContain('validationErrors.length > 0')
    expect(modalSrc).toContain('清单校验未通过')
    expect(modalSrc).toContain('validationErrors.map')
  })
})
