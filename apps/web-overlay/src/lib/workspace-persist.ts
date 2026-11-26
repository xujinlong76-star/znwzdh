/**
 * 工作区选择持久化 + `?workspace=` 深链（U-362）。
 *
 * 缺陷：`NavigationContent` 的 `activeWorkspace` 只是 `useState('all')`，
 * 切换只改内存态——刷新即丢、URL 里也没有，分享/收藏打不开指定工作区。
 *
 * 恢复优先级（挂载时一次）：URL 参数（有效时）> localStorage > `'all'`。
 * 非法值（URL 或 localStorage 里都可能有）一律回落，不抛错、不白屏；
 * 挂载与切换时把解析结果规范化回 URL，让 URL 永远真实反映当前选择。
 *
 * URL 形态：只给非默认工作区写参（`?workspace=dev`）；默认 `'all'` 不占参，
 * 与 `?scene=` 的惯例一致——缺参即默认，分享出去的干净 `/` 也能打开。
 * 切换用 `history.replaceState`（不产生后退历史），其它 query 参数与 hash 原样保留。
 *
 * 纯函数（`resolveWorkspace` / `buildWorkspaceSearch` / `readWorkspaceParam`）
 * 与存储读写分离：前者可直接单测；后者对 `Storage` 做依赖注入，
 * 隐私模式 / 配额耗尽抛错时也只静默失败，不打断初始化。
 */
import { WORKSPACES, type WorkspaceId } from '@/lib/workspaces'

/** localStorage 键（`navhub_*` 惯例；全仓此前无此键，见 U-362）。 */
export const WORKSPACE_STORAGE_KEY = 'navhub_active_workspace'

/** URL query 参数名。 */
export const WORKSPACE_SEARCH_PARAM = 'workspace'

const WORKSPACE_IDS: ReadonlySet<string> = new Set(WORKSPACES.map((ws) => ws.id))

export function isValidWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && WORKSPACE_IDS.has(value)
}

/**
 * 挂载时解析初始工作区：URL 参数优先（可分享/收藏），其次上次存下的选择，
 * 两者都无效或缺失时回落默认 `'all'`。
 */
export function resolveWorkspace({
  param,
  stored,
}: {
  param: string | null
  stored: string | null
}): WorkspaceId {
  if (isValidWorkspaceId(param)) return param
  if (isValidWorkspaceId(stored)) return stored
  return 'all'
}

/** 从 query 字符串读 `workspace` 参数（无参 / 解析失败 → null）。 */
export function readWorkspaceParam(search: string): string | null {
  try {
    return new URLSearchParams(search).get(WORKSPACE_SEARCH_PARAM)
  } catch {
    return null
  }
}

/**
 * 纯函数：按目标工作区算出新的 query 字符串（保留其它参数）。
 * `'all'` 时删参（缺参即默认）；其它值写参。返回含前导 `?` 或空串。
 */
export function buildWorkspaceSearch(search: string, id: WorkspaceId): string {
  const params = new URLSearchParams(search)
  if (id === 'all') {
    params.delete(WORKSPACE_SEARCH_PARAM)
  } else {
    params.set(WORKSPACE_SEARCH_PARAM, id)
  }
  const next = params.toString()
  return next ? `?${next}` : ''
}

export interface WorkspaceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): WorkspaceStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/** 读存下的工作区；无效值 / 存储不可用 → null（调用方回落默认）。 */
export function readStoredWorkspace(storage: WorkspaceStorage | null = defaultStorage()): WorkspaceId | null {
  try {
    const raw = storage?.getItem(WORKSPACE_STORAGE_KEY) ?? null
    return isValidWorkspaceId(raw) ? raw : null
  } catch {
    return null
  }
}

/** 存工作区；存储不可用时静默失败（不抛给初始化流程）。 */
export function writeStoredWorkspace(id: WorkspaceId, storage: WorkspaceStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(WORKSPACE_STORAGE_KEY, id)
  } catch {
    // 隐私模式 / 配额耗尽：持久化丢了，当前页选择不受影响
  }
}

/**
 * 把当前选择同步进 URL（`history.replaceState`，不变则不动，避免无谓写历史）。
 * 只在浏览器里调用；服务端渲染路径不走这里。
 */
export function syncWorkspaceToUrl(id: WorkspaceId): void {
  try {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const nextSearch = buildWorkspaceSearch(url.search, id)
    if (url.search === nextSearch) return
    url.search = nextSearch
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    // history 受限（如沙箱 iframe）：URL 不同步，当前页选择不受影响
  }
}
