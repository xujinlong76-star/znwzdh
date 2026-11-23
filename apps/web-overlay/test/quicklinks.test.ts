/**
 * 参数化快捷链接（Quicklinks）：lib/quicklinks.ts 的纯函数。
 *
 * 只测纯函数；接线（search-palette / spotlight / search-bar 的横幅、
 * 回车、记账）由组件层承担，不在这里重复测。
 *
 * 锁四件事：
 *  1. 校验：合法模板通过，8 类非法输入逐一拒绝且 reason 正确；
 *  2. 代入：整段参数一次 encodeURIComponent，`& = # {q} 中文 emoji` 全转义，
 *     空参数走落地页，超 500 字符 → null；
 *  3. 匹配：`!gh x` / `@gh x` / `gh x` 命中同一引擎、同一 URL，`!gh`
 *     命中落地页，裸 `gh` / 空串 / 未完成形态返 `none`，完整形态的
 *     `!unknown x` / 拼错前缀返 `unknown-prefix` 信号，大小写不敏感，
 *     用户 gh 覆盖内置 gh；
 *  4. 往返：quicklinkFromFavorite 缺任一字段 → null。
 */
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_QUICKLINK_PREFIXES,
  findQuicklinkPrefixConflict,
  isBuiltinQuicklinkPrefix,
  landingUrl,
  matchQuicklinkCommand,
  matchQuicklinkPrefix,
  normalizeQuicklinkPrefix,
  quicklinkFromFavorite,
  resolveQuicklinkUrl,
  toSearchEngines,
  validateQuicklink,
  type QuicklinkEntry,
} from '../src/lib/quicklinks'
import { DEFAULT_SEARCH_ENGINES } from '../src/lib/plugins/search-pack-runtime'

const GH: QuicklinkEntry = {
  siteId: 'gh',
  title: 'GitHub',
  href: 'https://github.com',
  quickPrefix: 'gh',
  templateUrl: 'https://github.com/search?q={q}',
}
const NPM: QuicklinkEntry = {
  siteId: 'npm',
  title: 'npm',
  href: 'https://www.npmjs.com',
  quickPrefix: 'npm',
  templateUrl: 'https://www.npmjs.com/search?q={q}',
}

describe('normalizeQuicklinkPrefix', () => {
  it('trim → 去首个 ! → 小写', () => {
    expect(normalizeQuicklinkPrefix('  !GH ')).toBe('gh')
    expect(normalizeQuicklinkPrefix('gh')).toBe('gh')
    expect(normalizeQuicklinkPrefix('!gh')).toBe('gh')
    expect(normalizeQuicklinkPrefix('')).toBe('')
  })

  it('只去首个 !：!!gh 归一后仍带 !，校验会以 bad-prefix 拒绝', () => {
    expect(normalizeQuicklinkPrefix('!!gh')).toBe('!gh')
    expect(validateQuicklink({ prefix: '!!gh', templateUrl: GH.templateUrl }).ok).toBe(false)
  })
})

