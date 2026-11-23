'use client'

/**
 * 我的批注总览（/me/annotations）：全部划线批注按收藏聚合。
 *
 * - 搜索框搜批注全文（划线原文 + 批注文字），命中按收藏分组，显示命中上下文
 *   与原收藏链接——搜批注文字能找到原收藏。
 * - 导出全部批注为 Markdown / JSON，入口在页头；空状态说清用法与入口。
 * - 存储不可用时显示错误状态，不假装列表为空。
 * - 批注只存本机浏览器（localStorage），不登录、不上传。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/ui/empty-state'
import { Footer } from '@/components/footer'
import {
  annotationExportFilename,
  deleteAnnotation,
  exportAnnotationsToJson,
  exportAnnotationsToMarkdown,
  groupAnnotationsBySave,
  isAnnotationStorageCorrupted,
  loadAnnotations,
  searchAnnotations,
  updateAnnotationNote,
  ANNOTATION_STORE_EVENT,
  MAX_NOTE_LENGTH,
  type SaveAnnotation,
} from '@/lib/save-annotations'
import { triggerFileDownload } from '@/lib/favorites-export-import'
import { Highlighter, Search } from 'lucide-react'

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
  } catch {
    return ''
  }
}

/** 带命中高亮的上下文片段：命中词加粗，其余照常。 */
function ContextSnippet({ context, matchStart, matchEnd }: { context: string; matchStart: number; matchEnd: number }) {
  const before = context.slice(0, matchStart)
  const hit = context.slice(matchStart, matchEnd)
  const after = context.slice(matchEnd)
  return (
    <span>
      {before}
      <mark className="bg-yellow-200 dark:bg-yellow-900/60 text-foreground rounded px-0.5">{hit}</mark>
      {after}
    </span>
  )
}

