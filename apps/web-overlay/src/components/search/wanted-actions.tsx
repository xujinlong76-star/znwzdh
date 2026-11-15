'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState } from 'react'
import { BookmarkPlus, Check, PlusCircle } from 'lucide-react'
import { queryToTitleAndUrl } from '@/lib/submit-prefill'
import { saveWantedSearch } from '@/lib/wanted-searches'
import { createCustomSite } from '@/lib/navhub-api'
import { useFavorites } from '@/hooks/useFavorites'

const AddSiteDialog = dynamic(
  () => import('@/components/add-site-dialog').then((m) => m.AddSiteDialog),
  { ssr: false },
)

/**
 * 零结果两出口（搜索容错纠错 · 第 5 项）客户端岛。
 *
 * /search 页其余部分保持服务端组件，沿用 ZeroResultActions 的模式，
 * 只有这两个按钮需要客户端状态：
 *
 * - 出口一「存为待找」：登录态调 POST /api/me/wanted，收录时站内通知；
 *   匿名走 localStorage 只存查询串，并明示「登录后才能在收录时通知你」。
 *   重复存提示「已在待找里了」。
 * - 出口二「新建收藏」：复用 AddSiteDialog 预填弹窗，提交调既有
 *   POST /api/me/custom-sites（登录态）；成功后尝试 useFavorites.toggle()
 *   把它同时放进收藏夹。
 *
 *   实施前验证结论（2026-11-13）：
 *   ① toggle() 接受任意 siteId/title/href，本地收藏是 localStorage-first，
 *      /favorites 直接按 LocalFavorite 渲染——自定义站点 id 能正常渲染；
 *      唯一缺口是云端同步 POST /api/favorites 会对库外 id 回 404，
 *      但 toggle 内部 degrade 已吞掉失败、本地态不受影响。
 *   ② AddSiteDialog 的 onSubmit 是调用方提供的：首页调用方落本地 DIY 板，
 *      这里提供自己的 onSubmit 落 /api/me/custom-sites，不沿用首页落点。
 *
 * 诚实边界：非网址查询的「新建收藏」不是一键完成——弹窗里 URL 是必填项，
 * 用户必须贴一个真实网址（绝不编造）；匿名同样先贴 URL。
 */
function customFavoriteId(title: string, url: string): string {
  let hash = 5381
  for (let i = 0; i < `${title}\n${url}`.length; i += 1) {
    hash = ((hash << 5) + hash + `${title}\n${url}`.charCodeAt(i)) >>> 0
  }
  return `custom:${hash.toString(16)}`
}

type WantedState = 'idle' | 'saving' | 'saved-server' | 'saved-local' | 'duplicate'

export function WantedActions({
  query,
  correctedQuery,
}: {
  /** 用户原查询 */
  query: string
  /** 纠正后的词（有纠正时优先用它做标题/待找匹配词） */
  correctedQuery?: string | null
}) {
  const q = query.trim()
  const corrected = (correctedQuery ?? '').trim() || null
  const { toggle } = useFavorites()
  const [wanted, setWanted] = useState<WantedState>('idle')
  const [wantedNote, setWantedNote] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ title: '', href: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!q) return null

  const handleSaveWanted = async () => {
    if (wanted === 'saving') return
    setWanted('saving')
    setWantedNote(null)
    try {
      const res = await saveWantedSearch(q, corrected)
      if (res.duplicate) {
        setWanted('duplicate')
        setWantedNote('已在待找里了')
        return
      }
      if (res.mode === 'local') {
        setWanted('saved-local')
        setWantedNote('已存在本地待找，登录后才能在收录时通知你')
      } else {
        setWanted('saved-server')
        setWantedNote(null)
      }
    } catch {
      setWanted('idle')
      setWantedNote('这次没能存下来，稍后再试')
    }
  }

  const openCreateDialog = () => {
    const prefill = queryToTitleAndUrl(corrected ?? q)
    setForm({
      title: prefill.title,
      href: prefill.url ?? '',
      // 纠正过才填原搜索词：让用户知道这个收藏是从哪个查询来的
      note: corrected && corrected !== q ? `原搜索词：${q}` : '',
    })
    setError(null)
    setSaved(null)
    setDialogOpen(true)
  }

  const handleCreateSubmit = async () => {
    const title = form.title.trim()
    const href = form.href.trim()
    if (!title || !href) return
    setSaving(true)
    setError(null)
    try {
      // 登录态：先存进「我的站点」（服务端），再联动收藏夹
      const item = await createCustomSite({ title, url: href, note: form.note.trim() || null })
      await toggle({ siteId: item.id, title: item.title, href: item.url })
      setDialogOpen(false)
      setSaved('已存入我的站点，并放进收藏夹')
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        // 匿名：custom-sites 要求登录，走本地收藏直存（前提是查询含真实 URL，
        // 无 URL 时弹窗的必填校验已拦住，不会走到这里）
        await toggle({ siteId: customFavoriteId(title, href), title, href })
        setDialogOpen(false)
        setSaved('已存进本地收藏（未登录，仅保存在当前设备）')
      } else {
        setError(err instanceof Error ? err.message : '保存失败，稍后再试')
      }
    } finally {
      setSaving(false)
    }
  }

  const wantedSaved = wanted === 'saved-server' || wanted === 'saved-local' || wanted === 'duplicate'

  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSaveWanted}
          disabled={wanted === 'saving' || wantedSaved}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-70"
        >
          {wantedSaved ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <BookmarkPlus className="h-3.5 w-3.5 text-primary" />}
          {wanted === 'saving' ? '正在保存…' : wantedSaved ? '已存为待找 ✓' : '存为待找'}
        </button>
        <button
          type="button"
          onClick={openCreateDialog}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <PlusCircle className="h-3.5 w-3.5 text-primary" />
          新建收藏
        </button>
        {wantedSaved ? (
          <Link href="/me/wanted" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-primary hover:underline">
            查看我的待找
          </Link>
        ) : null}
      </div>
      {wantedNote ? <p className="text-[11px] text-muted-foreground">{wantedNote}</p> : null}
      {saved ? (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
          {saved}
          {' · '}
          <Link href="/me/sites" className="text-primary hover:underline">
            去我的站点查看
          </Link>
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-destructive-text">{error}</p> : null}
      <AddSiteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={form.title}
        href={form.href}
        desc={form.note}
        onTitleChange={(v) => setForm((f) => ({ ...f, title: v }))}
        onHrefChange={(v) => setForm((f) => ({ ...f, href: v }))}
        onDescChange={(v) => setForm((f) => ({ ...f, note: v }))}
        suggestion={null}
        onPickSuggestion={() => {}}
        onSubmit={handleCreateSubmit}
        dialogTitle="新建收藏"
        dialogDescription="保存到「我的站点」（登录后跨设备同步）。网址必填：请粘贴真实网址，不会按关键词猜一个地址。"
      />
      {saving ? <p className="text-[11px] text-muted-foreground">正在保存…</p> : null}
    </div>
  )
}
