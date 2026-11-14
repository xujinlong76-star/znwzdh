/**
 * 详情页 KNN 推荐卡站内入口守卫（2026-11-15 03:22 轮，UX #7）。
 *
 * 根因：详情页「向量图谱相似站点推荐 (KNN)」卡片此前整卡只有一个外站
 * `<a href={safeHref(s.url)} target="_blank">`，点卡片直接跳外站；想先看
 * 本站收录的简介、巡检健康、平替再决定去不去，只能后退重进。同页上方的
 * 「同分类站点」区却是站内 Link + 独立外链图标，两处行为不一致。
 *
 * 修法：照抄同分类区模式——卡片主链改站内 `/site/{id}` Link，外链保留
 * 为独立小图标按钮（aria-label「访问 {title} 官网」）。不上报点击：
 * 本文件刻意无 reportClick（hot-report-click.test.ts:17 口径：详情页
 * 挂载时不另外上报，/hot → 详情是唯一一次上报），同分类区 Link 同样
 * 无 onClick，加上报会重复计数。
 *
 * 路径用仓库根相对定位：本文件经 mirror:web 在 apps/web 与
 * apps/web-overlay 双份存放，两边跑同一份断言。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const WEB_ROOT = resolve(REPO_ROOT, 'apps', 'web')
const OVERLAY_ROOT = resolve(REPO_ROOT, 'apps', 'web-overlay')
const REL = 'src/components/site-detail-view.tsx'

/** KNN 卡片主链：站内详情内链（与同分类区同款） */
const KNN_DETAIL_LINK = 'href={`/site/${encodeURIComponent(s.id)}`}'
/** KNN 卡片外链：独立小图标按钮 */
const KNN_EXTERNAL_LINK = 'aria-label={`访问 ${s.title} 官网`}'
/** 旧写法：整卡一个外站锚点 */
const KNN_WHOLE_CARD_EXTERNAL =
  '<a href={safeHref(s.url)} target="_blank" rel={externalRel} className="flex items-center gap-3">'

describe('详情页 KNN 推荐卡：主链进站内详情，外链保留为小图标', () => {
  for (const [name, root] of [
    ['apps/web', WEB_ROOT],
    ['apps/web-overlay', OVERLAY_ROOT],
  ] as const) {
    it(`${name}：KNN 卡含站内详情内链`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(KNN_DETAIL_LINK)
    })

    it(`${name}：KNN 卡保留独立外链图标按钮`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).toContain(KNN_EXTERNAL_LINK)
    })

    it(`${name}：KNN 卡不再是整卡外链`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).not.toContain(KNN_WHOLE_CARD_EXTERNAL)
    })

    it(`${name}：详情页仍不上报点击（不重复计数）`, () => {
      const src = readFileSync(resolve(root, REL), 'utf8')
      expect(src).not.toContain('reportClick')
    })
  }
})
