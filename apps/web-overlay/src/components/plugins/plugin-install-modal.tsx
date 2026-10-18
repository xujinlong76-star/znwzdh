'use client'

import { useState } from 'react'
import {
  type HubPluginItem,
  installPlugin,
  uninstallPlugin,
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
import { Globe, LayoutGrid, Palette, AlertTriangle, Check, Trash2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { setActiveTheme, resetTheme } from '@/lib/plugins/theme-runtime'

export interface PluginInstallModalProps {
  plugin: HubPluginItem | null
  mode: 'install' | 'uninstall'
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

  if (!plugin) return null

  const summary = plugin.summary

  const handleConfirm = async () => {
    setLoading(true)
    try {
      if (mode === 'install') {
        // 1. 服务端状态登记与 site-pack 增量写库
        const res = await installPlugin(plugin.slug, identity)

        // 2. 客户端工作台预设消费
        if (plugin.kind === 'workspace-preset' && onApplyPreset) {
          onApplyPreset(plugin.manifest.payload, presetMode)
        }

        // 3. 客户端主题运行时激活
        if (plugin.kind === 'theme') {
          const payload = plugin.manifest.payload
          setActiveTheme({
            slug: plugin.slug,
            name: plugin.name,
            tokens: payload.tokens,
            accent: payload.accent,
          })
        }

        toast.success(
          res.alreadyInstalled
            ? '插件已处于安装状态'
            : `成功安装「${plugin.name}」！`
        )
      } else {
        // 卸载
        const res = await uninstallPlugin(plugin.slug, identity, removeSites)

        // 若卸载的是正在生效的主题，回退系统默认
        if (plugin.kind === 'theme') {
          resetTheme()
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
      toast.error(mode === 'install' ? '安装失败' : '卸载失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {pluginKindLabel(plugin.kind)}
            </Badge>
            <span className="text-xs font-mono text-muted-foreground">v{plugin.version}</span>
          </div>
          <DialogTitle className="text-lg font-semibold pt-1">
            {mode === 'install' ? `确认安装「${plugin.name}」` : `确认卸载「${plugin.name}」`}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            {mode === 'install'
              ? '请确认以下将要引入的数据变更与生效范围：'
              : '卸载后您可以随时在插件市场重新安装。'}
          </DialogDescription>
        </DialogHeader>

        {/* 详情影响说明 */}
        <div className="py-3 space-y-3">
          {mode === 'install' ? (
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
            </div>
          )}
        </div>

        <DialogFooter className="flex sm:justify-end gap-2 pt-2">
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
            disabled={loading}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-all ${
              mode === 'install'
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'bg-destructive text-destructive-foreground hover:opacity-90'
            }`}
          >
            {loading ? (
              <span>处理中…</span>
            ) : mode === 'install' ? (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>立即安装</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>确认卸载</span>
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
