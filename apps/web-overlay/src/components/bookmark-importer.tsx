'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/registry/new-york/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Badge } from '@/components/ui/badge'
import { Upload, FileUp, CheckCircle, ArrowLeft, Loader2, Sparkles, AlertCircle } from 'lucide-react'
import Link from 'next/link'

interface ParsedBookmark {
  id: string
  title: string
  url: string
  folder?: string
  /** 权威树的叶子 slug；空串 = 没建议出来，交给「未分类」 */
  suggestedCategorySlug: string
  selected: boolean
}

/** 「暂不分类」在 select 里的值：提交时直接省略 categoryId */
const UNCLASSIFIED = ''

/**
 * 书签启发式建议表：关键词 → 权威树**叶子 slug**（方案 P4-5）。
 *
 * 为什么写 slug 不写 id：`/api/sites/batch` 对 id 与 slug 都认（中枢
 * `attachable` 集合同时收录两者），而旧版写死的 `cat-ai / cat-dev / cat-design /
 * cat-learn / cat-life` 在新树里要么已经不存在，要么是一级根——一级根本来就不在
 * 「可挂集合」里，提交上去一律降级成未分类，等于整批白归。
 * 兜底也改了：命中不了就留空（未分类 + 结果里报数），不再像旧版那样把一切都
 * 塞进「开发运维」，那种假成功事后完全看不出来。
 * 顺序即优先级，第一条命中即返回，所以垂类要排在泛词前面。
 */
