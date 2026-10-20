'use client'

import dynamic from 'next/dynamic'

/**
 * `@hello-pangea/dnd` 的懒加载代理（约 92 KB 首屏 chunk）。
 *
 * 为什么要代理：管理端几个列表页（`/admin/navigation/[id]/*`）直接静态 import
 * 拖拽库，把 ~92 KB 拖进首屏；这些页面是上游文件，改它们意味着把整页复制进 overlay。
 * 因此在 next.config 的 `turbopack.resolveAlias` 里把裸包名指向本文件：
 *  - 页面侧 import 变成「动态组件」，拖拽库进入异步 chunk；
 *  - 本文件必须绕开别名直接指向包内 ESM 产物，否则动态 import 会再次命中别名形成自递归。
 *
 * 代价与边界：
 *  - 拖拽库在交互时才加载（列表页首屏不再背这 92 KB）；
 *  - `ssr: false` 表示服务端不渲染拖拽树，客户端挂载后补上（这些页面的数据本来就是客户端取的）；
 *  - 三个组件共用同一份真实模块（同一 import 源），React context 不会分裂。
 */
const loadDnd = () => import('@hello-pangea/dnd/dist/dnd.esm.js')

export const DragDropContext = dynamic(() => loadDnd().then((m) => m.DragDropContext), { ssr: false })
export const Droppable = dynamic(() => loadDnd().then((m) => m.Droppable), { ssr: false })
export const Draggable = dynamic(() => loadDnd().then((m) => m.Draggable), { ssr: false })

export type { DropResult } from '@hello-pangea/dnd'
