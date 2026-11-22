'use client'

/**
 * 收藏划线批注面板（SaveAnnotationPanel）：挂在站点详情页的阅读区。
 *
 * 交互：
 * - 阅读区只渲染本地已有的真实文本：标题 + 简介。没有简介时只对标题划线，
 *   并明说「无简介正文」；不抓取、不编造站外正文。
 * - 选中文字后出现划线入口：鼠标用户看到跟随选区的浮动按钮，键盘用户用
 *   Tab 走到阅读区下方常驻的「划线选中的文字」按钮（选中 Shift+方向键选区后
 *   可达；未选中时按钮仍可聚焦可点，点后提示先选中文字）。
 * - 编辑器是行内表单（非弹窗）：Esc 取消并把焦点还给触发按钮；保存失败
 *   显示原因，不静默丢数据。
 * - 批注列表按本收藏聚合，支持改批注文字、删除；导出本收藏的批注为
 *   Markdown / JSON；无批注时空状态说清用法。
 * - 存储失败（localStorage 损坏或写满）显示错误状态，不假装保存成功。
 * - 全部可点控件 min-h-11（44px），移动端可用。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Highlighter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/ui/empty-state'
import {
  addAnnotation,
  annotationExportFilename,
  deleteAnnotation,
  exportAnnotationsToJson,
  exportAnnotationsToMarkdown,
  isAnnotationStorageCorrupted,
  loadAnnotationsForSave,
  resolveQuoteSource,
  updateAnnotationNote,
  ANNOTATION_STORE_EVENT,
  MAX_NOTE_LENGTH,
  type SaveAnnotation,
} from '@/lib/save-annotations'
import { triggerFileDownload } from '@/lib/favorites-export-import'
import { cn } from '@/lib/utils'

export interface SaveAnnotationPanelProps {
  siteId: string
  siteTitle: string
  siteUrl: string
  description?: string
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function SaveAnnotationPanel({ siteId, siteTitle, siteUrl, description }: SaveAnnotationPanelProps) {
  const [annotations, setAnnotations] = useState<SaveAnnotation[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState('')
  const [floating, setFloating] = useState<{ x: number; y: number } | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const readingRef = useRef<HTMLDivElement>(null)
  const highlightButtonRef = useRef<HTMLButtonElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  // 行内编辑的「编辑」按钮：编辑时按钮卸载，取消/Esc 后重新挂载才可聚焦，
  // 用 ref map 存每条的按钮 + 待回焦 id，挂载后在 effect 里还焦点。
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingEditFocusRef = useRef<string | null>(null)

  const reload = useCallback(() => {
    try {
      // loadAnnotations 损坏时返回 [] 不抛错，所以先用检测函数判损坏，
      // 否则损坏会被误显示为空列表（且写路径已拒写，不会覆盖旧数据）。
      if (isAnnotationStorageCorrupted()) {
        setAnnotations([])
        setLoadError('批注存储已损坏：已保存的批注暂时读不出来，未被删除。请先不要清空浏览器数据，换个浏览器或恢复备份后再试。')
        return
      }
      setAnnotations(loadAnnotationsForSave(siteId))
      setLoadError(null)
    } catch {
      setAnnotations([])
      setLoadError('批注读取失败：浏览器存储不可用，刷新页面后重试。已保存的批注不会因此被删除。')
    }
  }, [siteId])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    window.addEventListener(ANNOTATION_STORE_EVENT, reload)
    return () => window.removeEventListener(ANNOTATION_STORE_EVENT, reload)
  }, [reload])

  /** 读当前选区：只认阅读区内的选区，且文字必须来自标题或简介。 */
  const readSelection = useCallback((): string => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return ''
    const text = sel.toString().trim()
    if (!text) return ''
    const anchor = sel.anchorNode
    if (!anchor || !readingRef.current?.contains(anchor)) return ''
    const source = resolveQuoteSource(text, siteTitle, description)
    return source ? text : ''
  }, [siteTitle, description])

  const refreshSelection = useCallback(() => {
    const text = readSelection()
    setSelection(text)
    if (!text) {
      setFloating(null)
      return
    }
    // 鼠标选区：浮动按钮跟在选区右下角；键盘选区没有可靠坐标，只用常驻按钮。
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (rect.width > 0 || rect.height > 0) {
        // 浮动按钮是 position:fixed（视口坐标），直接用 rect 的视口坐标，不加 scroll 偏移。
        // 纵向钳制到视口内：贴底选区不让按钮出视口。
        setFloating({
          x: Math.max(8, Math.min(rect.left, window.innerWidth - 140)),
          y: Math.min(rect.bottom + 8, window.innerHeight - 60),
        })
      }
    }
  }, [readSelection])

  useEffect(() => {
    document.addEventListener('selectionchange', refreshSelection)
    return () => document.removeEventListener('selectionchange', refreshSelection)
  }, [refreshSelection])

  const openEditor = useCallback(() => {
    // 编辑器已打开时再点常驻按钮不重置草稿（按钮不再禁用，须防误删）。
    if (editorOpen) return
    const text = readSelection()
    if (!text) {
      setFormError('请先在上方的标题或简介里选中一段文字再划线')
      return
    }
    setSelection(text)
    setNote('')
    setFormError(null)
    setEditorOpen(true)
  }, [readSelection, editorOpen])

  useEffect(() => {
    if (editorOpen) noteRef.current?.focus()
  }, [editorOpen])

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setFormError(null)
    setFloating(null)
    // 清掉选区，避免浮动按钮残留；焦点还给常驻划线按钮。
    window.getSelection()?.removeAllRanges()
    setSelection('')
    highlightButtonRef.current?.focus()
  }, [])

  /** 行内编辑取消/Esc：记下要回焦的条目，等编辑按钮重新挂载后还焦点。 */
  const cancelEdit = useCallback((id: string) => {
    pendingEditFocusRef.current = id
    setEditingId(null)
  }, [])

  useEffect(() => {
    if (editingId === null && pendingEditFocusRef.current) {
      const id = pendingEditFocusRef.current
      pendingEditFocusRef.current = null
      editButtonRefs.current.get(id)?.focus()
    }
  }, [editingId])

  const saveAnnotation = () => {
    const source = resolveQuoteSource(selection, siteTitle, description)
    if (!source) {
      setFormError('划线文字不在当前标题或简介里，请重新选中')
      return
    }
    const sourceText = source === 'title' ? siteTitle : (description ?? '')
    const result = addAnnotation({
      siteId,
      siteTitle,
      siteUrl,
      quote: selection,
      source,
      note,
      sourceText,
    })
    if (!result.ok || !result.annotation) {
      setFormError(result.error ?? '批注保存失败，请重试')
      return
    }
    setEditorOpen(false)
    setNote('')
    setFormError(null)
    setNotice('已保存划线批注')
    window.getSelection()?.removeAllRanges()
    setSelection('')
    setFloating(null)
    reload()
  }

  const saveEdit = (id: string) => {
    const result = updateAnnotationNote(id, editingNote)
    if (!result.ok) {
      setActionError(result.error ?? '批注修改失败')
      return
    }
    setEditingId(null)
    setActionError(null)
    setNotice('批注已更新')
    reload()
  }

  const removeAnnotation = (id: string) => {
    if (!deleteAnnotation(id)) {
      setActionError('删除失败：这条批注已不存在或存储不可用')
      return
    }
    setActionError(null)
    setNotice('批注已删除')
    reload()
  }

  const exportForSave = (kind: 'md' | 'json') => {
    if (annotations.length === 0) return
    try {
      const content =
        kind === 'md' ? exportAnnotationsToMarkdown(annotations) : exportAnnotationsToJson(annotations)
      triggerFileDownload(content, annotationExportFilename(kind), kind === 'md' ? 'text/markdown' : 'application/json')
      setNotice(kind === 'md' ? '已导出 Markdown' : '已导出 JSON')
    } catch {
      setActionError('导出失败：浏览器阻止了文件下载，请检查下载权限后重试')
    }
  }

  const hasReadableText = Boolean(siteTitle.trim() || description?.trim())

  return (
    <section
      aria-labelledby="save-annotations-heading"
      className="rounded-xl border border-border/70 bg-card/60 px-3.5 py-3 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="save-annotations-heading" className="text-sm font-bold text-foreground">
          划线批注{annotations.length > 0 ? `（${annotations.length} 条）` : ''}
        </h2>
        <Link href="/me/annotations" className="text-xs text-primary hover:underline min-h-11 inline-flex items-center px-2">
          查看全部批注
        </Link>
      </div>

      {loadError ? (
        <p role="alert" className="text-xs sm:text-sm text-destructive-text leading-relaxed">
          {loadError}
        </p>
      ) : (
        <>
          {/* 阅读区：只含本地已有的标题 / 简介；无简介时明说只对标题划线。 */}
          <div ref={readingRef} className="rounded-lg border border-border/50 bg-background/60 px-3 py-3 space-y-2">
            <p className="text-sm font-semibold text-foreground leading-relaxed">{siteTitle}</p>
            {description ? (
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{description}</p>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                这个收藏没有简介正文，只能对标题划线；正文在原站打开阅读，不从站外抓取。
              </p>
            )}
            {!hasReadableText && (
              <p className="text-xs text-muted-foreground leading-relaxed">无正文可划线。</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            选中上方一段文字，点「划线批注」写下当时为什么存它、哪句有用；批注只保存在本机浏览器。
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={highlightButtonRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={openEditor}
              className="min-h-11 text-xs px-3 gap-1.5 font-medium cursor-pointer"
              aria-label={selection ? `为选中的文字添加划线批注：${selection.slice(0, 20)}` : '划线选中的文字（请先选中标题或简介里的一段文字）'}
            >
              划线选中的文字
            </Button>
            {annotations.length > 0 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => exportForSave('md')}
                  className="min-h-11 text-xs px-3 gap-1.5 font-medium cursor-pointer"
                >
                  导出 Markdown
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => exportForSave('json')}
                  className="min-h-11 text-xs px-3 gap-1.5 font-medium cursor-pointer"
                >
                  导出 JSON
                </Button>
              </>
            )}
          </div>

          {/* 鼠标选区后的浮动入口：只在有选区且编辑器未打开时出现。 */}
          {floating && selection && !editorOpen && (
            <button
              type="button"
              onClick={openEditor}
              className="fixed z-50 min-h-11 px-4 rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow-lg cursor-pointer"
              style={{ left: floating.x, top: floating.y }}
            >
              划线批注
            </button>
          )}

          {editorOpen && (
            <div
              className="rounded-lg border border-border/60 bg-background/70 px-3 py-3 space-y-2.5"
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeEditor()
              }}
            >
              <p className="text-xs text-muted-foreground">划线原文</p>
              <blockquote className="text-xs sm:text-sm leading-relaxed border-l-2 border-primary/60 pl-3 text-foreground">
                {selection}
              </blockquote>
              <label htmlFor="save-annotation-note" className="text-xs font-medium text-foreground block">
                批注（为什么存它、哪句有用；可留空，只划线也行）
              </label>
              <Textarea
                id="save-annotation-note"
                ref={noteRef}
                value={note}
                maxLength={MAX_NOTE_LENGTH}
                rows={3}
                placeholder="例如：当时想找一个免费的流程图工具，这句提到支持导出 PNG"
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeEditor()
                }}
              />
              <p className="text-xs text-muted-foreground text-right">{note.length}/{MAX_NOTE_LENGTH}</p>
              {formError && (
                <p role="alert" className="text-xs text-destructive-text leading-relaxed">
                  {formError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={saveAnnotation} className="min-h-11 text-xs px-4 cursor-pointer">
                  保存批注
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeEditor}
                  className="min-h-11 text-xs px-4 cursor-pointer"
                >
                  取消（Esc）
                </Button>
              </div>
            </div>
          )}

          {notice && (
            <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
              {notice}
            </p>
          )}
          {actionError && (
            <p role="alert" className="text-xs text-destructive-text leading-relaxed">
              {actionError}
            </p>
          )}

          {annotations.length === 0 ? (
            <EmptyState
              icon={Highlighter}
              title="还没有划线批注"
              description="选中上方标题或简介里的一句话，写下当时为什么存这个收藏——两周后再打开，就不用凭记忆猜了。"
            />
          ) : (
            <ul className="space-y-2.5">
              {annotations.map((a) => (
                <li key={a.id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 space-y-1.5">
                  <blockquote className="text-xs sm:text-sm leading-relaxed border-l-2 border-primary/60 pl-3 text-foreground">
                    {a.quote}
                  </blockquote>
                  {editingId === a.id ? (
                    <div className="space-y-2">
                      <label htmlFor={`edit-note-${a.id}`} className="sr-only">
                        编辑批注
                      </label>
                      <Textarea
                        id={`edit-note-${a.id}`}
                        value={editingNote}
                        maxLength={MAX_NOTE_LENGTH}
                        rows={3}
                        onChange={(e) => setEditingNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') cancelEdit(a.id)
                        }}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={() => saveEdit(a.id)} className="min-h-11 text-xs px-4 cursor-pointer">
                          保存修改
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => cancelEdit(a.id)}
                          className="min-h-11 text-xs px-4 cursor-pointer"
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {a.note ? (
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{a.note}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">（只划了线，未写批注）</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(a.createdAt)}
                          {a.source === 'description' ? ' · 划自简介' : ' · 划自标题'}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          ref={(el) => {
                            if (el) editButtonRefs.current.set(a.id, el)
                            else editButtonRefs.current.delete(a.id)
                          }}
                          onClick={() => {
                            setEditingId(a.id)
                            setEditingNote(a.note)
                            setActionError(null)
                          }}
                          className={cn('min-h-11 text-xs px-3 cursor-pointer')}
                          aria-label={`编辑批注：${a.quote.slice(0, 20)}`}
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAnnotation(a.id)}
                          className="min-h-11 text-xs px-3 text-destructive-text hover:text-destructive-text cursor-pointer"
                          aria-label={`删除批注：${a.quote.slice(0, 20)}`}
                        >
                          删除
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
