import Link from 'next/link'
import { SlidersHorizontal, X } from 'lucide-react'
import { searchHref } from '@/lib/search-page'

/**
 * 搜索结果页的正交分面筛选栏（服务端渲染，URL 即状态）。
 *
 * 为什么必须在前台透出：底层 site_facets 早已支持「付费模式 / 运行平台 /
 * 产品形态 / 语言 / 场景」五组正交维度，但此前只存在于 API 与管理端。
 * 用户找工具的真实需求恰恰是复合维度（如「开源 + Web + 自托管」），
 * 两级分类树无法表达——这是信息组织 MECE 破裂的直接解法。
 *
 * 全部用 <Link>：筛选态可分享、可回退、可被爬虫跟随，且无客户端 JS 依赖。
 * 单选维度（pricing）点击即替换，多选维度（platform/form）点击即增删。
 */

export interface FacetOptionWithCount {
  value: string
  label: string
  labelEn?: string
  count: number
}

export interface FacetGroup {
  key: string
  label: string
  labelEn?: string
  description?: string
  multiselect?: boolean
  options: FacetOptionWithCount[]
}

export interface SearchFacetBarProps {
  groups: FacetGroup[]
  q: string
  tag: string | null
  category: string | null
  selected: Record<string, string[]>
}

/** 生成「切换某个分面值」后的 URL */
function toggleHref(
  props: Omit<SearchFacetBarProps, 'groups'>,
  key: string,
  value: string,
  multiselect: boolean,
): string {
  const current = props.selected[key] ?? []
  const has = current.includes(value)
  let next: string[]
  if (multiselect) {
    next = has ? current.filter((v) => v !== value) : [...current, value]
  } else {
    // 单选：点已选中项＝取消；点其它值＝替换
    next = has ? [] : [value]
  }
  const facets: Record<string, string[]> = { ...props.selected, [key]: next }
  return searchHref({ q: props.q, tag: props.tag, category: props.category, facets })
}

/** 清除全部分面，保留查询词/标签/分类 */
function clearHref(props: Omit<SearchFacetBarProps, 'groups'>): string {
  return searchHref({ q: props.q, tag: props.tag, category: props.category })
}

export function SearchFacetBar({ groups, q, tag, category, selected }: SearchFacetBarProps) {
  // 只展示有数据的维度：空维度画出来只是一排点不动的按钮
  const visible = groups.filter((g) => g.options.length > 0)
  if (visible.length === 0) return null

  const selectedCount = Object.values(selected).reduce((n, v) => n + v.length, 0)
  const base = { q, tag, category, selected }

  return (
    <section
      aria-label="分面筛选"
      className="space-y-2.5 rounded-2xl border border-border/70 bg-card/50 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-500" aria-hidden />
          多维筛选
          {selectedCount > 0 ? (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary">
              已选 {selectedCount}
            </span>
          ) : null}
        </h2>
        {selectedCount > 0 ? (
          <Link
            href={clearHref(base)}
            className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            <X className="h-3 w-3" aria-hidden />
            清空筛选
          </Link>
        ) : null}
      </div>

      <dl className="space-y-2">
        {visible.map((group) => {
          const picked = selected[group.key] ?? []
          const multiselect = group.multiselect === true
          return (
            <div key={group.key} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2.5">
              <dt className="shrink-0 pt-0.5 text-[11px] font-medium text-muted-foreground sm:w-16">
                {group.label}
              </dt>
              <dd className="flex flex-wrap gap-1.5">
                {group.options.map((opt) => {
                  const active = picked.includes(opt.value)
                  return (
                    <Link
                      key={opt.value}
                      href={toggleHref(base, group.key, opt.value, multiselect)}
                      aria-pressed={active}
                      title={opt.labelEn ? opt.label + ' · ' + opt.labelEn : opt.label}
                      className={
                        active
                          ? 'inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary'
                          : 'inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground'
                      }
                    >
                      <span>{opt.label}</span>
                      <span className="font-mono text-[10px] opacity-70">{opt.count}</span>
                    </Link>
                  )
                })}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
