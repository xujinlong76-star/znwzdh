# 回归夹具标准答案：2026-11-16 ～ 2026-11-22（北京时间窗口）

人工标准答案，先于脚本写出；脚本输出须与之逐项比对。
夹具输入：`scripts/fixtures/weekly-review-2026-11-16-22.fixture.txt`
（文件名用 .fixture.txt：仓库 .gitignore 忽略 *.log）
（`git log origin/main --since="2026-11-16 00:00:00 +0800"
--until="2026-11-22 23:59:59 +0800" --format="COMMIT %H %cd %s" --date=short --name-only`，
928 笔，窗口按提交者日期过滤）。

## 0. 窗口口径（实测教训，2026-11-24）

git 把不带时刻的日期（如 "2026-11-16"）按“当天当前时刻”解析，
同一命令在不同时刻跑会得出不同提交数（实测 906→894 漂移）。
因此本夹具与全部人工点数一律用显式时刻 + 显式时区偏移（+0800）。
显式窗口点数 5 次重复均为 928 笔，hash 集逐次一致。

- 基线 rev（窗口前最后一笔）：`02c0fd1bfe948cfc39727ecc1bf91d52cd650af6`
  （`git rev-list -1 --before="2026-11-16 00:00:00 +0800" origin/main`）
- 窗口内最新一笔：`8e876a02d926fa49b285d2fd1a34114d0f830c6d`
  （2026-11-22，`fix(plugin-card): U-408 作者行 <p> 改 <div>`）
- 注意：`2a1e5ff1`（2026-11-22 fix(brief)）提交者日期为
  2026-11-22 18:58:56 +0000 = 11-23 02:58:56 +0800，不在本窗口内。

## 1. 聚类计数（人工独立分类器 /tmp/cluster.mjs，与脚本实现分开写）

