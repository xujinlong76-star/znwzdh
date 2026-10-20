import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * E2E 专属数据库路径（与开发库 data/navhub.db 物理隔离）。
 *
 * 为什么需要它：插件市场等用例会通过导入/发布通道往库里写入测试插件，
 * 此前 Playwright 的 webServer 直接启动 scripts/dev-all.mjs（写死开发库），
 * 导致开发库被 e2e-* 残留污染、真实种子插件反而进不去。
 */
export const E2E_DB_PATH = resolve(process.cwd(), 'data/e2e/navhub-e2e.db')

/**
 * 每轮 E2E 都从空库开始（与 CI 行为一致：CI 的 test-e2e 作业同样不播种）。
 * 空库是刻意的——用例必须自造数据，不能依赖开发库里的既有内容。
 */
export default function globalSetup() {
  mkdirSync(dirname(E2E_DB_PATH), { recursive: true })
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${E2E_DB_PATH}${suffix}`, { force: true })
  }
}
