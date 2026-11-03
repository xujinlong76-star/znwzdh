'use client'

import React, { useState, useMemo } from 'react'
import { Bookmark, ExternalLink, Search, X, Plus, Link as LinkIcon } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import { SiteFavicon } from '@/components/site-favicon'
import Link from 'next/link'
import { useFavorites } from '@/hooks/useFavorites'
import { Button } from '@/registry/new-york/ui/button'

export function FavoritesDockWidget() {
  const favorites = useFavorites()
  const [filterQuery, setFilterQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const filteredItems = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) {
      return favorites.items.slice(0, 10)
    }
    return favorites.items.filter(
      (site) => site.title.toLowerCase().includes(q) || site.href.toLowerCase().includes(q)
    )
  }, [favorites.items, filterQuery])

  const handleAddCustom = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)
    let url = newUrl.trim()
    if (!url) {
      setAddError('请输入有效网址')
      return
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`
    }
    try {
      new URL(url)
    } catch {
      setAddError('网址格式不正确')
      return
    }

    const host = url.replace(/^https?:\/\//, '').split('/')[0] || '我的链接'
    const title = newTitle.trim() || host
    const customId = `custom-dock-${Date.now()}`

    await favorites.toggle({
      siteId: customId,
      title,
      href: url,
    })

    setNewTitle('')
    setNewUrl('')
    setIsAddOpen(false)
  }

  const handleRemove = (e: React.MouseEvent, siteId: string) => {
    e.preventDefault()
    e.stopPropagation()
    favorites.remove(siteId)
  }

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      {/* 头部标题与原地微搜索 / 添加自定义网址切换 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium min-w-0">
          <Bookmark className="w-3.5 h-3.5 text-pink-500 shrink-0" />
          <span className="truncate">星标收藏启动坞</span>

          {favorites.items.length > 3 && (
            <button
              type="button"
              onClick={() => {
                setIsSearchOpen((prev) => !prev)
                if (isSearchOpen) setFilterQuery('')
              }}
              className={`p-1 rounded-md transition-colors ${
                isSearchOpen ? 'bg-pink-500/15 text-pink-500' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
              }`}
              title="卡片内就地检索"
            >
              <Search className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setIsAddOpen((prev) => !prev)
              setAddError(null)
            }}
            className={`p-1 rounded-md transition-colors ${
              isAddOpen ? 'bg-pink-500/15 text-pink-500' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
            title="添加自定义网址（内网/本地端口/专属工具）"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        <Link href="/favorites" className="text-xs text-primary hover:underline flex items-center gap-0.5 shrink-0">
          <span>全部 ({favorites.items.length})</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>

      {/* 就地微搜索输入栏 */}
      {isSearchOpen && (
        <div className="pt-1.5 pb-1">
          <div className="relative flex items-center">
            <Search className="w-3 h-3 text-muted-foreground absolute left-2 pointer-events-none" />
            <input
              type="text"
              autoFocus
              aria-label="快速过滤我的收藏"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="快速过滤我的收藏..."
              className="w-full text-xs pl-6 pr-6 py-1 rounded-lg border border-border/80 bg-background outline-none focus:border-pink-500/60"
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery('')}
                className="absolute right-1.5 text-muted-foreground hover:text-foreground p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 添加自定义网址微表单 */}
      {isAddOpen && (
        <form onSubmit={handleAddCustom} className="p-2 my-1.5 rounded-xl border border-pink-500/30 bg-pink-500/5 space-y-1.5 animate-in fade-in duration-150">
          <div className="flex items-center gap-1.5">
            <LinkIcon className="w-3 h-3 text-pink-500 shrink-0" />
            <span className="text-[11px] font-semibold text-foreground">添加自定义站点</span>
          </div>
          <div className="space-y-1">
            <input
              type="text"
              aria-label="自定义站点网址"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="网址 URL (如 localhost:8080 或内网地址)..."
              className="w-full text-xs px-2 py-1 rounded-md border border-border/70 bg-background outline-none font-mono"
              autoFocus
            />
            <input
              type="text"
              aria-label="自定义站点名称（可选）"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="名称 (可选，留空使用域名)..."
              className="w-full text-xs px-2 py-1 rounded-md border border-border/70 bg-background outline-none"
            />
          </div>
          {addError && <p className="text-[10px] text-destructive-text">{addError}</p>}
          <div className="flex items-center justify-end gap-1.5 pt-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setIsAddOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" size="sm" className="h-6 px-2.5 text-xs bg-pink-600 hover:bg-pink-700 text-white">
              保存到启动坞
            </Button>
          </div>
        </form>
      )}

      {/* 站点卡片列表 */}
      <div className="flex-1 py-1.5 overflow-y-auto min-h-0">
        {favorites.items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-2 text-xs text-muted-foreground space-y-2">
            <p>暂无收藏站点</p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs rounded-md"
                onClick={() => setIsAddOpen(true)}
              >
                <Plus className="w-3 h-3 mr-1" />
                添加自定义网址
              </Button>
              <Link href="/" className="text-xs text-primary hover:underline">
                去主页星标
              </Link>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-2 text-xs text-muted-foreground">
            <p>未找到匹配 "{filterQuery}" 的收藏</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filteredItems.map((site) => (
              <div
                key={site.siteId}
                className="relative flex items-center justify-between p-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-pink-500/40 transition-all group"
              >
                <a
                  href={safeHref(site.href)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 min-w-0 flex-1 pr-1"
                >
                  <div className="w-5 h-5 rounded bg-muted/60 flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0 overflow-hidden">
                    <SiteFavicon
                      title={site.title}
                      url={site.href}
                      icon={site.icon}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    {site.title}
                  </span>
                </a>

                {/* 悬停移除按钮 */}
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, site.siteId)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-red-500 transition-opacity shrink-0"
                  title={`移除「${site.title}」`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部信息提示 */}
      <div className="pt-1 text-xs text-muted-foreground text-center font-mono flex items-center justify-between">
        <span className="text-[10px]">
          {filterQuery ? `筛选出 ${filteredItems.length} 个` : 'E2EE 本地零知识同步'}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {favorites.items.length > 0 ? `共 ${favorites.items.length} 个快捷入口` : '点击直达'}
        </span>
      </div>
    </div>
  )
}
