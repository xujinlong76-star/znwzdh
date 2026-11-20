'use client'

import { useEffect, useRef } from 'react'
import {
  SEARCH_ENGINE_OPTIONS,
  externalSearchEngineName,
  externalSearchUrl,
  type SearchEngineId,
} from '@/lib/user-settings'
import { updateUserPreferences, useUserPreference } from '@/lib/user-preferences'
import { safeWindowOpen } from '@/lib/safe-url'

/**
 * /search 搜索框旁的一级引擎切换（W4-0622-1 缺口 ①）。
 *
 * 只复用同一偏好键 `defaultSearchEngine`：读用 `useUserPreference`、
 * 写用 `updateUserPreferences`，不另立引擎状态、不写新存储键。
 * 与用户中心设置页是同一份偏好——这里切了，那边跟着变，反之亦然。
 *
 * 行为：
 * - 选「站内」：表单照常 GET 提交到 /search（服务端渲染结果页）。
 * - 选站外引擎：提交时在新标签页打开该引擎的搜索地址
 *  （`externalSearchUrl`，与 Spotlight 站外出口同一来源，不手写地址）；
 *   空查询不拦截，照常走站内（不跳出一个空搜索结果页）。
 * - 站外打开失败时回落站内：safeWindowOpen 返回 null（地址未过安全闸 /
 *   新标签页被浏览器拦截）时不拦截提交，表单照常 GET 到 /search，
 *   用户至少能看到站内结果——而不是点完搜索什么都没发生。
 * - 无 JS 时本控件不参与提交（没有 name，不进 GET 参数），站内搜索照常可用。
 *
 * 选项文案用短名（站内 / Google / 百度 …）：搜索框旁放不下设置页那套
 * 双语长标签；短名同样来自 `externalSearchEngineName`，站内档单独写「站内」。
 * 下拉本身按 `SEARCH_ENGINE_OPTIONS` 枚举渲染，选项与设置页永远同源。
 */
export function SearchEngineSwitch() {
  const engine = useUserPreference('defaultSearchEngine')
  const selectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    const select = selectRef.current
    const form = select?.closest('form')
    if (!form) return
    const onSubmit = (e: SubmitEvent) => {
      if (engine === 'internal') return
      const q = new FormData(form).get('q')
      const query = typeof q === 'string' ? q.trim() : ''
      if (!query) return
      const url = externalSearchUrl(engine, query)
      if (!url) return
      // URL 卫生：裸 window.open 会被 url-hygiene.test.ts 拦下；
      // safeWindowOpen 先过 safeHref 闸（不过闸返回 null、不开新页），
      // 再以 '_blank' + noopener,noreferrer 打开——行为与原来逐字一致，
      // 地址本身仍由 externalSearchUrl 的引擎白名单 + 编码后查询词构造。
      // 只在新标签页真的打开时才拦截提交：返回 null（地址未过安全闸 /
      // 弹窗被拦截）时不拦截，表单照常 GET 提交到 /search 回落站内搜索，
      // 否则用户点完搜索什么都没发生、无任何反馈。
      const opened = safeWindowOpen(url)
      if (opened) e.preventDefault()
    }
    form.addEventListener('submit', onSubmit)
    return () => form.removeEventListener('submit', onSubmit)
  }, [engine])

  const engineName = engine === 'internal' ? '站内' : (externalSearchEngineName(engine) ?? '站外')

  return (
    <span className="flex shrink-0 flex-col gap-1">
      <label htmlFor="search-engine-switch" className="sr-only">
        搜索引擎
      </label>
      <select
        id="search-engine-switch"
        ref={selectRef}
        aria-label="搜索引擎"
        value={engine}
        title={engine === 'internal' ? '站内聚合搜索' : `用${engineName}搜索`}
        onChange={(e) => updateUserPreferences({ defaultSearchEngine: e.target.value as SearchEngineId })}
        className="h-10 max-w-28 rounded-xl border border-border/70 bg-background/90 px-2 text-sm text-foreground shadow-xs transition-colors hover:border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
      >
        {SEARCH_ENGINE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.value === 'internal' ? '站内' : (externalSearchEngineName(opt.value) ?? opt.label)}
          </option>
        ))}
      </select>
      {engine !== 'internal' ? (
        <span className="max-w-28 text-[11px] leading-tight text-muted-foreground">
          点「搜索」用{engineName}站外搜
        </span>
      ) : null}
    </span>
  )
}
