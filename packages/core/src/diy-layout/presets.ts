/**
 * 开箱即用的预设 DIY 情境模版定义 (Presets)。
 */

export interface DIYPreset {
  id: string
  name: string
  description: string
  icon: string
  config: {
    viewMode: 'hybrid' | 'classic' | 'workbench'
    cardDisplayMode: 'compact' | 'standard' | 'rich'
    canvasBackground: 'mesh' | 'dots' | 'grid' | 'aurora' | 'clean'
    density: 'dense' | 'comfortable' | 'spacious'
    heroDeckCollapsed: boolean
    heroDeckWidgets: string[]
  }
}

export const BUILTIN_DIY_PRESETS: DIYPreset[] = [
  {
    id: 'dev-pro',
    name: '极客工程套件 (Dev Pro)',
    description: '超高信息密度条形、工程细网格背景、集成微工具箱与首屏星标坞',
    icon: 'Terminal',
    config: {
      viewMode: 'hybrid',
      cardDisplayMode: 'compact',
      canvasBackground: 'grid',
      density: 'dense',
      heroDeckCollapsed: false,
      heroDeckWidgets: ['quick-search', 'quick-tools', 'favorites-dock'],
    },
  },
  {
    id: 'ai-researcher',
    name: 'AI 原生研究员 (AI Lab)',
    description: '深度大图文卡片、柔和彩色极光渐变、指标徽标与论文探索首选',
    icon: 'Sparkles',
    config: {
      viewMode: 'hybrid',
      cardDisplayMode: 'rich',
      canvasBackground: 'aurora',
      density: 'comfortable',
      heroDeckCollapsed: false,
      heroDeckWidgets: ['quick-search', 'clock-pomodoro', 'favorites-dock'],
    },
  },
  {
    id: 'zen-minimalist',
    name: '极简禅道流 (Zen Flow)',
    description: '经典全景分类导航、宽松呼吸间距、纯净白/黑底色、回归最专注的书签体验',
    icon: 'Compass',
    config: {
      viewMode: 'classic',
      cardDisplayMode: 'standard',
      canvasBackground: 'clean',
      density: 'spacious',
      heroDeckCollapsed: true,
      heroDeckWidgets: ['quick-search'],
    },
  },
  {
    id: 'power-workbench',
    name: '全功能工作台 (Power Board)',
    description: '沉浸式自由布局画布、微网格平滑流体、多组件并行业务仪表盘',
    icon: 'LayoutGrid',
    config: {
      viewMode: 'workbench',
      cardDisplayMode: 'standard',
      canvasBackground: 'mesh',
      density: 'comfortable',
      heroDeckCollapsed: false,
      heroDeckWidgets: ['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools'],
    },
  },
]
