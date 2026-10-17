import { cn } from '@/lib/utils'

interface ContainerProps {
  children: React.ReactNode
  /** 附加到容器上的类名（如页面级间距 space-y-6）。与内置的居中/内边距类合并。 */
  className?: string
  /**
   * 渲染成 `main` 时，这个容器就是页面的**主内容地标**。
   *
   * 默认仍是普通 `div`：有些页面自带 `<main>`（首页、视频页、管理后台），
   * 也有页面同一次渲染里有多个 Container（站点详情页的分支），
   * 一律当 main 会造出重复或嵌套的地标。
   */
  as?: 'div' | 'main'
  /** 元素 id。主内容地标统一用 `main-content`，供 layout 里的「跳到主要内容」锚点命中。 */
  id?: string
}

export function Container({ children, className, as = 'div', id }: ContainerProps) {
  const classes = cn(
    'mx-auto w-full max-w-(--breakpoint-2xl) px-3 sm:px-6 md:px-8 lg:px-10 xl:px-12',
    className
  )

  if (as === 'main') {
    return (
      <main id={id} className={classes}>
        {children}
      </main>
    )
  }

  return (
    <div id={id} className={classes}>
      {children}
    </div>
  )
}
