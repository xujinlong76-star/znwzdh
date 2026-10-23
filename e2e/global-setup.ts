import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * E2E 专属数据库路径（与开发库 data/navhub.db 物理隔离）。
 *
 * 为什么需要它：插件市场等用例会通过导入/发布通道往库里写入测试插件，
 * 此前 Playwright 的 webServer 直接启动 scripts/dev-all.mjs（写死开发库），
 * 导致开发库被 e2e-* 残留污染、真实种子插件反而进不去。
 *
 * `NAVHUB_E2E_DB` 可整体改址（相对路径按仓库根解析）：并行会话各自跑 E2E 时，
 * 共用一个库文件会让 `e2e-web-server.mjs` 的建库前重置撞上对方的句柄（Windows EBUSY），
 * 表现是「config.webServer 起不来」而不是任何用例失败 —— 红灯归属会被彻底带偏。
 * 默认值不变，CI 与日常本地跑不受影响。
 */
export const E2E_DB_PATH = resolve(
  process.cwd(),
  process.env.NAVHUB_E2E_DB || 'data/e2e/navhub-e2e.db',
)

/**
 * 每轮 E2E 都从空库开始（与 CI 行为一致：CI 的 test-e2e 作业同样不播种）。
 *
 * 注意：**删库不在这里做**。Playwright 先启动 webServer、再跑 globalSetup，
 * 等这里执行时中枢 API 已经打开了 SQLite 文件；Linux 可以 unlink 打开中的文件，
 * Windows 会 EBUSY（本地 E2E 因此一直起不来）。重置已挪到
 * `scripts/e2e-web-server.mjs`（启动 dev-all 之前，带重试）。
 */
export default function globalSetup() {
  mkdirSync(dirname(E2E_DB_PATH), { recursive: true })
}
