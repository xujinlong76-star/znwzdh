'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  type HubPluginItem,
  installPlugin,
  uninstallPlugin,
  fetchPluginDetail,
  hubGet,
} from '@/lib/navhub-api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { resolveInstallAction } from '@/lib/plugins/install-state'
import { Globe, LayoutGrid, Palette, Boxes, AlertTriangle, Check, Trash2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { setActiveTheme, resetTheme } from '@/lib/plugins/theme-runtime'
import {
  registerSearchPackEngines,
  unregisterSearchPackEngines,
} from '@/lib/plugins/search-pack-runtime'
import { getIdentity } from '@/lib/identity'

export interface PluginInstallModalProps {
  plugin: HubPluginItem | null
  mode: 'install' | 'uninstall' | 'upgrade'
  identity?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  onApplyPreset?: (preset: any, mode: 'append' | 'replace') => void
}

export function PluginInstallModal({
  plugin,
  mode,
  identity,
  open,
  onOpenChange,
  onSuccess,
  onApplyPreset,
}: PluginInstallModalProps) {
  const [loading, setLoading] = useState(false)
  const [removeSites, setRemoveSites] = useState(false)
  const [presetMode, setPresetMode] = useState<'append' | 'replace'>('append')
  /** 安装耗时（每 100ms 刷新一次），让「点了没反应」变成「看得见在处理」 */
  const [elapsedMs, setElapsedMs] = useState(0)
  /**
   * 安装前重复预览（P0-2）：这一包里有多少条已经在本地库里了。
   *
   * 结果与「它属于哪个 slug」一起存：slug 变了旧结果自然失效，
   * 因此不需要在 effect 里同步清空 state（同步 setState 会触发级联渲染）。
   */
  const [overlapResult, setOverlapResult] = useState<
    { slug: string; unique: number; existing: number; fresh: number } | null
  >(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 只在「打开 + 网址包 + 非卸载」时取预览
  const overlapSlug = open && plugin && plugin.kind === 'site-pack' && mode !== 'uninstall' ? plugin.slug : null
  /** null = 还没取到（加载中或接口失败）：预览只是体感优化，失败不拦安装 */
  const overlap = overlapResult && overlapResult.slug === overlapSlug ? overlapResult : null

  useEffect(() => {
    if (!overlapSlug) return
    let cancelled = false
    void hubGet<{ unique: number; existing: number; fresh: number }>(
      `/plugins/${encodeURIComponent(overlapSlug)}/overlap`,
    )
      .then((res) => {
        if (!cancelled) setOverlapResult({ slug: overlapSlug, ...res })
      })
      .catch(() => {
        // 预览失败不影响安装能力，保持 null 即可
      })
    return () => {
      cancelled = true
    }
  }, [overlapSlug])

  // 组件卸载时清掉计时器，避免关闭弹窗后继续 setState
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
    },
    [],
  )

  if (!plugin) return null

  const summary = plugin.summary
  // D1 更新链路：已安装且市场版本更高时，本弹窗以「更新」语义呈现
  // （执行通道不变——重装即升级，服务端幂等增量，只增不删）
  const isUpdate =
    mode === 'upgrade' ||
    (mode === 'install' && resolveInstallAction(plugin.installedVersion, plugin.version) === 'update')

  // 组合包任一成员失效（下架/隔离/删除/类型漂移）即 fail closed，安装按钮禁用；
  // 卸载不受影响，避免用户被失效组合包"锁死"。
  const bundleBlocked = plugin.kind === 'bundle' && plugin.bundleReady === false
  const memberKindLabels: Record<string, string> = {
    'site-pack': '网址包',
    'search-pack': '搜索引擎包',
    theme: '主题',
  }

  const handleConfirm = async () => {
    setLoading(true)
    const startedAt = Date.now()
    setElapsedMs(0)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 100)
    try {
      const effectiveIdentity = identity || getIdentity()
      if (mode !== 'uninstall') {
        // 1. 服务端状态登记与 site-pack 增量写库
        //    bundle 由服务端逐个成员复用同一条安装管道（预检失败即拒绝，无半安装）
        const res = await installPlugin(plugin.slug, effectiveIdentity)

        // 2. 客户端工作台预设消费（组合包不含 workspace-preset，此分支不会被 bundle 命中）
        if (plugin.kind === 'workspace-preset' && onApplyPreset) {
          onApplyPreset(plugin.manifest.payload, presetMode)
        }

        // 3. 客户端主题运行时激活（组合包只登记安装，主题需用户在已安装页显式启用）
        if (plugin.kind === 'theme') {
          const payload = plugin.manifest.payload
          setActiveTheme({
            slug: plugin.slug,
            name: plugin.name,
            tokens: payload.tokens,
            accent: payload.accent,
          })
        }

        // 4. 搜索引擎包运行时注册：`!前缀` 直达写入本地运行时并持久化
        if (plugin.kind === 'search-pack') {
          registerSearchPackEngines(plugin.slug, plugin.manifest?.payload?.engines)
        }

        // 5. 组合包内的搜索引擎包成员：逐成员补注册 `!前缀`（尽力而为，失败不阻断安装结果）
        if (plugin.kind === 'bundle') {
          const searchPacks = (plugin.bundleItems ?? []).filter(
            (item) => item.kind === 'search-pack' && item.available,
          )
          await Promise.allSettled(
            searchPacks.map(async (item) => {
              const detail = await fetchPluginDetail(item.slug)
              const engines = detail?.plugin?.manifest?.payload?.engines
              if (engines) registerSearchPackEngines(item.slug, engines)
            }),
          )
        }

        const bundleItems: Array<{ alreadyInstalled?: boolean }> = Array.isArray(res?.applied?.bundleItems)
          ? res.applied.bundleItems
          : []
        const installedCount = bundleItems.filter((item) => !item.alreadyInstalled).length

        /**
         * 成功提示要回答「到底发生了什么」，而不是只说「装好了」。
         * 服务端 `applied.sitesSkipped` 是等价 URL 去重后的跳过数 ——
         * 它正是跨包重复的量化结果（A 包装过、B 包又声明了同一条 URL），
         * 此前这个数字只写进审计日志，用户完全看不到。
         */
        const applied = res?.applied ?? {}
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
        const sitePackDescription =
          plugin.kind === 'site-pack' && !res.alreadyInstalled
            ? `新增 ${applied.sitesAdded ?? 0} 个站点` +
              ((applied.sitesSkipped ?? 0) > 0 ? `，跳过 ${applied.sitesSkipped} 个已存在` : '') +
              ((applied.categoriesCreated ?? 0) > 0 ? `，新建 ${applied.categoriesCreated} 个分类` : '') +
              ` · 用时 ${elapsedSec}s`
            : undefined

        toast.success(
          isUpdate
            ? `已更新到 v${plugin.version}！`
            : res.alreadyInstalled
              ? '插件已处于安装状态'
              : plugin.kind === 'bundle'
                ? `组合包「${plugin.name}」处理完成`
                : `成功安装「${plugin.name}」！`,
          sitePackDescription
            ? { description: sitePackDescription }
            : plugin.kind === 'bundle' && !res.alreadyInstalled
              ? {
                  description:
                    (installedCount > 0
                      ? `已安装 ${installedCount} 个新成员；主题类成员可在「已安装」页启用。`
                      : '所有成员此前均已安装，无需重复引入。') + `用时 ${elapsedSec}s`,
                }
              : res.alreadyInstalled
                ? { description: `未产生重复数据 · 用时 ${elapsedSec}s` }
                : undefined,
        )
      } else {
        // 卸载
        const res = await uninstallPlugin(plugin.slug, effectiveIdentity, removeSites)

        // 若卸载的是正在生效的主题，回退系统默认
        if (plugin.kind === 'theme') {
          resetTheme()
        }

        // 卸载搜索引擎包时移除其注册的 `!前缀`；其它类型不涉及客户端注册
        if (plugin.kind === 'search-pack') {
          unregisterSearchPackEngines(plugin.slug)
        }

        toast.success(`已卸载「${plugin.name}」`, {
          description:
            removeSites && res.sitesRemoved > 0
              ? `已软删除 ${res.sitesRemoved} 个关联站点（可去回收站恢复）`
              : '站点数据已保留在您的实例中',
        })
      }

      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      toast.error(mode === 'uninstall' ? '卸载失败' : isUpdate ? '升级失败' : '安装失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4 sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {pluginKindLabel(plugin.kind)}
            </Badge>
            <span className="text-xs font-mono text-muted-foreground">v{plugin.version}</span>
          </div>
          <DialogTitle className="text-lg font-semibold pt-1">
            {mode === 'uninstall'
              ? `确认卸载「${plugin.name}」`
              : `确认${isUpdate ? '更新' : '安装'}「${plugin.name}」`}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            {mode === 'uninstall'
              ? '卸载后您可以随时在插件市场重新安装。'
              : isUpdate
                ? '将增量导入新版本内容（等价 URL 去重，不覆盖或删除您已有的数据）：'
                : '请确认以下将要引入的数据变更与生效范围：'}
          </DialogDescription>
        </DialogHeader>

        {/* 详情影响说明 */}
        <div className="py-3 space-y-3">
          {mode !== 'uninstall' ? (
            <>
              {plugin.kind === 'site-pack' && (
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-medium text-xs">
                    <Globe className="w-4 h-4" />
                    <span>增量站点与分类导入</span>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                    <li>将新增约 <strong className="text-foreground">{summary?.siteCount ?? 0}</strong> 个精选站点</li>
                    <li>将新增约 <strong className="text-foreground">{summary?.categoryCount ?? 0}</strong> 个分类导航</li>
                    {/* 跨包重复预览：装第二个包时最需要的一句话，避免「以为装了两百个，实际只多三个」 */}
                    {overlap && overlap.existing > 0 ? (
                      <li>
                        其中 <strong className="text-amber-600 dark:text-amber-400">{overlap.existing}</strong> 个已在您的库中
                        （跨包重复），将自动跳过；<strong className="text-foreground">预计实际新增 {overlap.fresh}</strong> 个
                      </li>
                    ) : overlap ? (
                      <li>
                        这 {overlap.unique} 个站点在您的库中<strong className="text-foreground">都不重复</strong>，
                        安装后将全部新增
                      </li>
                    ) : null}
                    <li>遵循等价 URL 去重原则，绝不覆盖您已存在的同名或同地址站点</li>
                  </ul>
                </div>
              )}

              {plugin.kind === 'workspace-preset' && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium text-xs">
                    <LayoutGrid className="w-4 h-4" />
                    <span>工作台看板预设</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    包含 <strong className="text-foreground">{summary?.boardCount ?? 1}</strong> 个看板布局和{' '}
                    <strong className="text-foreground">{summary?.widgetCount ?? 0}</strong> 个实用小组件。
                  </p>
                  <div className="space-y-1.5 pt-1">
                    <div className="text-xs font-medium text-foreground block">导入模式：</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setPresetMode('append')}
                        className={`p-2 rounded-lg border text-left transition-all ${
                          presetMode === 'append'
                            ? 'border-emerald-500 bg-emerald-500/10 text-foreground font-medium'
                            : 'border-border text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        <div>追加新看板</div>
                        <div className="text-[10px] text-muted-foreground/80">保留当前工作台</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresetMode('replace')}
                        className={`p-2 rounded-lg border text-left transition-all ${
                          presetMode === 'replace'
                            ? 'border-emerald-500 bg-emerald-500/10 text-foreground font-medium'
                            : 'border-border text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        <div>覆盖当前工作台</div>
                        <div className="text-[10px] text-muted-foreground/80">可随时在历史中撤销</div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {plugin.kind === 'theme' && (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 font-medium text-xs">
                    <Palette className="w-4 h-4" />
                    <span>即时主题激活</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    将应用 {summary?.themeTokenCount ?? 0} 项 CSS 颜色变量
                    {summary?.accent ? `，主强调色设为 ${summary.accent}` : ''}。
                  </p>
                </div>
              )}

              {plugin.kind === 'bundle' && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium text-xs">
                    <Boxes className="w-4 h-4" />
                    <span>
                      组合包：一次登记 {summary?.bundleItemCount ?? plugin.bundleItems?.length ?? 0} 个成员插件
                    </span>
                  </div>
                  {bundleBlocked && (
                    <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>部分成员已失效，安装已暂停；可等待作者更新组合包或选择单独安装其余插件。</span>
                    </div>
                  )}
                  {Array.isArray(plugin.bundleItems) && plugin.bundleItems.length > 0 && (
                    <ul className="text-xs text-muted-foreground space-y-1">
                      {plugin.bundleItems.map((item) => (
                        <li key={item.slug} className="flex items-center gap-1.5 min-w-0">
                          {item.available ? (
                            <Check className="w-3 h-3 shrink-0 text-emerald-500" />
                          ) : (
                            <AlertTriangle className="w-3 h-3 shrink-0 text-destructive" />
                          )}
                          <span className="text-foreground truncate">{item.name ?? item.slug}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {memberKindLabels[item.kind] ?? item.kind}
                          </span>
                          {!item.available && item.reason && (
                            <span className="text-[10px] text-destructive shrink-0">{item.reason}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    成员按清单顺序复用市场同一条安装管道：站点与搜索引擎立即生效；主题仅登记安装，可在「已安装」页显式启用。
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              {plugin.kind === 'site-pack' && (
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-border/80 bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors">
                  <input
                    type="checkbox"
                    checked={removeSites}
                    onChange={(e) => setRemoveSites(e.target.checked)}
                    className="mt-0.5 rounded border-border"
                  />
                  <div className="text-xs space-y-0.5">
                    <span className="font-medium text-foreground block">
                      同时清理该插件带来的站点
                    </span>
                    <span className="text-muted-foreground block text-[11px]">
                      勾选后将软删除来源为本插件的所有站点（移动至回收站，可随时找回恢复）。不勾选则保留站点数据。
                    </span>
                  </div>
                </label>
              )}
              {plugin.kind === 'theme' && (
                <p className="text-xs text-muted-foreground">
                  卸载后系统将自动恢复为您原先的默认外观主题。
                </p>
              )}
              {plugin.kind === 'bundle' && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  卸载组合包只解除组合关系：<strong className="text-foreground">不会</strong>级联卸载成员插件，也不会删除成员已引入的站点。
                  如需清理，请在「已安装」页逐个处理成员。
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
          {mode === 'uninstall' ? (
            <Link
              href="/marketplace/installed"
              onClick={() => onOpenChange(false)}
              className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 inline-flex items-center gap-1"
            >
              <span>前往已安装管家 →</span>
            </Link>
          ) : <div />}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border/60 hover:bg-muted/60 transition-colors"
            >
              取消
            </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || (mode !== 'uninstall' && bundleBlocked)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === 'uninstall'
                ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            {loading ? (
              <span>
                处理中…
                {elapsedMs >= 200 ? ` ${(elapsedMs / 1000).toFixed(1)}s` : ''}
              </span>
            ) : mode === 'uninstall' ? (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>确认卸载</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>{isUpdate ? '立即平滑升级' : '立即安装'}</span>
              </>
            )}
          </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
