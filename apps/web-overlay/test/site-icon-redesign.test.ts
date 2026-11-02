import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBuiltinBrandLogo, BUILTIN_BRAND_LOGOS } from '../src/lib/brand-logos'
import { resolveSiteIcon, extractFaviconMonogram, getDeterministicGradient } from '../src/components/site-favicon'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('网站图标美化与高清矢量重新设计', () => {
  it('全新高颜值默认网站站标 SVG 文件存在且结构完整', () => {
    const svgPath = resolve(HERE, '../public/assets/images/default-website-icon.svg')
    expect(existsSync(svgPath)).toBe(true)
    const content = readFileSync(svgPath, 'utf8')
    expect(content).toContain('<svg')
    expect(content).toContain('viewBox="0 0 128 128"')
    expect(content).toContain('linearGradient id="bgGrad"')
    expect(content).toContain('rect')
  })

  it('主流高频站点拥有内置官方标准配色高清矢量 Logo', () => {
    const mainstreamDomains = [
      'github.com',
      'google.com',
      'bilibili.com',
      'deepseek.com',
      'zhihu.com',
      'juejin.cn',
      'weixin.qq.com',
      'youtube.com',
      'x.com',
      'docker.com',
      'npmjs.com',
      'developer.mozilla.org',
      'stackoverflow.com',
      'cursor.com',
      'huggingface.co',
      'v2ex.com',
      'baidu.com',
      'kimi.moonshot.cn',
    ]

    for (const domain of mainstreamDomains) {
      const logo = BUILTIN_BRAND_LOGOS[domain]
      expect(logo, `Missing logo for ${domain}`).toBeDefined()
      expect(logo).toContain('data:image/svg+xml')
      expect(logo).toContain('%3Csvg')
    }
  })

  it('getBuiltinBrandLogo 支持域名与子域名别名精准匹配', () => {
    // 直接主域名
    expect(getBuiltinBrandLogo('https://github.com')).toContain('data:image/svg+xml')
    expect(getBuiltinBrandLogo('https://google.com')).toContain('data:image/svg+xml')
    
    // 子域名与别名
    expect(getBuiltinBrandLogo('https://chat.deepseek.com')).toEqual(BUILTIN_BRAND_LOGOS['deepseek.com'])
    expect(getBuiltinBrandLogo('https://b23.tv/av123')).toEqual(BUILTIN_BRAND_LOGOS['bilibili.com'])
    expect(getBuiltinBrandLogo('https://weread.qq.com')).toEqual(BUILTIN_BRAND_LOGOS['weixin.qq.com'])
    expect(getBuiltinBrandLogo('https://zhuanlan.zhihu.com/p/123')).toEqual(BUILTIN_BRAND_LOGOS['zhihu.com'])
    expect(getBuiltinBrandLogo('https://kimi.ai')).toEqual(BUILTIN_BRAND_LOGOS['kimi.moonshot.cn'])
    expect(getBuiltinBrandLogo('https://twitter.com/home')).toEqual(BUILTIN_BRAND_LOGOS['x.com'])
    
    // 标题模糊匹配
    expect(getBuiltinBrandLogo(undefined, 'GitHub: Let\'s build from here')).toEqual(BUILTIN_BRAND_LOGOS['github.com'])
    expect(getBuiltinBrandLogo(undefined, '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili')).toEqual(BUILTIN_BRAND_LOGOS['bilibili.com'])
  })

  it('resolveSiteIcon 优先命中官方矢量 Logo 且杜绝跨域破图', () => {
    const ghIcon = resolveSiteIcon('https://github.com', 'GitHub')
    expect(ghIcon).toContain('data:image/svg+xml')

    const dsIcon = resolveSiteIcon('https://chat.deepseek.com', 'DeepSeek')
    expect(dsIcon).toContain('data:image/svg+xml')

    // 未提供任何有效图标和域名的站点回退为空字符串触发晶体微标
    expect(resolveSiteIcon('', '')).toBe('')
  })

  it('extractFaviconMonogram 首字母提取优雅且彻底告别突兀单字', () => {
    // 正常英文字符与中文字符提取
    expect(extractFaviconMonogram('Vite 官方中文文档')).toBe('V')
    expect(extractFaviconMonogram('前端开发')).toBe('前')
    expect(extractFaviconMonogram('  @Tailwind CSS  ')).toBe('T')
    
    // 从 URL 提取
    expect(extractFaviconMonogram('', 'https://react.dev')).toBe('R')
    expect(extractFaviconMonogram('', 'https://www.nextjs.org')).toBe('N')
    
    // 没有任何有效字符时，彻底告别旧实现的 '山'，返回空以激活精致星轨罗盘
    expect(extractFaviconMonogram('   !!!###   ', '')).toBe('')
    expect(extractFaviconMonogram('', '')).toBe('')
  })

  it('getDeterministicGradient 稳定生成高质感双色晶彩流光与防溢出角度', () => {
    const grad1 = getDeterministicGradient('https://react.dev')
    expect(grad1.cssGradient).toContain('linear-gradient(')
    expect(grad1.from).toMatch(/^#[0-9a-f]{6}$/i)
    expect(grad1.to).toMatch(/^#[0-9a-f]{6}$/i)
    expect(grad1.angle).toBeGreaterThanOrEqual(45)

    const grad2 = getDeterministicGradient('https://vuejs.org')
    expect(grad2.cssGradient).toContain('linear-gradient(')
  })

  it('SiteFavicon 具备大容器尺寸自适应 (w-16/w-12) 与响应式字体，且消除固定 24x24 属性限制', () => {
    const src = readFileSync(resolve(HERE, '../src/components/site-favicon.tsx'), 'utf8')
    expect(src).toContain("className.includes('w-16')")
    expect(src).toContain("className.includes('w-12')")
    expect(src).toContain('text-2xl sm:text-3xl font-black')
    expect(src).toContain('GlobeCompassIcon')
    // 确保没有写死 width={24} height={24}
    expect(src).not.toContain('width={24}')
  })

  it('VideoCard 具备科技海报质感默认占位，杜绝死气沉沉的灰暗方块', () => {
    const src = readFileSync(resolve(HERE, '../src/components/video-card.tsx'), 'utf8')
    expect(src).toContain('MonitorPlay')
    expect(src).toContain('科技海报')
    expect(src).not.toContain('PlayCircle className="w-16 h-16 text-muted-foreground/30"')
  })

  it('全局品牌 favicon.svg 存在且支持深浅色模式自适应媒体查询', () => {
    const svgPath = resolve(HERE, '../public/favicon.svg')
    expect(existsSync(svgPath)).toBe(true)
    const content = readFileSync(svgPath, 'utf8')
    expect(content).toContain('<svg')
    expect(content).toContain('viewBox="0 0 32 32"')
    expect(content).toContain('prefers-color-scheme: dark')
    expect(content).toContain('#38bdf8')
  })

  it('CategoryQuickJumpBar 具备分类专属矢量图标前缀', () => {
    const src = readFileSync(resolve(HERE, '../src/components/category-quick-jump-bar.tsx'), 'utf8')
    expect(src).toContain('resolveNavIcon')
    expect(src).toContain('CatIcon')
  })

  it('Sidebar 侧边栏具备精致微拟物分类图标底座', () => {
    const src = readFileSync(resolve(HERE, '../src/components/sidebar.tsx'), 'utf8')
    expect(src).toContain('w-6 h-6 rounded-md bg-muted/60')
    expect(src).toContain('group-hover:bg-primary/10')
  })

  it('根布局 layout.tsx 优先声明高清矢量 SVG Favicon', () => {
    const src = readFileSync(resolve(HERE, '../src/app/layout.tsx'), 'utf8')
    expect(src).toContain('/favicon.svg')
    expect(src).toContain('image/svg+xml')
  })

  it('EmptyState 统一空态组件具备柔和呼吸光晕与晶体多层质感图标底座', () => {
    const src = readFileSync(resolve(HERE, '../src/components/ui/empty-state.tsx'), 'utf8')
    expect(src).toContain('bg-primary/15')
    expect(src).toContain('blur-md')
    expect(src).toContain('ring-inset ring-white/20')
  })

  it('brand-logos 库补充 Bing 与 Vercel 官方纯矢量标准微标', () => {
    expect(BUILTIN_BRAND_LOGOS['bing.com']).toBeDefined()
    expect(BUILTIN_BRAND_LOGOS['bing.com']).toContain('data:image/svg+xml')
    expect(BUILTIN_BRAND_LOGOS['vercel.com']).toBeDefined()
    expect(BUILTIN_BRAND_LOGOS['vercel.com']).toContain('data:image/svg+xml')

    expect(getBuiltinBrandLogo('https://cn.bing.com')).toEqual(BUILTIN_BRAND_LOGOS['bing.com'])
    expect(getBuiltinBrandLogo(undefined, '微软必应搜索')).toEqual(BUILTIN_BRAND_LOGOS['bing.com'])
    expect(getBuiltinBrandLogo('https://my-app.vercel.app')).toEqual(BUILTIN_BRAND_LOGOS['vercel.com'])
  })

  it('SearchPalette 全网搜索聚合装配 Google/GitHub/百度/Bing 官方标准高清微矢量徽标', () => {
    const src = readFileSync(resolve(HERE, '../src/components/search-palette.tsx'), 'utf8')
    expect(src).toContain("getBuiltinBrandLogo('google.com')")
    expect(src).toContain("getBuiltinBrandLogo('github.com')")
    expect(src).toContain("getBuiltinBrandLogo('baidu.com')")
    expect(src).toContain("getBuiltinBrandLogo('bing.com')")
    expect(src).toContain('touch-manipulation')
  })

  it('NavigationCard 彻底分离工作台固定(LayoutGrid)与分类置顶(Pin)的图标语义，并增加触控弹性反馈', () => {
    const src = readFileSync(resolve(HERE, '../src/components/navigation-card.tsx'), 'utf8')
    expect(src).toContain('LayoutGrid')
    expect(src).toContain('touch-manipulation select-none active:scale-[0.985]')
    // 确保不再使用同一个 Pin 图标同时作为工作台和分类置顶
    expect(src).toContain('handleWorkbenchPin')
    expect(src).toContain('<LayoutGrid className="w-3.5 h-3.5" />')
  })

  it('FavoriteButton 具备点击微物理弹性动效与温暖琥珀金光晕', () => {
    const src = readFileSync(resolve(HERE, '../src/components/favorite-button.tsx'), 'utf8')
    expect(src).toContain('active:scale-75')
    expect(src).toContain('fill-amber-400 text-amber-400')
    expect(src).toContain('drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]')
    expect(src).toContain('touch-manipulation')
  })

  it('MobileNav 移动端底部导航统一使用 Star 收藏图标并增强触按微动效', () => {
    const src = readFileSync(resolve(HERE, '../src/components/mobile-nav.tsx'), 'utf8')
    expect(src).toContain("Icon: Star")
    expect(src).not.toContain("Icon: Heart")
    expect(src).toContain('touch-manipulation select-none active:scale-90')
    expect(src).toContain('fill-primary/15')
  })

  it('SitePeekDialog 站点速览具备平替卡片 Favicon 与短时对勾 Check 反馈', () => {
    const src = readFileSync(resolve(HERE, '../src/components/site-peek-dialog.tsx'), 'utf8')
    expect(src).toContain('copiedLink')
    expect(src).toContain('copiedMd')
    expect(src).toContain('SiteFavicon')
    expect(src).toContain('已复制')
  })

  it('SiteDetailView 详情页平替生态全量装配 SiteFavicon 与专属复制网址按钮', () => {
    const src = readFileSync(resolve(HERE, '../src/components/site-detail-view.tsx'), 'utf8')
    expect(src).toContain('handleCopyUrl')
    expect(src).toContain('已复制网址')
    expect(src).toContain('SiteFavicon')
    // 确保平替卡片和备用替代卡片均有 SiteFavicon 节点
    const faviconMatches = src.match(/<SiteFavicon/g)
    expect(faviconMatches).not.toBeNull()
    expect(faviconMatches!.length).toBeGreaterThanOrEqual(4)
  })

  it('CollectionBoard 专题列表区分类型专属微光方案并支持触控手势反馈', () => {
    const src = readFileSync(resolve(HERE, '../src/components/collection-board.tsx'), 'utf8')
    expect(src).toContain('text-violet-600')
    expect(src).toContain('text-emerald-600')
    expect(src).toContain('text-amber-600')
    expect(src).toContain('touch-manipulation select-none active:scale-[0.985]')
  })

  it('NotFound 404 引导页具备晶体多层罗盘底座与恢复卡片微底座', () => {
    const src = readFileSync(resolve(HERE, '../src/app/not-found.tsx'), 'utf8')
    expect(src).toContain('from-primary/20 via-primary/10 to-primary/5')
    expect(src).toContain('w-8 h-8 rounded-lg bg-primary/10 border border-primary/20')
    expect(src).toContain('touch-manipulation select-none')
  })

  it('BatchOperationDock 批量操作坞统一工作台 LayoutGrid 图标与 emerald 色系', () => {
    const src = readFileSync(resolve(HERE, '../src/components/batch-operation-dock.tsx'), 'utf8')
    expect(src).toContain('LayoutGrid')
    expect(src).toContain('text-emerald-500')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })

  it('ModeToggle 主题切换具备日月温润微光与触控弹性', () => {
    const src = readFileSync(resolve(HERE, '../src/components/mode-toggle.tsx'), 'utf8')
    expect(src).toContain('text-amber-500')
    expect(src).toContain('text-sky-400')
    expect(src).toContain('touch-manipulation select-none active:scale-90')
  })

  it('FloatingQuickNav 悬浮控制台具备专属悬停色彩与触控质感', () => {
    const src = readFileSync(resolve(HERE, '../src/components/floating-quick-nav.tsx'), 'utf8')
    expect(src).toContain('hover:text-primary hover:bg-primary/10')
    expect(src).toContain('hover:text-blue-500 hover:bg-blue-500/10')
    expect(src).toContain('hover:text-amber-500 hover:bg-amber-500/10')
    expect(src).toContain('touch-manipulation select-none active:scale-90')
  })

  it('RelatedTags 标签共现具备微型晶体底座与触控弹性', () => {
    const src = readFileSync(resolve(HERE, '../src/components/related-tags.tsx'), 'utf8')
    expect(src).toContain('w-4 h-4 rounded-full bg-indigo-500/10')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })

  it('QuickToolsDrawer 时间戳复制具备成功反馈并支持转换结果复制', () => {
    const src = readFileSync(resolve(HERE, '../src/components/quick-tools-drawer.tsx'), 'utf8')
    expect(src).toContain("copied === 'ts10' ? <Check")
    expect(src).toContain("copied === 'ts13' ? <Check")
    expect(src).toContain("copied === 'tsResult' ? <Check")
    expect(src).toContain('text-emerald-500')
  })

  it('VideoCard 离线缓存支持 Check 对勾反馈与触控质感', () => {
    const src = readFileSync(resolve(HERE, '../src/components/video-card.tsx'), 'utf8')
    expect(src).toContain('isSavedOffline ? <Check')
    expect(src).toContain('touch-manipulation select-none active:scale-90')
  })

  it('BookmarkImporter 书签导入列表装配 SiteFavicon 并具备触控弹性', () => {
    const src = readFileSync(resolve(HERE, '../src/components/bookmark-importer.tsx'), 'utf8')
    expect(src).toContain('SiteFavicon')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })

  it('SubmissionForm 推荐收录表单支持实时 SiteFavicon 预览与触控按压', () => {
    const src = readFileSync(resolve(HERE, '../src/components/submission-form.tsx'), 'utf8')
    expect(src).toContain('SiteFavicon')
    expect(src).toContain('touch-manipulation select-none active:scale-[0.98]')
  })

  it('KeyboardShortcutsDialog 快捷键全景指南支持秒开直达与晶体外观', () => {
    const src = readFileSync(resolve(HERE, '../src/components/keyboard-shortcuts-dialog.tsx'), 'utf8')
    expect(src).toContain('1 ~ 9')
    expect(src).toContain('^N / ^P')
    expect(src).toContain('Alt+C')
    expect(src).toContain('ring-white/10')
  })

  it('CrdtSyncStatusPill 多端协同药丸支持触屏弹性交互', () => {
    const src = readFileSync(resolve(HERE, '../src/components/crdt/crdt-sync-status-pill.tsx'), 'utf8')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })

  it('HotView 热门榜单前三名采用高质感金银铜渐变晶体徽标与触控', () => {
    const src = readFileSync(resolve(HERE, '../src/app/hot/hot-view.tsx'), 'utf8')
    expect(src).toContain('from-amber-400 via-amber-500 to-amber-600')
    expect(src).toContain('from-slate-300 via-slate-400 to-slate-500')
    expect(src).toContain('from-amber-700 via-amber-800 to-amber-900')
    expect(src).toContain('touch-manipulation select-none active:scale-[0.985]')
  })

  it('EcosystemGraph 技术拓扑图谱详情与关联列表全面装配 SiteFavicon', () => {
    const src = readFileSync(resolve(HERE, '../src/components/ecosystem-graph.tsx'), 'utf8')
    expect(src).toContain('SiteFavicon')
    expect(src).toContain('touch-manipulation select-none active:scale-[0.98]')
  })

  it('SitePeekDialog 站点速览具备晶体 Favicon 高光底座与全面触控优化', () => {
    const src = readFileSync(resolve(HERE, '../src/components/site-peek-dialog.tsx'), 'utf8')
    expect(src).toContain('bg-gradient-to-b from-card to-muted/80')
    expect(src).toContain('w-8 h-8 rounded-xl bg-background/80')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })

  it('SiteDetailView 详情展板具备晶体微光底座且全量按钮支持触控反馈', () => {
    const src = readFileSync(resolve(HERE, '../src/components/site-detail-view.tsx'), 'utf8')
    expect(src).toContain('bg-gradient-to-b from-card to-muted/80')
    expect(src).toContain('w-9 h-9 rounded-xl bg-background/80')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })

  it('VideoSharePosterDialog 海报分享弹窗具备晶体微光徽标与触控反馈', () => {
    const src = readFileSync(resolve(HERE, '../src/components/video-share-poster-dialog.tsx'), 'utf8')
    expect(src).toContain('bg-pink-500/10 border border-pink-500/20 text-pink-500')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })

  it('HomeDiyBackupDialog DIY 备份弹窗具备晶体微光徽标与触控反馈', () => {
    const src = readFileSync(resolve(HERE, '../src/components/home-diy-backup-dialog.tsx'), 'utf8')
    expect(src).toContain('bg-primary/10 border border-primary/20 text-primary')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })

  it('PreferencesPage 画像摘要与设置项具备晶体微光底座与触控弹性', () => {
    const src = readFileSync(resolve(HERE, '../src/app/preferences/page.tsx'), 'utf8')
    expect(src).toContain('min-w-0 rounded-2xl border border-border/70 bg-card/60')
    expect(src).toContain('w-6 h-6 rounded-lg bg-primary/10')
    expect(src).toContain('touch-manipulation select-none')
  })

  it('VideoPlayerPage 播放器控制栏与连播切换全量支持触控弹性', () => {
    const src = readFileSync(resolve(HERE, '../src/components/video-player-page.tsx'), 'utf8')
    expect(src).toContain('touch-manipulation select-none active:scale-90')
    expect(src).toContain('touch-manipulation select-none active:scale-95')
  })
})
