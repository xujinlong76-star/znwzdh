'use client'

/**
 * 简报页全空态（客户端小组件，/brief 专属）。
 *
 * 为什么必须是个独立的客户端组件：全空态的 EmptyState 要一个 Flame 图标，
 * 而 /brief 是服务端组件——图标元素（<Flame …/>）不能由服务端创建后当 prop
 * 传给客户端组件：跨 RSC 边界后它在预渲染期不再满足 isValidElement，
 * 又被 EmptyState 的 isComponentType（见 components/ui/empty-state.tsx）
 * 误判为组件类型，`<Icon />` 遂报「Element type is invalid … got: object」，
 * isr-build 整步失败（2026-11-23 06:22 进化轮定位，构建 18/20/21）。
 * 本组件只接收可序列化的字符串 prop，图标在客户端内部实例化，
 * 边界上只过数据、不过元素。
 */
import { Flame } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/registry/new-york/ui/button'

export default function BriefEmptyState({
  title,
  why,
  next,
  actionHref,
  actionLabel,
}: {
  title: string
  why: string
  next: string
  actionHref: string
  actionLabel: string
}) {
  return (
    <EmptyState
      // 客户端调用方传组件类型，由 EmptyState 统一套尺寸与主色（warning 档
      // w-6 h-6 + text-amber-700，与此前服务端元素传法的视觉逐字一致）。
      icon={Flame}
      iconTone="warning"
      title={title}
      description={
        <>
          {why} {next}
        </>
      }
      action={
        <Button asChild size="sm" variant="outline" className="text-xs">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      }
    />
  )
}
