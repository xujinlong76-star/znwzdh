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
