'use client'

/**
 * 打包成链接包对话框（收藏页批量栏入口）。
 *
 * 生成的是快照：标题/备注/每站一句话用途在生成那一刻冻结进链接，
 * 之后原收藏怎么变，已发出的包都不变；对话框里把这点、20 条上限、
 * 4KB 长度上限都明说，超限时给「只打包前 20 个」的分包出口。
 *
 * 生成后内容一改，链接即过期（ stale 提示 + 重新生成），不让用户
 * 把一条「改过之后」的旧链接发出去。
 */

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyText } from '@/lib/clipboard'
import {
  LINK_PACK_ITEM_PURPOSE_MAX,
  LINK_PACK_MAX_ITEMS,
  LINK_PACK_NOTE_MAX,
  LINK_PACK_TITLE_MAX,
  buildLinkPack,
  type LinkPackItemInput,
} from '@/lib/link-pack'
import { CheckCircle2, Copy, ExternalLink, Link2 } from 'lucide-react'

export interface LinkPackDialogProps {
  open: boolean
  /** 已选中的收藏（调用方从 LocalFavorite 映射：purpose 默认取简介/备注） */
  items: LinkPackItemInput[]
  onClose: () => void
}

export function LinkPackDialog({ open, items, onClose }: LinkPackDialogProps) {
  const [title, setTitle] = useState('我的链接包')
  const [note, setNote] = useState('')
  const [purposes, setPurposes] = useState<string[]>(() => items.map((i) => i.purpose ?? ''))
  const [takeFirst20, setTakeFirst20] = useState(false)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [buildNotes, setBuildNotes] = useState<string[]>([])
  const [copyNote, setCopyNote] = useState<string | null>(null)
  const [copyOk, setCopyOk] = useState(false)

  const overLimit = items.length > LINK_PACK_MAX_ITEMS
  const effectiveItems = useMemo(
    () => (overLimit && takeFirst20 ? items.slice(0, LINK_PACK_MAX_ITEMS) : items),
    [items, overLimit, takeFirst20],
  )
  const canGenerate = items.length > 0 && (!overLimit || takeFirst20)

  /** 生成后任何编辑都让旧链接失效：不让用户发出一条「改过之后」的链接 */
  const markDirty = () => {
    setGeneratedUrl(null)
    setBuildNotes([])
    setCopyNote(null)
    setCopyOk(false)
  }

  const handleGenerate = () => {
    setBuildError(null)
    setCopyNote(null)
    setCopyOk(false)
    const out = buildLinkPack(
      {
        title,
        note: note.trim() ? note : undefined,
        items: effectiveItems.map((item, i) => ({
          ...item,
          purpose: purposes[i]?.trim() ? purposes[i] : undefined,
        })),
      },
      { origin: window.location.origin, pathname: '/pack' },
    )
    if (!out.ok) {
      setGeneratedUrl(null)
      setBuildError(out.reason)
      return
    }
    setGeneratedUrl(out.url)
    setBuildNotes(out.notes)
  }

  const handleCopy = async () => {
    if (!generatedUrl) return
    const result = await copyText(generatedUrl)
    if (result.ok) {
      setCopyOk(true)
      setCopyNote('已复制链接，发给对方即可')
    } else {
      setCopyOk(false)
      setCopyNote(`复制失败：${result.reason}——请手动选中链接复制`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            打包成链接包
          </DialogTitle>
          <DialogDescription>
            把选中的 {items.length} 个收藏做成一页清单链接，对方打开可逐个点、也可全部打开、一键导入自己的收藏。
            内容是快照：发出后不再随你的收藏变化而更新。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              还没选中任何收藏：先在收藏列表里勾选要打包的站点，再点「打包成链接包」。
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="link-pack-title" className="text-xs font-medium">
                  链接包标题
                </label>
                <Input
                  id="link-pack-title"
                  value={title}
                  maxLength={LINK_PACK_TITLE_MAX}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    markDirty()
                  }}
                  placeholder="比如：新人必看工具合集"
                  className="min-h-11"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="link-pack-note" className="text-xs font-medium">
                  备注（可选，对方打开时先看到）
                </label>
                <Input
                  id="link-pack-note"
                  value={note}
                  maxLength={LINK_PACK_NOTE_MAX}
                  onChange={(e) => {
                    setNote(e.target.value)
                    markDirty()
                  }}
                  placeholder="比如：这套是我做设计时每天用的工具"
                  className="min-h-11"
                />
              </div>

              <fieldset className="space-y-2">
                <legend className="text-xs font-medium">
                  每站一句话用途（{effectiveItems.length} 个）
                </legend>
                {effectiveItems.map((item, i) => (
                  <div key={`${item.href}-${i}`} className="space-y-1">
                    <label htmlFor={`link-pack-purpose-${i}`} className="text-xs text-muted-foreground block truncate">
                      {item.title || item.href}
                    </label>
                    <Input
                      id={`link-pack-purpose-${i}`}
                      value={purposes[i] ?? ''}
                      maxLength={LINK_PACK_ITEM_PURPOSE_MAX}
                      onChange={(e) => {
                        const next = [...purposes]
                        next[i] = e.target.value
                        setPurposes(next)
                        markDirty()
                      }}
                      placeholder="一句话说清这个站是干嘛的（可空）"
                      className="min-h-11 text-xs"
                    />
                  </div>
                ))}
                {overLimit && !takeFirst20 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
                    你选了 {items.length} 个站点，链接包一次最多 {LINK_PACK_MAX_ITEMS} 个。
                  </p>
                )}
                {overLimit && takeFirst20 && (
                  <p className="text-xs text-muted-foreground" role="status">
                    只打包前 {LINK_PACK_MAX_ITEMS} 个，其余 {items.length - LINK_PACK_MAX_ITEMS} 个请再打一个包。
                  </p>
                )}
              </fieldset>

              <p className="text-[11px] text-muted-foreground">
                上限：最多 {LINK_PACK_MAX_ITEMS} 个站点、链接总长 4KB；超长时请分包。快照版链接不经过服务器，不登录也能打开。
              </p>

              {overLimit && !takeFirst20 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 text-xs"
                  onClick={() => {
                    setTakeFirst20(true)
                    markDirty()
                  }}
                >
                  只打包前 {LINK_PACK_MAX_ITEMS} 个
                </Button>
              )}

              <Button
                variant="default"
                size="sm"
                className="min-h-11 text-xs w-full sm:w-auto"
                disabled={!canGenerate}
                title={!canGenerate ? `一次最多打包 ${LINK_PACK_MAX_ITEMS} 个站点，请先分包` : undefined}
                onClick={handleGenerate}
              >
                生成链接包
              </Button>

              {buildError && (
                <p className="text-xs text-destructive-text" role="alert">
                  {buildError}
                </p>
              )}
              {buildNotes.length > 0 && (
                <p className="text-xs text-muted-foreground" role="note">
                  {buildNotes.join('；')}
                </p>
              )}

              {generatedUrl && (
                <div className="space-y-2 rounded-xl border border-border/70 bg-muted/40 p-3">
                  <label htmlFor="link-pack-url" className="text-xs font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                    链接包已生成（快照，发出后内容不再更新）
                  </label>
                  <Input
                    id="link-pack-url"
                    readOnly
                    value={generatedUrl}
                    onFocus={(e) => e.target.select()}
                    className="min-h-11 text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="default" size="sm" className="min-h-11 text-xs" onClick={() => void handleCopy()}>
                      <Copy className="w-3.5 h-3.5 mr-1.5" />
                      复制链接
                    </Button>
                    <Button asChild variant="outline" size="sm" className="min-h-11 text-xs">
                      <a href={generatedUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        打开预览
                      </a>
                    </Button>
                  </div>
                  {copyNote && (
                    <p
                      className={copyOk ? 'text-xs text-emerald-700 dark:text-emerald-400' : 'text-xs text-destructive-text'}
                      role="status"
                      aria-live="polite"
                    >
                      {copyNote}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
