/**
 * 场景落地页元信息合成的红线测试：
 *  - 标题走任务型长尾（「{场景}的网站与全流程」），不叠品牌、不加最/第一；
 *  - 描述里的每一个数字都必须来自入参的真实计数，入参为 0 时不许出现数量词；
 *  - 步骤骨架来自真实步骤标题（去掉「第X步：」前缀），站点名只用入参给的；
 *  - 长度永远不超过 SITE_DESCRIPTION_MAX。
 */
import { describe, expect, it } from 'vitest'
import { SITE_DESCRIPTION_MAX } from '../src/lib/seo/site-description'
import {
  sceneMetaDescription,
  sceneMetaTitle,
  sceneStepHead,
  scenesIndexDescription,
} from '../src/lib/seo/scene-meta'

describe('sceneStepHead', () => {
  it('去掉步骤前缀，保留正文', () => {
    expect(sceneStepHead('第一步：找模板与灵感')).toBe('找模板与灵感')
    expect(sceneStepHead('第3步：配图与图标')).toBe('配图与图标')
    expect(sceneStepHead('直接就是标题')).toBe('直接就是标题')
  })
})

describe('sceneMetaTitle', () => {
  it('拼任务型长尾，不带品牌与夸大词', () => {
    expect(sceneMetaTitle('做 PPT')).toBe('做 PPT的网站与全流程')
    expect(sceneMetaTitle('做短剧')).toBe('做短剧的网站与全流程')
    const t = sceneMetaTitle('考公考研')
    expect(t).not.toMatch(/最好|第一|必备|山羊胡/)
  })
  it('已是成稿形态的标题不重复拼', () => {
    expect(sceneMetaTitle('短剧网站大全')).toBe('短剧网站大全')
    expect(sceneMetaTitle('')).toBe('场景包全流程')
  })
})

describe('sceneMetaDescription', () => {
  const base = {
    title: '做 PPT',
    description: '从零做一份能拿去汇报的 PPT：先找对模板和版式灵感，再用在线工具把内容做成稿，最后配齐图片与图标素材导出分享。',
    stepCount: 3,
    siteCount: 9,
    stepLabels: ['第一步：找模板与灵感', '第二步：做稿件', '第三步：配图与图标'],
    topSiteTitles: ['PPT 大师', '模板站', '素材库'],
  }

  it('数字与站点名全部来自入参', () => {
    const d = sceneMetaDescription(base)
    expect(d).toContain('共 3 步')
    expect(d).toContain('共 9 个')
    expect(d).toContain('PPT 大师')
    expect(d).toContain('找模板与灵感 → 做稿件 → 配图与图标')
    expect(d.length).toBeLessThanOrEqual(SITE_DESCRIPTION_MAX)
    expect(d).not.toMatch(/最好|第一名|必备/)
  })

  it('召回为 0 时绝不写数量（不拿 0 冒充规模）', () => {
    const d = sceneMetaDescription({ ...base, siteCount: 0, topSiteTitles: [] })
    expect(d).not.toMatch(/共 \d+ 个/)
    expect(d).toContain('共 3 步')
  })

  it('超长编辑文案被截断到上限内', () => {
    const d = sceneMetaDescription({ ...base, description: '长'.repeat(400) })
    expect(d.length).toBeLessThanOrEqual(SITE_DESCRIPTION_MAX)
  })
})

describe('scenesIndexDescription', () => {
  it('总数来自真实汇总', () => {
    const d = scenesIndexDescription({ sceneCount: 24, totalSites: 210, sceneTitles: ['做 PPT', '剪视频', '写论文'] })
    expect(d).toContain('共 24 个场景包')
    expect(d).toContain('210 个真实收录的网站')
    expect(d).toContain('做 PPT')
  })
  it('覆盖站点为 0 时不写该句', () => {
    const d = scenesIndexDescription({ sceneCount: 24, totalSites: 0, sceneTitles: [] })
    expect(d).not.toMatch(/覆盖 \d+/)
  })
})
