/**
 * ⌘K 面板里的 DIY 快捷操作（8c）。
 *
 * 本模块只做「匹配」：给定查询词，算出该展示哪些 DIY 操作行（含预设展开）。
 * 真正的执行（toggleEditingLayout / applyDIYPreset / exportPresetToUrlHash /
 * importDIYConfig / resetDIYConfig）全部复用 useHomeDIY 的现有函数，
 * 由 search-palette.tsx 按 actionId 分发，不在这里复制逻辑。
 *
 * 快捷键提示只写真实存在的：进入/退出编辑模式是全局按键
 * （Ctrl/Cmd+E 开关，Esc 退出；裸按 E 已按 WCAG 2.1.4 废止，
 * 见 keyboard-shortcuts-dialog.tsx），其余操作没有快捷键，
 * 就不编一个。
 */
import type { DIYPreset } from './diy-presets'

export type DiyPaletteActionId = 'edit' | 'preset' | 'share' | 'import' | 'reset'

export interface DiyPaletteActionDef {
  id: DiyPaletteActionId
  title: string
  description: string
  /** 命中词：查询包含其中任意一个，或其中任意一个以查询开头（前缀补全） */
  keywords: string[]
  /** 真实存在的快捷键提示；没有就不写 */
  hint?: string
}

/** 命中任意一个即展示全部 DIY 操作的通用词 */
const DIY_CATCH_ALL_KEYWORDS = ['diy', '布局', '排版', '首页']

export const DIY_PALETTE_ACTION_DEFS: DiyPaletteActionDef[] = [
  {
    id: 'edit',
    title: '进入排版编辑模式',
    description: '拖拽分类、调整首页排版',
    keywords: ['编辑', '编排', 'edit', '拖拽', ...DIY_CATCH_ALL_KEYWORDS],
    hint: 'Ctrl/⌘+E',
  },
  {
    id: 'preset',
    title: '应用预设情境',
    description: '一键切换视图、卡片密度与画布背景',
    keywords: ['预设', 'preset', '主题', '模板', '模版', ...DIY_CATCH_ALL_KEYWORDS],
  },
  {
    id: 'share',
    title: '分享当前排版',
    description: '生成免登分享链接并复制到剪贴板',
    keywords: ['分享', 'share', '链接', '复制链接', ...DIY_CATCH_ALL_KEYWORDS],
  },
  {
    id: 'import',
    title: '导入排版配置',
    description: '从 JSON 备份文件还原排版',
    keywords: ['导入', 'import', '还原', ...DIY_CATCH_ALL_KEYWORDS],
  },
  {
    id: 'reset',
    title: '重置排版为默认',
    description: '恢复系统默认排版，可按 Ctrl/Cmd+Z 撤销',
    keywords: ['重置', 'reset', '恢复默认', '默认', ...DIY_CATCH_ALL_KEYWORDS],
  },
]

export interface DiyPaletteActionItem {
  /** 渲染 key / 键盘导航 id 后缀 */
  key: string
  actionId: DiyPaletteActionId
  /** preset 行才带：要点哪个预设 */
  presetId?: string
  title: string
  description: string
  hint?: string
}

/**
 * 查询词 → 要展示的 DIY 操作行。
 *
 * 空查询返回 []（空查询面板由 search-palette 直接渲染全部操作，不走匹配）。
 * 预设命中时展开为每个内置预设一行；其余操作各一行。
 * 查询少于 2 字不匹配，避免单字（如 "e"）误触一堆操作。
 * 已在编辑态时 edit 行的标题是「退出排版编辑模式」：静态写「进入…」
 * 会让用户按下去才发现是退出（调用方把 isEditingLayout 传进来）。
 */
export function matchDiyPaletteActions(
  query: string,
  presets: Pick<DIYPreset, 'id' | 'name' | 'description'>[],
  opts?: { isEditingLayout?: boolean },
): DiyPaletteActionItem[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  const hits = DIY_PALETTE_ACTION_DEFS.filter((def) =>
    def.keywords.some((k) => {
      const kw = k.toLowerCase()
      // 查询包含关键词，或关键词以查询开头（前缀补全）；
      // 不用「关键词包含查询」：否则 "reset" 会误命中 "preset"（preset 包含 reset）
      return q.includes(kw) || kw.startsWith(q)
    }),
  )
  if (hits.length === 0) return []

  const items: DiyPaletteActionItem[] = []
  for (const def of hits) {
    if (def.id === 'preset') {
      for (const preset of presets) {
        items.push({
          key: `preset-${preset.id}`,
          actionId: 'preset',
          presetId: preset.id,
          title: `应用预设：${preset.name}`,
          description: preset.description,
        })
      }
      continue
    }
    items.push({
      key: def.id,
      actionId: def.id,
      // 已在编辑态时按它就是退出：标题必须说真话，不能还写「进入…」
      title: def.id === 'edit' && opts?.isEditingLayout ? '退出排版编辑模式' : def.title,
      description: def.description,
      hint: def.hint,
    })
  }
  return items
}
