import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function loadSource(rel: string): string {
  const candidates = [
    resolve(HERE, '..', rel),
    resolve(HERE, '..', '..', 'web-overlay', rel)
  ]
  const hit = candidates.find(p => existsSync(p))
  if (!hit) throw new Error('File not found: ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('导航效率增强与用户体验治理', () => {
  it('CategoryQuickJumpBar 具备吸顶、平滑定位、技术视频入口与指示器', () => {
    const src = loadSource('src/components/category-quick-jump-bar.tsx')
    expect(src).toContain('sticky top-14')
    expect(src).toContain('IntersectionObserver')
    expect(src).toContain('scrollToId')
    expect(src).toContain('href="/videos"')
    expect(src).toContain('精选视频')
    expect(src).toContain('常用')
  })

  it('QuickAccessTray 具备收藏与足迹聚合、复制链接、多态筛选与持久化兜底', () => {
    const src = loadSource('src/components/quick-access-tray.tsx')
    expect(src).toContain('useFavorites')
    expect(src).toContain('readOfflineVisits')
    expect(src).toContain('copyText')
    expect(src).toContain('activeTab')
    expect(src).toContain('displayItems')
    expect(src).toContain('safeHref')
  })

  it('NavigationContent 成功装配吸顶快速直达与常用托盘', () => {
    const src = loadSource('src/components/navigation-content.tsx')
    expect(src).toContain('CategoryQuickJumpBar')
    expect(src).toContain('SpeedDialDock')
    expect(src).toContain('categories={sortedCategories.map')
  })

  it('NavigationCard 遵循单 Tab 停留点规范与安全跳转', () => {
    const src = loadSource('src/components/navigation-card.tsx')
    expect(src).toContain('safeHref')
    expect(src).toContain('SiteFavicon')
  })

  it('SpotlightModal (⌘K) 集成并行视频召回与全局核心生产力指令', () => {
    const src = loadSource('src/components/search/spotlight-modal.tsx')
    expect(src).toContain('/api/videos?q=')
    expect(src).toContain('videoHits')
    expect(src).toContain('spotlight-video-listbox')
    expect(src).toContain('cmd-videos')
    expect(src).toContain('cmd-admin-videos')
    expect(src).toContain('cmd-import')
    expect(src).toContain('cmd-user-center')
    expect(src).toContain('referrerPolicy="no-referrer"')
  })

  it('NavigationCategorySection 具备类目内 0-RTT 极速关键词筛选与热门标签筛选', () => {
    const src = loadSource('src/components/navigation-category-section.tsx')
    expect(src).toContain('filterKeyword')
    expect(src).toContain('selectedTag')
    expect(src).toContain('categoryTopTags')
    expect(src).toContain('matchesFilter')
    expect(src).toContain('filteredDirectItems')
    expect(src).toContain('totalMatchedCount')
    expect(src).toContain('清空此类目筛选')
  })

  it('视频 API 解耦 readStorageFresh，GET 查询走内存单飞缓存保障毫秒级响应', () => {
    const srcId = loadSource('src/app/api/videos/[id]/route.ts')
    expect(srcId).not.toContain('readStorageFresh')
    expect(srcId).toContain('getFileContent')

    const srcItems = loadSource('src/app/api/videos/[id]/items/route.ts')
    expect(srcItems).not.toContain('readStorageFresh')
    expect(srcItems).toContain('getFileContent')
  })

  it('管理后台视频条目与分类列表缩略图具备防盗链 no-referrer 与代理自愈降级', () => {
    const srcItems = loadSource('src/app/admin/videos/[id]/items/page.tsx')
    expect(srcItems).toContain('AdminVideoThumbnail')
    expect(srcItems).toContain('referrerPolicy="no-referrer"')
    expect(srcItems).toContain('isStrictAntiLeech')
    expect(srcItems).toContain('mediaProxyIconUrl')

    const srcCategoryItems = loadSource('src/app/admin/videos/[id]/categories/[categoryId]/items/page.tsx')
    expect(srcCategoryItems).toContain('CategoryVideoThumbnail')
    expect(srcCategoryItems).toContain('referrerPolicy="no-referrer"')
  })

  it('视频 API 统一鉴权失败响应为结构化 JSON 杜绝客户端 SyntaxError', () => {
    const srcHarvest = loadSource('src/app/api/videos/harvest/route.ts')
    expect(srcHarvest).not.toContain('return new Response(authCheck.error')
    expect(srcHarvest).toContain('success: false, error: authCheck.error')

    const srcTask = loadSource('src/app/api/videos/harvest/task/route.ts')
    expect(srcTask).not.toContain('return new Response(authCheck.error')
    expect(srcTask).toContain('success: false, error: authCheck.error')

    const srcHistory = loadSource('src/app/api/videos/history/route.ts')
    expect(srcHistory).not.toContain('return new Response(authCheck.error')
    expect(srcHistory).toContain('success: false, error: authCheck.error')
  })

  it('NavigationCategorySection 具备二级分类快速筛选导航轨与即时视图隔离', () => {
    const src = loadSource('src/components/navigation-category-section.tsx')
    expect(src).toContain('selectedSubCatId')
    expect(src).toContain('setSelectedSubCatId')
    expect(src).toContain('showDirectGroup')
    expect(src).toContain('子分类快速切换')
    expect(src).toContain('subCats.length > 1')
  })

  it('全站搜索页 /search 具备跨模态技术视频库引流与零结果智能建议', () => {
    const src = loadSource('src/app/search/search-results.tsx')
    expect(src).toContain('/videos?q=')
    expect(src).toContain('MonitorPlay')
    expect(src).toContain('在精选技术视频库中搜索')
    expect(src).toContain('在视频库中搜索 “')
  })

  it('VideoContent 具备 URL ?q= 深度联动、?dur= 时长精细筛选与历史同步', () => {
    const src = loadSource('src/components/video-content.tsx')
    expect(src).toContain("new URLSearchParams(window.location.search).get('q')")
    expect(src).toContain("new URLSearchParams(window.location.search).get('dur')")
    expect(src).toContain('durationFilter')
    expect(src).toContain('matchesDuration')
    expect(src).toContain('selectDuration')
    expect(src).toContain('url.searchParams.set(\'dur\', dur)')
    expect(src).toContain('url.searchParams.set(\'q\', query.trim())')
    expect(src).toContain('时长偏好：')
    expect(src).toContain('filteredSearchResults')
  })

  it('分类 Hub 详情页具备 0-RTT 客户端即时筛选、独立官网直达与视频课程联动', () => {
    const srcBoard = loadSource('src/app/category/[slug]/category-board.tsx')
    expect(srcBoard).toContain('CategorySiteFilterBar')
    expect(srcBoard).toContain('ExternalLink')
    expect(srcBoard).toContain('/videos?q=')
    expect(srcBoard).toContain('data-site-item')

    const srcFilter = loadSource('src/components/category-site-filter-bar.tsx')
    expect(srcFilter).toContain('categoryName')
    expect(srcFilter).toContain('applyFilter')
    expect(srcFilter).toContain('category-filter-empty')
    expect(srcFilter).toContain('显示')
  })

  it('全部站点目录页具备 SitesDirectoryFilterableGrid 与精选技术视频库联动', () => {
    const src = loadSource('src/app/sites/sites-directory.tsx')
    expect(src).toContain('SitesDirectoryFilterableGrid')
    expect(src).toContain('MonitorPlay')
    expect(src).toContain('href="/videos"')
  })

  it('站点详情页集成跨生态实战视频教程与优雅回退', () => {
    const src = loadSource('src/components/site-detail-view.tsx')
    expect(src).toContain('relatedVideos')
    expect(src).toContain('/api/videos?q=')
    expect(src).toContain('site-videos-heading')
    expect(src).toContain('相关实战视频与精品教程')
    expect(src).toContain('referrerPolicy="no-referrer"')
  })

  it('标签结果页具备跨生态技术视频联动横幅与空态直达', () => {
    const src = loadSource('src/components/tag-results-board.tsx')
    expect(src).toContain('MonitorPlay')
    expect(src).toContain('/videos?q=')
    expect(src).toContain('相关视频教程')
  })

  it('SpotlightModal 具备完整的全景核心路由快捷系统指令', () => {
    const src = loadSource('src/components/search/spotlight-modal.tsx')
    expect(src).toContain('cmd-hot')
    expect(src).toContain("router.push('/hot')")
    expect(src).toContain('cmd-collections')
    expect(src).toContain("router.push('/collections')")
    expect(src).toContain('cmd-tags')
    expect(src).toContain("router.push('/tags')")
    expect(src).toContain('cmd-sites')
    expect(src).toContain("router.push('/sites')")
    expect(src).toContain('cmd-favorites')
    expect(src).toContain("router.push('/favorites')")
  })

  it('专题合集详情页具备专题内 0-RTT 即时筛选与跨生态视频教程联动', () => {
    const src = loadSource('src/app/collections/[slug]/collection-detail-view.tsx')
    expect(src).toContain('siteFilterQuery')
    expect(src).toContain('filteredSites')
    expect(src).toContain('/videos?q=')
    expect(src).toContain('相关技术视频教程')
  })

  it('榜单页 HotView 具备榜内即时筛选、ExternalLink 官网直达与热门技术视频联动', () => {
    const src = loadSource('src/app/hot/hot-view.tsx')
    expect(src).toContain('filterQuery')
    expect(src).toContain('filteredTrending')
    expect(src).toContain('filteredFresh')
    expect(src).toContain('ExternalLink')
    expect(src).toContain('/videos')
    expect(src).toContain('热门技术精选视频教程')
  })

  it('标签云 TagCloud 具备跨生态技术视频联动横幅与直达入口', () => {
    const src = loadSource('src/components/tag-cloud.tsx')
    expect(src).toContain('/videos')
    expect(src).toContain('按技术栈查找精选视频教程')
  })

  it('视频中心 VideoContent 具备来源平台、时长偏好、智能排序多维控制台与空态重置', () => {
    const src = loadSource('src/components/video-content.tsx')
    expect(src).toContain('PLATFORM_FILTER_OPTIONS')
    expect(src).toContain('SORT_OPTIONS')
    expect(src).toContain('platformFilter')
    expect(src).toContain('sortOrder')
    expect(src).toContain('matchesPlatform')
    expect(src).toContain('sortVideoItems')
    expect(src).toContain('没有找到匹配当前条件的视频')
    expect(src).toContain('重置所有筛选')
  })

  it('站点详情页 SiteDetailView 具备一键复制 Markdown 引用格式能力', () => {
    const src = loadSource('src/components/site-detail-view.tsx')
    expect(src).toContain('handleCopyMarkdown')
    expect(src).toContain('复制 Markdown')
    expect(src).toContain('mdCopyFeedback')
    expect(src).toContain('FileText')
  })

  it('站点速览弹窗 SitePeekDialog 具备本地实时测速探针、延迟反馈与死链失效原位上报能力', () => {
    const src = loadSource('src/components/site-peek-dialog.tsx')
    expect(src).toContain('probeSiteLatency')
    expect(src).toContain('handleLivePing')
    expect(src).toContain('handleReportBroken')
    expect(src).toContain('反馈失效')
    expect(src).toContain('测速')
    expect(src).toContain('已收到失效反馈')
    expect(src).toContain('Activity')
  })

  it('搜索面板 SearchPalette 具备空查询时即时聚合「常用与最近常去」站点秒开体验', () => {
    const src = loadSource('src/components/search-palette.tsx')
    expect(src).toContain('readOfflineVisits')
    expect(src).toContain('recentVisits')
    expect(src).toContain('常用与最近常去')
    expect(src).toContain('safeHref')
    expect(src).toContain('recordOfflineVisit')
    expect(src).toContain('reportClick')
  })

  it('全局 Spotlight 控制台具备空输入时展示常用与最近常去站点并支持一键秒开', () => {
    const src = loadSource('src/components/search/spotlight-modal.tsx')
    expect(src).toContain('readOfflineVisits')
    expect(src).toContain('recentVisits')
    expect(src).toContain('常用与最近常去')
    expect(src).toContain('safeHref')
    expect(src).toContain('recordOfflineVisit')
    expect(src).toContain('fetchSearchHistory')
  })

  it('NavigationCategorySection 具备分类直达锚点链接复制与进入时 Hash 自愈展开能力', () => {
    const src = loadSource('src/components/navigation-category-section.tsx')
    expect(src).toContain('handleCopyCategoryLink')
    expect(src).toContain('Link2')
    expect(src).toContain('复制分类直达链接')
    expect(src).toContain('copyText')
    expect(src).toContain('window.location.hash')
    expect(src).toContain('history.replaceState')
  })

  it('FloatingQuickNav 具备滚动感知、遵循 preferredScrollBehavior 的极速回顶与生产力入口', () => {
    const src = loadSource('src/components/floating-quick-nav.tsx')
    expect(src).toContain('preferredScrollBehavior')
    expect(src).toContain('scrollToTop')
    expect(src).toContain('openSpotlight')
    expect(src).toContain('回到顶部')
    expect(src).toContain('超级搜索')
    expect(src).toContain('微工具箱')
  })

  it('NavigationContent 与 KeyboardShortcutsDialog 协同挂载 FloatingQuickNav 与规范快捷键文案', () => {
    const srcContent = loadSource('src/components/navigation-content.tsx')
    expect(srcContent).toContain('FloatingQuickNav')
    expect(srcContent).toContain('onOpenTools={() => setIsToolsOpen(true)}')

    const srcShortcuts = loadSource('src/components/keyboard-shortcuts-dialog.tsx')
    // 平台键不许写死：macOS 是 ⌘K、Windows/Linux 是 Ctrl+K，还得跟随用户的呼出键偏好
    expect(srcShortcuts).toContain('spotlightHotkeyHint(spotlightMode, modKey)')
    expect(srcShortcuts).toContain('getModifierKey()')
    expect(srcShortcuts).not.toMatch(/key:\s*'Ctrl\+K 或 \//)
    expect(srcShortcuts).toContain('极速呼出超级搜索与指令控制台 (Spotlight)')
  })

  it('SiteDetailView 具备死链/超时自愈引导横幅、Wayback Machine 快照链接与平替锚点直达', () => {
    const src = loadSource('src/components/site-detail-view.tsx')
    expect(src).toContain('isDeadLink')
    expect(src).toContain('waybackUrl')
    // 死链防御 #4：Wayback 链接定向到收录时刻最近的快照（buildDeadLinkWaybackUrl），
    // 而不是写死的 `web/*/…` 最新快照；无收录时间时 helper 内部回落到 `*`。
    expect(src).toContain('buildDeadLinkWaybackUrl(site.url, site.createdAt)')
    expect(src).not.toContain('web.archive.org/web/*/')
    expect(src).toContain('查看历史快照')
    expect(src).toContain('查看平替方案')
    expect(src).toContain('alternatives-section')
  })

  it('LocalDataManager 具备设备端离线数据资产清点、JSON 全量快照导出、备份还原与足迹清空', () => {
    const src = loadSource('src/components/user-center/local-data-manager.tsx')
    expect(src).toContain('useFavorites')
    expect(src).toContain('useHomeDIY')
    expect(src).toContain('readOfflineVisits')
    expect(src).toContain('clearOfflineVisits')
    expect(src).toContain('navhub-local-full-backup')
    expect(src).toContain('handleExportBackup')
    expect(src).toContain('handleFileChange')
    expect(src).toContain('handleClearVisits')
  })

  it('/me/data 数据主权中心成功挂载 LocalDataManager 为匿名与登录用户提供离线数据主权', () => {
    const src = loadSource('src/app/me/data/page.tsx')
    expect(src).toContain('LocalDataManager')
    expect(src).toContain('<LocalDataManager />')
  })
})
