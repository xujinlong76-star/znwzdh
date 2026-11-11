import { hubGet, hubGetProbe, type HubProbe } from './hub'

/**
 * 场景包的服务端取数（GET /api/scenes、GET /api/scenes/:id）。
 *
 * 场景定义与展开都在中枢（SCENE_PACKS + scene-resolve），这里只是类型化
 * 转发：落地页 /scenes、/scenes/{id} 与 sitemap 都从这一层拿数据，
 * 前端不许再存第二份场景清单（旧 ai-finder-panel 手抄清单已删）。
 */

export interface HubSceneSite {
  siteId: string
  title: string
  url: string
  description: string | null
  categoryId: string
  /** 本地拼装的推荐理由（分类 + 简介），不是模型生成 */
  reason: string
}

export interface HubSceneStep {
  label: string
  queries: string[]
  sites: HubSceneSite[]
}

export interface HubSceneDetail {
  id: string
  title: string
  description: string
  intro: string
  steps: HubSceneStep[]
  /** 全部步骤去重后的真实站点数（按本次召回算） */
  siteCount: number
  /** 本页站点最近更新时间（毫秒戳）；无站点时为 null */
  updatedAt: number | null
}

export interface HubSceneSummary {
  id: string
  title: string
  description: string
  intro: string
  /** 定义的步骤数（流程本身的长度） */
  stepCount: number
  /** 本次真实召回到站点的步骤数，与 stepCount 分开报，不混用 */
  resolvedStepCount: number
  siteCount: number
  stepLabels: string[]
  updatedAt: number | null
}

export interface HubSceneDetailPayload {
  scene: HubSceneDetail
  /** 检索部分失败时为 'error'：页面据实提示，不把部分结果冒充完整 */
  degraded: string | null
}

interface ScenesListPayload {
  scenes?: HubSceneSummary[]
}

interface SceneDetailRawPayload {
  scene?: HubSceneDetail
  degraded?: string | null
}

/** 场景列表：失败返回 null，调用方降级（不生成假清单） */
export async function loadScenes(revalidate = 300): Promise<HubSceneSummary[] | null> {
  const body = await hubGet<ScenesListPayload>('/api/scenes', revalidate)
  if (!body || !Array.isArray(body.scenes)) return null
  return body.scenes
}

/**
 * 场景详情：用 probe 区分三种状态——ok（真数据）、miss（中枢明确 404，
 * 页面跟着 404）、failed（中枢不可达，页面降级渲染而不是误杀真页面）。
 */
export async function loadSceneDetail(id: string, revalidate = 60): Promise<HubProbe<HubSceneDetailPayload>> {
  const probe = await hubGetProbe<SceneDetailRawPayload>(`/api/scenes/${encodeURIComponent(id)}`, revalidate)
  if (probe.status !== 'ok') return probe
  if (!probe.data || !probe.data.scene) return { status: 'failed' }
  return { status: 'ok', data: { scene: probe.data.scene, degraded: probe.data.degraded ?? null } }
}
