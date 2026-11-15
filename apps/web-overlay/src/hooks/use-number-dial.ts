/**
 * 首屏数字直达：首页唯一的数字键监听。
 *
 * 挂在 navigation-content.tsx（首页唯一挂载点）。不要并进
 * keyboard-shortcuts-dialog.tsx 的处理函数：那个对话框受
 * feat:keyboard-nav 掩码控制，被屏蔽时数字直达会跟着陪葬；且 1/2/3
 * 视图切换本身就要动那个文件，两件事别缠在一起。
 *
 * 优先级：window 捕获阶段监听，命中后 stopImmediatePropagation() +
 * preventDefault()，不依赖各监听的挂载顺序。判定本身是纯函数
 * （lib/number-dial.ts 的 resolveNumberDialAction），这里只负责
 * 从 DOM 收集守卫快照与同步执行打开。
 *
 * 拖拽守卫说明：useDiyDragActive() 的 context 只在 DiyDragProvider
 * 子树里才有值（provider 包的是分类网格，不是整个 navigation-content），
 * hook 在 provider 外读它永远是 false。所以这里用 DOM 判定：焦点落在
 * [data-diy-drag-handle] 上时一律让位。键盘拖拽进行中焦点一定在手柄上，
 * 这个判定是任务原文「拖拽进行中且焦点在手柄上」的保守超集——手柄仅
 * 聚焦、还没按下空格时数字键同样让位，不劫持任何拖拽相关按键；
 * dnd-kit 的方向键/Enter/Esc 不含数字键，超集不会误伤正常直达
 * （焦点在卡片主链接或页面其它处时数字键照常工作）。
 */
'use client'

import { useEffect, useRef } from 'react'
import {
  buildDialMap,
  openDialTarget,
  resolveNumberDialAction,
  type DialSite,
  type NumberDialGuardState,
  type QuickDialSlots,
} from '@/lib/number-dial'
import {
  isAnyDialogOpen,
  isDragHandleFocused,
  isEventTargetTyping,
} from '@/lib/keyboard-guards'

export interface UseNumberDialArgs {
  /** 数字直达总开关（用户设置 numberDialEnabled，默认开）；挂载前为 false */
  enabled: boolean
  /** 速览坞 Top 9（与坞同一份 computeSpeedDialSites 产物） */
  dialSites: DialSite[]
  /** 自定义快拨位（DIY 配置 quickDialSlots） */
  quickDialSlots: QuickDialSlots
  /** 全站索引（id → 站点）：自定义位解析与失效判定用 */
  siteIndex: ReadonlyMap<string, DialSite>
  /** 用户偏好：openLinksInNewTab 决定 _blank/_self */
  linkTarget: '_blank' | '_self'
  /** 多选模式：此时点卡是选中不是打开 */
  selectionMode: boolean
  /** DIY 编辑态 */
  editingLayout: boolean
}

export function useNumberDial(args: UseNumberDialArgs): void {
  const argsRef = useRef(args)
  argsRef.current = args

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const current = argsRef.current
      const guards: NumberDialGuardState = {
        enabled: current.enabled,
        composing: e.isComposing,
        typing: isEventTargetTyping(e),
        dialogOpen: isAnyDialogOpen(),
        dragHandleFocused: isDragHandleFocused(),
        selectionMode: current.selectionMode,
        editingLayout: current.editingLayout,
      }
      const action = resolveNumberDialAction(e, {
        guards,
        dialMap: buildDialMap(current.dialSites),
        quickDialSlots: current.quickDialSlots,
        siteIndex: current.siteIndex,
      })
      if (!action) return
      // 命中：捕获阶段截停，不再往下冒泡给其它全局监听；
      // 同步打开（用户激活态，弹窗拦截器放行；await 再开会被拦截）。
      e.preventDefault()
      e.stopImmediatePropagation()
      openDialTarget(action.site, {
        forceNewTab: action.forceNewTab,
        linkTarget: current.linkTarget,
      })
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])
}