describe('validateQuicklink', () => {
  it('通过例：前缀归一 + 模板原样保留', () => {
    expect(validateQuicklink({ prefix: '!GH', templateUrl: 'https://github.com/search?q={q}' })).toEqual({
      ok: true,
      prefix: 'gh',
      templateUrl: 'https://github.com/search?q={q}',
    })
    // {q} 在 hash 里同样合法（origin 之后）
    expect(
      validateQuicklink({ prefix: 'dd', templateUrl: 'https://devdocs.io/#q={q}' }).ok,
    ).toBe(true)
    // {q} 在 path 里同样合法
    expect(
      validateQuicklink({ prefix: 'wiki', templateUrl: 'https://example.com/search/{q}' }).ok,
    ).toBe(true)
  })

  it('空前缀 → empty-prefix', () => {
    expect(validateQuicklink({ prefix: '', templateUrl: GH.templateUrl })).toMatchObject({
      ok: false,
      reason: 'empty-prefix',
    })
    expect(validateQuicklink({ prefix: '   ', templateUrl: GH.templateUrl })).toMatchObject({
      ok: false,
      reason: 'empty-prefix',
    })
    expect(validateQuicklink({ prefix: '!', templateUrl: GH.templateUrl })).toMatchObject({
      ok: false,
      reason: 'empty-prefix',
    })
  })

  it('前缀含空格 / 中文 / 超 15 字符 / 含非法字符 → bad-prefix', () => {
    for (const bad of ['my prefix', '中文', 'a'.repeat(16), 'gh!x', 'gh/x', 'gh.x']) {
      expect(validateQuicklink({ prefix: bad, templateUrl: GH.templateUrl })).toMatchObject({
        ok: false,
        reason: 'bad-prefix',
      })
    }
    expect(validateQuicklink({ prefix: 'a'.repeat(15), templateUrl: GH.templateUrl }).ok).toBe(true)
    expect(validateQuicklink({ prefix: 'my-link_1', templateUrl: GH.templateUrl }).ok).toBe(true)
  })

  it('缺 {q} → missing-placeholder；两个 {q} → multiple-placeholders', () => {
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://github.com/search' }),
    ).toMatchObject({ ok: false, reason: 'missing-placeholder' })
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://example.com/?a={q}&b={q}' }),
    ).toMatchObject({ ok: false, reason: 'multiple-placeholders' })
  })

  it('{q} 在 host 里 → placeholder-in-origin', () => {
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://{q}.example.com/' }),
    ).toMatchObject({ ok: false, reason: 'placeholder-in-origin' })
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://example.{q}/?x=1' }),
    ).toMatchObject({ ok: false, reason: 'placeholder-in-origin' })
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://user:pass@example.com/?q={q}' }),
    ).toMatchObject({ ok: false, reason: 'unsafe-url' })
  })

  it('{q} 在 scheme 里 → placeholder-in-origin（创建与打开都拦）', () => {
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: '{q}://example.com/?q=x' }),
    ).toMatchObject({ ok: false, reason: 'placeholder-in-origin' })
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https{q}://example.com/?q=x' }),
    ).toMatchObject({ ok: false, reason: 'placeholder-in-origin' })
    expect(resolveQuicklinkUrl('{q}://example.com/?q=x', 'https')).toBeNull()
    expect(resolveQuicklinkUrl('https{q}://example.com/?q=x', 'x')).toBeNull()
  })

  it('javascript: / data: / 相对路径 → unsafe-url', () => {
    for (const bad of [
      'javascript:alert({q})',
      'data:text/html,{q}',
      '/search?q={q}',
      'github.com/search?q={q}',
      'ftp://example.com/{q}',
    ]) {
      expect(validateQuicklink({ prefix: 'gh', templateUrl: bad })).toMatchObject({
        ok: false,
        reason: 'unsafe-url',
      })
    }
  })

  it('带 userinfo → unsafe-url（显示域名与打开域名不一致的钓鱼口径）', () => {
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://github.com@evil.example/?q={q}' }),
    ).toMatchObject({ ok: false, reason: 'unsafe-url' })
  })

  it('含控制字符 / 零宽 / Bidi → control-chars', () => {
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://github.com/search?q={q}\u0000' }),
    ).toMatchObject({ ok: false, reason: 'control-chars' })
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://github.com/search?q={q}\u200B' }),
    ).toMatchObject({ ok: false, reason: 'control-chars' })
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://github.com/search?q=\u202E{q}' }),
    ).toMatchObject({ ok: false, reason: 'control-chars' })
    // 零宽藏在 host 里同样拒绝（不是只在参数里才查）
    expect(
      validateQuicklink({ prefix: 'gh', templateUrl: 'https://git\u200Bhub.com/search?q={q}' }),
    ).toMatchObject({ ok: false, reason: 'control-chars' })
  })

  it('超 2048 字符 → too-long', () => {
    const long = `https://example.com/search?q={q}&pad=${'a'.repeat(2030)}`
    expect(long.length).toBeGreaterThan(2048)
    expect(validateQuicklink({ prefix: 'gh', templateUrl: long })).toMatchObject({
      ok: false,
      reason: 'too-long',
    })
  })
})