const CATEGORY_HINTS: Array<{ slug: string; title: string; icon: string; keywords: string[] }> = [
  { slug: 'chat-assistants', title: '对话助手', icon: '💬', keywords: ['chatgpt', 'gpt', 'claude', 'gemini', 'copilot', 'llm', '大模型', '对话机器人', 'chatbot', '文心', 'kimi', 'deepseek'] },
  { slug: 'ai-image-generation', title: 'AI 图像生成', icon: '🎨', keywords: ['midjourney', 'stable diffusion', 'sdxl', 'dall', '文生图', 'ai 绘画', 'ai 作图'] },
  { slug: 'ai-video-generation', title: 'AI 视频生成', icon: '🎬', keywords: ['sora', 'runway', '可灵', '文生视频', 'ai 视频', '数字人'] },
  { slug: 'ai-writing-office', title: 'AI 写作办公', icon: '✍️', keywords: ['ai 写作', 'AI 文案', '智能写作', '秘塔写作'] },
  { slug: 'ai-search-knowledge', title: 'AI 搜索知识', icon: '🔍', keywords: ['perplexity', 'ai 搜索', '秘塔', '深度研究'] },
  { slug: 'code-hosting', title: '代码托管', icon: '📦', keywords: ['github', 'gitlab', 'gitee', 'bitbucket', '代码托管', '仓库'] },
  { slug: 'official-docs', title: '官方文档', icon: '📖', keywords: ['mdn', 'docs', '文档', '手册', '规范', 'reference', 'spec'] },
  { slug: 'qa-communities', title: '问答社区', icon: '❓', keywords: ['stackoverflow', 'segmentfault', 'csdn', '掘金', 'juejin', '问答', '论坛', '社区'] },
  { slug: 'databases-and-storage', title: '数据库与存储', icon: '🗄️', keywords: ['mysql', 'postgres', 'redis', 'mongo', '数据库', 'sqlite', '对象存储', 's3'] },
  { slug: 'containers-and-orchestration', title: '容器与编排', icon: '🐳', keywords: ['docker', 'kubernetes', 'k8s', '容器', 'helm', '编排'] },
  { slug: 'ci-cd-and-releases', title: '持续交付', icon: '🚀', keywords: ['jenkins', 'actions', '流水线', '持续集成', '部署', 'vercel', 'netlify', 'ci/cd'] },
  { slug: 'observability-and-monitoring', title: '可观测与监控', icon: '📈', keywords: ['grafana', 'prometheus', 'sentry', '监控', '日志', '告警', '可观测', 'tracing'] },
  { slug: 'icons-and-typefaces', title: '图标与字体', icon: '🔤', keywords: ['icon', '图标', '字体', 'font', 'glyph', '插画'] },
  { slug: 'color-palettes', title: '配色与色板', icon: '🌈', keywords: ['color', '配色', '色板', 'palette', '对比度'] },
  { slug: 'stock-media', title: '图片视频素材', icon: '🖼️', keywords: ['unsplash', 'pexels', 'pixabay', '图库', '素材', '免版权', 'stock'] },
  { slug: 'prototyping-and-collab', title: '原型与协作', icon: '📐', keywords: ['figma', 'sketch', '原型', '墨刀', 'framer', 'wireframe', '设计交付'] },
  { slug: 'notes-and-pkb', title: '笔记与知识库', icon: '📝', keywords: ['notion', 'obsidian', 'flomo', '印象笔记', '笔记', '知识库', 'wiki'] },
  { slug: 'collaborative-docs', title: '协作文档', icon: '🤝', keywords: ['腾讯文档', '飞书', '语雀', '石墨', 'google docs', '在线文档', '协作文档'] },
  { slug: 'screenshots-and-pdf', title: '截图与 PDF', icon: '📄', keywords: ['pdf', '截图', 'ocr', '扫描', '录屏', '标注'] },
  { slug: 'cloud-drives-and-transfer', title: '网盘与传输', icon: '☁️', keywords: ['网盘', '云盘', 'dropbox', 'onedrive', '下载', '传输', '种子', '磁力'] },
  { slug: 'online-courses', title: '在线课程', icon: '🎓', keywords: ['coursera', 'udemy', '慕课', 'mooc', '课程', '学堂', 'edx'] },
  { slug: 'digital-libraries', title: '数字图书馆', icon: '📚', keywords: ['图书馆', '电子书', '文献', 'kindle', '微信读书', '图书', 'book'] },
  { slug: 'dictionaries-and-translators', title: '词典与翻译', icon: '🌐', keywords: ['翻译', 'translate', 'deepl', '词典', 'dict', '术语'] },
  { slug: 'language-learning', title: '语言学习', icon: '🗣️', keywords: ['多邻国', 'duolingo', '背单词', '外语', '雅思', '托福', 'ielts', 'toefl'] },
  { slug: 'music', title: '音乐', icon: '🎵', keywords: ['音乐', 'music', 'spotify', '网易云', 'qq音乐', '歌词'] },
  { slug: 'anime-and-fandom', title: '动漫与二次元', icon: '📺', keywords: ['动漫', '漫画', '二次元', '番剧', 'anime', 'bilibili', 'b站'] },
  { slug: 'long-video', title: '长视频', icon: '🎞️', keywords: ['电影', '电视剧', 'youtube', '优酷', '爱奇艺', '腾讯视频', 'netflix', '视频'] },
  { slug: 'podcast-and-audiobooks', title: '播客与有声书', icon: '🎧', keywords: ['播客', 'podcast', '有声书', '听书', '小宇宙'] },
  { slug: 'game-platforms', title: '游戏平台', icon: '🎮', keywords: ['steam', 'epic', '游戏', 'game', '攻略'] },
  { slug: 'ecommerce', title: '电商购物', icon: '🛒', keywords: ['淘宝', '京东', '天猫', '拼多多', 'amazon', '购物', '电商', '闲鱼'] },
  { slug: 'grocery-and-delivery', title: '生鲜与外卖', icon: '🍜', keywords: ['外卖', '美团', '饿了么', '生鲜', '买菜', '超市'] },
  { slug: 'travel-and-lodging', title: '旅行与住宿', icon: '✈️', keywords: ['旅行', '旅游', '机票', '酒店', '民宿', '携程', '马蜂窝'] },
  { slug: 'transit-and-mobility', title: '交通与出行', icon: '🚇', keywords: ['地图', '导航', '公交', '地铁', '打车', '高德', '12306', '出行'] },
  { slug: 'weather-and-environment', title: '气象与环境', icon: '🌦️', keywords: ['天气', 'weather', '气象', '空气质量'] },
  { slug: 'general-news-portals', title: '门户综合资讯', icon: '📰', keywords: ['新闻', '资讯', 'news', '头条', '门户', '微博'] },
  { slug: 'healthcare', title: '医疗健康', icon: '🩺', keywords: ['医疗', '健康', '医院', '药', 'dxy', '健身', '减肥'] },
  { slug: 'funds-and-wealth', title: '基金理财', icon: '💰', keywords: ['基金', '理财', '财富', '定投', '余额宝'] },
  { slug: 'securities-and-quotes', title: '证券与行情', icon: '📊', keywords: ['股票', '证券', '行情', 'a股', '期货', '投资', '财报', 'finance', '东方财富', '雪球'] },
  { slug: 'crypto-and-web3', title: '加密与区块链', icon: '🪙', keywords: ['比特币', '加密货币', '区块链', 'crypto', 'web3', '钱包地址'] },
]

