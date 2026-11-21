'use client'

/**
 * 读取网格真实列数（2026-11-21）。
 *
 * 列数来源：lib/grid-column-observer 的共享 ResizeObserver 已把真实列数写进
 * 网格元素的 data-grid-cols（左侧栏可拖拽，视口宽度推不出真实列数）。
 * 这里**只读**该属性并订阅其变化，不新起 observer、不重复读 getComputedStyle。
 *
 * 纯函数 previewCountForColumns 在 lib/preview-count.ts（无 React 依赖，可单测）；
 * 本文件 re-export 一次，调用方只 import 一个入口。
 */

import { useEffect, useState } from 'react'

export { PREVIEW_ROWS, previewCountForColumns } from '@/lib/preview-count'

/**
 * 读取某个网格元素当前的真实列数（data-grid-cols）。
 *
 * - 首帧（SSR / 水合前）该属性还不存在：返回传入的 fallback（通常 0），
 *   调用方据此退回「不按列数切」的保守行为，避免水合分叉。
 * - 之后订阅属性变化：ResizeObserver 每次写入新列数都会触发，
 *   预览张数随之联动。
 */
export function useGridColumns(el: HTMLElement | null, fallback = 0): number {
  const [cols, setCols] = useState<number>(fallback)

  useEffect(() => {
    if (!el) return
    const read = () => {
      const raw = Number(el.dataset.gridCols)
      if (Number.isFinite(raw) && raw > 0) setCols(Math.floor(raw))
    }
    // 挂载瞬间可能已经写好了（ResizeObserver 首帧回调早于本 effect）
    read()
    const mo = new MutationObserver(read)
    mo.observe(el, { attributes: true, attributeFilter: ['data-grid-cols'] })
    return () => mo.disconnect()
  }, [el])

  return cols
}
