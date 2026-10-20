'use client'

import dynamic from "next/dynamic"

// 同路径懒加载包装器：页面仍按原方式 import { AddNavigationForm }，
// 但 react-hook-form / zod / 表单 UI 只在“添加分类”弹窗打开后才加载。
export const AddNavigationForm = dynamic(
  () => import("./AddNavigationForm.impl").then((mod) => mod.AddNavigationForm),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-10 w-full animate-pulse rounded-md border bg-muted"
          />
        ))}
      </div>
    ),
  }
)
