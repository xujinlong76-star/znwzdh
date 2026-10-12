# 验收报告（实测，非设计意图）

本文件记录**实际跑出来的结果**。每条都可复现。

## 环境

| 项 | 值 |
| --- | --- |
| Node | v24.21.0（DSH 自带运行时） |
| pnpm | 11.7.0 |
| 模式 | `lite`（SQLite + sqlite-vec + FTS5） |
| embedding | `Xenova/bge-small-zh-v1.5` quantized，24MB，512 维，**完全离线** |
| LLM | 未配置（按预期降级为启发式） |
| 语料 | 50 个真实中文站点 / 5 个类目 / 77 个标签 |

## 启动横幅（真实输出）

```
================================================================
NavHub 已启动
  监听    http://0.0.0.0:8787
  模式    lite
  语义检索 可用
  全文检索 可用
  LLM 富化 不可用（降级为启发式）
  · sqlite-vec 已加载，向量维度 512
  · FTS5 全文索引就绪（CJK 二元分词）
  · embedding 服务已装配（惰性加载：Xenova/bge-small-zh-v1.5 via https://hf-mirror.com）
================================================================
```

播种耗时：**50 个站点全部生成向量，共 1340ms**。

## 检索验收：16 / 16 通过

`[通道]` 列展示该次查询实际命中的召回通道，`ms` 为服务端耗时。

### [1] 语义检索 —— 用自然语言提问（核心能力）

```
PASS  写代码的AI            => Cursor > GitHub Copilot > Claude        [fts+semantic] 461ms
PASS  帮我找个能画流程图的工具   => Excalidraw > Midjourney > Figma        [fts+semantic] 11ms
PASS  我要部署容器           => Kubernetes > Docker Hub > Vercel        [fts+semantic] 11ms
PASS  免费高清图片           => Unsplash > TinyPNG > Google Fonts      [exact+fts+semantic] 10ms
PASS  天气预报             => 中国天气网 > GitHub Trending > 国家网信办  [exact+fts+semantic] 10ms
PASS  装依赖包             => npm > npmmirror > Iconify                [fts+semantic] 9ms
PASS  AI 绘画              => Midjourney > Claude > GitHub Copilot      [exact+fts+semantic] 9ms
PASS  算法刷题             => 力扣 LeetCode > Stack Overflow > GitHub Trending  [fts+semantic] 8ms
PASS  我想学前端            => MDN 中文 > Vercel > arXiv                 [fts+semantic] 10ms
```

注意这些查询里**没有任何一个词出现在站点的标题或描述里**（除了「天气预报」），
说明不是关键词匹配在起作用，而是真的走了语义通道。

### [2] 拼音 / 首字母

```
PASS  zgtqw   => 中国天气网 > Uiverse > Ollama   [exact+fts+pinyin+semantic] 11ms
PASS  tianqi  => 中国天气网 > Claude > Unsplash     [exact+semantic] 9ms
PASS  manong  => Google Fonts > Unsplash > Claude  [semantic] 8ms
```

### [3] 中文子串 / 英文前缀

```
PASS  天气    => 中国天气网 > GitHub Trending > 知乎  [exact+fts+semantic] 9ms
PASS  curs    => Cursor > Coursera > Uiverse          [exact+fts+pinyin+semantic] 9ms
PASS  docker  => Docker Hub > Kubernetes > Uiverse     [exact+fts+pinyin+semantic] 9ms
PASS  设计    => Dribbble > Figma > Iconify           [exact+fts+semantic] 9ms
```

### [4] 标签过滤

```
标签=代码补全 命中 1 条: GitHub Copilot
```

## 自动化测试：117 / 117 通过

```
Test Files  5 passed (5)
     Tests  117 passed (117)
```

| 套件 | 用例数 | 关键覆盖 |
| --- | --- | --- |
| `packages/core` | 24 | CJK 二元分词、MATCH 表达式转义、拼音、RRF 融合、个性化通道权重约束 |
| `packages/store` | 21 | 内存/真实 sqlite-vec 双实现一致、hashSiteId 稳定性、真实 SQLite 集成 15 项 |
| `packages/ai` | 26 | SSRF 全部网段 + IPv4 映射绕过、元数据抽取、启发式降级、schema 校验 |
| `apps/api` | 21 | 真实 HTTP 端到端：检索四通道、CRUD、409 去重、改名后索引同步、降级、审计 |
| `packages/mcp` | 25 | 只读 token 越权被拒、dryRun 默认、幂等重放、条数上限、审计落库 |

TypeScript 严格模式 `tsc --noEmit`：**0 错误**。

## 开发过程中被测试抓到并修掉的真实缺陷

这些不是设计说明，是**先写错、被验证推翻、然后修好**的记录：

1. **个性化会覆盖相关性**（最初设计错误）
   最初把个性化做成「融合后乘一个 ≤20% 的系数」。实测算出 RRF(k=60) 下
   `rrf(1)/rrf(8) = 1.11`，即排 8 的站点只要加成 11% 就能顶掉排 1。
   已改为「个性化是一路独立通道，权重 0.3」，并加测试锁定「多通道共识的相关性结果不会被单路偏好顶掉」。

2. **FTS5 无法命中中文子串**
   `unicode61` 把连续汉字当成单个 token，`match '启动'` 查不到「启动脚本」。
   已在写入期展开为单字 + 二元分词（`packages/core/src/cjk.ts`），实测任意 ≥2 字子串均可命中。

3. **英文词被分词器丢弃**
   CJK 分词最初只处理汉字，导致「GitHub Copilot」里的英文整段消失，搜 `GitHub` 无结果。
   已补充拉丁词提取。

4. **中文标签永远无法过滤**
   `slugify` 把非 `[a-z0-9]` 字符全部删除，中文标签被 slug 成空字符串，
   且过滤只匹配 slug。已改为保留 CJK，并同时匹配 `slug` 与 `name`。

5. **GET 检索接口直接报参数无效**
   query string 的值都是字符串，而 zod schema 要求 `number`，
   `GET /api/search?limit=3` 会返回「参数无效」。已改用 `z.coerce` + 布尔联合类型。

6. **启发式分类误判**
   最初用「命中关键词计数」，「GitHub Copilot AI 代码补全」被归到「开发运维」
   （GitHub + 代码 2 票 vs AI 1 票）。已改为**加权关键词** + 标题加成 + 拉丁词边界匹配。

7. **Node type-stripping 不支持构造函数参数属性**
   `constructor(private db: Db)` 会导致 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。已全部改为显式字段声明。

8. **主模块判断导致静默退出**
   `import.meta.url === "file://" + process.argv[1]` 在 Windows 上因盘符大小写/斜杠形式不一致而恒为 false，
   `server.ts` 直接运行会**退出码 0 且无任何输出**（比报错更难查）。已改为独立入口 `main.ts` / `seed-main.ts`。

## 已知未完成项

- `standard`（PostgreSQL + pgvector）模式的**代码已实现但未在本机运行验证** ——
  本机 Docker 守护进程未启动（Docker Desktop 已安装，需要管理员权限启动）。
  已实现 `PgVectorStore`，且与 `SqliteVecStore` 共享同一套测试接口。
- `apps/web` 的 `StorageAdapter` 已写好并可通过 `STORAGE_ADAPTER=http` 接入，
  但尚未把 NavSphere 的 `getFileContent`/`commitFile` 替换为适配器调用（改动面为 2 个函数）。
- 健康巡检、对话式侧边栏、PWA、主题系统尚未实现。