export function BookmarkImporter() {
  const [bookmarks, setBookmarks] = useState<ParsedBookmark[]>([])
  const [categories, setCategories] = useState<Array<{ slug: string; label: string }>>([])
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    success: number
    failed: number
    duplicate: number
    degraded: number
    /** 服务端返回 2xx 但正文读不出条数（代理异常页 / 字段缺失）：既不能算成功也不能算失败 */
    unconfirmed: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/hub/categories')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) return
        // 只留「有父级且有 slug」的行：一级根不能挂站点，历史脏行可能没有 slug
        setCategories(
          data
            .filter((c: any) => c.parentId && (c.slug ?? c.id) && c.enabled !== false)
            .map((c: any) => ({
              slug: String(c.slug ?? c.id),
              label: (c.icon ? c.icon + ' ' : '') + String(c.title),
            })),
        )
      })
      .catch(() => {
        // 分类下拉只是「选填」数据源：拉不到就退回内置建议表（仍可留空或手输），
        // 导入流程本身不依赖它，所以不打断也不打扰
      })
  }, [])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsParsing(true)
    setError(null)
    setImportResult(null)

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || '')
        const parsed = parseNetscapeBookmarks(text)
        if (parsed.length === 0) {
          setError('未能从文件中解析出有效书签，请确保文件是由 Chrome/Edge/Firefox 导出的书签 HTML 文件。')
        } else {
          setBookmarks(parsed)
        }
      } catch (err) {
        setError('解析文件失败: ' + (err instanceof Error ? err.message : String(err)))
      } finally {
        setIsParsing(false)
      }
    }
    reader.readAsText(file)
  }

  const toggleSelect = (id: string) => {
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b))
    )
  }

  const toggleSelectAll = (checked: boolean) => {
    setBookmarks((prev) => prev.map((b) => ({ ...b, selected: checked })))
  }

  const handleImport = async () => {
    const toImport = bookmarks.filter((b) => b.selected)
    if (toImport.length === 0) return

    setIsImporting(true)
    setError(null)

    let successCount = 0
    let failedCount = 0
    let duplicateCount = 0
    let degradedCount = 0
    let unconfirmedCount = 0

    // 分块并发批量入库，大幅减少网络往返并避免触发 300/min 限流
    const chunkSize = 50
    for (let i = 0; i < toImport.length; i += chunkSize) {
      const chunk = toImport.slice(i, i + chunkSize)
      try {
        const res = await fetch('/api/hub/sites/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sites: chunk.map((b) => ({
              url: b.url,
              title: b.title,
              // 中枢对 id 与 slug 都认；没建议出来就整个字段省略，让它走「未分类」
              ...(b.suggestedCategorySlug ? { categoryId: b.suggestedCategorySlug } : {}),
              source: 'bookmark-import',
            })),
          }),
        })
        if (res.ok) {
          // 2xx 但响应体不是 JSON（代理吞成错误页）：读不出条数就走下面的「未确认」分支，
          // 这里吞掉异常只是为了不把已成功的批次误判成失败，绝不补 0 冒充零收录。
          const data = await res.json().catch(() => {
            return null
          })
          if (data && typeof data.created === 'number') {
            successCount += data.created
            duplicateCount += data.duplicates ?? 0
            // 传了类目但没挂上（类目不存在 / 是一级根）的条数：不报出来就是静默堆进未分类
            degradedCount += data.categoryDegraded ?? 0
          } else {
            // 2xx 但读不出条数（代理回了异常页 / 字段缺失）：把整块当成功就是假话，
            // 记成「未确认」，让用户知道这批既没确认收录也没确认失败，可以重导一次。
            unconfirmedCount += chunk.length
          }
        } else {
          failedCount += chunk.length
        }
      } catch {
        failedCount += chunk.length
      }
    }

    setImportResult({
      success: successCount,
      failed: failedCount,
      duplicate: duplicateCount,
      degraded: degradedCount,
      unconfirmed: unconfirmedCount,
    })
    setIsImporting(false)
  }

  const selectedCount = bookmarks.filter((b) => b.selected).length

  /**
   * 下拉选项 = 中枢叶子 ∪ 内置建议表里缺的 slug。
   *
   * 补集不是为了好看：建议值如果在选项里找不到，下拉框会渲染成空白，
   * 用户以为没归类、实际却会把一个中枢认不出来的 slug 提交上去（降级成未分类）。
   * 中枢取数失败时 `categories` 为空，选项退回内置建议表，导入仍然可用。
   */
  const categoryOptions = useMemo(() => {
    const seen = new Set(categories.map((c) => c.slug))
    const extras = CATEGORY_HINTS.filter((h) => !seen.has(h.slug)).map((h) => ({
      slug: h.slug,
      label: `${h.icon} ${h.title}`,
    }))
    return [{ slug: UNCLASSIFIED, label: '暂不分类（导入后再归类）' }, ...categories, ...extras]
  }, [categories])

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-5 sm:space-y-6">
      {/* 顶部 Hero 展板 */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 p-4 sm:p-8 glass-surface market-hero subtle-mesh shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm" className="h-7 px-2.5 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-background/80 border border-border/50 gap-1.5 transition-all">
                <Link href="/">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回主页</span>
                </Link>
              </Button>
              <span className="text-xs text-muted-foreground">/ 智能书签导入</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground flex items-center gap-2.5">
              <Upload className="w-6 h-6 text-indigo-500 shrink-0" />
              <span>浏览器书签一键智能导入</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
              支持 Chrome、Edge、Firefox、Safari 导出的 <code className="text-primary font-mono bg-primary/10 px-1 py-0.5 rounded">bookmarks.html</code>。系统将在本地解析层级结构，并通过多维启发式自动建议技术分类。
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-col items-start sm:items-end gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              <span>纯前端本地解析</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-medium">
              <span>启发式自动归类</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-muted/60 text-muted-foreground border border-border/50 font-medium">
              <span>零外泄隐私保护</span>
            </span>
          </div>
        </div>
      </div>

      <Card className="glass-surface rounded-2xl border-border/80 shadow-xs overflow-hidden">
        <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-5">
          {/* 上传拖拽区 */}
          <div className="relative group border-2 border-dashed border-border/80 hover:border-primary/60 rounded-2xl p-5 sm:p-10 text-center transition-all duration-300 bg-muted/20 hover:bg-primary/5 cursor-pointer">
            <input aria-label="选择书签 HTML 文件"
              type="file"
              accept=".html,.htm"
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="flex flex-col items-center gap-2.5 pointer-events-none">
              <div className="w-12 h-12 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform duration-200">
                <FileUp className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors">
                点击选择或拖拽书签 HTML 文件至此
              </p>
              <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
                在 Chrome/Edge 浏览器中按 <kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">Ctrl+Shift+O</kbd> 打开书签管理器，点击右上角 “导出书签” 即可获得 HTML 导出文件。
              </p>
            </div>
          </div>

          {isParsing && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>正在解析书签层级与建议分类...</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 导入结果状态 */}
          {importResult && (
            <div
              className={
                importResult.failed + importResult.unconfirmed > 0
                  ? 'p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs space-y-1'
                  : 'p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs space-y-1'
              }
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {importResult.failed + importResult.unconfirmed > 0 ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                <span>
                  {importResult.failed + importResult.unconfirmed > 0 ? '导入结束，但有内容没确认收录' : '导入完成！'}
                </span>
              </div>
              <p>
                成功收录 {importResult.success} 个站点
                {importResult.duplicate > 0 ? `，已存在跳过 ${importResult.duplicate} 个` : ''}
                {importResult.failed > 0 ? `，失败 ${importResult.failed} 个` : ''}
                {importResult.unconfirmed > 0
                  ? `，${importResult.unconfirmed} 个未能确认（服务端返回异常，可重新导入这批）`
                  : ''}
                {importResult.degraded > 0
                  ? `；其中 ${importResult.degraded} 个所选分类不存在或是一级分类，已落到「未分类」，请到管理页重新归类`
                  : ''}。
              </p>
            </div>
          )}

          {/* 解析出的书签表格预览 */}
          {bookmarks.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-border/60">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-foreground">已解析出 {bookmarks.length} 个书签</span>
                  <Badge variant="secondary" className="font-mono bg-muted/80 px-2 py-0.5 rounded-full">已选中 {selectedCount}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs rounded-lg"
                    onClick={() => toggleSelectAll(selectedCount !== bookmarks.length)}
                  >
                    {selectedCount === bookmarks.length ? '取消全选' : '全选'}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5 rounded-lg shadow-xs"
                    disabled={selectedCount === 0 || isImporting}
                    onClick={handleImport}
                  >
                    {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span>{isImporting ? '正在批量收录...' : `导入选中的 ${selectedCount} 个站点`}</span>
                  </Button>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto rounded-xl border border-border/80 divide-y divide-border/50 text-xs bg-background/50">
                {bookmarks.map((b) => (
                  <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 p-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <input aria-label={`选择 ${b.title}`}
                        type="checkbox"
                        checked={b.selected}
                        onChange={() => toggleSelect(b.id)}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4 mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground truncate">{b.title}</span>
                          {b.folder && (
                            <span className="text-[11px] text-muted-foreground bg-muted/80 px-1.5 py-0.5 rounded font-mono truncate max-w-[100px] sm:max-w-[120px] shrink-0">
                              {b.folder}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground/80 truncate font-mono">{b.url}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end sm:justify-start pl-6 sm:pl-0 shrink-0">
                      <select
                        aria-label={`为「${b.title}」选择建议分类`}
                        value={b.suggestedCategorySlug}
                        onChange={(e) => {
                          const val = e.target.value
                          setBookmarks((prev) =>
                            prev.map((item) => (item.id === b.id ? { ...item, suggestedCategorySlug: val } : item))
                          )
                        }}
                        className="w-full sm:w-auto bg-background border border-border/70 rounded-lg px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
                      >
                        {categoryOptions.map((opt) => (
                          <option key={opt.slug || '__unclassified__'} value={opt.slug}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Netscape Bookmark HTML 简易解析器与智能分类启发式
 */
function parseNetscapeBookmarks(html: string): ParsedBookmark[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const links = Array.from(doc.querySelectorAll('a'))
  const results: ParsedBookmark[] = []

  let idx = 0
  for (const a of links) {
    const url = a.getAttribute('href') || ''
    const title = (a.textContent || url).trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue

    // 寻找最近的父级文件夹标题
    let folderName: string | undefined
    let parent = a.parentElement
    while (parent && parent !== doc.body) {
      const prevHeading = parent.querySelector('h3')
      if (prevHeading && prevHeading.textContent) {
        folderName = prevHeading.textContent.trim()
        break
      }
      parent = parent.parentElement
    }

    const suggestedCategorySlug = guessCategorySlug(title, url, folderName)

    results.push({
      id: `bm-${idx++}`,
      title,
      url,
      folder: folderName,
      suggestedCategorySlug,
      selected: true,
    })
  }

  return results
}

/** 命中不了就留空：旧版把兜底塞进「开发运维」，等于把书签堆进一个不相干的叶子 */
function guessCategorySlug(title: string, url: string, folder?: string): string {
  const text = `${title} ${url} ${folder ?? ''}`.toLowerCase()
  for (const hint of CATEGORY_HINTS) {
    if (hint.keywords.some((keyword) => text.includes(keyword))) return hint.slug
  }
  return UNCLASSIFIED
}
