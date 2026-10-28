/**
 * 分面标注编辑（/admin/facets）：从「只能看」到「能改且改坏可回滚」。
 *
 * 改动前的事实：页面 `import { hubGet, hubSend }`，但全文没有一处调用 hubSend——
 * `PUT /api/sites/:id/facets` 早已存在（write scope + zod 预算校验），后台却没有
 * 任何保存入口。管理员发现某个站点标错分面，只能离开本页去站点编辑页重做。
 *
 * 接上保存时最危险的三个点，这里逐条钉住：
 *   1. **整份重写**：存储层先 DELETE 再 INSERT，编辑器少提交一个维度就等于静默
 *      抹掉它（旧版自由值尤其容易丢）——草稿必须携带全部维度与历史值；
 *   2. **乐观更新必须能回滚**：失败后界面上不能留着「以为成功」的标注；
 *   3. **400 的字段级原因要能看到**：不能只给一句「保存失败」，也不能把失败
 *      渲染成「暂无匹配站点」那种数据结论。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  canonicalFacets,
  facetLabel,
  facetOptionLabel,
  fieldIssuesOf,
  removeFacetValue,
  sameFacets,
  toggleFacetValue,
  uncontrolledValues,
  type FacetDraft,
  type FacetVocabulary,
} from '@/lib/facet-editing'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()
const PAGE = 'src/app/admin/facets/page.tsx'

function raw(): string {
  return readFileSync(join(ROOT, PAGE), 'utf8')
}

/** 剥注释但保留行列位置（注释里会正当地提到旧实现与失败文案） */
function code(): string {
  const noBlock = raw().replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith('//') ? ' '.repeat(line.length) : line))
    .join('\n')
}

const DEFS: FacetVocabulary[] = [
  {
    key: 'pricing',
    label: '付费模式',
    multiselect: false,
    options: [
      { value: 'free', label: '完全免费' },
      { value: 'paid', label: '商业付费' },
    ],
  },
  {
    key: 'platform',
    label: '运行平台',
    multiselect: true,
    options: [
      { value: 'web', label: 'Web 网页端' },
      { value: 'ios', label: 'iOS' },
      { value: 'android', label: 'Android' },
    ],
  },
]

describe('canonicalFacets：提交形状必须可比较、可复现', () => {
  it('小写化、去重、排序，丢弃空维度', () => {
    expect(
      canonicalFacets({ Platform: ['IOS', 'web', 'ios'], pricing: ['  '], scene: ['dev'] }),
    ).toEqual({ platform: ['ios', 'web'], scene: ['dev'] })
  })

  it('键也排序：点击顺序不同不该被当成「有改动」', () => {
    expect(canonicalFacets({ scene: ['dev'], pricing: ['free'] })).toEqual(
      canonicalFacets({ pricing: ['free'], scene: ['dev'] }),
    )
  })

  it('空输入得到空对象（清空全部维度是合法操作）', () => {
    expect(canonicalFacets(undefined)).toEqual({})
    expect(canonicalFacets({})).toEqual({})
  })
})

describe('toggleFacetValue：单选与多选是两套语义', () => {
  it('单选维度：点另一个值 = 替换；再点已选值 = 取消该维度', () => {
    const first = toggleFacetValue({}, DEFS[0]!, 'free')
    expect(first).toEqual({ pricing: ['free'] })
    const replaced = toggleFacetValue(first, DEFS[0]!, 'paid')
    expect(replaced).toEqual({ pricing: ['paid'] })
    expect(toggleFacetValue(replaced, DEFS[0]!, 'paid')).toEqual({})
  })

  it('多选维度：未选则追加，已选则移除；移空后整键删除', () => {
    let draft: FacetDraft = toggleFacetValue({}, DEFS[1]!, 'web')
    draft = toggleFacetValue(draft, DEFS[1]!, 'ios')
    expect(draft).toEqual({ platform: ['ios', 'web'] })
    draft = toggleFacetValue(draft, DEFS[1]!, 'web')
    expect(draft).toEqual({ platform: ['ios'] })
    expect(toggleFacetValue(draft, DEFS[1]!, 'ios')).toEqual({})
  })

  it('不会污染传入的草稿（React setState 依赖旧值）', () => {
    const before: FacetDraft = { platform: ['web'] }
    const after = toggleFacetValue(before, DEFS[1]!, 'ios')
    expect(before).toEqual({ platform: ['web'] })
    expect(after).not.toBe(before)
  })
})

