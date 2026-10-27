const fs = require('fs')

const nowIso = new Date().toISOString()
const nowLocal = '2026-10-27T01:48:00+08:00'

// ---- MODULES.json ----
const mp = '.cache/auto-upgrade/MODULES.json'
const m = JSON.parse(fs.readFileSync(mp, 'utf8'))
const area = m.areas.find((a) => a.id === 'home-navigation')
if (!area) throw new Error('home-navigation area missing')
area.rounds += 1
area.updatedAt = nowLocal
area.last_researched = '2026-10-27T01:30:00+08:00'
const gi = area.knownGaps.findIndex((g) => g.startsWith('【P2·run44 定案·失败原因码丢掉了 HTTP status】'))
if (gi < 0) throw new Error('gap #13 entry missing')
area.knownGaps[gi] +=
  ' 【run87 01:30 逐条复核·行号已随迁移更新】文件已迁到 src/lib/modular/：推送失败固定 hub_error 在 home-diy-io.ts:235；拉取文案把 check_failed 与 hub_error 合并同类在 vault-copy.ts:80-81；客户端词表 navhub-api.ts:1971 / :1990；删除 toast 已带 HTTP status（home-diy-backup-dialog.tsx:345）但 telemetry 仍拍平。6 条外部依据 + 四步施工图见 research/2026-10-27T01-30-home-navigation.md。未施工原因：navhub-api.ts 是第一改动点且正被并行会话改写（§2c）。'
fs.writeFileSync(mp, JSON.stringify(m, null, 1) + '\n')

// ---- STATE.json ----
const sp = '.cache/auto-upgrade/STATE.json'
const s = JSON.parse(fs.readFileSync(sp, 'utf8'))
s.runs = 84
s.last_run = 'run87'
s.no_commit_streak = 0
s.mode = 'normal'
s.mode_reason =
  'run87 有提交（8efde42）：§10 前端门禁红灯（723d640 的 11 个 tsc 错）先修——仪表盘导出的 3 个未定义变量已单独提交并推送；体检面板 8 错与并行会话 WIP 同文件交织，保留在工作树待其提交，不代交。home-navigation gap#13 完成研究+定级但按 §2c 未施工（navhub-api.ts 被并发改写）。'
s.pending_push = null
s.push_blocked = false
s.updated_at = nowIso
s.cursor = s.cursor || {}
s.cursor.next_target = {
  area: 'home-navigation',
  subitem: 'gap#13 有界失败码（http_401/http_403/http_4xx/http_5xx/network）+ 按用户动作分族文案 + 映射矩阵测试',
  why: '施工图已就绪（research/2026-10-27T01-30-home-navigation.md，含 6 条外部依据与四步落地）；开工前置：navhub-api.ts 必须从并行会话的大改中脱手，且重新 git status + grep 行号（该文件行号已因迁移漂移过一次）',
}
s.cursor.active_run = {
  run: 87,
  segment: '87',
  area: 'home-navigation',
  subitem: '§10 前置：修 723d640 的前端门禁红灯（仪表盘导出 3 个未定义变量）+ gap#13 只读研究',
  startedAt: '2026-10-27T01:30:00+08:00',
  endedAt: nowLocal,
  status: 'committed_ci_fix_research_only',
  commit: '8efde42',
  push: '723d640..8efde42 origin/main',
  verification: {
    webTypecheck: 'EXIT=0 / 0 error（修前同命令 EXIT=1 / 11 error）',
    overlayMirror: 'check-web-overlay --fix 后 705 文件一致，0 漂移 0 缺失',
    precommit: '语法检查通过；定向测试 6 文件 101 例通过 + 2 跳过（含 dashboard-components 26 例）',
    notRun: '浏览器实测（导出按钮需管理员会话+真实中枢，并行会话占用同一工作树）、pnpm verify 全量、Playwright E2E',
  },
  withheld: [
    'plugin-url-health-panel.tsx 的 2 处类型修复（auditedAt 可选字段 + setAiHealResults 的 [slug] 包裹）与并行会话约 99 行 WIP 同文件交织，已随其暂存区（git show :<path> 与工作树逐字节相等），待其提交带走；本轮不代交',
  ],
  warnings: [
    '共享暂存区被他方 git add 了 91 个文件 / +68602 行，含 .playwright-mcp/（145MB）与 tmp-8k-probe.mjs；本轮未清理未提交，若被原样提交会把 145MB 会话截图推上远端',
    '体检面板在 HEAD 里仍有 8 个 tsc 错（前端门禁红），转绿依赖并行会话提交',
  ],
}
s.ci_last_push = {
  sha: '8efde4240b0642f5c3d1c87b8db22cc162e74e39',
  checked_at: '2026-10-27T01:41:00+08:00',
  source: 'GitHub REST check-runs（匿名，无 gh 无 token）',
  total: 9,
  state: 'in_progress（8 个进行中 + 1 skipped）',
  prev_tip: '723d640 前端门禁红：11 个 tsc 错（3 个仪表盘 + 8 个体检面板）',
  expected: '本轮只修掉仪表盘的 3 个 ⇒ 8efde42 的前端门禁预期仍红（剩 8 错全在并行会话 WIP 的体检面板），待其提交后转绿',
  note: '第一次 push 遇到 SSL unexpected eof，未改动远端、未强推；第二次成功',
}
s.run87 = {
  mined: 'signals/2026-10-27T01-30-run87-skip.md（events Δ0、llm_usage 24h 78/55 fail=70.5%、无新增痛点）',
  researched: 'research/2026-10-27T01-30-home-navigation.md（6 来源 + 本仓约束 + 四步施工）',
  report: 'reports/2026-10-27T01-30-run87-ci-fix-and-gap13-research.md',
  commit: '8efde42（1 文件 +3/−3）',
  ci_prev_red_fixed: '3/11（仪表盘）；8/11 待并行会话',
  seven_dim: { 完整性: '3→4', 性能: '5→5', 可访问性: '4→4', 可靠性: '2→4', 数据主权: '4→4', 跨端一致性: '1→1', 可发现性: '2→4' },
  disproved: [
    '「导出只是类型噪音」→ 实为模块级自由变量，按钮必抛 ReferenceError',
    '「1600 行只是类型不匹配」→ updater 返回裸对象会抹掉整个 Record 的 AI 自愈结果',
    '「失败码丢 status 只在删除路径」→ save/sync/pull/delete 四路全丢',
    '「删除 toast 完全没有 status」→ dialog:345 已展示 HTTP status，丢的是 telemetry 码与建议动作',
  ],
}
fs.writeFileSync(sp, JSON.stringify(s, null, 1) + '\n')
console.log('ledger updated: MODULES round=%d, STATE runs=%d last_run=%s', area.rounds, s.runs, s.last_run)
