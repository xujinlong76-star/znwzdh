'use client'

import { AlertTriangle, ChevronDown, HardDrive, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * 零知识金库「人话化信任弹窗」（/favorites Header 的 AES-256-GCM 徽标触发）。
 *
 * 为什么不用技术术语堆：普通用户不关心 PBKDF2 迭代次数，只关心三件事——
 * 东西放哪、密码去哪、忘了怎么办。3 条清单只讲这三件事。
 *
 * 结构：VaultSecurityPopoverContent 是纯展示（无 Radix、无状态），可直接
 * renderToString 测试；VaultSecurityPopover 只负责触发与开关（Radix 处理
 * 外点关闭与 Esc 关闭）。
 */
export function VaultSecurityPopoverContent() {
  return (
    <div className="space-y-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
          零知识金库 · 安全白皮书
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">三句话讲清你的收藏如何被保护</p>
      </div>
      <ul className="space-y-2.5">
        <li className="flex items-start gap-2 text-xs leading-relaxed">
          <HardDrive className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">收藏默认只留在本机浏览器</span>
            <span className="text-muted-foreground">——不登录、不上传，换设备前记得先导出备份。</span>
          </span>
        </li>
        <li className="flex items-start gap-2 text-xs leading-relaxed">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">
              导出 <code>.navhub.vault</code> 全程在本地浏览器完成加解密
            </span>
            <span className="text-muted-foreground">——服务器永不接触密码，也看不到你的收藏内容。</span>
          </span>
        </li>
        <li className="flex items-start gap-2 text-xs leading-relaxed">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <span>
            <span className="font-medium">忘记加密密码将无法找回，请妥善保管</span>
            <span className="text-muted-foreground">——零知识意味着连我们也帮你解不开。</span>
          </span>
        </li>
      </ul>
    </div>
  )
}

export function VaultSecurityPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="查看零知识金库安全说明"
          title="点击查看安全白皮书"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <KeyRound className="size-3" aria-hidden />
          AES-256-GCM 认证加密
          <ChevronDown className="size-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-80 max-w-[calc(100vw-2rem)]">
        <VaultSecurityPopoverContent />
      </PopoverContent>
    </Popover>
  )
}
