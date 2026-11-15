/**
 * 待找（搜索容错纠错 · 出口一）前端客户端。
 *
 * 两条路（协调人决定 4）：
 * - 登录态：调 BFF /api/me/wanted（navhub-api 的 saveWanted/listWanted/
 *   deleteWanted），收录时站内通知；
 * - 匿名：localStorage `navhub.wanted.v1` 只存查询串（仿 WATCHLIST_STORAGE_KEY），
 *   界面明示「登录后才能在收录时通知你」——存着但不通知。
 *
 * 本文件只做「存/列/删 + 匿名回退」的判定；UI 在
 * components/search/wanted-actions.tsx。
 */
import { deleteWanted, listWanted, saveWanted, type WantedSearchItem } from './navhub-api'

export const WANTED_STORAGE_KEY = 'navhub.wanted.v1'
export const WANTED_QUERY_MAX_LENGTH = 256

export interface LocalWantedItem {
  query: string
  correctedQuery: string | null
  createdAt: number
}

export type WantedSaveResult =
  | { mode: 'server'; item: WantedSearchItem; duplicate: boolean }
  | { mode: 'local'; item: LocalWantedItem; duplicate: boolean }

export function normalizeWantedQuery(raw: string): string {
  return (raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WANTED_QUERY_MAX_LENGTH)
    .trim()
}

function readLocal(): LocalWantedItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(WANTED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as LocalWantedItem[]
    return Array.isArray(parsed) ? parsed.filter((i) => i && typeof i.query === 'string') : []
  } catch {
    return []
  }
}

function writeLocal(items: LocalWantedItem[]): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(WANTED_STORAGE_KEY, JSON.stringify(items))
    return true
  } catch {
    return false
  }
}

export function listLocalWanted(): LocalWantedItem[] {
  return readLocal().sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 存为待找：先调服务端（登录态），401 即匿名 → 本地存一份。
 * 返回 mode 告诉调用方渲染哪句文案（本地态必须明示「登录后才能通知」）。
 */
export async function saveWantedSearch(
  query: string,
  correctedQuery?: string | null,
): Promise<WantedSaveResult> {
  const q = normalizeWantedQuery(query)
  if (!q) throw new Error('查询词为空')
  try {
    const { item, duplicate } = await saveWanted(q, correctedQuery ?? null)
    return { mode: 'server', item, duplicate: duplicate ?? false }
  } catch (err) {
    if ((err as { status?: number })?.status !== 401) throw err
    const items = readLocal()
    const existing = items.find((i) => i.query === q)
    if (existing) return { mode: 'local', item: existing, duplicate: true }
    const item: LocalWantedItem = { query: q, correctedQuery: correctedQuery ?? null, createdAt: Date.now() }
    writeLocal([item, ...items])
    return { mode: 'local', item, duplicate: false }
  }
}

/** 我的待找列表：登录态读服务端；401 时读本地（匿名也能看到自己存过的）。 */
export async function listWantedSearches(): Promise<Array<WantedSearchItem | LocalWantedItem>> {
  try {
    return await listWanted()
  } catch (err) {
    if ((err as { status?: number })?.status !== 401) throw err
    return listLocalWanted()
  }
}

export async function deleteWantedSearch(idOrQuery: string, mode: 'server' | 'local'): Promise<boolean> {
  if (mode === 'local') {
    const items = readLocal().filter((i) => i.query !== idOrQuery)
    return writeLocal(items)
  }
  return deleteWanted(idOrQuery)
}
