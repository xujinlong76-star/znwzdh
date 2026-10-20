/**
 * `@hello-pangea/dnd` 深路径导入的类型声明。
 *
 * 背景：为了把拖拽库从首屏 chunk 里挪出去，next.config 的 `turbopack.resolveAlias`
 * 把裸包名指向 `src/lib/lazy-dnd.tsx`；代理内部必须绕开别名（否则动态 import 会再次
 * 命中别名形成自递归），于是直接指向包内 ESM 产物 `dist/dnd.esm.js`。
 *
 * 该子路径不在包的 `types` 映射里，TS 无法自行推断，这里用 ambient module 把类型
 * 重新指回裸包名——运行时仍然加载同一份实现，类型与官方入口保持一致。
 */
declare module '@hello-pangea/dnd/dist/dnd.esm.js' {
  export * from '@hello-pangea/dnd'
}
