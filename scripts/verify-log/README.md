# 公开核验日志 PoC（骨架）

依据：每日战略研究 2026-11-24 20:00 门禁底稿 §3（公开核验日志，过门禁）。
本目录只做 PoC 的可交付骨架：探针脚本 + 20 站清单 + 记录格式测试。
**20 站实测尚未跑完**；静态日志页与第 2 周重探不在本提交内。

## 文件

- `probe-site.mjs` — 单站探针：≥2 种方法（探活 HTTP 状态 + 字节数；标题比对；
  官方站另加官方域名比对），输出一条含 5 要素的核验记录。零新依赖。
- `run-probe.mjs` — 批量 CLI：`node scripts/verify-log/run-probe.mjs --sites scripts/verify-log/poc-sites.json --out scripts/verify-log/verification-log.jsonl [--limit N] [--append]`
- `poc-sites.json` — 20 站清单（见下）。
- `verify-log.test.mjs` — 记录格式与结论三态测试（stub fetch，不发真实请求）。

## 20 站清单来源（来源标注，门禁底稿 §2 规则）

- 官方 10 站：取自已确认的 50 家官方域名名单（只读引用
  `~/workspace/znwzdh-evolve/apps/web/src/lib/verified-brands.ts`，
  用户 2026-11-24 已确认“就按这份做”；本目录只抄录域名与站名，不改名单）。
  选取方法：名单前 10 家（按名单顺序），canonicalDomain 逐字照抄。
- 随机 10 站：取自本克隆 `apps/web-overlay/src/navsphere/content/navigation.json`
  （实测 388 条 href 条目，全部 enabled）。抽样方法：
  Python `random.Random(20261124).sample`，抽样框 = 388 条中排除与 50 家官方域名
  同域或子域的条目后的 329 条（两层样本不重叠），抽 10 条。种子与抽样框已固定，可复现。
- 结论状态：清单本身不含任何“已核实”结论；探针没跑过的站，在
  `verification-log.jsonl` 里一律记 `verdict=unknown`（未知），不编造。
- 站点 URL 与标题逐字取自 navigation.json（href / title 字段）。

## 结论三态

- `verified`（已核实）：HTTP 2xx 且第二种方法至少一种通过。
- `unverified`（未核实）：探针跑通但证据不符（非 2xx，或标题/域名比对均失败）。
- `unknown`（未知）：探针本身没跑通（超时/网络错），无证据可判断。
- 下次复检日 = 核验时间 + 7 天；日志 append-only，只追加、不改写、不删除。
