/**
 * 批量固定的 toast 文案（纯函数，可直接单测）。
 *
 * 背景：pinSiteToWorkbench 对已固定过的站也返回 ok（只不新加），
 * 批量处理器不能把 ok 数直接当新增数报给用户——选两条同站不同写法
 * （www / utm / 尾斜杠）会报「已固定 2 个站点」，实际只新增 1 条。
 * newlyPinned 只计本次新建的站；alreadyPinned 计 ok 但未新加的站。
 */
export function buildBatchPinToast(newlyPinned: number, alreadyPinned: number): { title: string; description: string } {
  if (newlyPinned > 0 && alreadyPinned > 0) {
    return {
      title: '📌 已固定 ' + newlyPinned + ' 个站点',
      description: '已加入收藏与工作台启动坞；另有 ' + alreadyPinned + ' 个已在收藏中。',
    }
  }
  if (newlyPinned > 0) {
    return {
      title: '📌 已固定 ' + newlyPinned + ' 个站点',
      description: '已加入收藏与工作台启动坞。',
    }
  }
  if (alreadyPinned > 0) {
    return {
      title: '📌 ' + alreadyPinned + ' 个站点已在收藏中',
      // 只敢说收藏未变：pin 时 dock 补位仍可能新建启动坞 widget
      //（workbench-bridge 无论是否新加都会确保 dock 存在），
      // 所以不写「工作台启动坞未变」。
      description: '未新增任何站点，收藏未变。',
    }
  }
  return {
    title: '⚠️ 固定失败',
    description: '浏览器本地存储不可用，或网址不合法。',
  }
}
