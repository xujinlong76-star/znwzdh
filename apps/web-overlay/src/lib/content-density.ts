/**
 * 卡片密度的纯映射层（不碰 React）。
 *
 * 为什么单独一个文件：`app/layout.tsx` 是服务端组件，它要在水合前把
 * `[data-density]` 写进 `<html>`（见 density-bootstrap.ts），于是必须能读到这份映射。
 * 映射原先住在 user-preferences.ts 里，而那个模块顶部 import 了 useSyncExternalStore ——
 * Next 直接报「把依赖 useSyncExternalStore 的模块导进了 RSC」，整站路由 500。
 * 判据仍然只有一份：user-preferences.ts 从这里再导出，组件侧的 import 路径不变。
 */
import { DEFAULT_USER_SETTINGS, type CardDensityMode } from './user-settings'

/** 真正驱动 `--density-*` CSS 变量的三档（`[data-density]` 在 globals.css 里定义） */
export type ContentDensity = 'dense' | 'comfortable' | 'spacious'

export const DEFAULT_CONTENT_DENSITY: ContentDensity = 'comfortable'

/** 供首屏内联脚本复用：水合前的判据必须与组件侧的映射逐字一致 */
export const CARD_DENSITY_TO_CONTENT: Record<CardDensityMode, ContentDensity> = {
  comfortable: 'comfortable',
  compact: 'dense',
  minimal: 'spacious',
}

const CONTENT_TO_CARD_DENSITY: Record<ContentDensity, CardDensityMode> = {
  comfortable: 'comfortable',
  dense: 'compact',
  spacious: 'minimal',
}

export function contentDensityOf(mode: CardDensityMode): ContentDensity {
  return CARD_DENSITY_TO_CONTENT[mode] ?? DEFAULT_CONTENT_DENSITY
}

export function cardDensityOf(density: ContentDensity): CardDensityMode {
  return CONTENT_TO_CARD_DENSITY[density] ?? DEFAULT_USER_SETTINGS.cardDensity
}

export function isContentDensity(value: unknown): value is ContentDensity {
  return value === 'dense' || value === 'comfortable' || value === 'spacious'
}
