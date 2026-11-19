/**
 * 备考站点区取数（/exam）：读站内「学习成长 / 考试备考」分类，不硬编码链接。
 *
 * 三态返回（U-238）——取数失败与分类为空不再共用 [] 一个返回值：
 *  - ok：成功取到非空列表；
 *  - error：取数抛错（中枢分片 / 整包 / site.json 任一失败）；
 *  - empty：分类不存在、子分类不存在、或子分类下无站点。
 * 空态文案与恢复入口由调用方按状态写：失败给重试按钮，分类空指往 /sites。
 */
import { getProcessedData } from '@/lib/data-loader'
import { EXAM_PREP_CATEGORY_ID, EXAM_PREP_SUB_ID } from '@/lib/exam-calendar'
import { getFileContent } from '@/lib/github'
import { loadNavigationCatalog } from '@/lib/navigation-catalog-read'
import type { NavigationSubItem } from '@/types/navigation'

const SITE_PATH = 'src/navsphere/content/site.json'

export type ExamPrepSitesResult =
  | { status: 'ok'; sites: NavigationSubItem[] }
  | { status: 'error' }
  | { status: 'empty' }

export async function loadExamPrepSites(): Promise<ExamPrepSitesResult> {
  try {
    // U-36：与首页同款，导航改读中枢派生的分片，不再读 2MB 整包
    const [navigationLoad, siteRaw] = await Promise.all([
      loadNavigationCatalog(),
      getFileContent(SITE_PATH),
    ])
    const { navigationData } = getProcessedData(navigationLoad.data as never, siteRaw as never)
    const category = navigationData.navigationItems.find((c) => c.id === EXAM_PREP_CATEGORY_ID)
    const sub = category?.subCategories?.find((s) => s.id === EXAM_PREP_SUB_ID)
    const sites = sub?.items ?? []
    if (sites.length === 0) return { status: 'empty' }
    return { status: 'ok', sites }
  } catch {
    return { status: 'error' }
  }
}
