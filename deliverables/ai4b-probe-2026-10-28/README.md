# [AI-4b] 普通站点替代复用的候选探针 —— 交付说明

日期：2026-10-28 ~ 2026-10-29（本目录是这一项的完整证据链）

## 结论

「AI 平替推荐」此前只把模型的话原样搬到界面：模型说「知名度高、稳定可用」就算证据，
停放页、拼错的域名、已下线的官网都能顶着「智能平替」的标签被一键写进 `sites` 并置为
active。本轮把插件体检里早就修过的「先实测再推荐」搬到普通站点这条更常用的路上：

1. **后端**：候选探活/档位/可信度抽成 `apps/api/src/candidate-probe.ts`，由插件体检与
   站点平替共用；`/api/sites/:id/recommend-alternative` 的三条出口（额度降级 / 模型成功 /
   模型失败）全部先实测再返回，排序按实测档位，不可达的**不删除**而是标注。
2. **前端**：五档档位逐档有说明、徽章、实测依据与可信度分解；`dead`/`suspicious` 禁止一键
   采纳（按钮禁用 + 处理函数二次早退）；`blocked`/`unverified` 可采纳但必须带人工复核提示；
   整批读数与口径声明随列表渲染，不只在 toast 里一闪而过。
3. **顺手修掉的真实缺陷**（浏览器实测暴露，都有回归测试）：
   - 平替目标**已在站内收录**时（兜底候选天然如此），旧实现直接改 `sites.url` 撞唯一约束
     → 用户只看到 500。改为「归档失效站点 + 关联既有条目」，前端如实说「已在站内收录」。
   - `archived` 被巡检当成「待治愈」：dismiss 点了等于没点、健康分永远上不去。
     现在归档即退出巡检队列与健康分分母。

## 目录

| 路径 | 用途 |
| --- | --- |
| `harness/seed.ts` | 造隔离库：1 个失效站点 + 3 个同类目活跃站点，并把五种档位写进未过期的探活缓存 |
| `harness/stub-llm.mjs` | 本地假模型（:8921），固定返回三条分别对应 verified/unverified/dead 的候选 |
| `harness/browser.mjs` | 真实浏览器实测（Playwright/chromium），两种模式各跑一次 |
| `harness/diag-login.mjs`、`harness/diag-alt.mjs` | 排障取证脚本（登录态 / 经代理的响应体） |
| `results/browser-evidence-{llm,fallback}.json` | 逐条断言结果、卡片原文、写库请求、console/网络记录 |
| `results/modal-{llm,fallback}.png` | 两种模式下弹窗的截图 |
| `results/logs/`、`logs/` | 隔离栈运行日志 |

## 复现

```bash
# 1) 隔离库 + 探活缓存（会清空 data/，只用演示数据）
node deliverables/ai4b-probe-2026-10-28/harness/seed.ts

# 2) 假模型
STUB_PORT=8921 node deliverables/ai4b-probe-2026-10-28/harness/stub-llm.mjs &

# 3) 中枢（run A：接假模型）
cd apps/api && NAVHUB_PORT=8914 NAVHUB_HOST=127.0.0.1 NAVHUB_MODE=lite \
  NAVHUB_SQLITE_PATH=<abs>/data/navhub.db NAVHUB_PROBE_CACHE_PATH=<abs>/data/probe-cache.json \
  NAVHUB_EMBEDDING_ENABLED=0 NAVHUB_ADMIN_TOKEN=ai4b-local-admin-token \
  NAVHUB_LLM_BASE_URL=http://127.0.0.1:8921/v1 NAVHUB_LLM_API_KEY=sk-stub-local-only \
  NAVHUB_LLM_MODEL=stub-probe-1 NAVHUB_LLM_ALLOW_PRIVATE=1 node src/main.ts &

# 4) 前端（独立端口与 dist，不碰并行会话的 :3200/:3411/:8787）
cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:8914 NAVHUB_STORAGE_BASE_URL=http://127.0.0.1:8914 \
  NAVHUB_ADMIN_TOKEN=ai4b-local-admin-token NEXT_DIST_DIR=.next-ai4b-dev AUTH_TRUST_HOST=1 \
  npx next dev -p 3414 &

# 5) 实测
AI4B_MODE=llm node deliverables/ai4b-probe-2026-10-28/harness/browser.mjs

# 6) run B（兜底分支）：重播种 → 中枢去掉模型（空 key + 本地死端口，零外呼）→
AI4B_MODE=fallback node deliverables/ai4b-probe-2026-10-28/harness/browser.mjs
```

