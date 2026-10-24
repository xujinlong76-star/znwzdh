'use client'

/**
 * 浏览器书签 HTML 导入按钮（T2/T16）。
 *
 * 独立成组件并被 /me/data 按需加载（next/dynamic）：书签导入是低频操作，
 * 解析器与交互文案不该占数据页首屏预算（bundle 只降不升的硬约束）。
 * 收藏只能落「本机收藏」（云端按站点库校验 siteId，任意 URL 的书签没有对应
 * 站点）——登录后随收藏同步通道上云，未收录站点按孤儿行规则靠本地 href 兜底。
 */
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { BookmarkPlus, Loader2 } from 'lucide-react'
import type { FavoritesApi } from '@/hooks/useFavorites'

export function BookmarkImportButton({ favorites }: { favorites: FavoritesApi }) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handleHtml = useCallback(
    async (rawHtml: string) => {
      setBusy(true)
      try {
        const { parseNetscapeBookmarks, bookmarkId } = await import('@/lib/bookmarks-import')
        const { items, truncated } = parseNetscapeBookmarks(rawHtml)
        if (items.length === 0) {
          toast({
            title: '书签文件里没有可识别的链接',
            description: '请确认导出的是 Netscape HTML 格式的书签文件。',
            variant: 'destructive',
          })
          return
        }
        const payload = JSON.stringify({
          version: 1,
          items: items.map((bm) => ({
            siteId: bookmarkId(bm.href),
            title: bm.title,
            href: bm.href,
            createdAt: Date.now(),
          })),
        })
        const result = favorites.importJson(payload)
        if (!result.ok) {
          toast({ title: '书签导入失败', description: result.error ?? '本机存储暂不可写', variant: 'destructive' })
          return
        }
        const skipped = items.length - result.imported
        toast({
          title: `已把 ${result.imported} 条书签加入本机收藏`,
          description:
            (skipped > 0 ? `${skipped} 条与现有收藏重复，自动跳过；` : '') +
            (truncated ? `文件过大只处理了前 ${items.length} 条；` : '') +
            '登录后这些收藏会随同步进入云端。',
        })
      } finally {
        setBusy(false)
      }
    },
    [favorites, toast],
  )

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm,text/html"
        aria-label="选择浏览器书签 HTML 文件"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') void handleHtml(reader.result)
          }
          reader.readAsText(file)
          e.target.value = ''
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="w-full text-xs sm:w-auto"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="mr-2 h-3.5 w-3.5" />}
        从浏览器书签 HTML 导入（本机）
      </Button>
    </>
  )
}
