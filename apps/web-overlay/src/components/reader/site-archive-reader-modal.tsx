'use client'

/**
 * Local-First 离线文档快照与 SingleFile 沉浸阅读器
 *
 * 核心特性：
 * 1. 纯净阅读模式 (Reader Mode)：自动剔除页面弹窗、横幅与冗余脚本，保留核心正文与文档结构；
 * 2. 多重排版主题定制：纯净白 / 羊皮纸护眼 / 极客暗夜 / 豆沙淡绿 + 字号字重自由缩放；
 * 3. 永久离线快照：调用后端 SingleFile 归档引擎，离线本地保存；
 * 4. 零依赖离线 HTML 导出与 Markdown 提取。
 */

import { useState, useEffect, useCallback } from 'react'
import {
  BookOpen,
  Download,
  Copy,
  ExternalLink,
  RefreshCw,
  X,
  Type,
  Palette,
  Clock,
  FileText,
  ShieldCheck,
  Check,
  Sparkles,
} from 'lucide-react'
import {
  fetchSiteArchive,
  createSiteArchive,
  type SiteOfflineArchive,
} from '@/lib/navhub-api'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { copyText } from '@/lib/clipboard'

interface SiteArchiveReaderModalProps {
  site: {
    id: string
    title: string
    url: string
    description?: string | null
  } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ReaderTheme = 'light' | 'sepia' | 'dark' | 'green'
type FontSize = 'sm' | 'base' | 'lg'
type FontFamily = 'sans' | 'serif' | 'mono'

export function SiteArchiveReaderModal({
  site,
  open,
  onOpenChange,
}: SiteArchiveReaderModalProps) {
  const [loading, setLoading] = useState(false)
  const [archive, setArchive] = useState<SiteOfflineArchive | null>(null)
  const [theme, setTheme] = useState<ReaderTheme>('light')
  const [fontSize, setFontSize] = useState<FontSize>('base')
  const [fontFamily, setFontFamily] = useState<FontFamily>('sans')
  const [copied, setCopied] = useState(false)

  // 加载离线文档快照
  const loadArchive = useCallback(
    async (forceRefresh = false) => {
      if (!site) return
      setLoading(true)
      try {
        let res: { ok: boolean; archive: SiteOfflineArchive }
        if (forceRefresh) {
          res = await createSiteArchive(site.id)
        } else {
          res = await fetchSiteArchive(site.id)
          if (!res.ok || !res.archive) {
            // 若尚无快照，自动触发首次生成
            res = await createSiteArchive(site.id)
          }
        }

        if (res.ok && res.archive) {
          setArchive(res.archive)
          try {
            if (typeof window !== 'undefined') {
              localStorage.setItem(`navhub:archive:${site.id}`, JSON.stringify(res.archive))
            }
          } catch {
            // ignore storage quota
          }
          if (forceRefresh) {
            toast.success('离线快照已重新抓取更新')
          }
        } else {
          toast.error('获取离线快照失败')
        }
      } catch {
        // 尝试从本地离线缓存恢复
        const cached = typeof window !== 'undefined' ? localStorage.getItem(`navhub:archive:${site.id}`) : null
        if (cached) {
          try {
            const parsed = JSON.parse(cached)
            setArchive(parsed)
            toast.info('已从本地离线缓存载入快照')
            return
          } catch {
            // ignore parse error
          }
        }
        toast.error('网络异常且无本地缓存，无法加载离线快照')
      } finally {
        setLoading(false)
      }
    },
    [site]
  )

  useEffect(() => {
    if (open && site) {
      loadArchive(false)
    } else {
      setArchive(null)
    }
  }, [open, site, loadArchive])

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  // SingleFile 离线文件下载 (.html)
  const handleDownloadSingleFile = () => {
    if (!archive) return
    const blob = new Blob([archive.htmlContent], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${archive.title.replace(/[\/\\?%*:|"<>]/g, '_')}_offline_archive.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('已下载 SingleFile 纯净离线 HTML 文档')
  }

  // 复制 Markdown 格式文本
  const handleCopyMarkdown = () => {
    if (!archive) return
    const md = `# ${archive.title}\n\n> 来源: ${archive.url}\n> 归档时间: ${new Date(
      archive.capturedAt
    ).toLocaleString()}\n\n${archive.plainText}`
    copyText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('已复制纯文本 Markdown 内容')
  }

  if (!open || !site) return null

  // 主题样式映射
  const themeClasses: Record<ReaderTheme, string> = {
    light: 'bg-white text-zinc-900 border-zinc-200',
    sepia: 'bg-[#fbf0d9] text-[#422e1b] border-[#e8d5b5]',
    dark: 'bg-zinc-950 text-zinc-100 border-zinc-800',
    green: 'bg-[#edf7ed] text-[#1e4620] border-[#c8e6c9]',
  }

  const fontSizeClasses: Record<FontSize, string> = {
    sm: 'text-sm leading-relaxed',
    base: 'text-base leading-relaxed',
    lg: 'text-lg leading-loose',
  }

  const fontFamilyClasses: Record<FontFamily, string> = {
    sans: 'font-sans',
    serif: 'font-serif',
    mono: 'font-mono',
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={() => onOpenChange(false)}
    >
      <div
        className={`relative flex flex-col w-full max-w-4xl h-[90vh] rounded-2xl border shadow-2xl overflow-hidden backdrop-blur-2xl transition-colors duration-300 ${themeClasses[theme]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-inherit bg-black/5 dark:bg-white/5 backdrop-blur-md">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h3 className="font-semibold text-xs sm:text-sm truncate max-w-[130px] min-[380px]:max-w-[180px] sm:max-w-md">
                  {archive?.title || site.title}
                </h3>
                <Badge variant="outline" className="text-[10px] py-0 shrink-0">
                  离线快照
                </Badge>
              </div>
              <p className="text-[10px] sm:text-[11px] opacity-60 font-mono truncate max-w-[150px] min-[380px]:max-w-[220px] sm:max-w-md">
                {site.url}
              </p>
            </div>
          </div>

          {/* 右侧排版与控制项 */}
          <div className="flex items-center gap-2">
            {/* 字号切换 */}
            <div className="hidden sm:flex items-center gap-1 p-0.5 rounded-lg bg-black/5 dark:bg-white/10">
              {(['sm', 'base', 'lg'] as FontSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  className={`px-2 py-1 rounded text-xs transition-all ${
                    fontSize === size
                      ? 'bg-white dark:bg-zinc-800 shadow-sm font-bold'
                      : 'opacity-60 hover:opacity-100'
                  }`}
                  aria-label={`切换为${size === 'sm' ? '小' : size === 'base' ? '中' : '大'}字号`}
                >
                  {size === 'sm' ? '小' : size === 'base' ? '中' : '大'}
                </button>
              ))}
            </div>

            {/* 字体切换 */}
            <div className="hidden sm:flex items-center gap-1 p-0.5 rounded-lg bg-black/5 dark:bg-white/10">
              {(['sans', 'serif', 'mono'] as FontFamily[]).map((fam) => (
                <button
                  key={fam}
                  onClick={() => setFontFamily(fam)}
                  className={`px-2 py-1 rounded text-xs transition-all ${
                    fontFamily === fam
                      ? 'bg-white dark:bg-zinc-800 shadow-sm font-semibold'
                      : 'opacity-60 hover:opacity-100'
                  }`}
                  aria-label={`切换为${fam === 'sans' ? '黑体' : fam === 'serif' ? '宋体' : '等宽'}字体`}
                >
                  {fam === 'sans' ? '黑体' : fam === 'serif' ? '宋体' : '等宽'}
                </button>
              ))}
            </div>

            {/* 配色切换 */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-black/5 dark:bg-white/10">
              <button
                onClick={() => setTheme('light')}
                aria-label="浅色模式"
                className={`w-5 h-5 rounded-full bg-white border border-zinc-300 shadow-sm ${
                  theme === 'light' ? 'ring-2 ring-indigo-500' : ''
                }`}
              />
              <button
                onClick={() => setTheme('sepia')}
                aria-label="羊皮纸护眼模式"
                className={`w-5 h-5 rounded-full bg-[#fbf0d9] border border-[#d8c4a0] shadow-sm ${
                  theme === 'sepia' ? 'ring-2 ring-amber-600' : ''
                }`}
              />
              <button
                onClick={() => setTheme('green')}
                aria-label="豆沙绿护眼模式"
                className={`w-5 h-5 rounded-full bg-[#c8e6c9] border border-[#a5d6a7] shadow-sm ${
                  theme === 'green' ? 'ring-2 ring-emerald-600' : ''
                }`}
              />
              <button
                onClick={() => setTheme('dark')}
                aria-label="极客暗夜模式"
                className={`w-5 h-5 rounded-full bg-zinc-950 border border-zinc-700 shadow-sm ${
                  theme === 'dark' ? 'ring-2 ring-indigo-400' : ''
                }`}
              />
            </div>

            {/* 关闭按钮 */}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              aria-label="关闭阅读器"
              className="w-8 h-8 rounded-lg ml-1"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* 状态统计条 */}
        {archive && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 sm:px-6 py-2 border-b border-inherit bg-black/[0.02] dark:bg-white/[0.02] text-xs opacity-75">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-[11px] sm:text-xs">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                预估阅读: {archive.readTimeMinutes} 分钟
              </span>
              <span className="hidden min-[380px]:inline">·</span>
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                字数容量: {archive.contentLength.toLocaleString()} 字符
              </span>
              <span className="hidden min-[480px]:inline">·</span>
              <span className="hidden min-[480px]:inline">
                归档时间: {new Date(archive.capturedAt).toLocaleTimeString()}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCopyMarkdown}
                aria-label="复制纯文本内容"
                className="h-7 text-xs rounded-md"
              >
                {copied ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                {copied ? '已复制' : '复制文本'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadSingleFile}
                aria-label="导出 SingleFile HTML 离线文档"
                className="h-7 text-xs rounded-md border-inherit"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                离线导出 (.html)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => loadArchive(true)}
                disabled={loading}
                aria-label="重新捕获快照"
                className="h-7 text-xs rounded-md"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        )}

        {/* 正文阅读区 */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-16 py-6 sm:py-8">
          {loading && !archive ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm font-medium">正在生成 Local-First 纯净离线快照...</p>
              <p className="text-xs opacity-60">去除页面杂质 · 提炼正文结构 · 离线资源打包</p>
            </div>
          ) : archive ? (
            <article
              className={`max-w-2xl mx-auto space-y-6 ${fontSizeClasses[fontSize]} ${fontFamilyClasses[fontFamily]}`}
            >
              <header className="border-b border-inherit pb-6 space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  {archive.title}
                </h1>
                {archive.meta?.description && (
                  <p className="text-sm opacity-80 italic">
                    {archive.meta.description}
                  </p>
                )}
                <div className="flex items-center gap-2 pt-2 text-xs opacity-60">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>NavHub 离线安全沙箱渲染</span>
                  <span>·</span>
                  <a
                    href={archive.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:underline text-indigo-500"
                  >
                    访问源页面
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </header>

              {/* 正文段落 */}
              <div className="prose dark:prose-invert max-w-none space-y-4">
                {archive.plainText.split('\n\n').map((paragraph, pIdx) => {
                  const trimmed = paragraph.trim()
                  if (!trimmed) return null
                  if (trimmed.startsWith('# ')) {
                    return <h2 key={pIdx} className="text-xl font-bold mt-6">{trimmed.slice(2)}</h2>
                  }
                  if (trimmed.startsWith('## ')) {
                    return <h3 key={pIdx} className="text-lg font-semibold mt-4">{trimmed.slice(3)}</h3>
                  }
                  return (
                    <p key={pIdx} className="leading-relaxed">
                      {trimmed}
                    </p>
                  )
                })}
              </div>
            </article>
          ) : (
            <div className="text-center py-20 opacity-60 text-sm">
              未能加载该站点的离线快照文档
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
