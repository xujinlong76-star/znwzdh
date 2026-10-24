#!/usr/bin/env node
/**
 * 本地跑 E2E 的入口：自动挑一对空闲端口，再交给 Playwright。
 *
 * 为什么需要它：`playwright.config.ts` 默认用 3000/8787，而这两台开发机上的
 * 常驻 `dev:all` 正好占着它们；配置要求 `reuseExistingServer: false`（否则用例
 * 会写回开发库），于是本地跑 E2E 的第一步永远是
 *
 *     Error: http://localhost:3000 is already used ...
 *
 * 手动换端口（`NAVHUB_WEB_PORT=3100`）也不行——3100 常常也被第二套 dev 栈占着。
 * 每次试错都要等 Playwright 启动一遍才能看到结果，成本很高。
 *
 * 本脚本做三件事：
 *   1. 从 3200 / 8900 起扫一对**都空闲**的端口（Web 与 API 必须同时可用）；
 *   2. 打印选中的端口，便于排查；
 *   3. 以该端口启动 Playwright，参数原样转发（`node scripts/e2e-local.mjs -g 关键词`）。
 *
 * 刻意**不做**的：不自动杀进程。占用端口的可能是同事正在跑的开发栈，
 * 按端口猜测并 kill 的代价太高；检测到长期占用时只报出端口，由人决定。
 */
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'

/** 端口是否可绑定（能绑上就说明没人监听；用完立刻释放） */
function isFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.on('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * 找一对空闲端口。
 *
 * Web 与 API 的起始点刻意错开：两者都要能绑上才算这一对可用，
 * 避免「Web 端口空着但 API 端口被占」导致 Playwright 起来后才失败。
 * 扫描上限 200 个，够避开常见的开发栈与代理端口。
 */
async function findPortPair(webStart = 3200, apiStart = 8900, span = 200) {
  for (let i = 0; i < span; i++) {
    const web = webStart + i
    const api = apiStart + i
    if ((await isFree(web)) && (await isFree(api))) return { web, api }
  }
  return null
}

const pair = await findPortPair()
if (!pair) {
  console.error('[e2e-local] 找不到可用的端口对（已扫 3200-3399 / 8900-9099）')
  process.exit(1)
}

console.log(`[e2e-local] 使用端口：Web ${pair.web} / API ${pair.api}`)
console.log('[e2e-local] 若上一个 E2E 被强杀，data/e2e/navhub-e2e.db 可能仍被占用；')
console.log('[e2e-local] 那时 e2e-web-server 会重试 20 次后报错，请按提示清理残留进程。')

const args = process.argv.slice(2)
const playwrightArgs = args.length > 0 ? ['test', ...args] : ['test']

const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', ...playwrightArgs], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    NAVHUB_WEB_PORT: String(pair.web),
    NAVHUB_API_PORT: String(pair.api),
    // 显式覆盖 baseURL：配置里 BASE_URL 会读 NAVHUB_WEB_PORT，但若外部环境
    // 已设了 PLAYWRIGHT_TEST_BASE_URL（指向某个运行中的站点），它会优先于端口，
    // 那就变成「对着别人的服务器跑用例」——这里清掉，保证测的是本次启动的进程。
    PLAYWRIGHT_TEST_BASE_URL: '',
    // 本机冷启动（turbopack 首次编译 + 另一套开发栈抢 CPU）常常超过配置默认的
    // 120 秒；CI 上不会走到这里（它直接用 `playwright test`）。可用同名环境变量覆盖。
    NAVHUB_E2E_SERVER_TIMEOUT: process.env.NAVHUB_E2E_SERVER_TIMEOUT || '300000',
  },
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