describe('resolveQuicklinkUrl / landingUrl', () => {
  it('react hooks → %20；参数含 & = # {q} 中文 emoji 全部转义', () => {
    expect(resolveQuicklinkUrl(GH.templateUrl, 'react hooks')).toBe(
      'https://github.com/search?q=react%20hooks',
    )
    expect(resolveQuicklinkUrl(GH.templateUrl, 'a&b=c#d{q}中文🚀')).toBe(
      'https://github.com/search?q=a%26b%3Dc%23d%7Bq%7D%E4%B8%AD%E6%96%87%F0%9F%9A%80',
    )
  })

  it('空参数 → 落地页（{q} → 空串）', () => {
    expect(resolveQuicklinkUrl(GH.templateUrl, '')).toBe('https://github.com/search?q=')
    expect(resolveQuicklinkUrl(GH.templateUrl, '   ')).toBe('https://github.com/search?q=')
    expect(landingUrl(GH.templateUrl)).toBe('https://github.com/search?q=')
  })

  it('参数 trim 后超 500 字符 → null（不静默截断）', () => {
    expect(resolveQuicklinkUrl(GH.templateUrl, 'a'.repeat(500))).not.toBeNull()
    expect(resolveQuicklinkUrl(GH.templateUrl, 'a'.repeat(501))).toBeNull()
    expect(resolveQuicklinkUrl(GH.templateUrl, `  ${'a'.repeat(501)}  `)).toBeNull()
  })

  it('模板非法时打开侧同样拦住：javascript: / 缺 {q} / 两个 {q} → null', () => {
    expect(resolveQuicklinkUrl('javascript:alert({q})', 'x')).toBeNull()
    expect(resolveQuicklinkUrl('https://example.com/search', 'x')).toBeNull()
    expect(resolveQuicklinkUrl('https://example.com/?a={q}&b={q}', 'x')).toBeNull()
    expect(resolveQuicklinkUrl('https://{q}.example.com/', 'x')).toBeNull()
    expect(landingUrl('javascript:alert({q})')).toBeNull()
  })

  it('纵深防御：代入后的完整 URL 含控制字符 / 不可见字符 / 超 2048 字符 → null', () => {
    // 模板绕过创建时校验直接进打开侧：控制字符与不可见字符同样拦住
    expect(resolveQuicklinkUrl('https://example.com/?q={q}\u0001', 'x')).toBeNull()
    expect(resolveQuicklinkUrl('https://example.com/?q={q}\u200b', 'x')).toBeNull()
    // 模板本身合法但代入后越界：长模板 + 500 字符参数编码后超过 2048
    const longTemplate = `https://example.com/${'p'.repeat(1900)}?q={q}`
    expect(longTemplate.length).toBeLessThanOrEqual(2048)
    expect(resolveQuicklinkUrl(longTemplate, 'a'.repeat(500))).toBeNull()
    // 同一模板配短参数、代入后仍在 2048 内时正常打开
    expect(resolveQuicklinkUrl(longTemplate, 'x')).not.toBeNull()
  })

  it('替换用 replaceAll 语义：模板只有一个 {q}，参数里的 {q} 不会被二次替换', () => {
    expect(resolveQuicklinkUrl(GH.templateUrl, '{q}')).toBe('https://github.com/search?q=%7Bq%7D')
  })
})