规则（与脚本 `classifyCommit` 同一份口径）：
图标（主题含 图标/icon/favicon 或改动 brand-icons/）→ 考试节点
（主题含 考试/国考/准考证/成考/四六级/省考/guokao/cet/exam 或改动
exam-calendar.ts）→ 修复（fix: / fix(）→ 战略实现
（strategy/战略/复盘/weekly-review）→ 功能 / 测试 / 文档 / 工程 /
其他（按类型前缀；无前缀进“其他”）。

| 聚类 | 笔数 | 代表 commit（窗口内最新 3 笔，短 hash + 主题） |
|---|---|---|
| 修复 | 301 | 8e876a02 fix(plugin-card): U-408 作者行 <p> 改 <div>，修 /marketplace 水合失败；a1c470fe fix(watchlist): U-460 同步按 applied 计成功，LWW 跳过如实报出；6cc59533 fix(probe): U-433 探活口径：301/302 落到 corporate 企业站终点记未证实 |
| 其他 | 166 | eac3bea1 U-470: 下架 ai-deep-search-pack 死引擎 !pwc 与 !phind（只删不换）；97ab63c7 Merge branch 'evo/jd-link-1622' into main；e81be591 Merge branch 'b3/u427-fix-1322' into main (U-427) |
| 功能 | 120 | fea8bfb0 feat(api): 空库在启动日志与 /api/health 里可见；5858ec16 feat(favorites): U-371 收藏离线编辑不再经批量同步静默丢失；3d567cb4 feat(favorites): /favorites 页面重排 |
| 测试 | 113 | 01a181ec test(e2e): U-426 E3 期望计入门户备用链；32d8706c test(favorites): U-423 同步 triage 断言到 U-371 的 updatedAt 调用形状；f918254f test(e2e): U-124 E3 例外 label 补「缴费」 |
| 考试节点 | 109 | 1e8f69aa test(api): U-417 救援补丁：补 POST /api/me/exams/sync 运行时契约用例；3cda21e2 U-421: 开放期提醒岛瘦身行加「去打印准考证」直达链；c003eda5 test(exam): u124 门户备用链断言 |
| 图标 | 86 | 081139b3 fix(favorites): a11y 对比度守卫回归——3 处 -600 图标色提档 -700；36c8d9f2 fix(favicon): U-389 分层修法 P1/P2/P3；23195b0d fix(favicon): gemini 图标改走 /brand-icons/gemini.svg，修 404 |
| 工程 | 23 | 025c78e5 chore(mirror): 同步 PR #104 到 apps/web；e197b020 perf(u358): 今日中心四区改 dynamic(ssr:false) 懒加载；66aa7009 chore(mirror): sync tracked search-bar.tsx with overlay |
| 文档 | 10 | 838742af docs(probe): U-433 ISSUE-2 修正 classifyCorporateTerminalRedirect 失实注释；52e919e2 docs(pricing): 383→388 注释同步；b8d56e56 docs(audit-p0-1): 首屏 flight 已实测 234KB |
| 战略实现 | 0 | 无 |
| 合计 | 928 | 301+166+120+113+109+86+23+10+0 = 928，零丢失 |

## 2. 数据文件前后对照（`git show <rev>:<path>` 独立点数）

| 指标 | 基线 02c0fd1b（11-16 前） | 窗口末 8e876a02（11-22） | 变化 |
|---|---|---|---|
| 站数（navigation.json，递归 items 计数） | 335 | 388 | +53 |
| 定价键数（pricing-overrides.json） | 342 | 394 | +52 |
| 考试节点数（exam-calendar.ts，label 计数 = 节点解析数） | 11 | 46 | +35 |

## 3. 过期检测规则①（as-of 2026-11-22，endISO < 当天且非 estimated）

共 14 项（独立解析器 /tmp/expired.mjs；节点总数 46，解析数与 label 计数一致）：

1. 军队文职 / jundui-wenzhi / 缴费（end=2026-11-18）
2. 京考 / jingkao / 报名（end=2026-11-18）
3. 成考 / chengkao / 江西成绩查询（end=2026-11-18）
4. 成考 / chengkao / 江西成绩复核（end=2026-11-20）
5. 成考 / chengkao / 广东成绩查询（end=2026-11-18）
6. 成考 / chengkao / 广东成绩复核（end=2026-11-20）
7. 成考 / chengkao / 新疆成绩查询（end=2026-11-18）
8. 成考 / chengkao / 新疆成绩复核（end=2026-11-20）
9. 成考 / chengkao / 山西成绩复核（end=2026-11-20）
10. 成考 / chengkao / 海南成绩查询（end=2026-11-19）
11. 成考 / chengkao / 天津成绩复核（end=2026-11-19）
12. 江苏自考 / jiangsu-zikao / 成绩查询（end=2026-11-18）
13. 江苏自考 / jiangsu-zikao / 成绩复核（end=2026-11-20）
14. 广东自考 / guangdong-zikao / 成绩查询（end=2026-11-18）

误报说明：14 项逐项核对 endISO 均 < 2026-11-22 且均非 estimated，
按规则①定义误报为 0。但文件无显式状态字段，“仍待办”按“仍列在
EXAMS 中”近似——检出项是“疑似过期，待人工确认”，不是“展示错误”
的定论，须由复盘轮逐项确认是否为展示口径问题。

## 4. 过期检测规则②③（as-of 2026-11-22，状态表 lastUpdated=2026-11-22）

- 规则②：0 项。待 PoC 项最老提出于 2026-11-19（仅 3 天），
  无一项超 14 天观察期。
- 规则③：Batch 0 前置（S20 联盟链接披露 + CPS）：上次记录“未合入”，
  本次 `git merge-base --is-ancestor origin/batch0/fix-integrated origin/main`
  实测仍为未合入（分支 HEAD 3e6d98a6）——无变化，不列入裁决清单；
  其余带前置项（S01/S02/S03/S21）无 git 可见信号，列“需人工确认”，
  不作变化判定。
- 状态表未过期（0 天），草稿顶部无告警。

## 5. 状态表（hidden_files/strategy-state.json）

32 项：过门禁 8 / 待PoC 12 / 未通过 12；状态：未启动 18 / 存档 12 /
已实现 1（S08 我的常用）/ 已冻结 1（S20 联盟 CPS）。
来源：HX.md 31 项 + 11-22 第 7 路正式裁决（S32 无账号 E2EE 全量自动
同步不通过）1 项。注意：HX.md 末尾小结写“明确不通过 8 项”但表内
实际列出 10 项（#2、#4–#7、#9、#21、#22、#30–#31），以表内逐行
为准，未改写 HX 原文。
