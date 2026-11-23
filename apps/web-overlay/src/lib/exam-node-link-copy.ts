/**
 * /exam 带 URL 节点的动作文案映射。
 * 组件与 E2E 共用，避免测试维护一套与界面不同步的例外标签列表。
 */
/**
 * U-124：带 url 节点的链接文案按节点类型映射（只改文案，不改数据/URL）。
 *
 * 默认是准考证打印类（13 处）；10 处例外按 node.label 映射：京考「报名」
 * 是报名系统入口、京考「缴费」是缴费入口（U-395）、京考「公共科目笔试」挂的是首都之窗公告页（非办事入口）、
 * 「江西成绩复核」走报名系统申请、「成绩查询」走广东自考成绩查询系统
 *（江苏自考同名节点无 url、不渲染链接，误伤不到）。C4（2026-11-23）：
 * 广东自考·1月五节点同理映射——「新生预报名」「正式报名」走报名系统、
 * 「考生报考」走报考系统、「网上缴费」走缴费入口、「考试」挂自考系统只作
 * 查看入口（五节点 url 均为 GUANGDONG_ZIKAO_SCORE_URL，不挂默认的打印文案）。
 * ExamNode 无类型字段，映射键只能是 label；
 * 映射只在 node.url 分支内调用，国考/省考同名「公共科目笔试」节点无 url、
 * 不渲染链接，误伤不到。可见文案与 aria-label 同构，只换中间的动作词。
 */
export function examNodeLinkCopy(label: string): { text: string; ariaAction: string } {
  if (label === '报名') return { text: '去官网报名', ariaAction: '官方报名' }
  if (label === '公共科目笔试') return { text: '查看官方公告', ariaAction: '官方公告' }
  if (label === '江西成绩复核') return { text: '去报名系统申请复核', ariaAction: '报名系统申请复核' }
  if (label === '成绩查询') return { text: '去系统查成绩', ariaAction: '系统查询成绩' }
  if (label === '缴费') return { text: '去官网缴费', ariaAction: '官方缴费' }
  if (label === '新生预报名') return { text: '去官网报名', ariaAction: '官方报名' }
  if (label === '正式报名') return { text: '去官网报名', ariaAction: '官方报名' }
  if (label === '考生报考') return { text: '去官网报考', ariaAction: '官方报考' }
  if (label === '网上缴费') return { text: '去官网缴费', ariaAction: '官方缴费' }
  if (label === '考试') return { text: '去官网查看', ariaAction: '官方查看' }
  return { text: '去官网打印准考证', ariaAction: '官方打印' }
}

