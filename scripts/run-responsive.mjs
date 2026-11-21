#!/usr/bin/env node
/**
 * 响应式验收的分层运行包装（2026-11-22）。
 *
 * 为什么要包装而不是 `cross-env RESPONSIVE_TIER=pr playwright test`：
 * 仓库没装 cross-env，而 `VAR=x cmd` 语法在 Windows 的 cmd/PowerShell 里
 * 不生效——本地开发机跑 pnpm 脚本会静默变成"没设置变量 → 跑全量"，
 * 既不报错也不达预期，是最难查的那种坑。
 *
 * 用法：
 *   node scripts/run-responsive.mjs pr        # PR 门禁：390 + 1366
 *   node scripts/run-responsive.mjs nightly   # 夜间全量：6 档
 *   node scripts/run-responsive.mjs           # 不传 = 全量
 * 额外参数原样透传给 playwright：
 *   node scripts/run-responsive.mjs pr -g hot
 */
import { spawn } from 'node:child_process'

const VALID = new Set(['pr', 'nightly'])
const first = process.argv[2]
const tier = VALID.has(first) ? first : ''
const rest = tier ? process.argv.slice(3) : process.argv.slice(2)

const env = { ...process.env }
if (tier) env.RESPONSIVE_TIER = tier

const args = ['playwright', 'test', 'e2e/responsive-matrix.spec.ts', ...rest]

console.log(
  '[responsive] tier=' + (tier || 'all') +
  ' | 目标视口=' + (tier === 'pr' ? '390x844 + 1366x768' : '6 档全量'),
)

const child = spawn('npx', args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
child.on('exit', (code) => process.exit(code ?? 1))
