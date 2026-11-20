# PoC 实测量化脚手架 (Batch 1 / 04-command-palette, W8)

第一段交付: 三份对照脚手架 + 参考实现。全部是测量脚本, 不写产品代码,
不进 bundle。W5/W6 的 PoC 代码到位后, 同一套脚本以 `--impl` 指向其实现重跑,
即为第二段实测。

## 文件

| 文件 | 用途 |
|---|---|
| `lib.mjs` | 共享: navigation.json 标题展平、确定性随机、pinyin-pro 解析、JSON 写出 |
| `ref-pinyin.mjs` | §1.2 参考实现 (`buildPinyinKeys`/`matchPinyin`/`isLatinQuery`, 含 `segmentit` 选项透传)。W8 独立复核用, 非产品代码 |
| `ref-mru.mjs` | §3.2 参考实现 (`mruScore`/`MRU_MIN_USES_FOR_BOOST`/§9 C1 手算例) |
| `p-b-threshold.mjs` | P-b 阈值对照 0.2 vs 0.3 vs 0.4 |
| `p-c-mru.mjs` | P-c MRU 权重对照 0.1 / 0.15 / 0.25 |
| `p-e-pinyin-accuracy.mjs` | P-e 拼音准确率: segmentit 1 vs 2 + 多音展开误匹配率 + PINYIN_FIXES 候选 |
| `fixtures/mru-20-records.json` | P-c 默认 20 条记录 (构造 fixture, 见下) |
| `out/` | 各脚本的 JSON 报告输出目录 (运行后生成, 不入库) |

## 运行 (工作区根目录)

```bash
# P-b (默认参考实现; W5 到位后加 --impl <W5 模块路径>)
node scripts/poc-measure/p-b-threshold.mjs \
  --nav apps/web-overlay/src/navsphere/content/navigation.json \
  --out scripts/poc-measure/out/p-b-threshold.json

# P-c (默认参考实现 + 默认 fixture; W6 到位后加 --impl <W6 模块路径>)
node scripts/poc-measure/p-c-mru.mjs \
  --records scripts/poc-measure/fixtures/mru-20-records.json \
  --out scripts/poc-measure/out/p-c-mru.json

# P-e (默认参考实现; W5 到位后加 --impl <W5 模块路径>; 人工确认误读后加 --confirmed-fixes)
node scripts/poc-measure/p-e-pinyin-accuracy.mjs \
  --nav apps/web-overlay/src/navsphere/content/navigation.json \
  --out scripts/poc-measure/out/p-e-pinyin-accuracy.json
```

pinyin-pro 解析顺序: `--pinyin-pro <path>` > `PINYIN_PRO_PATH` 环境变量 >
worktree 自身 `node_modules` (段 2 `pnpm install` 后) > 基础克隆的暖 store 副本
(只读 smoke test 用)。解析不到时脚本直接报错退出, 不静默造数。

`--impl` 指向 W5/W6 模块时, 模块须是可直接 `import()` 的 JS (须导出
`buildPinyinKeys`+`matchPinyin` / `mruScore`)。W5/W6 的源文件是 TS,
段 2 用前由 W5/W6 提供可运行形态 (vitest 内跑或 esbuild 打包);
本脚本不替他们转译, 转译方式不同可能引入差异, 报告中须注明实际跑的形态。

## 待输入 (第一段结束时均未到位)

| 输入 | 来源 | 状态 (2026-11-20 18:49) |
|---|---|---|
| W5 `matchPinyin` + `buildPinyinKeys` | `~/workspace/znwzdh-batch1-w5-poc-pinyin`, 集成支待通知 | 未到位 (克隆仍在基线 e3650f84, 无 PoC 代码) |
| W6 `mruScore` | `~/workspace/znwzdh-batch1-w6-poc-mru-hotkey`, 集成支待通知 | 未到位 (同上) |
| W5 §1.5 `PINYIN_FIXES` 名单 | W5 离线脚本产出 | 未到位; P-e 输出候选供其核对 |
| 20 条真实访问记录 | 真实访问日志导出 (同 fixture schema) | 库内无此数据; 先用构造 fixture 跑通流程 |

## 判定规则 (全部写死在脚本内, 与方案 §10 一致)

- P-b: 选漏命中率 <=5% 且误命中率最低的阈值; 若 0.2 漏命中率 >5%, 放宽到
  实测最优值 (只影响本地行 `matchPinyin` 命中判定)。
- P-c: 选两类失效 (误点站上榜 / 旧重度站压新站) 均不出现的最小权重;
  三档均失效则权重降为 0。
- P-e: 拉丁查询命中率 >=95% 通过、<90% 判失败 (§10 成功阈值 1 / 失败阈值 2)。
  确认误读站名 <=5 只用 `customPinyin` 名单; >5 评估 `@pinyin-pro/data` (§1.5)。

## 已知问题 / 假设 (实测中发现, 不是事后补的)

