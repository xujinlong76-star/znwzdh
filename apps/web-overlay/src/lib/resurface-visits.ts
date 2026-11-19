'use client'

/**
 * 重温 / 归档 / 冬眠的「打开」信号合并（2026-11-16，第 90 轮）。
 *
 * 问题：三处调用方（/brief 今日重温岛、/favorites/stale、/favorites 主列表）
 * 此前只喂本机离线最近访问（lib/offline-recent，最多 50 条）——手机上天天
 * 打开的收藏，回电脑却被标「好久没打开」，甚至被建议归档。云端 visits
 * （GET /api/me/visits，同一身份的 click 事件交还）一直存在，只是没接线。
 *
 * 做法（调用方合并，resurface.ts 本体不动）：
 *
 *   - 本机 visits（readOfflineVisits，50 条）+ 云端 visits
 *     （fetchVisitsPage，limit 50，走 /api/hub 代理身份：登录态会话优先，
 *     匿名态自报 anon 头，见 U-239）拼成一个数组喂给
 *     selectDailyResurface / selectStaleFavorites / latestVisitsById——
 *     取最新一次的 Math.max 语义让较新的一方自动胜出。
 *   - 云端取不到（fetchVisitsPage 返回 null）时静默回落本机-only：
 *     **绝不把 null 当空数组**——「取不到」不等于「没打开过」，当成空会把
 *     误判从「漏算另一设备」升级成「有记录也算没打开」。
 *   - 未登录 / 匿名用户不发任何云端请求，行为与接线前完全一致。
 *
 * 取数时机：挂载后现算，不进 SSR（/brief 是服务端渲染的中枢缓存页，
 * brief-page.test.ts 的红线）；身份就绪前先按本机-only 算，身份一旦确认
 * 已登录即补取云端并重算——先快后准，不阻塞首屏。
 */

import { useEffect, useState } from 'react'
import { fetchVisitsPage, type HubVisitItem } from './navhub-api'
import { getIdentity } from './identity'
import { readOfflineVisits, type RecentVisit } from './offline-recent'
import type { ResurfaceVisitLike } from './resurface'

/** 云端 visits 与本机 visits 对齐的取数上限（与 readOfflineVisits(50) 一致）。 */
export const CLOUD_VISITS_LIMIT = 50

/** 云端一条访问 → resurface 的输入形状（{siteId, at} → {id, visitedAt}）。 */
export function toResurfaceVisits(items: HubVisitItem[]): ResurfaceVisitLike[] {
  return items.map((item) => ({ id: item.siteId, visitedAt: item.at }))
}

/**
 * 纯函数：本机 + 云端打开信号合并。
 *
 * cloud 为 null（云端取不到）时返回本机原数组——调用方不得把 null 当空数组
 * 拼进去，否则「取不到」会被算成「没打开过」。取 max 的活由下游的
 * latestVisitsById 做，这里只拼数组，不丢任何一方的记录。
 */
export function mergeVisits(
  local: ResurfaceVisitLike[],
  cloud: HubVisitItem[] | null,
): ResurfaceVisitLike[] {
  if (cloud === null) return local
  return [...local, ...toResurfaceVisits(cloud)]
}

/**
 * 取云端 visits（limit 50，走 /api/hub 代理身份）：成功返回 items，任何失败
 * （未登录 401、网络失败、降级）返回 null——调用方据此回落本机-only。
 * 匿名用户不要调它（调用方用 isLoggedIn 守门，不产生任何云端请求）。
 * 登录态下代理用会话身份覆盖这里自报的 identity，行为与 U-239 前一致。
 */
export async function fetchCloudVisits(): Promise<HubVisitItem[] | null> {
  const page = await fetchVisitsPage(getIdentity(), { limit: CLOUD_VISITS_LIMIT })
  return page === null ? null : page.items
}

/**
 * 合并后的最近访问 + 就绪态：三处调用方共用同一锚点（一处接线修三处）。
 *
 * isLoggedIn 变化（身份就绪后确认登录 / 退出）时重跑：登录后补取云端，
 * 退出后云端部分随之撤下。加载中途不重置 loaded——岛 / 列表先按本机-only
 * 渲染，云端到了再重算，不闪不跳。
 */
export function useMergedVisits(isLoggedIn: boolean): { visits: ResurfaceVisitLike[]; loaded: boolean } {
  const [visits, setVisits] = useState<ResurfaceVisitLike[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    const localP = readOfflineVisits(CLOUD_VISITS_LIMIT).catch(() => [] as RecentVisit[])
    const cloudP = isLoggedIn ? fetchCloudVisits() : Promise.resolve(null)
    Promise.all([localP, cloudP])
      .then(([local, cloud]) => {
        if (active) setVisits(mergeVisits(local, cloud))
      })
      .catch(() => {
        // 两路都读不到时只按收藏时间算旧，不阻断重温 / 分拣
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [isLoggedIn])

  return { visits, loaded }
}