describe('removeFacetValue：历史值可以逐个移除', () => {
  it('移除后保留其他值；最后一个值被移除时整键删除', () => {
    const draft: FacetDraft = { platform: ['web', 'ios'] }
    expect(removeFacetValue(draft, 'platform', 'web')).toEqual({ platform: ['ios'] })
    expect(removeFacetValue({ platform: ['ios'] }, 'platform', 'ios')).toEqual({})
  })

  it('不存在/空输入原样返回，不制造空维度', () => {
    const draft: FacetDraft = { platform: ['web'] }
    expect(removeFacetValue(draft, 'platform', 'android')).toEqual(draft)
    expect(removeFacetValue(draft, '', 'web')).toEqual(draft)
    expect(removeFacetValue(draft, 'scene', '')).toEqual(draft)
  })
})

describe('sameFacets：决定「保存」按钮是否可点', () => {
  it('顺序不同但内容相同 = 没有改动', () => {
    expect(sameFacets({ platform: ['web', 'ios'] }, { platform: ['ios', 'web'] })).toBe(true)
  })

  it('多一个值 / 少一个值 / 大小写不同（归一化后相同）都要判断正确', () => {
    expect(sameFacets({ platform: ['web'] }, { platform: ['web', 'ios'] })).toBe(false)
    expect(sameFacets({ platform: ['web'] }, {})).toBe(false)
    expect(sameFacets({ platform: ['WEB'] }, { platform: ['web'] })).toBe(true)
  })
})

describe('uncontrolledValues：历史值必须可见，否则保存会静默抹掉', () => {
  it('已知维度里的词表外值会被列出', () => {
    expect(uncontrolledValues({ platform: ['web', 'wechat'] }, DEFS)).toEqual([
      { key: 'platform', values: ['wechat'] },
    ])
  })

  it('词表里完全没有的维度整组列出（例如旧版写入的自定义维度）', () => {
    expect(uncontrolledValues({ workspace: ['team'], platform: ['web'] }, DEFS)).toEqual([
      { key: 'workspace', values: ['team'] },
    ])
  })

  it('全部在词表内时返回空数组', () => {
    expect(uncontrolledValues({ platform: ['web', 'ios'], pricing: ['free'] }, DEFS)).toEqual([])
  })
})

describe('标签回退：词表缺项时显示原值而不是空白', () => {
  it('维度名与候选值都有回退', () => {
    expect(facetLabel(DEFS, 'pricing')).toBe('付费模式')
    expect(facetLabel(DEFS, 'workspace')).toBe('workspace')
    expect(facetOptionLabel(DEFS, 'platform', 'ios')).toBe('iOS')
    expect(facetOptionLabel(DEFS, 'platform', 'wechat')).toBe('wechat')
    expect(facetOptionLabel(DEFS, 'unknown', 'x')).toBe('x')
  })
})

describe('fieldIssuesOf：两种 400 形态都要能取到字段级原因', () => {
  it('hubSend 的 zod 400：payload.detail[].path 是数组', () => {
    const err = Object.assign(new Error('参数无效'), {
      status: 400,
      payload: {
        error: '参数无效',
        detail: [
          { code: 'too_big', path: ['facets', 'platform'], message: '最多 200 个值' },
          { code: 'invalid_type', path: [], message: '必须是对象' },
        ],
      },
    })
    expect(fieldIssuesOf(err)).toEqual([
      { path: 'facets.platform', message: '最多 200 个值' },
      { path: '', message: '必须是对象' },
    ])
  })

  it('自定义 400：payload.issues[].path 是字符串（/api/site 形态）', () => {
    const err = Object.assign(new Error('保存失败'), {
      payload: { error: '保存失败', issues: [{ path: 'siteName', message: '不能为空' }] },
    })
    expect(fieldIssuesOf(err)).toEqual([{ path: 'siteName', message: '不能为空' }])
  })

  it('直接挂在 error 上的 issues 也能读（SiteSettingsError 形态）', () => {
    const err = Object.assign(new Error('x'), { issues: [{ path: 'a', message: 'b' }] })
    expect(fieldIssuesOf(err)).toEqual([{ path: 'a', message: 'b' }])
  })

  it('没有结构化原因时返回空数组（页面回退到整句消息，而不是假装没出错）', () => {
    expect(fieldIssuesOf(new Error('网络不可达'))).toEqual([])
    expect(fieldIssuesOf(null)).toEqual([])
    expect(fieldIssuesOf({ payload: { detail: 'not-an-array' } })).toEqual([])
  })

  it('脏条目被跳过，且最多展示 6 条', () => {
    const detail = Array.from({ length: 9 }, (_, i) => ({ path: ['k' + i], message: 'm' + i }))
    detail.splice(1, 0, null as never, { path: ['x'] } as never)
    expect(fieldIssuesOf({ payload: { detail } })).toHaveLength(6)
  })
})

