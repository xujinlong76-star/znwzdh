'use client'

/**
 * 首页「我的常用」区（2026-11-20 20:00 战略研究 W9 落地）。
 *
 * 位置：搜索框下方、分类区上方（由 navigation-content.tsx 挂载）。
 * 未使用时完全折叠：返回 null，不占位、不改动现有首页布局。
 * 全部数据只存浏览器本地；区内点击只写本地最近快照
 * （`recordOfflineVisit`），不发点击上报请求——个人数据零网络请求。
 * 图标：站内站点沿用卡片同款 SiteFavicon；自定义链接优先本地
 * brand-icons（`resolveSiteIcon`），无匹配时用字母徽标，不自动抓取
 * 第三方 favicon。
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, History, Link2, Settings2, Star, Trash2, X } from 'lucide-react'
import { MAX_RECENT_PERSONAL, type CatalogCategory } from '@/lib/personal-data'
import { clearOfflineVisits, readOfflineVisits, recordOfflineVisit, type RecentVisit } from '@/lib/offline-recent'
import { usePersonalData } from '@/hooks/usePersonalData'
import { PersonalLinkForm } from '@/components/personal-link-form'
import { SiteFavicon, extractFaviconMonogram, getDeterministicGradient, resolveSiteIcon } from '@/components/site-favicon'
import { safeHref } from '@/lib/safe-url'

export interface PersonalZoneSite {
  id: string
  title: string
  href: string
  icon?: string | null
}

interface MyPersonalZoneProps {
  /** 全站站点（用于解析场景 siteId；缺失的站跳过，不编数据）。 */
  allSites?: PersonalZoneSite[]
  /** 导航分类（用于播种预置场景；不传则不播种）。 */
  catalog?: readonly CatalogCategory[]
}

const ROLE_LABEL = { main: '主', backup: '备', notice: '公告' } as const

