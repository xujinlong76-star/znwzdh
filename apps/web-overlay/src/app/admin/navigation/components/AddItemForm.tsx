'use client'

import dynamic from 'next/dynamic'
import type { AddItemFormProps } from './AddItemForm.impl'

/**
 * 同路径懒加载包装器：真正实现里的 react-hook-form / zod / @hookform/resolvers
 * （合计约 145 KB 首屏 chunk）只在弹窗打开后才加载。
 *
 * 页面仍然按原路径 `../../components/AddItemForm` 引用，无需改动上游页面。
 */
const AddItemFormImpl = dynamic(() => import('./AddItemForm.impl').then((mod) => mod.AddItemForm), {
  ssr: false,
  loading: () => (
    <div className="space-y-4" aria-busy="true" aria-label="正在加载表单">
      <div className="h-10 w-full rounded-md bg-muted/60" />
      <div className="h-10 w-full rounded-md bg-muted/60" />
      <div className="h-24 w-full rounded-md bg-muted/60" />
    </div>
  ),
})

export function AddItemForm(props: AddItemFormProps) {
  return <AddItemFormImpl {...props} />
}