describe('页面接线：保存走 PUT、乐观更新可回滚、失败说真话', () => {
  it('真的调用了 hubSend，且是整份标注提交到单站点端点', () => {
    const src = code()
    expect(src).toContain("import { hubGet, hubSend } from '@/lib/navhub-api'")
    expect(src).toContain(
      "await hubSend(`/api/sites/${encodeURIComponent(site.id)}/facets`, 'PUT', { facets: payload })",
    )
    // 提交的是 canonicalFacets 后的完整草稿，而不是某一个维度的增量
    expect(src).toContain('const payload = canonicalFacets(draft)')
  })

  it('先乐观更新、再发请求；失败时回滚到请求前的快照', () => {
    const src = code()
    const optimisticAt = src.indexOf('setSiteSamples((prev) =>')
    const requestAt = src.indexOf('await hubSend(`/api/sites/')
    expect(optimisticAt).toBeGreaterThan(-1)
    expect(requestAt).toBeGreaterThan(optimisticAt)
    // 回滚用的是保存前抓的快照
    expect(src).toContain('const before = siteSamples')
    expect(src).toContain('setSiteSamples(before)')
    const catchAt = src.indexOf('} catch (err) {')
    expect(catchAt).toBeGreaterThan(requestAt)
    expect(src.slice(catchAt)).toContain('setSiteSamples(before)')
  })

  it('失败时展示字段级原因（role=alert + path/message 列表）', () => {
    const src = code()
    expect(src).toContain('const issues = fieldIssuesOf(err)')
    expect(src).toContain('role="alert"')
    expect(src).toContain('saveError.issues.map((issue, index) => (')
    expect(src).toContain('{issue.path && <span className="font-mono">{issue.path}</span>}')
    expect(src).toContain('{issue.message}')
    // 失败文案必须说明已回滚；不能混入「暂无匹配站点」这类数据结论
    expect(src).toContain('已恢复原值')
    expect(src).not.toContain('.catch(() => setSiteSamples([]))')
  })

  it('编辑器一次渲染全部维度，并保留/可删历史值与未登记维度', () => {
    const src = code()
    expect(src).toContain('const definitions = (data?.definitions ?? []).filter(')
    expect(src).toContain('setDraft(canonicalFacets(site.facets))')
    expect(src).toContain('{definitions.map((definition) => {')
    expect(src).toContain('uncontrolledValues(draft, definitions)')
    expect(src).toContain('removeFacetValue(prev, definition.key, value)')
  })

  it('没有改动或正在保存时不能重复提交', () => {
    const src = code()
    expect(src).toContain('const editingDirty = editing ? !sameFacets(draft, editing.facets) : false')
    expect(src).toContain('disabled={savingId !== null || !editingDirty}')
    expect(src).toContain("{savingId === editing.id ? '保存中…' : editingDirty ? '保存分面' : '没有改动'}")
  })

  it('保存成功后刷新分布与样例，让计数/列表与新标注一致', () => {
    const src = code()
    const saveAt = src.indexOf('await hubSend(`/api/sites/')
    const after = src.slice(saveAt, src.indexOf('} catch (err) {'))
    expect(after).toContain('loadFacets()')
    expect(after).toContain('loadSamples(activeTab, selectedOption)')
    expect(after).toContain('setSaveNotice(')
  })

  it('两个 GET 都绕过 60s 浏览器缓存（否则保存后计数与样例都是旧的）', () => {
    const src = code()
    expect(src).toContain("hubGet<FacetsResponse>('/api/facets?ts=' + Date.now())")
    expect(src).toContain('&limit=12&ts=${Date.now()}')
  })

  it('编辑弹窗可键盘操作：候选值是真按钮 + aria-pressed；空标注写明「尚未标注」', () => {
    const src = code()
    expect(src).toContain('<Dialog')
    expect(src).toContain('role="group"')
    expect(src).toContain('aria-pressed={isOn}')
    expect(src).toContain('尚未标注分面')
    expect(src).toContain('role="status"')
  })
})

describe('守卫不是空跑', () => {
  it('确实读到了真实页面源码', () => {
    const src = raw()
    expect(src.length).toBeGreaterThan(12000)
    expect(src).toContain('多维分面体系治理')
    expect(src).toContain('命中站点样例')
    expect(src).toContain('编辑分面')
  })
})
