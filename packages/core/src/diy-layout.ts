/**
 * 首页次世代 DIY 可视化排版与分类编排核心算法引擎 (DIY Core Layout Engine)
 *
 * 具体算法按域拆在 ./diy-layout/ 下：
 *  1. ordering    分类拓扑编排、置顶与隐藏算法
 *  2. ranking     时间半衰期自适应站点热度排序算法
 *  3. health      人机工程学与香农信息熵排版健康度评估算法
 *  4. merge       三路差异比对与无损合并引擎
 *  5. suggestion  关键词与 Jaccard 相似度智能分类推荐算法
 *  6. presets     开箱即用情境模版
 *  7. sanitize    配置清洗与防御（不可信输入第一道防线）
 *  8. history     撤销/重做时间旅行栈算法
 *  9. collapse    分类手风琴折叠状态算法
 *
 * 本文件只做聚合再导出：对外公共 API（index.ts 的 `export * from "./diy-layout.ts"`）
 * 与拆分前完全一致，调用方无需任何改动。
 */

export * from './diy-layout/ordering.ts'
export * from './diy-layout/ranking.ts'
export * from './diy-layout/health.ts'
export * from './diy-layout/merge.ts'
export * from './diy-layout/suggestion.ts'
export * from './diy-layout/presets.ts'
export * from './diy-layout/sanitize.ts'
export * from './diy-layout/history.ts'
export * from './diy-layout/collapse.ts'
