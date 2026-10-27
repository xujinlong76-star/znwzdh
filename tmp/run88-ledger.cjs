const fs = require('fs')
const MOD = '.cache/auto-upgrade/MODULES.json'
const ST = '.cache/auto-upgrade/STATE.json'
const now = '2026-10-27T04:05:00+08:00'

// ---- MODULES ----
const mRaw = fs.readFileSync(MOD, 'utf8')
const m = JSON.parse(mRaw)
if (JSON.stringify(m, null, 1) + '\n' !== mRaw) throw new Error('MODULES roundtrip mismatch')
const a = m.areas.find((x) => x.id === 'home-navigation')
if (!a) throw new Error('area not found')
const gi = a.knownGaps.findIndex((g) => g.includes('失败原因码丢掉了 HTTP status'))
if (gi < 0) throw new Error('gap13 not found')
a.knownGaps[gi] +=
  ' 【run88 2026-10-27 03:5x 只读轮·施工图定稿】码表修正为 6 个（429 单列——可退避重试；400/404/405/422 才是不可重试的 http_4xx）：http_401/http_403/http_429/http_4xx/http_5xx/network。证据：saveCloudVault 在 navhub-api.ts:1039-1041 丢 status，deleteCloudVault:1071-1076 保留（同构路径不对称）；io:231-237 固定 hub_error；vault-copy.ts:81 与 check_failed 合并。修法：映射函数放零依赖模块 src/lib/modular/vault-codes.ts（run87 chunk 泄漏教训，仅限 import type），矩阵 + 文案分族 + 无值 import 三条守卫，恒等消融必须全红。七维 24→26（可靠性 3→4、可发现性与引导 3→4）。研究见 research/2026-10-27T03-55-home-navigation-gap13-error-family.md。未施工原因：工作树 12-13 项并行 WIP 持续写入（plugin-audit.ts 03:56:33、candidate-probe-classify.test.ts 03:57:06 仍在变）。'
a.rounds = 30
a.updatedAt = now
a.last_researched = now
a.note_run88 =
  'run88（03:50–04:05，§2c 只读轮）：开局 HEAD 27e95d8 == origin/main，无锁，脏 10 → 收尾 12（全部他方，含 03:56/03:57 新写两文件）。§3 只读挖掘：events 1051 / plugin_heal 7d n=78 fail=55（rate_limit 47，单日批量，属配额线索非功能缺陷）/ vault_* 7d 0 条。§4 gap#13 七条证据在 HEAD 逐行复核成立，navhub-api.ts 的他方 WIP 仅在 3025-3066，与 VAULT_RESULT_CODES 1971-1996 零交集。§5 新增 5 来源（fetch 只在网络层 reject / 401 vs 403 两种动作 / 429 可重试），码表由 5 码修正为 6 码。§6 七维 24→26（预期，未施工）。§7 施工图 7 步（零依赖映射模块 + save 补 status + 落码 + 文案分族 + 遥测只报码 + 三重守卫 + 恒等消融）。零代码零提交；材料见 research/2026-10-27T03-55-home-navigation-gap13-error-family.md 与 reports/2026-10-27T03-55-run88-readonly-gap13-error-family-blueprint.md。'
fs.writeFileSync(MOD, JSON.stringify(m, null, 1) + '\n')

