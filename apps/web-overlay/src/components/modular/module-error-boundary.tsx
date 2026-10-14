'use client'

import React from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

/**
 * 模块级错误隔离。
 *
 * 为什么需要：模块化页面的核心承诺是"模块相互独立"。但 React 的渲染是**整棵树**的——
 * 任一模块在 render 里抛错（数据异常、第三方组件、JSON 解析…），整棵子树会被卸载，
 * 表现是整页白屏而不是"那一个模块坏了"。
 *
 * 这个边界把故障圈在每个模块自己的卡片里：
 *   - 崩溃只影响该模块，其余模块与页面外壳照常工作
 *   - 卡片内给出错误原因与"重试"入口（重试 = 换 key 重新挂载子树）
 *   - 编辑模式下额外提供"移除此模块"，用户可自救
 */

interface ModuleErrorBoundaryProps {
  /** 模块标题，用于日志与提示定位 */
  title?: string
  children: React.ReactNode
  /** 编辑模式：额外显示移除入口 */
  isEditing?: boolean
  onRemove?: () => void
}

interface ModuleErrorBoundaryState {
  error: Error | null
  /** 每次重试自增，作为子树 key 强制重新挂载 */
  retryKey: number
}

export class ModuleErrorBoundary extends React.Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  state: ModuleErrorBoundaryState = { error: null, retryKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<ModuleErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 只告警不阻断：这正是边界的意义——把崩溃变成可观测的局部降级
    console.warn(
      '[modular] 模块崩溃已隔离，不影响其它模块：',
      this.props.title ?? '(未命名模块)',
      error?.message,
      info?.componentStack,
    )
  }

  private handleRetry = () => {
    this.setState((s) => ({ error: null, retryKey: s.retryKey + 1 }))
  }

  render() {
    const { error, retryKey } = this.state
    if (!error) {
      // key 变化即重新挂载子树，实现"重试"
      return <React.Fragment key={retryKey}>{this.props.children}</React.Fragment>
    }

    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="w-9 h-9 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4" />
        </div>
        <div className="space-y-0.5">
          <div className="text-[11px] font-semibold text-foreground">此模块运行出错</div>
          <div className="text-[10px] text-muted-foreground line-clamp-2 px-2">
            {error.message || '未知错误'}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-lg border border-border/70 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCw className="w-3 h-3" />
            重试
          </button>
          {this.props.isEditing && this.props.onRemove && (
            <button
              type="button"
              onClick={this.props.onRemove}
              className="px-2 py-1 text-[10px] rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
            >
              移除模块
            </button>
          )}
        </div>
      </div>
    )
  }
}
