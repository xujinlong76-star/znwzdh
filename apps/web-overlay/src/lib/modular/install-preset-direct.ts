/**
 * 非工作台页面安装 workspace-preset 的本地接缝。
 *
 * 插件详情页只需要「把预设写进工作台」这一个动作；若为此静态引入
 * useModularLayout，会经 registry 把全部 widget 组件拉进详情页首屏
 * （2026-10-24 实测该 chunk 约 110 KB，含时钟/天气/番茄/RSS 等）。
 * 注册表改在动态 import 里，只有用户真正点「应用预设」时才下载；
 * 台账仍由 planPresetInstall 产出，措辞与工作台内安装完全一致。
 */
import type { Board, LayoutImportReport, PresetInstallInput } from './layout-import-plan'
import { planPresetInstall } from './layout-import-plan'
import { STORAGE_KEY } from './layout-storage'
import { backupCorruptPayload } from './workspace-storage'

export interface DirectPresetInstallResult {
  report: LayoutImportReport
  /** 看板是否真的写进了 localStorage；false 时 UI 必须如实提示 */
  persisted: boolean
}

interface StoredWorkspace {
  version?: number
  activeBoardId?: string
  boards?: Board[]
}

function readStoredWorkspace(): { boards: Board[]; corruptRaw: string | null } {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { boards: [], corruptRaw: null }
  }
  if (!raw) return { boards: [], corruptRaw: null }
  try {
    const parsed = JSON.parse(raw) as StoredWorkspace | null
    if (!parsed || !Array.isArray(parsed.boards)) return { boards: [], corruptRaw: raw }
    return {
      boards: parsed.boards.filter(
        (b): b is Board => Boolean(b) && typeof b === 'object' && Array.isArray((b as Board).widgets),
      ),
      corruptRaw: null,
    }
  } catch {
    return { boards: [], corruptRaw: raw }
  }
}

export async function installWidgetPresetDirect(
  preset: PresetInstallInput | null | undefined,
  mode: 'append' | 'replace' = 'append',
): Promise<DirectPresetInstallResult> {
  if (typeof window === 'undefined') {
    return { report: planPresetInstall(preset, () => false).report, persisted: false }
  }

  const { WIDGET_REGISTRY } = await import('./registry')
  const plan = planPresetInstall(preset, (type) => Boolean(WIDGET_REGISTRY[type]))
  if (!plan.report.ok) return { report: plan.report, persisted: false }

  const stored = readStoredWorkspace()
  // 损坏的旧布局先留现场再覆盖，避免「应用预设」把用户还能抢救的数据抹掉
  if (stored.corruptRaw) backupCorruptPayload(STORAGE_KEY, stored.corruptRaw, Date.now(), localStorage)
  const nextBoards = mode === 'replace' ? plan.boards : [...stored.boards, ...plan.boards]
  const activeBoardId = plan.boards[0]?.id ?? nextBoards[0]?.id ?? ''

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, activeBoardId, boards: nextBoards }))
  } catch {
    return { report: plan.report, persisted: false }
  }

  window.dispatchEvent(new Event('navhub_workbench_updated'))
  return { report: plan.report, persisted: true }
}
