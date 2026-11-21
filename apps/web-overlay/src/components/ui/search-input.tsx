"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"

export type SearchInputProps = React.InputHTMLAttributes<HTMLInputElement>

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <div className="relative">
        <Icons.search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          /* 2026-11-21 移动端触控与输入人因：
             - type="search" 让 iOS 键盘显示「搜索」键而不是「换行」
             - inputMode="search" 让部分 Android 输入法切到搜索布局
             - enterKeyHint="search" 统一回车键文案（iOS 16+/Chrome 119+）
             - autoCapitalize/autoCorrect 关闭，避免「react」被首字母大写成「React」干扰检索
             - spellCheck=false 关闭波浪线噪音
             调用方显式传 type 时以调用方为准（保持受控灵活度）。 */
          type={type ?? "search"}
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            // 移动端 text-base(16px) 防 iOS Safari 聚焦自动放大；sm 起回到 text-sm
            "flex h-9 w-full rounded-md border border-border-strong bg-background pl-9 pr-3 py-1 text-base shadow-sm transition-colors sm:text-sm",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
    )
  }
)
SearchInput.displayName = "SearchInput"

export { SearchInput } 