1. **语料基数**: 方案写 365 站, 基线 e3650f84 的 navigation.json 实际为
   **383 站** (中文标题 142, 非中文 241, 标题无重复)。三份脚本均按实际
   383 站跑, 报告中 corpus.titles 以实测为准。
2. **P-b 阈值几无区分度 (已实测, 非假设)**: 单 token 分数档只有
   {0.6, 0.65, 0.7, 0.8, 0.85, 0.9, 1.0}, 全部 >= 0.6; 三档差异只来自
   多 token 乘积分数 (混合标题如 "Kimi 搜索" 的 pyFull 含空格, 乘积可 <0.4)。
   参考实现冒烟: τ=0.2/0.3 漏 0%/误 0.09%, τ=0.4 漏 0.05%/误 0.09%。
   脚本主表如实跑出该结果, 另附一张前缀-only (score >= 0.8) 诊断表
   (冒烟: 漏 4.04%/误 0.06%) 供协调员裁决阈值是否应改释为"前缀/中间命中"
   分界; 诊断表不参与 §10 判定。
   另: 含标点标题派生的查询 (如 "continue.dev"、"node.js") 不是合法拉丁
   查询, 按 §1.2 恒返回 0——脚本已将其剔除并计数 (冒烟 16 条), 不计入漏命中。
3. **参考实现假设** (与 W5 交叉核对时逐项比对, 分歧不静默通过):
   A1 keys 一律小写 (方案只写查询小写; 不小写则 "ChatGPT" 等拉丁标题
   永远命中不了小写查询); A2 多音读音去调用 NFD 去音调 + ü→u
   (pinyin-pro 无"给任意字符串去调" API)。
4. **mruScore 二参歧义**: §3.2 签名是 `mruScore(visit, now)` 二参, 但频率
   分的"建库天数"需列表最早一条记录——二参实现无法从单条 visit 得出。
   本 harness 以三参 (visit, now, earliest) 调用并记录实现声明的 arity;
   若 W6 为二参, C1 差值会如实暴露分歧, 须 W6/协调员确认建库天数的传递方式。
5. **P-c fixture 是构造值, 且结论对 matchScore 敏感 (已实测)**:
   站 id/title 真实, count/visitedAt/matchScore 为构造 (库内无真实访问日志)。
   `matchScore` 给三类 archetype 设了近乎打平的分 (fresh 0.90 / heavy-old 0.88 /
   accidental 0.85), 否则权重对排序无影响、对照失去区分度 (已验证: 全相等时
   排序与 w 无关)。敏感性试验: 误点站 matchScore 0.85→0.90 时, 三档权重
   下误点站全部上榜 (连 w=0 也上榜——此时失效来自匹配分打平后的 visitedAt
   决胜, 不是 MRU 权重), 选定权重翻为 0。因此段 2 必须用真实 matchPinyin 分
   (对同一情景查询实测) 替换构造值, 否则权重结论是任意的。
   另: 空查询分区里 count<3 的站按 §3.3 本就进不了置顶区 (门槛), F1 只可能
   出现在有查询加分路径上; 边际扫描 (w∈[0,1]) 会报告两类失效各自首次
   出现的权重, 默认 fixture 下两类失效到 w=1.0 均未出现。
6. **segmentit 1 vs 2**: pinyin-pro 3.29.5 的 `segmentit` 选项值为 1|2
   (默认 2); 参考实现冒烟: 全量 383 标题两档读音零差异, segment() 第三方
   意见零分歧 (修正 ü 写法差异后), PINYIN_FIXES 候选 0 条。
   P-e 另量"多音展开新增碰撞率" (它站只靠多音展开才命中, 冒烟 25.36%,
   集中在 dou/bi/gong/huo 等短单音节查询上); 该率量的是"展开多出候选",
   不是"展开导致排错首位" (后者需排序实测, 不在 P-e 内)。
7. **本机写盘限制 (环境事实, 段 2 风险)**: 本执行环境间歇性拒绝 node
   写盘 (EPERM, 与内容/大小无关; 同一调用 11:01 成功、11:02 失败、
   11:04 又成功; 疑似与基础克隆并行 pnpm install 的 overlay 写竞争有关,
   未证实)。脚本已做防护: 临时文件+改名 (不截断已有好报告)、5 次退避
   重试、最终失败时整份 JSON 打到 stdout 且 exit 1 (数字不丢失)。
   网络拉取字节写盘则始终被拦 (curl/npm/node 写下载内容均 EPERM)——
   因此段 2 的 `pnpm install` 若需拉取新包 (如 pinyin-pro) 可能在同样
   位置失败; 段 2 开工时先验证, 若失败则用已在盘上的暖 store 副本
   (基础克隆 `node_modules/.pnpm/pinyin-pro@3.29.5`, 另有
   `~/tmp-znwzdh-p1-1822` 等三处同版本副本) 或改走主聊/云电脑安装,
   不编造安装成功。