// ---- STATE ----
const sRaw = fs.readFileSync(ST, 'utf8')
const s = JSON.parse(sRaw)
if (JSON.stringify(s, null, 1) + '\n' !== sRaw) throw new Error('STATE roundtrip mismatch')
s.runs += 1
s.round = 88
s.run = 88
s.last_run = 'run88'
s.no_commit_streak = (s.no_commit_streak || 0) + 1
s.updatedAt = now
s.ci_last_push = {
  sha: '27e95d8',
  checked_at: '2026-10-27T03:52:00+08:00',
  source: 'GitHub REST check-runs（匿名 Node fetch，无 gh 无 token）',
  total: 9,
  green: '前端门禁（typecheck/lint/build）/ 覆盖层与扩展 / PostgreSQL / SQLite / 线上 ISR 抽查 / 镜像冒烟 / 依赖审计 = success（7 项）',
  skipped: '运行时线上检查（生产预览，按设计跳过）',
  pending: '浏览器 E2E（Playwright）收尾时仍 in_progress；已知 6d378ab 上为过期断言红（admin-console gap），与本轮/上轮改动无关',
  next: '下一轮开局复采 27e95d8 的 E2E 终态'
}
s.cursor.next_target = {
  area: 'home-navigation',
  subitem: '施工 gap#13「金库失败分族」6 码 + 文案分族 + 三重守卫（施工图已定稿：research/2026-10-27T03-55-home-navigation-gap13-error-family.md 第 7 节 7 步）',
  why: '七维 24→26（可靠性 3→4、引导 3→4）；证据七条在 HEAD 27e95d8 逐行成立；实现文件当前 CLEAN，navhub-api.ts 他方 WIP 与目标区零交集。前置：开工时三实现文件仍 CLEAN 且 navhub-api.ts 的 1971-1996 / 1001-1043 区间无他方 hunk，否则再次顺延。'
}
s.cursor.active_run = {
  run: 88,
  segment: '88',
  area: 'home-navigation',
  subitem: '§2c 只读：gap#13 施工图定稿（6 码修正 + 三重守卫 + 恒等消融）',
  startedAt: '2026-10-27T03:50:00+08:00',
  endedAt: now,
  status: 'readonly_researched_and_blueprinted_no_code',
  commit: '无（本轮零代码零提交，HEAD/远端均 27e95d8）',
  verification: {
    nothingToVerify: '未改代码，无构建/测试必要；只读挖掘脚本 readonly + fileMustExist，EXIT=0',
    ci: '27e95d8：7 success + 1 skipped + E2E in_progress（下一轮复采）',
    ledger: 'MODULES/STATE 往返守卫通过（1 空格缩进 + 结尾换行）',
    git: '本轮未执行 add/commit/push/stash/restore；.cache/ 经 git check-ignore 确认被忽略'
  },
  dirty_snapshot: {
    open: 10,
    close: 12,
    note: '全部属并行会话；收尾新增 routes/plugin-audit.ts（+34/−2, 03:56:33）与 test/candidate-probe-classify.test.ts（+44/−1, 03:57:06）'
  },
  report: 'reports/2026-10-27T03-55-run88-readonly-gap13-error-family-blueprint.md',
  signals: 'signals/2026-10-27T03-55-run88-mining.md',
  research: 'research/2026-10-27T03-55-home-navigation-gap13-error-family.md'
}
s.completed = s.completed || []
s.completed.push(
  'run88 home-navigation gap#13 §2c 只读轮：§3 只读挖掘（events 1051 / plugin_heal 7d n=78 fail=55 / vault_* 7d 0 条）+ §4 七条证据在 HEAD 27e95d8 逐行复核（save 丢 status 1039-1041 vs delete 保留 1071-1076）+ §5 新增 5 来源（码表 5→6，429 单列）+ §6 七维 24→26（预期）+ §7 施工图 7 步 + 账本更新；零代码零提交，脏树 10→12（全部他方）。'
)
s.lessons = s.lessons || []
s.lessons.push(
  '同构两条路径的失败信息不对称，是「低成本、可验证」缺陷的可靠入口：run88 只读轮靠对比 saveCloudVault（catch 丢 status）与 deleteCloudVault（catch 保留 status）把 gap#13 的爆炸半径压到「一个 catch + 一张码表」。下次审计同类「错误码拍平」问题时，先找同文件里已经做对的兄弟函数当模板。'
)
fs.writeFileSync(ST, JSON.stringify(s, null, 1) + '\n')
console.log('MODULES/STATE updated; runs=', s.runs, 'rounds=', a.rounds, 'gapLen=', a.knownGaps[gi].length)