function LetterBadge({ name, className }: { name: string; className?: string }) {
  const gradient = getDeterministicGradient(name)
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-md text-xs font-bold text-white shrink-0 ${className ?? 'h-6 w-6'}`}
      style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }}
    >
      {extractFaviconMonogram(name)}
    </span>
  )
}

export function MyPersonalZone({ allSites = [], catalog }: MyPersonalZoneProps) {
  const personal = usePersonalData()
  const [mounted, setMounted] = useState(false)
  const [recents, setRecents] = useState<RecentVisit[]>([])
  const [linkFormOpen, setLinkFormOpen] = useState(false)
  const { data } = personal

  useEffect(() => {
    setMounted(true)
  }, [])

  // 预置场景只在用户已经用过个人数据（固定/自定义链接）后播种：
  // 首访用户不因此多出一个区（「未使用时完全折叠」）。
  useEffect(() => {
    if (!mounted || !catalog || catalog.length === 0) return
    if (data.pinned.length === 0 && data.customLinks.length === 0) return
    personal.ensurePresetScenes(catalog)
  }, [mounted, catalog, data.pinned.length, data.customLinks.length])

  useEffect(() => {
    if (!mounted || !data.prefs.recordRecent) {
      setRecents([])
      return
    }
    let alive = true
    void readOfflineVisits(MAX_RECENT_PERSONAL).then((rows) => {
      if (alive) setRecents(rows.slice(0, MAX_RECENT_PERSONAL))
    })
    return () => {
      alive = false
    }
  }, [mounted, data.prefs.recordRecent, data.counters.personalClick])

  const siteById = useMemo(() => new Map(allSites.map((s) => [s.id, s])), [allSites])
  const activeScene = useMemo(
    () => data.scenes.find((s) => s.id === data.activeSceneId) ?? null,
    [data.scenes, data.activeSceneId],
  )
  const activeSceneSites = useMemo(() => {
    if (!activeScene) return []
    return activeScene.siteIds
      .map((id) => ({ id, site: siteById.get(id), role: activeScene.roles[id] ?? 'backup' as const }))
      .filter((entry): entry is { id: string; site: PersonalZoneSite; role: 'main' | 'backup' | 'notice' } => Boolean(entry.site))
  }, [activeScene, siteById])

  const hasScenesWithSites = data.scenes.some((s) => s.siteIds.length > 0)
  const isUsed =
    data.pinned.length > 0 || data.customLinks.length > 0 || hasScenesWithSites || recents.length > 0

  // 未使用时完全折叠：不占位、不渲染任何骨架。
  if (!mounted || !isUsed) return null

  const openSite = (site: { id: string; title: string; href: string; icon?: string | null }) => {
    personal.recordClick()
    recordOfflineVisit({ id: site.id, title: site.title, href: site.href, icon: site.icon ?? null })
  }

  const clearRecents = async () => {
    await clearOfflineVisits()
    setRecents([])
  }

  return (
    <section aria-label="我的常用" data-testid="my-personal-zone" className="mb-6 sm:mb-8">
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <h2 className="text-base sm:text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <span className="w-1.5 h-5 rounded-full bg-amber-500" />
          <Star className="h-4 w-4 text-amber-500 fill-amber-500" aria-hidden />
          <span>我的常用</span>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40 shrink-0">
            仅保存在本机
          </span>
        </h2>
        <span className="flex items-center gap-1">
          <button
            type="button"
            data-testid="personal-add-link"
            onClick={() => setLinkFormOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50"
          >
            <Link2 className="h-3.5 w-3.5" />
            添加链接
          </button>
          <a
            href="/personal"
            data-testid="personal-manage-link"
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50"
          >
            <Settings2 className="h-3.5 w-3.5" />
            管理与隐私
          </a>
        </span>
      </div>

      {/* 场景分组：全部 + 各场景；切场景只换本区展示，不动分类区 */}
      {data.scenes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 px-1" role="tablist" aria-label="场景">
          <button
            type="button"
            role="tab"
            aria-selected={data.activeSceneId === null}
            data-testid="personal-scene-tab-all"
            onClick={() => personal.setActiveScene(null)}
            className={`rounded-full px-2.5 py-1 text-xs border transition-colors ${
              data.activeSceneId === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted/40 text-muted-foreground border-border/60 hover:bg-accent/50'
            }`}
          >
            全部
          </button>
          {data.scenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              role="tab"
              aria-selected={data.activeSceneId === scene.id}
              data-testid={`personal-scene-tab-${scene.id}`}
              onClick={() => personal.setActiveScene(scene.id)}
              className={`rounded-full px-2.5 py-1 text-xs border transition-colors ${
                data.activeSceneId === scene.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/40 text-muted-foreground border-border/60 hover:bg-accent/50'
              }`}
              style={data.activeSceneId === scene.id ? { backgroundColor: scene.color, borderColor: scene.color } : { color: undefined }}
              title={scene.goal || scene.name}
            >
              <span className="inline-block h-2 w-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: scene.color }} />
              {scene.name}
            </button>
          ))}
        </div>
      )}

      {/* 场景视图：只展示该场景的站 + 角色 + 一句话成功标准 */}
      {activeScene ? (
        <div>
          {activeScene.goal ? (
            <p className="text-xs text-muted-foreground mb-2 px-1">成功标准：{activeScene.goal}</p>
          ) : null}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {activeSceneSites.map(({ id, site, role }) => {
              const href = safeHref(site.href, '')
              if (!href) return null
              return (
                <a
                  key={id}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="personal-scene-site"
                  onClick={() => openSite(site)}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs group"
                >
                  <span className="w-6 h-6 shrink-0 flex items-center justify-center">
                    <SiteFavicon title={site.title} url={href} icon={site.icon} className="w-6 h-6 object-contain rounded" />
                  </span>
                  <span className="truncate font-medium text-foreground group-hover:text-primary flex-1 min-w-0">{site.title}</span>
                  <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground">
                    {ROLE_LABEL[role]}
                  </span>
                </a>
              )
            })}
            {activeSceneSites.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-full px-1 py-2">这个场景还没有可展示的站（站表里找不到对应的站 id）。</p>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* 置顶收藏 */}
          {data.pinned.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {data.pinned.map((pin, index) => {
                const href = safeHref(pin.href, '')
                if (!href) return null
                return (
                  <div
                    key={pin.siteId}
                    data-testid="personal-pin-item"
                    className="group relative flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all"
                  >
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => openSite({ id: pin.siteId, title: pin.title, href: pin.href, icon: pin.icon })}
                      className="flex items-center gap-2 min-w-0 flex-1"
                    >
                      <span className="w-6 h-6 shrink-0 flex items-center justify-center">
                        <SiteFavicon title={pin.title} url={href} icon={pin.icon} className="w-6 h-6 object-contain rounded" />
                      </span>
                      <span className="truncate text-xs font-medium text-foreground">{pin.title}</span>
                    </a>
                    <span className="flex items-center shrink-0">
                      <button
                        type="button"
                        data-testid="personal-move-left"
                        disabled={index === 0}
                        aria-label={`把「${pin.title}」往前移`}
                        title="往前移"
                        onClick={() => personal.movePinned(pin.siteId, index - 1)}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        data-testid="personal-move-right"
                        disabled={index === data.pinned.length - 1}
                        aria-label={`把「${pin.title}」往后移`}
                        title="往后移"
                        onClick={() => personal.movePinned(pin.siteId, index + 1)}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        data-testid="personal-unpin"
                        aria-label={`从「我的常用」取消固定：${pin.title}`}
                        title="取消固定"
                        onClick={() => personal.togglePin(pin)}
                        className="p-0.5 rounded text-muted-foreground hover:text-amber-500"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* 自定义链接：图标优先本地 brand-icons，无匹配用字母徽标 */}
          {data.customLinks.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-2">
              {data.customLinks.map((link) => {
                const href = safeHref(link.url, '')
                if (!href) return null
                const localIcon = resolveSiteIcon(link.url, link.name)
                return (
                  <div
                    key={link.id}
                    data-testid="personal-custom-link"
                    className="group relative flex items-center gap-2 p-2 rounded-lg border border-dashed border-border/60 bg-background/60 hover:bg-accent/50 transition-all"
                  >
                    <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => personal.recordClick()} className="flex items-center gap-2 min-w-0 flex-1">
                      {localIcon ? (
                        <img src={localIcon} alt="" className="w-6 h-6 object-contain rounded shrink-0" />
                      ) : (
                        <LetterBadge name={link.name} />
                      )}
                      <span className="truncate text-xs font-medium text-foreground">{link.name}</span>
                    </a>
                    <button
                      type="button"
                      data-testid="personal-remove-link"
                      aria-label={`删除自定义链接：${link.name}`}
                      title="删除"
                      onClick={() => personal.removeLink(link.id)}
                      className="p-0.5 rounded text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* 本地最近使用（上限 8 条，仅本站内点击） */}
          {data.prefs.recordRecent && recents.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 px-1 mb-1.5">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  最近使用
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="personal-record-toggle"
                    aria-pressed={data.prefs.recordRecent}
                    onClick={() => personal.setRecordRecent(false)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  >
                    关闭记录
                  </button>
                  <button
                    type="button"
                    data-testid="personal-clear-recent"
                    onClick={() => void clearRecents()}
                    className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  >
                    清空
                  </button>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 px-1">
                {recents.map((visit) => {
                  const href = safeHref(visit.href, '')
                  if (!href) return null
                  return (
                    <a
                      key={visit.id}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="personal-recent-item"
                      onClick={() => personal.recordClick()}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-xs hover:bg-accent/50"
                    >
                      <span className="w-4 h-4 flex items-center justify-center shrink-0">
                        <SiteFavicon title={visit.title} url={href} icon={visit.icon} className="w-4 h-4 object-contain rounded" />
                      </span>
                      <span className="max-w-32 truncate">{visit.title}</span>
                    </a>
                  )
                })}
              </div>
            </div>
          )}
          {data.prefs.recordRecent === false && (
            <p className="text-xs text-muted-foreground px-1 mt-2">
              最近使用记录已关闭（新点击不再记录）。
              <button type="button" className="underline underline-offset-2 ml-1" onClick={() => personal.setRecordRecent(true)}>
                重新开启
              </button>
            </p>
          )}
        </>
      )}

      {personal.corrupt ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400 mt-2 px-1">
          本地「我的常用」数据曾读不出来，已隔离保护；原数据仍在浏览器里，可在「管理与隐私」页处理。
        </p>
      ) : null}
      {personal.storageBlocked ? (
        <p role="alert" className="text-xs text-destructive mt-2 px-1">
          {personal.storageBlocked}
        </p>
      ) : null}

      <PersonalLinkForm open={linkFormOpen} onOpenChange={setLinkFormOpen} />
    </section>
  )
}