两个关键前提（都踩过坑）：

- **登录**：`/api/hub/admin/*` 在匿名访问时被 Next 代理挡成 401；且 dev 冷编译时
  signin 页还是静态 DOM，点按钮不发请求。harness 以「会话里真的有了管理员」为唯一判据重试。
- **登录态拿到之后**：hub 代理只有在存在已登录管理员时才注入 `NAVHUB_ADMIN_TOKEN`，
  所以 web 与 hub 必须配置**同一个** token。

## 证据

浏览器实测（真实 DOM，不是源码字符串）：

| 模式 | 结果 | 覆盖档位 | 关键断言 |
| --- | --- | --- | --- |
| `AI4B_MODE=llm` | **18/18** | verified / unverified / dead | 档位排序=实测降序；dead 禁用且写库请求为 0；unverified 可采纳但带「慢 ≠ 死」；可信度是分解值 |
| `AI4B_MODE=fallback` | **17/17** | verified / blocked / suspicious | 兜底来源如实标注；suspicious 禁用；blocked 可采纳需人工确认；「没有模型参与」与实测读数同屏 |

两种模式合计覆盖后端能给出的全部五档。另有三条与档位无关的护栏：无 console error、
浏览器从未替候选 URL 发过请求（`ai4b-demo.example` 全程未被解析）、采纳后条目从待治愈
列表消失。

自动化测试：

- `apps/api/test/candidate-probe.test.ts`（5）：档位归类、预算用尽、抛错归类、排序。
- `apps/api/test/site-alternative-probe-api.test.ts`（4）：三条出口都带探活读数（离线，stub fetch）。
- `apps/api/test/audit-apply-merge-api.test.ts`（4）：目标已在站内→归档+关联；未收录→就地修复；
  归档退出巡检与健康分；dismiss 同样退出。
- `apps/web/test/site-alternative-honesty.test.ts`（11）：档位契约↔UI 逐档对应、禁用接线、
  读数渲染、合并提示如实。档位清单从契约解析，后端新增档位而 UI 未处理会变红。

消融（每条断言都证明过会咬）：

| 消融 | 结果 |
| --- | --- |
| 去掉 `dead/suspicious` 的 adoptable=false | 守卫测试红 |
| 把「慢 ≠ 死」换成「不可达」 | 守卫测试红 |
| 删掉实测读数渲染块 | 守卫测试红 |
| 平替合并分支条件置假 | `audit-apply-merge` 红（500 vs 200） |
| 前端合并提示改成普通成功 | 守卫测试红（且第一次断言太松没咬住，已收紧为 `/if \(res\.merged\) \{/`） |
| 巡检重新把 archived 当异常 | 两条归档退出用例红 |

全量回归：`apps/api` 129 个文件 / 1238 个测试全绿；`apps/api` tsc 0 错。

## 诚实的边界

- 候选档位来自**预置探活缓存**（`checkedAt=now` 的未过期结论），`probeCandidateUrl` 命中即返回，
  所以这套隔离栈对真实世界**零请求**、结论可复现；但这也意味着本轮验证的不是「真实网络
  此刻的判定」，而是「判定结果在界面上的表达与拦截」。真实探活路径由 `candidate-probe` 的
  单测与既有 `health-audit-api` 用例覆盖。
- 探活口径是「从本机网络实测」，不是全网点测：超时/被 WAF 挡/内网地址被拦都不等于站点已死，
  界面把这条写进了 `caveat` 并让 `unverified` 仍可人工采纳。
- 本轮没有改 `/api/admin/audit/apply` 之外的写路径；合并分支不删除任何数据，只把失效条目
  归档并在审计日志里记下关联关系。
- 截图是在本机 in-app 浏览器可达的环境下由 Playwright 直接截取；若在隐藏窗口环境运行，
  `browser.mjs` 会在日志里留下 `screenshot skipped`，其余断言不受影响。
