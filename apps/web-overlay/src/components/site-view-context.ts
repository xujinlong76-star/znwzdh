'use client'

import { createContext, useContext } from 'react'

/**
 * 根布局算好、客户端组件直接消费的站点设置视图。
 *
 * 为什么用 context 而不是让页脚自己读配置：Footer 有 20 处挂在客户端组件里
 * （marketplace / me / favorites / preferences…），把它改成 async 服务端组件会
 * 直接让这些页面编译失败；而中枢读取只能在服务端做。根布局本来就要读这份配置
 * （标题与默认主题），顺手把结果透传下来是唯一不额外打中枢、也不动渲染边界的做法。
 *
 * 品牌名在这里已由服务端收敛过（空值与上游 NavSphere 都折叠成内置默认），
 * 客户端不必再 import 依赖中枢读取的 seo 模块。
 */
export interface SiteViewModel {
  brand: string
  linkTarget: '_blank' | '_self'
  footerText?: string
  icp?: string
}

export const SiteContext = createContext<SiteViewModel | null>(null)

export function useSiteViewModel(): SiteViewModel | null {
  return useContext(SiteContext)
}
