/**
 * U-381：/graph 深链恢复的纯决策函数（vitest 是 node 环境、无 jsdom，
 * 组件挂载测不了，恢复逻辑放纯函数里单测；组件只负责按结果改状态与写 URL）。
 *
 * 口径：
 *  - center 优先于 site：带 center 进雷达，site 不再单独恢复（中心节点由
 *    采样 effect 自动选中）。
 *  - 中心站只要还在全站母体（allSites）里就进雷达——ego 子图走全站母体，
 *    不要求它在当前 24 站抽样内（雷达单开）。
 *  - center 指向已下线站点（live 数据已就绪且全站无此 id）→ delisted，
 *    组件退回默认视图并清掉 URL 里的 center；live 未就绪（示例态）时
 *    无法判定是否下线，不清（也不进雷达）。
 *  - site 只在当前节点集里找得到时才选中；找不到不强行选中。
 */
export interface GraphUrlRestoreInput<S extends { id: string }, N extends { id: string }> {
  centerParam: string | null
  siteParam: string | null
  allSites: readonly S[]
  nodes: readonly N[]
  /** live 数据已就绪（allSites 非空）：只有就绪时才能判定「已下线」。 */
  liveReady: boolean
}

export interface GraphUrlRestoreResult<S, N> {
  /** center 指向的站（全站母体里找到）；undefined = 无 center 参数。 */
  centerSite?: S | null
  /** center 参数指向已下线站点。 */
  delistedCenter: boolean
  /** site 参数指向的当前节点；null = 有参数但节点不在当前集；undefined = 无参数。 */
  selectedNode?: N | null
}

export function resolveGraphUrlRestore<S extends { id: string }, N extends { id: string }>(
  input: GraphUrlRestoreInput<S, N>,
): GraphUrlRestoreResult<S, N> {
  if (input.centerParam) {
    const centerSite = input.allSites.find((s) => s.id === input.centerParam) ?? null
    return {
      centerSite,
      delistedCenter: centerSite === null && input.liveReady,
      selectedNode: null,
    }
  }
  if (input.siteParam) {
    const node = input.nodes.find((n) => n.id === input.siteParam) ?? null
    return { centerSite: undefined, delistedCenter: false, selectedNode: node }
  }
  return { centerSite: undefined, delistedCenter: false, selectedNode: undefined }
}