describe('matchQuicklinkCommand', () => {
  const entries = [GH, NPM]

  it('!gh react、@gh react 与 gh react 都命中同一引擎、同一 URL，arg 正确', () => {
    const expected = {
      kind: 'hit',
      entry: GH,
      arg: 'react',
      url: 'https://github.com/search?q=react',
    }
    expect(matchQuicklinkCommand('!gh react', entries)).toEqual(expected)
    expect(matchQuicklinkCommand('@gh react', entries)).toEqual(expected)
    expect(matchQuicklinkCommand('gh react', entries)).toEqual(expected)
    const npmHit = matchQuicklinkCommand('!npm lodash', entries)
    expect(npmHit.kind).toBe('hit')
    if (npmHit.kind === 'hit') expect(npmHit.url).toBe('https://www.npmjs.com/search?q=lodash')
  })

  it('!gh（无参数）命中落地页；裸 gh（无 !、无参数）不触发', () => {
    expect(matchQuicklinkCommand('!gh', entries)).toEqual({
      kind: 'hit',
      entry: GH,
      arg: '',
      url: 'https://github.com/search?q=',
    })
    expect(matchQuicklinkCommand('gh', entries)).toEqual({ kind: 'none' })
    expect(matchQuicklinkCommand('gh   ', entries)).toEqual({ kind: 'none' })
    expect(matchQuicklinkCommand('@gh', entries)).toEqual({ kind: 'none' })
  })

  it('空串返 none；完整形态的未知前缀返 unknown-prefix 信号，不报错', () => {
    expect(matchQuicklinkCommand('', entries)).toEqual({ kind: 'none' })
    expect(matchQuicklinkCommand('   ', entries)).toEqual({ kind: 'none' })
    expect(matchQuicklinkCommand('!unknown x', entries)).toEqual({
      kind: 'unknown-prefix',
      prefix: 'unknown',
      arg: 'x',
    })
    expect(matchQuicklinkCommand('unknown x', entries)).toEqual({
      kind: 'unknown-prefix',
      prefix: 'unknown',
      arg: 'x',
    })
    expect(matchQuicklinkCommand('!githb react', entries)).toEqual({
      kind: 'unknown-prefix',
      prefix: 'githb',
      arg: 'react',
    })
    expect(matchQuicklinkCommand('githb react', entries)).toEqual({
      kind: 'unknown-prefix',
      prefix: 'githb',
      arg: 'react',
    })
  })

  it('! 形态 arg 为空时不判未知：!unknown（无参数）返 none，不闪提示', () => {
    expect(matchQuicklinkCommand('!unknown', entries)).toEqual({ kind: 'none' })
    expect(matchQuicklinkCommand('!unknown ', entries)).toEqual({ kind: 'none' })
  })

  it('大小写不敏感：!GH React 命中 gh', () => {
    const a = matchQuicklinkCommand('!GH React', entries)
    expect(a.kind).toBe('hit')
    if (a.kind === 'hit') expect(a.entry).toBe(GH)
    const b = matchQuicklinkCommand('Gh react', entries)
    expect(b.kind).toBe('hit')
    if (b.kind === 'hit') expect(b.entry).toBe(GH)
  })

  it('多词参数整体保留；前后空白不影响', () => {
    const a = matchQuicklinkCommand('  !gh  react hooks  ', entries)
    expect(a.kind).toBe('hit')
    if (a.kind === 'hit') {
      expect(a.arg).toBe('react hooks')
      expect(a.url).toBe('https://github.com/search?q=react%20hooks')
    }
    const b = matchQuicklinkCommand('gh   react hooks', entries)
    expect(b.kind).toBe('hit')
    if (b.kind === 'hit') expect(b.arg).toBe('react hooks')
  })

  it('内置引擎默认注入：不传用户 entries 时 !gh/@gh/gh 仍命中 GitHub', () => {
    for (const q of ['!gh react', '@gh react', 'gh react']) {
      const hit = matchQuicklinkCommand(q, [])
      expect(hit.kind).toBe('hit')
      if (hit.kind === 'hit') {
        expect(hit.entry.quickPrefix).toBe('gh')
        expect(hit.url).toBe('https://github.com/search?q=react')
      }
    }
    expect(matchQuicklinkCommand('/gh react', [])).toEqual({ kind: 'none' })
  })

  it('用户条目同前缀覆盖内置：用户 gh 优先于内置 GitHub', () => {
    const hit = matchQuicklinkCommand('!gh react', [GH])
    expect(hit.kind).toBe('hit')
    if (hit.kind === 'hit') expect(hit.entry).toBe(GH)
  })

  it('模板无占位符 → bad-template（调用方明示、Enter 不外跳）', () => {
    const bad: QuicklinkEntry = {
      siteId: 'bad',
      title: '坏模板',
      href: 'https://example.com/',
      quickPrefix: 'bad',
      templateUrl: 'https://example.com/search',
    }
    expect(matchQuicklinkCommand('!bad x', [bad])).toEqual({
      kind: 'bad-template',
      entry: bad,
      arg: 'x',
    })
  })

  it('前缀命中但参数超 500 字符 → hit 且 url 为 null（调用方 toast、不开页）', () => {
    const hit = matchQuicklinkCommand(`!gh ${'a'.repeat(501)}`, entries)
    expect(hit.kind).toBe('hit')
    if (hit.kind === 'hit') {
      expect(hit.entry).toBe(GH)
      expect(hit.url).toBeNull()
    }
  })
})

