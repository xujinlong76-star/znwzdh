'use client'

/**
 * 「设置」页：全局导航 / 0-RTT / 历史保留 / 遥测等偏好的唯一编辑入口。
 *
 * 数据逻辑在 `hooks/use-me-settings.ts`；本组件只负责四态渲染与反馈。
 * 登录态写云端，匿名态写本机（登录后 SessionSync 会同步到云端）。
 */
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { CheckCircle2, Loader2, Settings2 } from 'lucide-react'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { AnonymousHintInline } from '@/components/user-center/anonymous-hint'
import { SectionState } from '@/components/user-center/section-state'
import { SettingsPanel } from '@/components/user-center/settings-panel'
import { useMeSettings } from '@/hooks/use-me-settings'
import type { UserSettingsPatch } from '@/lib/user-settings'

export function MeSettingsView() {
  const { toast } = useToast()
  const controller = useMeSettings()
  const { state, settings, busy, notice, error } = controller

  const handleChange = async (patch: UserSettingsPatch, successTitle?: string) => {
    const ok = await controller.patch(patch)
    if (ok) {
      toast({ title: successTitle ?? '偏好设置已保存并校验通过' })
      return
    }
    toast({ title: '设置保存失败', description: '中枢暂不可用，请稍后重试', variant: 'destructive' })
  }

  const handleRestore = async () => {
    const ok = await controller.restoreDefaults()
    if (ok) {
      toast({ title: '已恢复默认导航偏好设置' })
      return
    }
    toast({ title: '恢复失败', description: '中枢暂不可用，请稍后重试', variant: 'destructive' })
  }

  return (
    <Container as="main" id="main-content" className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <CenterPageHeader
        title="设置"
        icon={Settings2}
        eyebrow="导航与隐私"
        back={{ href: '/me', label: '用户中心' }}
        description="默认搜索引擎、卡片密度、0-RTT、快捷键、历史保留与遥测开关都在这里统一管理。"
      />

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-300"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {notice}
          </span>
          <button
            type="button"
            onClick={controller.dismissNotice}
            className="text-[11px] underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            知道了
          </button>
        </div>
      )}

      {state === 'loading' && (
        <SectionState variant="loading" rows={3} loadingLabel="正在加载偏好设置" />
      )}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="设置暂时取不到"
          description={error ?? '云端暂时不可用，这不代表设置被清空——恢复后原样回来。'}
          onRetry={() => void controller.reload()}
        />
      )}

      {state === 'anonymous' && (
        <AnonymousHintInline>
          当前为本机匿名身份：设置只保存在这个浏览器。登录后会自动把本机偏好同步到云端。
        </AnonymousHintInline>
      )}

      {(state === 'ready' || state === 'anonymous') && (
        <SettingsPanel
          value={settings}
          busy={busy}
          idPrefix="me-settings"
          onChange={(patch, title) => void handleChange(patch, title)}
          onRestoreDefaults={() => void handleRestore()}
        />
      )}

      {busy && (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          正在保存…
        </p>
      )}

      <Footer />
    </Container>
  )
}
