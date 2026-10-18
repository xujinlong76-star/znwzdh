/**
 * 工作台预设暂存区 (Workspace Preset Staging)
 *
 * 场景：用户在插件市场点「安装」一个 workspace-preset 插件时，详情页并不挂载
 * 模块化工作台的状态机（useModularLayout 只在 /custom 的画布组件里），
 * 因此安装动作分两步：
 *   1. 插件安装（API，登记 installs）通过后，把 manifest.payload 暂存进 localStorage；
 *   2. 用户进入模块化工作台（modular-canvas）时消费暂存区，调用 installWidgetPreset
 *      真正把看板落进布局（消费一次即删，避免重复安装风暴）。
 *
 * 存储键独立于布局存储（navhub_modular_multi_boards_v2），互不污染；
 * 任何解析失败都视为「无暂存」并清掉脏数据，绝不抛错给 UI。
 */

export const PRESET_STAGING_KEY = 'navhub_pending_workspace_preset_v1'

export interface StagedWorkspacePreset {
  slug: string
  name: string
  payload: {
    boards?: Array<{ name?: string; widgets?: Array<Record<string, unknown>> }>
  }
  /** 应用到工作台的模式（用户在安装确认弹窗里的选择）；缺省 append */
  mode?: 'append' | 'replace'
  stagedAt: number
}

/** 解析并校验暂存记录形状（坏数据返回 null，调用方负责清理） */
function parseStaged(raw: string | null): StagedWorkspacePreset | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StagedWorkspacePreset>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.slug !== 'string' || !parsed.slug) return null
    const boards = parsed.payload?.boards
    if (!Array.isArray(boards) || boards.length === 0) return null
    return {
      slug: parsed.slug,
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.slug,
      payload: parsed.payload as StagedWorkspacePreset['payload'],
      mode: parsed.mode === 'replace' ? 'replace' : 'append',
      stagedAt: typeof parsed.stagedAt === 'number' ? parsed.stagedAt : Date.now(),
    }
  } catch {
    return null
  }
}

/** 暂存一份预设（插件详情页安装成功后调用）。返回是否成功写盘。 */
export function stageWorkspacePreset(
  slug: string,
  name: string,
  payload: StagedWorkspacePreset['payload'],
  mode: 'append' | 'replace' = 'append',
): boolean {
  if (typeof window === 'undefined') return false
  try {
    const record: StagedWorkspacePreset = { slug, name, payload, mode, stagedAt: Date.now() }
    localStorage.setItem(PRESET_STAGING_KEY, JSON.stringify(record))
    return true
  } catch {
    // 隐私模式/配额不足：安装登记仍成功，只是需要用户手动去工作台导入 JSON
    return false
  }
}

/** 查看暂存记录（不消费）；脏数据会被清除并返回 null */
export function peekStagedWorkspacePreset(): StagedWorkspacePreset | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = localStorage.getItem(PRESET_STAGING_KEY)
  } catch {
    return null
  }
  const record = parseStaged(raw)
  if (!record && raw) clearStagedWorkspacePreset()
  return record
}

/** 消费暂存记录：读取后即删除（预设只自动安装一次） */
export function takeStagedWorkspacePreset(): StagedWorkspacePreset | null {
  const record = peekStagedWorkspacePreset()
  if (record) clearStagedWorkspacePreset()
  return record
}

/** 清空暂存（例如用户在工作台安装前反悔） */
export function clearStagedWorkspacePreset(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PRESET_STAGING_KEY)
  } catch {
    // 忽略 localStorage 受限环境
  }
}
