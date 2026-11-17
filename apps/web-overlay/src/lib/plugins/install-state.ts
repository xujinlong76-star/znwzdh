import { comparePluginVersions } from './plugin-manifest'

export type InstallAction = 'install' | 'update' | 'installed'

/**
 * 根据「已安装版本」与「市场最新版本」解析安装按钮应呈现的动作。
 *
 * - 未安装（installedVersion 为空）→ `install`：立即安装
 * - 已安装且市场版本更高（comparePluginVersions > 0）→ `update`：更新到 vX
 * - 其余 → `installed`：已安装（点击管理 / 卸载）
 *
 * 更新的执行通道与安装完全一致（服务端 install 为幂等增量语义：
 * 只增不减，重装即升级），因此这里只负责「呈现哪种动作」，
 * 不引入任何新的服务端状态机。
 */
export function resolveInstallAction(
  installedVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): InstallAction {
  if (!installedVersion) return 'install'
  if (latestVersion && comparePluginVersions(latestVersion, installedVersion) > 0) {
    return 'update'
  }
  return 'installed'
}

/**
 * P3-6：已安装卡片在触屏上的点按去向。
 *
 * 桌面 hover 时「已安装」会变成「管理 / 卸载」，用户点按前已看到去向；
 * 触屏无 hover，点按直接以 uninstall 模式打开卸载确认弹窗，预期是
 * 「查看 / 管理」的用户先看到卸载确认、容易误点。因此触屏上已安装态
 * 的点按先进已安装管家（`/marketplace/installed`，复用现有管理页：
 * 升级 / 卸载 / 主题切换都在那里），不在卡片上直接弹卸载确认。
 * 鼠标点按保持原样（开卸载确认弹窗）；安装 / 更新动作不受影响。
 */
export function shouldOpenManageOnInstalledTap(
  targetMode: 'install' | 'uninstall' | 'upgrade',
  isTouch: boolean,
): boolean {
  return targetMode === 'uninstall' && isTouch
}
