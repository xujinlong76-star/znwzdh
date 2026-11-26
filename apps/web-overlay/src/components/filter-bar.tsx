import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

/**
 * 筛选条原语（2026-11-25 UI 评审 P0-1 阶段 B）：搜索框 + 主筛选 chips 槽 +
 * 右侧计数/操作区，收编 /sites、/hot、/category 三处各写各的筛选条壳。
 *
 * 统一的是「解剖与配方」，不是行为：取数、过滤逻辑、搜索历史上报仍留在各页。
 *   - 壳：圆角卡（rounded-xl + bg-card/60 + backdrop-blur-xs）——三处此前有
 *     rounded-xl/rounded-2xl 与 bg-card/60、bg-muted/30 两套写法；
 *   - 输入框：统一 44px 触控档（pointer-coarse:min-h-11，桌面 h-9），
 *     type=search + enterKeyHint 等移动端人因属性与全站搜索框同口径
 *     （hot 页 2026-11-21 先行，这里推广到全部筛选条）；
 *   - 清空钮：aria-label + title 双标注，::after 无形扩点击区到 ~46px；
 *   - 右侧：meta 在前（计数文案）、actions 在后（重置/展开收起/全站检索出口）。
 *
 * 属性名刻意保持 placeholder / aria-label 的 JSX 原形（扁平 props 而不是 search 对象）：
 * local-search-record-bundle-guard.test.ts 按 `placeholder="…"` 字面量扫调用点源码。
 *
 * `chips` 槽：主筛选 chips 行（换行排在搜索行下方）。当前三处暂无内嵌 chips，
 * 槽位按评审 P0-1 规格预留，随阶段 C「首屏减负」（首页主筛选 chips 收编）启用。
 *
 * 次级「筛选」弹层不在本原语内：那是阶段 C 首页的子分类/快捷站点弹层，
 * 等有真实消费方再定型，不预先抽象。
 */

export function FilterBar({
  value,
  onChange,
  onClear,
  placeholder,
  'aria-label': ariaLabel,
  chips,
  meta,
  actions,
  className,
}: {
  value: string
  onChange: (value: string) => void
  /** 点清空钮时的回调；默认 `onChange('')` */
  onClear?: () => void
  placeholder: string
  /** 输入框无障碍名 */
  'aria-label': string
  /** 主筛选 chips 行（换行占满整行，排在搜索行下方） */
  chips?: ReactNode
  /** 右侧计数文案（mono 字体由文案节点自带，保持调用方排版权） */
  meta?: ReactNode
  /** 右侧操作：重置 / 展开收起 / 全站检索出口等 */
  actions?: ReactNode
  className?: string
}) {
  const clear = onClear ?? (() => onChange(''))
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2.5 p-2.5 sm:p-3 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs shadow-2xs',
        className,
      )}
    >
      <div className="relative flex-1 min-w-[200px] sm:min-w-[15rem] max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="h-9 pointer-coarse:min-h-11 pl-9 pr-8 text-xs sm:text-sm bg-background/80 [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="清空筛选输入"
            title="清空筛选"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-sm cursor-pointer after:absolute after:-inset-3.5 after:content-['']"
          >
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {meta || actions ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {meta}
          {actions}
        </div>
      ) : null}

      {chips ? <div className="w-full flex flex-wrap items-center gap-1.5">{chips}</div> : null}
    </div>
  )
}
