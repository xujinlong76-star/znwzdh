import { cn } from '@/lib/utils'

interface ContainerProps {
  children: React.ReactNode
  /** 附加到容器上的类名（如页面级间距 space-y-6）。与内置的居中/内边距类合并。 */
  className?: string
}

export function Container({ children, className }: ContainerProps) {
  return (
    <div className={cn(
      'mx-auto w-full max-w-(--breakpoint-2xl) px-3 sm:px-6 md:px-8 lg:px-10 xl:px-12',
      className
    )}>
      {children}
    </div>
  )
}
