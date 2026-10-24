/** 站点管理页共享类型（page 与 sitelist-dialogs 共用；第五批 A2 拆分）。 */
import type { NavigationSubItem } from '@/types/navigation'

export interface SubCategory {
  id: string
  title: string
  icon?: string
  items: NavigationSubItem[]
}

export interface Category {
  id: string
  title: string
  icon?: string
  items: NavigationSubItem[]
  subCategories?: SubCategory[]
}

export interface Site {
  id: string
  name: string
  url: string
  description?: string
  createdAt: string
  updatedAt: string
}
