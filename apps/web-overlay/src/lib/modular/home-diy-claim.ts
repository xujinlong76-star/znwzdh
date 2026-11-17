/**
 * 首页 DIY 历史步认领制（W2-9）的唯一状态源：零 import 叶子模块。
 *
 * 从 home-diy-storage.ts 拆出：认领只是一枚模块级 boolean + 微任务清零，
 * 本身不依赖存储/历史/同步；独立成叶后，全局 Ctrl+Z 的轻量网守
 * （hooks/use-global-undo）只需 import 这里即可同步读认领态，不必把
 * 56KB 的 home-diy-storage 静态拉进全路由共享 chunk。
 * home-diy-storage.ts 继续 re-export 这两个函数，既有导入路径不变，
 * 共享的仍是同一份模块实例（同一枚 boolean）。
 */

/**
 * 同一按键只撤销一步（W2-9）的认领制：Ctrl+Z 有三条 window keydown 监听——
 * 画布撤销（modular-canvas，未编排态也挂着）、排版撤销（use-home-diy，
 * 仅编排态）、回收站恢复（navigation-content）——不拦就会一次按键撤两步。
 * 同一任务（task）里第一个认领者返回 true 并执行，其余返回 false；
 * 认领在微任务末尾自动清零（同一按键的后续监听都在同一任务里跑完）。
 * 注意：这里不拦 undoHomeDiy 本身——旧测试在同一 `it` 里同步连调两次
 * undoHomeDiy()，拦它会把测试也拦了；认领只拦按键入口（use-home-diy
 * 的 undo/redo 回调 + navigation-content 的恢复监听）。
 */
let homeDiyHistoryStepClaimed = false

export function claimHomeDiyHistoryStep(): boolean {
  if (homeDiyHistoryStepClaimed) return false
  homeDiyHistoryStepClaimed = true
  queueMicrotask(() => {
    homeDiyHistoryStepClaimed = false
  })
  return true
}

export function didHomeDiyHistoryStepClaimThisTask(): boolean {
  return homeDiyHistoryStepClaimed
}