export default function MyAnnotationsPage() {
  const [annotations, setAnnotations] = useState<SaveAnnotation[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  /** 每条「编辑」按钮的 ref：Esc/取消关闭编辑后把焦点还给它。 */
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())
  /** 待还焦点的编辑按钮 id：编辑器卸载后（按钮重新挂载）再 focus。 */
  const pendingEditFocusId = useRef<string | null>(null)

  /** 取消编辑并把焦点还给该条的「编辑」按钮。 */
  const cancelEdit = useCallback((id: string) => {
    pendingEditFocusId.current = id
    setEditingId(null)
  }, [])

  useEffect(() => {
    if (editingId === null && pendingEditFocusId.current) {
      const id = pendingEditFocusId.current
      pendingEditFocusId.current = null
      editButtonRefs.current.get(id)?.focus()
    }
  }, [editingId])

  /** 清空搜索并把焦点放回搜索框。 */
  const clearSearch = useCallback(() => {
    setQuery('')
    searchInputRef.current?.focus()
  }, [])

  const reload = useCallback(() => {
    try {
      // loadAnnotations 损坏时返回 [] 不抛错，所以先用检测函数判损坏，
      // 否则损坏会被误显示为空列表（且写路径已拒写，不会覆盖旧数据）。
      if (isAnnotationStorageCorrupted()) {
        setAnnotations([])
        setLoadError('批注存储已损坏：已保存的批注暂时读不出来，未被删除。请先不要清空浏览器数据，换个浏览器或恢复备份后再试。')
        return
      }
      setAnnotations(loadAnnotations())
      setLoadError(null)
    } catch {
      setAnnotations([])
      setLoadError('批注读取失败：浏览器存储不可用，刷新页面后重试。已保存的批注不会因此被删除。')
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    window.addEventListener(ANNOTATION_STORE_EVENT, reload)
    return () => window.removeEventListener(ANNOTATION_STORE_EVENT, reload)
  }, [reload])

  const groups = useMemo(() => groupAnnotationsBySave(annotations), [annotations])
  const searchGroups = useMemo(
    () => (query.trim() ? searchAnnotations(annotations, query) : null),
    [annotations, query],
  )
  const totalHits = useMemo(
    () => (searchGroups ? searchGroups.reduce((n, g) => n + g.hits.length, 0) : 0),
    [searchGroups],
  )

  const exportAll = (kind: 'md' | 'json') => {
    if (annotations.length === 0) return
    try {
      const content =
        kind === 'md' ? exportAnnotationsToMarkdown(annotations) : exportAnnotationsToJson(annotations)
      triggerFileDownload(content, annotationExportFilename(kind), kind === 'md' ? 'text/markdown' : 'application/json')
      setNotice(kind === 'md' ? '已导出全部批注为 Markdown' : '已导出全部批注为 JSON')
    } catch {
      setActionError('导出失败：浏览器阻止了文件下载，请检查下载权限后重试')
    }
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

  return (
    <Container as="main" id="main-content" className="py-6 sm:py-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">我的批注</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
            在收藏的标题或简介上划过的线、写下的批注都在这里，按收藏聚合；只保存在本机浏览器。
          </p>
        </div>
        {annotations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => exportAll('md')}
              className="min-h-11 text-xs px-3 cursor-pointer"
            >
              导出全部 Markdown
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => exportAll('json')}
              className="min-h-11 text-xs px-3 cursor-pointer"
            >
              导出全部 JSON
            </Button>
          </div>
        )}
      </div>

      {loadError ? (
        <p role="alert" className="text-sm text-destructive-text leading-relaxed">
          {loadError}
        </p>
      ) : (
        <>
          <div>
            <label htmlFor="annotations-search" className="sr-only">
              搜索批注
            </label>
            <Input
              id="annotations-search"
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜批注文字，例如：免费、导出、流程图"
              className="min-h-11"
              aria-label="搜索批注全文"
            />
            {query.trim() && (
              <p role="status" className="text-xs text-muted-foreground mt-2">
                {totalHits > 0
                  ? `找到 ${totalHits} 条批注，分布在 ${searchGroups?.length ?? 0} 个收藏`
                  : '没有命中的批注，换个词试试（搜的是划线原文和批注文字）'}
              </p>
            )}
          </div>

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
              description="打开任意收藏的详情页，在标题或简介里选中一句话，点「划线批注」写下当时为什么存它——下次打开就不用凭记忆猜了。"
              action={
                <Button asChild size="sm" variant="outline" className="text-xs min-h-11">
                  <Link href="/favorites">去收藏页</Link>
                </Button>
              }
            />
          ) : searchGroups !== null && searchGroups.length === 0 ? (
            <EmptyState
              icon={Search}
              iconTone="muted"
              title="没有命中的批注"
              description="搜的是划线原文和批注文字；试试换个词，或清空搜索框查看全部批注。"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearSearch}
                  className="min-h-11 text-xs px-3 cursor-pointer"
                >
                  清空搜索
                </Button>
              }
            />
          ) : searchGroups !== null ? (
            <div className="space-y-4">
              {searchGroups.map((g) => (
                <section key={g.siteId} aria-label={`收藏：${g.siteTitle}`} className="rounded-xl border border-border/70 bg-card/60 px-3.5 py-3 space-y-2.5">
                  <h2 className="text-sm font-bold">
                    <Link href={`/site/${encodeURIComponent(g.siteId)}`} className="min-h-11 inline-flex items-center hover:text-primary hover:underline">
                      {g.siteTitle || g.siteId}
                    </Link>
                  </h2>
                  <ul className="space-y-2">
                    {g.hits.map((hit) => (
                      <li key={hit.annotation.id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {hit.field === 'quote' ? '命中划线原文' : '命中批注文字'} · {formatDate(hit.annotation.createdAt)}
                        </p>
                        <p className="text-xs sm:text-sm leading-relaxed">
                          <ContextSnippet context={hit.context} matchStart={hit.matchStart} matchEnd={hit.matchEnd} />
                        </p>
                        {editingId === hit.annotation.id ? (
                          <div className="space-y-2">
                            <label htmlFor={`edit-note-${hit.annotation.id}`} className="sr-only">
                              编辑批注
                            </label>
                            <Textarea
                              id={`edit-note-${hit.annotation.id}`}
                              value={editingNote}
                              maxLength={MAX_NOTE_LENGTH}
                              rows={3}
                              onChange={(e) => setEditingNote(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') cancelEdit(hit.annotation.id)
                              }}
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" onClick={() => saveEdit(hit.annotation.id)} className="min-h-11 text-xs px-4 cursor-pointer">
                                保存修改
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => cancelEdit(hit.annotation.id)}
                                className="min-h-11 text-xs px-4 cursor-pointer"
                              >
                                取消
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              划线：{hit.annotation.quote}
                              {hit.annotation.note ? ` ｜ 批注：${hit.annotation.note}` : ''}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                ref={(el) => {
                                  editButtonRefs.current.set(hit.annotation.id, el)
                                }}
                                onClick={() => {
                                  setEditingId(hit.annotation.id)
                                  setEditingNote(hit.annotation.note)
                                  setActionError(null)
                                }}
                                className="min-h-11 text-xs px-3 cursor-pointer"
                                aria-label={`编辑批注：${hit.annotation.quote.slice(0, 20)}`}
                              >
                                编辑
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeAnnotation(hit.annotation.id)}
                                className="min-h-11 text-xs px-3 text-destructive-text hover:text-destructive-text cursor-pointer"
                                aria-label={`删除批注：${hit.annotation.quote.slice(0, 20)}`}
                              >
                                删除
                              </Button>
                            </div>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <section key={g.siteId} aria-label={`收藏：${g.siteTitle}`} className="rounded-xl border border-border/70 bg-card/60 px-3.5 py-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-bold">
                      <Link href={`/site/${encodeURIComponent(g.siteId)}`} className="min-h-11 inline-flex items-center hover:text-primary hover:underline">
                        {g.siteTitle || g.siteId}
                      </Link>
                    </h2>
                    <span className="text-xs text-muted-foreground">{g.items.length} 条批注</span>
                  </div>
                  <ul className="space-y-2">
                    {g.items.map((a) => (
                      <li key={a.id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 space-y-1.5">
                        <blockquote className="text-xs sm:text-sm leading-relaxed border-l-2 border-primary/60 pl-3">
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
                                  editButtonRefs.current.set(a.id, el)
                                }}
                                onClick={() => {
                                  setEditingId(a.id)
                                  setEditingNote(a.note)
                                  setActionError(null)
                                }}
                                className="min-h-11 text-xs px-3 cursor-pointer"
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
                </section>
              ))}
            </div>
          )}
        </>
      )}
      <Footer />
    </Container>
  )
}
