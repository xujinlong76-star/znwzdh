/**
 * 模块化页面系统架构类型定义 (Modular Page System Architecture)
 */

export type WidgetCategory = 'tools' | 'efficiency' | 'analytics' | 'content' | 'ai'

export interface WidgetConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  options?: Array<{ label: string; value: string | number }>
  defaultValue?: unknown
  description?: string
}

export interface ModularWidgetDefinition {
  type: string
  title: string
  description: string
  category: WidgetCategory
  icon: string
  /** 12 栅格下的宽度 (1-12) */
  defaultColSpan: number
  /** 行跨度 (1-4) */
  defaultRowSpan: number
  minColSpan: number
  maxColSpan: number
  minRowSpan: number
  maxRowSpan: number
  /** 该模块是否允许配置参数 */
  configSchema?: WidgetConfigField[]
  /** 预览标签 */
  badge?: string
}

export interface WidgetInstance {
  id: string
  type: string
  customTitle?: string
  /** 桌面端 12 栅格宽度 (1-12) */
  colSpan: number
  /** 行跨度 (1-4) */
  rowSpan: number
  /** 实例独立配置 */
  config: Record<string, unknown>
  createdAt: number
}

export interface ModularPageLayout {
  version: number
  updatedAt: number
  title?: string
  widgets: WidgetInstance[]
}

export interface ModularPresetTemplate {
  id: string
  name: string
  description: string
  icon: string
  widgets: Omit<WidgetInstance, 'id' | 'createdAt'>[]
}
