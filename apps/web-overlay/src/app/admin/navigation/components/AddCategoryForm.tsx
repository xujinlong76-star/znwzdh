'use client'

import dynamic from 'next/dynamic'
import type { AddCategoryFormProps } from './AddCategoryForm.impl'

/**
 * 同路径懒加载包装器：react-hook-form / zod / @hookform/resolvers（约 145 KB 首屏 chunk）
 * 只在弹窗打开后加载；上游页面按原路径引用，无需改动。
 */
const AddCategoryFormImpl = dynamic(
  () => import('./AddCategoryForm.impl').then((mod) => mod.AddCategoryForm),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4" aria-busy="true" aria-label="正在加载表单">
        <div className="h-10 w-full rounded-md bg-muted/60" />
        <div className="h-10 w-full rounded-md bg-muted/60" />
      </div>
    ),
  },
)

export function AddCategoryForm(props: AddCategoryFormProps) {
  return <AddCategoryFormImpl {...props} />
}