describe('quicklinkFromFavorite', () => {
  it('两字段齐全且合法 → entry（前缀归一）', () => {
    expect(
      quicklinkFromFavorite({
        siteId: 'gh',
        title: 'GitHub',
        href: 'https://github.com',
        quickPrefix: '!GH',
        templateUrl: 'https://github.com/search?q={q}',
      }),
    ).toEqual({
      siteId: 'gh',
      title: 'GitHub',
      href: 'https://github.com',
      icon: undefined,
      quickPrefix: 'gh',
      templateUrl: 'https://github.com/search?q={q}',
    })
  })

  it('缺任一字段 → null', () => {
    expect(quicklinkFromFavorite({ siteId: 'a', title: 'A', href: 'https://a.example' })).toBeNull()
    expect(
      quicklinkFromFavorite({
        siteId: 'a',
        title: 'A',
        href: 'https://a.example',
        quickPrefix: 'gh',
      }),
    ).toBeNull()
    expect(
      quicklinkFromFavorite({
        siteId: 'a',
        title: 'A',
        href: 'https://a.example',
        templateUrl: 'https://github.com/search?q={q}',
      }),
    ).toBeNull()
    expect(
      quicklinkFromFavorite({
        siteId: 'a',
        title: 'A',
        href: 'https://a.example',
        quickPrefix: '',
        templateUrl: 'https://github.com/search?q={q}',
      }),
    ).toBeNull()
  })

  it('模板非法 → null（javascript: / 缺 {q} / 域名里有 {q}）', () => {
    for (const templateUrl of [
      'javascript:alert({q})',
      'https://github.com/search',
      'https://{q}.example.com/',
    ]) {
      expect(
        quicklinkFromFavorite({
          siteId: 'a',
          title: 'A',
          href: 'https://a.example',
          quickPrefix: 'gh',
          templateUrl,
        }),
      ).toBeNull()
    }
  })
})

describe('toSearchEngines', () => {
  it('prefix 补 !，id 带 quicklink: 前缀，searchUrl 即模板', () => {
    const engines = toSearchEngines([GH])
    expect(engines[0]).toEqual({
      id: 'quicklink:gh',
      name: 'GitHub',
      prefix: '!gh',
      searchUrl: 'https://github.com/search?q={q}',
    })
  })

  it('同前缀覆盖内置：用户 gh 在前，内置 gh 被剔除，其余内置保留', () => {
    const engines = toSearchEngines([GH])
    expect(engines.filter((e) => e.prefix.toLowerCase() === '!gh')).toHaveLength(1)
    expect(engines[0]!.id).toBe('quicklink:gh')
    expect(engines.map((e) => e.prefix)).toEqual(
      expect.arrayContaining(DEFAULT_SEARCH_ENGINES.filter((e) => e.prefix !== '!gh').map((e) => e.prefix)),
    )
    expect(engines).toHaveLength(DEFAULT_SEARCH_ENGINES.length)
  })

  it('无 quicklink 时原样返回内置 6 个', () => {
    expect(toSearchEngines([])).toEqual(DEFAULT_SEARCH_ENGINES)
  })
})

describe('matchQuicklinkPrefix', () => {
  it('前缀开头联想；空输入返回 []', () => {
    expect(matchQuicklinkPrefix('g', [GH, NPM])).toEqual([GH])
    expect(matchQuicklinkPrefix('!gh', [GH, NPM])).toEqual([GH])
    expect(matchQuicklinkPrefix('', [GH, NPM])).toEqual([])
    expect(matchQuicklinkPrefix('z', [GH, NPM])).toEqual([])
  })
})

describe('前缀冲突', () => {
  it('内置前缀表覆盖 OMNI + search-pack 两套内置', () => {
    for (const p of ['g', 'google', 'gh', 'github', 'npm', 'bing', 'mdn', 'baidu', 'bd', 'so', 'dd', 'caniuse']) {
      expect(BUILTIN_QUICKLINK_PREFIXES).toContain(p)
      expect(isBuiltinQuicklinkPrefix(p)).toBe(true)
      expect(isBuiltinQuicklinkPrefix(`!${p.toUpperCase()}`)).toBe(true)
    }
    expect(isBuiltinQuicklinkPrefix('myown')).toBe(false)
  })

  it('findQuicklinkPrefixConflict：内置 > 其它收藏重复 > 无冲突', () => {
    expect(findQuicklinkPrefixConflict('gh', [GH])).toBe('builtin')
    expect(findQuicklinkPrefixConflict('npm', [GH])).toBe('builtin')
    const other: QuicklinkEntry = {
      siteId: 'other',
      title: 'Other',
      href: 'https://other.example',
      quickPrefix: 'mine',
      templateUrl: 'https://other.example/?q={q}',
    }
    expect(findQuicklinkPrefixConflict('mine', [other])).toBe('duplicate')
    expect(findQuicklinkPrefixConflict('mine', [other], 'other')).toBeNull()
    expect(findQuicklinkPrefixConflict('fresh', [GH, other])).toBeNull()
    expect(findQuicklinkPrefixConflict('', [GH])).toBeNull()
  })
})
