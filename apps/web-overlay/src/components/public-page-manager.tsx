'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, EyeOff, Globe, Link2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'
import {
  PUBLIC_PAGE_DESCRIPTION_MAX,
  PUBLIC_PAGE_MAX_ITEMS,
  PUBLIC_PAGE_TITLE_MAX,
  createPublicPage,
  deletePublicPage,
  isValidPublicPageSlug,
  listMyPublicPages,
  normalizePublicPageSlugInput,
  publicPageUrl,
  setPublicPageStatus,
  slugifyPublicPageTitle,
  type PublicPageView,
} from '@/lib/public-pages'

/**
 * 公开导航页管理区（收藏夹页内，Batch 3 第 6 项）。
 *
 * 发布一个收藏文件夹 → 公开只读页（/pub/:slug），不用登录就能看；
 * 与「打包成链接包」不同：链接包是发一次的快照，公开页是常驻页面——
 * 内容随收藏更新、可随时下线、有独立链接与 SEO。
 *
 * 诚实边界：
 * - 只有云端身份能发布：本地收藏只存本机，没有服务端身份，发不出去——
 *   未登录时整个区置灰并明说原因，不做「点了才告诉你不行」的假按钮。
 * - 空文件夹不发：选中当前文件夹时发布前就按条数拦（0 条或超 100 条都
 *   明说）；换了别的收藏夹时条数未知，交给中枢兜底——中枢也会拦并回人话。
 * - 下线/删除都是两步确认；删除不可恢复，按钮文案直接写清楚。
 * - 复制失败不静默：复制按钮会变成「复制失败」，不让用户以为复制成功了
 *   才发现发出去的是空剪贴板（与公开页上的复制按钮同一条诚实口径）。
 */
