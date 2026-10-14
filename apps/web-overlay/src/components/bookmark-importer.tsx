'use client'

import { useState } from 'react'
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
  suggestedCategory: string
  selected: boolean
}

const CATEGORY_OPTIONS = [
  { id: 'cat-ai', label: '🤖 AI 工具' },
  { id: 'cat-dev', label: '💻 开发运维' },
  { id: 'cat-design', label: '🎨 设计资源' },
  { id: 'cat-learn', label: '📚 学习教育' },
  { id: 'cat-life', label: '☕ 生活服务' },
]

export function BookmarkImporter() {
  const [bookmarks, setBookmarks] = useState<ParsedBookmark[]>([])
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; failed: number; duplicate: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

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

    // 分批次调用中枢创建接口
    for (const b of toImport) {
      try {
        const res = await fetch('/api/hub/sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: b.url,
            title: b.title,
            categoryId: b.suggestedCategory,
            source: 'bookmark-import',
          }),
        })
        if (res.ok) {
          successCount++
        } else if (res.status === 409) {
          duplicateCount++
        } else {
          failedCount++
        }
      } catch {
        failedCount++
      }
    }

    setImportResult({ success: successCount, failed: failedCount, duplicate: duplicateCount })
    setIsImporting(false)
  }

  const selectedCount = bookmarks.filter((b) => b.selected).length

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* 顶部 Hero 展板 */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 p-6 sm:p-8 glass-surface subtle-mesh shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Link href="/">
                <Button variant="ghost" size="sm" className="h-7 px-2.5 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-background/80 border border-border/50 gap-1.5 transition-all">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回主页</span>
                </Button>
              </Link>
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
        <CardContent className="p-6 space-y-5">
          {/* 上传拖拽区 */}
          <div className="relative group border-2 border-dashed border-border/80 hover:border-primary/60 rounded-2xl p-8 sm:p-10 text-center transition-all duration-300 bg-muted/20 hover:bg-primary/5 cursor-pointer">
            <input
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
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle className="w-4 h-4" />
                <span>导入完成！</span>
              </div>
              <p>
                成功收录 {importResult.success} 个站点
                {importResult.duplicate > 0 ? `，已存在跳过 ${importResult.duplicate} 个` : ''}
                {importResult.failed > 0 ? `，失败 ${importResult.failed} 个` : ''}。
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
                <div className="flex items-center gap-2">
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
                  <div key={b.id} className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={b.selected}
                      onChange={() => toggleSelect(b.id)}
                      className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground truncate">{b.title}</span>
                        {b.folder && (
                          <span className="text-xs text-muted-foreground bg-muted/80 px-2 py-0.5 rounded font-mono truncate max-w-[120px]">
                            {b.folder}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground/80 truncate font-mono">{b.url}</p>
                    </div>
                    <select
                      value={b.suggestedCategory}
                      onChange={(e) => {
                        const val = e.target.value
                        setBookmarks((prev) =>
                          prev.map((item) => (item.id === b.id ? { ...item, suggestedCategory: val } : item))
                        )
                      }}
                      className="bg-background border border-border/70 rounded-lg px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary shrink-0"
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
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

    const suggestedCategory = guessCategory(title, url, folderName)

    results.push({
      id: `bm-${idx++}`,
      title,
      url,
      folder: folderName,
      suggestedCategory,
      selected: true,
    })
  }

  return results
}

function guessCategory(title: string, url: string, folder?: string): string {
  const text = `${title} ${url} ${folder || ''}`.toLowerCase()

  if (text.includes('ai') || text.includes('gpt') || text.includes('智能') || text.includes('model') || text.includes('claude') || text.includes('chat') || text.includes('bot') || text.includes('llm')) {
    return 'cat-ai'
  }
  if (text.includes('设计') || text.includes('ui') || text.includes('图') || text.includes('icon') || text.includes('figma') || text.includes('photo') || text.includes('color') || text.includes('font') || text.includes('字体')) {
    return 'cat-design'
  }
  if (text.includes('学习') || text.includes('doc') || text.includes('教程') || text.includes('文档') || text.includes('课程') || text.includes('百科') || text.includes('书') || text.includes('learn') || text.includes('edu') || text.includes('笔记')) {
    return 'cat-learn'
  }
  if (text.includes('生活') || text.includes('购物') || text.includes('天气') || text.includes('地图') || text.includes('旅游') || text.includes('音乐') || text.includes('视频') || text.includes('电影') || text.includes('health') || text.includes('出行')) {
    return 'cat-life'
  }
  return 'cat-dev'
}
