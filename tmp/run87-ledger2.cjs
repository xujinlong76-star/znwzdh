const fs = require('fs')
const sp = '.cache/auto-upgrade/STATE.json'
const s = JSON.parse(fs.readFileSync(sp, 'utf8'))
const nowLocal = '2026-10-27T01:47:00+08:00'

s.mode_reason =
  'run87 有提交：§10 前端门禁红灯（723d640 的 11 个 tsc 错）两批修完并推送——8efde42 修仪表盘导出的 3 个未定义变量（整文件提交），ddebd7d 用临时索引只提交体检面板的 2 处类型修复（同文件并行 WIP 未带上）。home-navigation gap#13 完成研究+定级但按 §2c 未施工（navhub-api.ts 被并发改写）。'

s.cursor.active_run.commit = '8efde42 + ddebd7d'
s.cursor.active_run.push = '723d640..8efde42..ddebd7d origin/main'
s.cursor.active_run.verification.precommit = '两次提交钩子各通过：6 文件 101 例 / 20 文件 191 例（各 2 跳过）'
s.cursor.active_run.withheld = [
  '体检面板同文件并行 WIP 约 99+ 行（趋势 validPoints、深检/趋势缓存失效、重试清错）——未进入任何提交，仍在工作树与并行会话暂存区中，由其自行提交；我的 2 处修复用临时索引单独提交为 ddebd7d（committed==hybrid 已逐字节核对）',
]
s.cursor.active_run.hybrid_commit = {
  sha: 'ddebd7d',
  mechanism: 'GIT_INDEX_FILE=$TEMP/run87-idx + git read-tree HEAD + git update-index --cacheinfo（只含 1 路径）；真实 index 的 90 个他方条目一个字节未动',
  content_proof: 'tmp/run87-panel-hybrid.tsx 与 HEAD 的差异仅 +9/−4（2 个锚点各命中 1 次）；提交后 git show HEAD:<path> 与 hybrid diff -q 相等',
}

s.ci_last_push = {
  sha: 'ddebd7d44161998c341bf664dbccc30b1f4fe40a',
  checked_at: '2026-10-27T01:48:00+08:00',
  source: 'GitHub REST check-runs / annotations（匿名，无 gh 无 token）',
  total: 9,
  prev_tips: [
    '723d640 前端门禁 failure：11 个 tsc 错（annotation 逐条核对）',
    '8efde42 前端门禁 failure：8 个 tsc 错，全在 plugin-url-health-panel.tsx（530/858/860/2286/2317/2333/2385 + 1600）',
  ],
  expected: 'ddebd7d 预期前端门禁转绿（提交内容 = HEAD + 2 处类型修复，等价于本地 tsc EXIT=0 的合并工作树去掉并行 WIP）',
  push_retries: '两次 push 各遇一次瞬时网络错误（SSL unexpected eof / Connection reset），远端未变、未强推，重试成功',
}
s.run87.commit = '8efde42 + ddebd7d'
s.run87.ci_prev_red_fixed = '11/11 已修并推送（3 仪表盘 + 8 体检面板），CI 转绿待 ddebd7d 的 run 确认'
s.updated_at = new Date().toISOString()
fs.writeFileSync(sp, JSON.stringify(s, null, 1) + '\n')
console.log('STATE updated: commit', s.run87.commit)