export default function PublicPageManager({
  cloudIdentity,
  folders,
  activeFolder,
  activeFolderCount,
}: {
  cloudIdentity: string
  folders: Array<{ id: string; name: string }>
  activeFolder: string
  activeFolderCount: number
}) {
  const [pages, setPages] = useState<PublicPageView[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [slug, setSlug] = useState('')
  const [folderId, setFolderId] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [justPublished, setJustPublished] = useState<PublicPageView | null>(null)
  const [copiedSlug, setCopiedSlug] = useState('')
  const [copyFailedSlug, setCopyFailedSlug] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')

  const refresh = useCallback(async () => {
    if (!cloudIdentity) return
    setLoading(true)
    setLoadError('')
    const result = await listMyPublicPages(cloudIdentity)
    setLoading(false)
    if (result.ok) setPages(result.data)
    else setLoadError(result.message)
  }, [cloudIdentity])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openForm = () => {
    const folder = folders.find((f) => f.id === activeFolder)
    setTitle(folder ? folder.name : '我的导航')
    setDescription('')
    setSlug('')
    setFolderId(activeFolder === 'all' ? '' : activeFolder)
    setFormError('')
    setJustPublished(null)
    setShowForm(true)
  }

  const handlePublish = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setFormError('请给公开页起个标题')
      return
    }
    const normalizedSlug = normalizePublicPageSlugInput(slug)
    if (normalizedSlug && !isValidPublicPageSlug(normalizedSlug)) {
      setFormError('链接后缀只能用小写字母、数字和连字符，开头必须是字母或数字，2–64 个字符')
      return
    }
    // 已知条数时发布前就拦：选中的正是当前文件夹（条数已知）才拦；
    // 换了别的收藏夹时条数未知，交给中枢兜底（0 条/超 100 条都会回人话）。
    // 注意 activeFolderCount 是原始收藏数（含已失效的站），>100 时只能说
    // 「约」——最终口径在中枢的有效条目数。
    const selectedFolderId = folderId || ''
    const activeFolderId = activeFolder === 'all' ? '' : activeFolder
    if (selectedFolderId === activeFolderId) {
      if (activeFolderCount === 0) {
        setFormError('当前文件夹里还没有可公开的有效站点，先收藏几个再发布。')
        return
      }
      if (activeFolderCount > PUBLIC_PAGE_MAX_ITEMS) {
        setFormError(
          `公开页最多 ${PUBLIC_PAGE_MAX_ITEMS} 条，当前文件夹约 ${activeFolderCount} 条，请分文件夹发布`,
        )
        return
      }
    }
    setBusy(true)
    setFormError('')
    const result = await createPublicPage(cloudIdentity, {
      title: trimmedTitle,
      description: description.trim() || null,
      folderId: folderId || null,
      slug: normalizedSlug || null,
    })
    setBusy(false)
    if (!result.ok) {
      setFormError(result.message)
      return
    }
    setJustPublished(result.data.page)
    setShowForm(false)
    void refresh()
  }

  const handleCopy = async (page: PublicPageView) => {
    const result = await copyText(publicPageUrl(page.slug))
    if (result.ok) {
      setCopiedSlug(page.slug)
      setCopyFailedSlug('')
      window.setTimeout(() => setCopiedSlug(''), 2000)
    } else {
      setCopyFailedSlug(page.slug)
      window.setTimeout(() => setCopyFailedSlug(''), 2000)
    }
  }

  const handleToggleStatus = async (page: PublicPageView) => {
    const next = page.status === 'published' ? 'unpublished' : 'published'
    setBusy(true)
    const result = await setPublicPageStatus(cloudIdentity, page.slug, next)
    setBusy(false)
    if (!result.ok) {
      setLoadError(result.message)
      return
    }
    setLoadError('')
    setPages((prev) => prev.map((p) => (p.slug === page.slug ? result.data : p)))
  }

  const handleDelete = async (page: PublicPageView) => {
    if (confirmDelete !== page.slug) {
      setConfirmDelete(page.slug)
      return
    }
    setConfirmDelete('')
    setBusy(true)
    const result = await deletePublicPage(cloudIdentity, page.slug)
    setBusy(false)
    if (!result.ok) {
      setLoadError(result.message)
      return
    }
    setLoadError('')
    setPages((prev) => prev.filter((p) => p.slug !== page.slug))
  }

  return (
    <section aria-label="公开导航页" className="rounded-xl border border-border/60 bg-card/40 p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Globe className="size-4" aria-hidden />
            公开导航页
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            把一个收藏夹发布成不用登录就能看的只读页面（/pub/链接），随时可下线。
            与链接包快照不同：公开页内容随你的收藏更新。
          </p>
        </div>
        {cloudIdentity && (
          <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={openForm}>
            <Link2 className="mr-1.5 size-3.5" aria-hidden />
            发布当前文件夹
          </Button>
        )}
      </div>

      {!cloudIdentity ? (
        <p className="text-xs text-muted-foreground">
          需登录并同步到云端收藏后才能发布——本地收藏只存在本机，没有可发布到的服务端身份。
        </p>
      ) : (
        <>
          {showForm && (
            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium">标题（最多 {PUBLIC_PAGE_TITLE_MAX} 字）</span>
                <Input
                  value={title}
                  maxLength={PUBLIC_PAGE_TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="比如：设计师常用工具"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">简介（可选，最多 {PUBLIC_PAGE_DESCRIPTION_MAX} 字）</span>
                <Input
                  value={description}
                  maxLength={PUBLIC_PAGE_DESCRIPTION_MAX}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="一句话说清这个导航页是给谁、用来干什么的"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium">收藏夹</span>
                  <select
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    className="h-9 w-full rounded-md border border-border-strong bg-background px-2 text-sm"
                  >
                    <option value="">全部收藏</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">链接后缀（可选，留空自动生成）</span>
                  <Input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder={slugifyPublicPageTitle(title.trim() || '我的导航')}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {activeFolderCount === 0
                  ? '当前文件夹里还没有可公开的有效站点，先收藏几个再发布。'
                  : `当前文件夹约 ${activeFolderCount} 条收藏，公开页最多 ${PUBLIC_PAGE_MAX_ITEMS} 条。`}
              </p>
              {formError && (
                <p role="alert" className="text-xs text-destructive-text">
                  {formError}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" className="min-h-11" disabled={busy} onClick={() => void handlePublish()}>
                  {busy ? '发布中…' : '发布公开页'}
                </Button>
                <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setShowForm(false)}>
                  取消
                </Button>
              </div>
            </div>
          )}

          {justPublished && (
            <p role="status" className="text-xs">
              发布成功：
              <a
                href={publicPageUrl(justPublished.slug)}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-primary underline underline-offset-2"
              >
                /pub/{justPublished.slug}
              </a>
              ，发给别人不用登录就能打开。
            </p>
          )}

          {loading ? (
            <p className="text-xs text-muted-foreground">正在读取已发布的公开页…</p>
          ) : loadError ? (
            <p role="alert" className="text-xs text-destructive-text">
              {loadError}
            </p>
          ) : pages.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有发布过公开页。</p>
          ) : (
            <ul className="space-y-2">
              {pages.map((page) => (
                <li key={page.slug} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{page.title}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[11px]',
                          page.status === 'published' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {page.status === 'published' ? '已发布' : '已下线'}
                      </span>
                    </span>
                    <a
                      href={publicPageUrl(page.slug)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block truncate text-xs text-muted-foreground underline underline-offset-2"
                    >
                      /pub/{page.slug}
                    </a>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-8 min-h-8 text-xs" disabled={busy} onClick={() => void handleCopy(page)}>
                      {copiedSlug === page.slug ? <Check className="mr-1 size-3.5" aria-hidden /> : <Copy className="mr-1 size-3.5" aria-hidden />}
                      {copiedSlug === page.slug ? '已复制' : copyFailedSlug === page.slug ? '复制失败' : '复制链接'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 min-h-8 text-xs"
                      disabled={busy}
                      onClick={() => void handleToggleStatus(page)}
                    >
                      <EyeOff className="mr-1 size-3.5" aria-hidden />
                      {page.status === 'published' ? '下线' : '重新发布'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 min-h-8 border-destructive/40 text-xs text-destructive-text hover:bg-destructive/15"
                      disabled={busy}
                      onClick={() => void handleDelete(page)}
                    >
                      <Trash2 className="mr-1 size-3.5" aria-hidden />
                      {confirmDelete === page.slug ? '再次点击确认删除' : '删除'}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
