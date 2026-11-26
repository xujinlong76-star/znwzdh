/**
 * 搜索作用域编解码的「同构副本」一致性守卫（U-374）。
 *
 * 前端那份 `src/lib/search-scope.ts` 是 `packages/core/src/search-scope.ts` 的
 * 同步副本——因为 Web 生产镜像只拷贝 overlay，镜像里没有 packages/core，
 * 前端不能直接跨包 import（2026-10-27 main 的镜像构建因此红过）。
 *
 * 复制本身可以接受（仓库对 health-state / category-url / shortlink-target
 * 也是这么做的），不可接受的是两份**悄悄分叉**：中枢记的 scope 与历史页
 * 恢复出来的 scope 口径不一致，「再次搜索」就会带错筛选。
 * 这里用同一组矩阵同时喂给两份实现，要求输出逐字段相等。
 */
import { describe, expect, it } from 'vitest'
import {
  decodeSearchScope as fromCopy,
  encodeSearchScope as encodeCopy,
} from '../src/lib/search-scope'
import {
  decodeSearchScope as fromCore,
  encodeSearchScope as encodeCore,
} from '@navhub/core'

const SCOPES = [
  undefined,
  null,
  {},
  { category: 'ai-tools' },
  { tag: 'chat' },
  { category: 'ai-tools', tag: 'chat' },
  { category: 'ai-tools', facets: { pricing: ['free', 'freemium'] } },
  { category: '  ', tag: '' },
  { category: 'c'.repeat(100), tag: 't'.repeat(100) },
  { category: 'x', facets: { pricing: [''] } },
  { category: 'x', facets: { Pricing: ['FREE', ''] } },
  { category: 'x', facets: { pricing: ['free,freemium'] } },
  { category: 'x', facets: { pricing: [123] } },
  { category: 'x', facets: { pricing: [null] } },
  { category: 'x', facets: { bad: ['x'.repeat(101)] } },
]

const RAWS = [
  '',
  'not-json{',
  '[1,2]',
  '123',
  '{"category":"ai"}',
  '{"category":"ai","tag":123,"evil":"x","facets":"nope"}',
  '{"facets":{"Pricing":["FREE",""]}}',
  '{"category":"' + 'c'.repeat(100) + '"}',
]

describe('search-scope 同构副本与 core 逐字段一致', () => {
  it.each(SCOPES.map((s, i) => [i, s] as const))('encode 快照 #%i', (_i, scope) => {
    expect(encodeCopy(scope as never)).toBe(encodeCore(scope as never))
  })

  it.each(RAWS.map((s, i) => [i, s] as const))('decode 快照 #%i', (_i, raw) => {
    expect(fromCopy(raw)).toEqual(fromCore(raw))
  })

  it('encode→decode 往返一致', () => {
    const scope = { category: 'ai-tools', tag: 'chat', facets: { pricing: ['free'] } }
    expect(fromCopy(encodeCopy(scope))).toEqual(fromCore(encodeCore(scope)))
    expect(fromCopy(encodeCopy(scope))).toEqual(scope)
  })

  it('副本文件与 core 实现除说明头外逐字一致（防手改分叉）', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    const { dirname, resolve } = await import('node:path')
    // 测试可能跑在 apps/web-overlay/test 或镜像 apps/web/test，向上找仓库根
    let root = __dirname
    for (let i = 0; i < 6 && !existsSync(resolve(root, 'pnpm-workspace.yaml')); i++) {
      root = dirname(root)
    }
    const core = readFileSync(resolve(root, 'packages/core/src/search-scope.ts'), 'utf8')
    const copy = readFileSync(resolve(root, 'apps/web-overlay/src/lib/search-scope.ts'), 'utf8')
    // 副本允许有一段落款说明，其余必须一致
    const body = copy.slice(copy.indexOf('*/') + 2).trimStart()
    // 行尾归一后再比：仓库在 Windows 上可能出现 CRLF，语义不受影响
    const normalize = (text: string) => text.split('\r\n').join('\n')
    expect(normalize(body)).toBe(normalize(core.slice(core.indexOf('*/') + 2)).trimStart())
  })
})
