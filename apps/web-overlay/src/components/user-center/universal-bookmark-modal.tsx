'use client'

import { useState, useRef, useMemo, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  parseUniversalBookmarks,
  type ParsedUniversalItem,
  type ParseResult,
} from '@/lib/favorites-export-import'
import {
  Upload,
  FileText,
  FileCode,
  Folder,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react'

export interface UniversalBookmarkModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingHrefs: Set<string>
  onImportItems: (
    items: ParsedUniversalItem[],
    options: { createFolders: boolean; skipDuplicates: boolean },
  ) => Promise<{ imported: number; skipped: number; foldersCreated: number }>
}

export function UniversalBookmarkModal({
  open,
  onOpenChange,
  existingHrefs,
  onImportItems,
}: UniversalBookmarkModalProps) {
  const [activeTab, setActiveTab] = useState<'file' | 'text'>('file')
  const [rawText, setRawText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [createFolders, setCreateFolders] = useState(true)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [busy, setBusy] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleProcessContent = useCallback((content: string, name?: string) => {
    if (name) setFileName(name)
    const res = parseUniversalBookmarks(content)
    setParseResult(res)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (text) {
        handleProcessContent(text, file.name)
      }
    }
    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (text) {
        handleProcessContent(text, file.name)
      }
    }
    reader.readAsText(file)
  }

  const handleReset = () => {
    setParseResult(null)
    setFileName(null)
    setRawText('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleExecuteImport = async () => {
    if (!parseResult || parseResult.items.length === 0) return
    setBusy(true)
    try {
      await onImportItems(parseResult.items, {
        createFolders,
        skipDuplicates,
      })
      onOpenChange(false)
      handleReset()
    } finally {
      setBusy(false)
    }
  }

  // 计算重复条数
  const duplicateCount = useMemo(() => {
    if (!parseResult) return 0
    return parseResult.items.filter((item) => existingHrefs.has(item.href)).length
  }, [parseResult, existingHrefs])

  const formatLabel = useMemo(() => {
    if (!parseResult) return ''
    switch (parseResult.format) {
      case 'html':
        return 'Netscape HTML 浏览器书签'
      case 'markdown':
        return 'Markdown 结构化文档'
      case 'onetab':
        return 'OneTab / 纯文本链接表'
      case 'json':
        return 'JSON 书签数据'
      default:
        return '未知格式'
    }
  }, [parseResult])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-5 sm:p-6">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Upload className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <span>导入外部书签与导航数据</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            支持 Chrome、Edge、Safari、Firefox 导出的 <code>bookmarks.html</code>，或 Notion/Obsidian Markdown 清单。
          </DialogDescription>
        </DialogHeader>

        {/* 顶部标签切换 */}
        {!parseResult && (
          <div className="flex border-b border-border/70 gap-4 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('file')}
              className={`pb-2 border-b-2 transition-colors ${
                activeTab === 'file'
                  ? 'border-emerald-600 text-foreground font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              上传书签文件 (.html / .md / .txt / .json)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('text')}
              className={`pb-2 border-b-2 transition-colors ${
                activeTab === 'text'
                  ? 'border-emerald-600 text-foreground font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              粘贴文本内容
            </button>
          </div>
        )}

        {/* 上传区域 */}
        {!parseResult ? (
          activeTab === 'file' ? (
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragOver(true)
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
                isDragOver
                  ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20'
                  : 'border-border/70 hover:border-emerald-500/60 bg-muted/20 hover:bg-muted/30'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,.md,.txt,.json"
                className="hidden"
                aria-label="上传书签文件"
                onChange={handleFileChange}
              />
              <div className="flex flex-col items-center justify-center gap-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                  <FileCode className="w-6 h-6" />
                </div>
                <div className="text-sm font-semibold text-foreground">
                  点击选择文件，或将书签文件拖放至此处
                </div>
                <div className="text-xs text-muted-foreground max-w-sm">
                  从 Chrome/Edge 等浏览器通过「书签管理器 → 导出书签」获得的 HTML 文件可直接拖入
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={`在此粘贴书签 HTML、Markdown 链接（- [标题](URL)）或 OneTab 纯文本链接...`}
                aria-label="粘贴书签内容"
                className="w-full h-36 rounded-lg border border-border/70 bg-background p-2.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                  disabled={!rawText.trim()}
                  onClick={() => handleProcessContent(rawText, '剪贴板内容')}
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1" />
                  解析文本
                </Button>
              </div>
            </div>
          )
        ) : (
          /* 解析结果确认区 */
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
                  <span className="text-sm font-semibold text-foreground">
                    解析成功：识别到 {parseResult.items.length} 个书签
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleReset}
                >
                  重新选择
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded-md bg-background/80 border border-border/60 text-muted-foreground">
                  格式：{formatLabel}
                </span>
                {fileName && (
                  <span className="px-2 py-0.5 rounded-md bg-background/80 border border-border/60 text-muted-foreground truncate max-w-[200px]">
                    来源：{fileName}
                  </span>
                )}
                {parseResult.detectedFolders.length > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-background/80 border border-border/60 text-muted-foreground">
                    发现 {parseResult.detectedFolders.length} 个文件夹
                  </span>
                )}
                {duplicateCount > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                    与现有收藏重复：{duplicateCount} 条
                  </span>
                )}
              </div>

              {/* 识别到的文件夹清单预览 */}
              {parseResult.detectedFolders.length > 0 && (
                <div className="pt-2 border-t border-emerald-500/20">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Folder className="w-3.5 h-3.5" />
                    <span>检测到的文件夹分类：</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                    {parseResult.detectedFolders.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-background/90 border border-border/70 text-foreground"
                      >
                        📂 {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 导入选项 */}
            <div className="space-y-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createFolders}
                  onChange={(e) => setCreateFolders(e.target.checked)}
                  className="rounded border-border text-emerald-700 focus:ring-emerald-500"
                />
                <span className="text-foreground">自动同步创建对应的收藏夹/分类并归类</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  className="rounded border-border text-emerald-700 focus:ring-emerald-500"
                />
                <span className="text-foreground">跳过已存在的相同网址（避免重复）</span>
              </label>
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy} className="text-xs">
                取消
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                disabled={busy || parseResult.items.length === 0}
                onClick={handleExecuteImport}
              >
                {busy && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                确认导入 ({parseResult.items.length - (skipDuplicates ? duplicateCount : 0)} 项)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
