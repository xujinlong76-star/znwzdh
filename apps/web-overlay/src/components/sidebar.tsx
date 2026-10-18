'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { preferredScrollBehavior } from '@/lib/motion'
import { Button } from '@/registry/new-york/ui/button'
import { ScrollArea } from '@/registry/new-york/ui/scroll-area'
import type { NavigationData } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { ChevronDown, ChevronRight, Compass, X } from 'lucide-react'
import { NavIcon } from '@/components/nav-icon'
import { NAV_ICON_FALLBACK, isIconUrl, resolveNavIcon } from '@/lib/nav-icons'

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  navigationData: NavigationData
  siteInfo: SiteConfig
  onClose?: () => void
}

export function Sidebar({ className, navigationData, siteInfo, onClose }: SidebarProps) {



  const scrollToSection = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      // JS 显式传的 behavior 会压过样式表，所以这里必须自己问一次系统偏好
      element.scrollIntoView({ behavior: preferredScrollBehavior() })
      onClose?.()
    }
  }

  const handleCategoryClick = (categoryId: string) => {
    // 先跳转到对应区域
    scrollToSection(categoryId)

    // 如果有子分类，切换展开/收起状态
    const category = navigationData.navigationItems.find(cat => cat.id === categoryId)
    if (category?.subCategories && category.subCategories.length > 0) {
      toggleCategory(categoryId)
    }
  }

  const renderIcon = (iconName?: string) => {
    if (!iconName) return <NAV_ICON_FALLBACK className="h-4 w-4" />;

    if (isIconUrl(iconName)) {
      return (
        <Image
          src={iconName}
          alt="icon"
          width={16}
          height={16}
          className="h-4 w-4"
        />
      );
    }

    // 已知名字走静态映射（可被 tree-shaking，零额外体积、无闪烁）；
    // 表外名字交给 NavIcon 按需拉取，行为与旧的整包查找一致。
    const StaticIcon = resolveNavIcon(iconName);
    if (StaticIcon) return <StaticIcon className="h-4 w-4" />;
    return <NavIcon name={iconName} className="h-4 w-4" />;
  }

  // 使用对象存储每个分类的展开状态
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => {
    return navigationData.navigationItems.reduce((acc, category) => {
      acc[category.id] = false
      return acc
    }, {} as Record<string, boolean>)
  })

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryId]: !prev[categoryId]
    }))
  }

  return (
    <div className={cn("w-64 bg-background border-r border-border/40 flex flex-col", className)}>
      <div className="flex h-14 items-center justify-between px-4 border-b border-border/40">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-sm tracking-tight hover:opacity-90 transition-opacity">
          {siteInfo.appearance.logo ? (
            <Image
              src={siteInfo.appearance.logo}
              alt={siteInfo.basic.title}
              width={26}
              height={26}
              className="h-6.5 w-6.5 rounded-md object-contain"
            />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-2xs">
              <Compass className="h-4 w-4 text-primary" />
            </div>
          )}
            <div className="flex flex-col">
            <span className="leading-tight font-semibold text-foreground">{siteInfo.basic.title}</span>
            <span className="text-xs text-muted-foreground/80 font-mono font-normal">AI-Native Hub</span>
          </div>
        </Link>

        <span className="hidden sm:inline-flex text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
          v5.0
        </span>

        {/* 移动模式下的关闭按钮 */}
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto md:hidden h-8 w-8 rounded-lg"
            onClick={onClose}
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ScrollArea className="h-[calc(100vh-3.5rem)] px-3 py-3">
        <div className="space-y-1">
          {navigationData.navigationItems.map((category) => (
            <div key={category.id} className="py-1">
              <div className="flex items-center group">
                <Button
                  variant="ghost"
                  className="flex-1 justify-start gap-2.5 h-8.5 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                  onClick={() => handleCategoryClick(category.id)}
                >
                  <span className="text-muted-foreground group-hover:text-primary transition-colors">
                    {renderIcon(category.icon)}
                  </span>
                  <span className="truncate">{category.title}</span>
                </Button>

                {category.subCategories && category.subCategories.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-7 px-0 hover:bg-muted/50 cursor-pointer text-muted-foreground"
                    onClick={() => toggleCategory(category.id)}
                  >
                    {expandedCategories[category.id] ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>

              {category.subCategories && category.subCategories.length > 0 && (
                <div
                  className={cn(
                    "grid transition-all duration-200 ease-in-out",
                    expandedCategories[category.id] ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="mt-1 ml-3 pl-2.5 border-l border-border/50 space-y-0.5 overflow-hidden">
                    {category.subCategories.map((subCategory) => (
                      <Button
                        key={subCategory.id}
                        variant="ghost"
                        className="w-full justify-start h-7.5 px-2 text-xs rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 cursor-pointer"
                        onClick={() => {
                          scrollToSection(subCategory.id)
                          onClose?.()
                        }}
                      >
                        <span className="truncate">{subCategory.title}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
