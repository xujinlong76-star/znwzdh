# 调研与技术验证记录

本文件只记录**实测结论**，每条都附可复现的验证方式。未经验证的猜测不写在这里。

## 1. 竞品格局（2026-10 实测 star / 活跃度 / 授权）

| 项目 | ⭐ | 技术栈 | 授权 | 结论 |
| --- | --- | --- | --- | --- |
| glanceapp/glance | 37.5k | Go | AGPL-3.0 | 授权传染，不做超集底座 |
| gethomepage/homepage | 33k | Next.js | GPL-3.0 | 同上 |
| karakeep-app/karakeep | 29.6k | TS/Next | AGPL-3.0 | 是书签库，非导航站 |
| lissy93/dashy | 26.7k | Vue 3 | MIT | 配置驱动，改造成本高 |
| liuzi6612/nav | 3.3k | Angular | **GPL-3.0** | 中文最强但授权有传染性 |
| hslr-s/sun-panel | 5.3k | Vue | MIT | NAS 面板，无 AI |
| helloxz/onenav | 3.1k | PHP+SQLite | Apache-2.0 | 技术栈偏旧 |
| topqaz/LiteMark | 312 | Vue3+FastAPI | — | 有 AI+MCP 雏形 |
| majin72/Tok123 | 0 | Next16+Meili | Apache-2.0 | 思路对（Admin Skill+MCP），刚开源 |

**选定底座：tianyaxiang/NavSphere（829⭐, MIT, 2026-08 活跃）**

## 2. 底座的可改造性（决定整体方案）

NavSphere 全站的持久化**只经过两个函数**：

- `src/lib/github.ts` → `getFileContent(path)` / `commitFile(path, content, message, token)`
- 数据落在 3 个 JSON：`navigation.json` / `site.json` / `resource-metadata.json`
- 调用点共 **69 处**，分布在约 15 个 `src/app/api/**/route.ts`

已验证结论：**存储层可整体替换，前端业务代码几乎无需改动**。
NavSphere 的数据模型是三层结构（category → subCategory → item），
`packages/core/src/types.ts` 的 `NavSphereNavigationData` 必须与之字节级兼容。

## 3. 本机环境与网络（决定 AI 方案）

| 探测项 | 结果 | 影响 |
| --- | --- | --- |
| `huggingface.co` | ❌ 连接超时 | 不能用默认端点 |
| `hf-mirror.com` | ✅ 200 | 模型下载必须走镜像 |
| `api.openai.com` | ❌ 超时 | LLM 走 DeepSeek |
| `api.deepseek.com` | ✅ 可达（401 = 缺 Key） | 默认 LLM 端点 |
| `registry.npmjs.org` | ✅ 200 | 依赖安装正常 |
| Node / pnpm / git | v22.23.1 / **11.7.0** / 2.54 | 见下方注意事项 |
| Docker | CLI 29.4.3，**守护进程未启动** | standard profile 需先启 Docker Desktop |
| `pwsh`（PowerShell Core） | ❌ 未安装 | 只能用 Windows PowerShell 5.1 |

## 4. 环境踩坑（都会影响后续开发）

1. **pnpm 不在 PATH**，且 DSH 打包的 pnpm.mjs 曾被 `packageManager: pnpm@10.9.8` 卡住 ——
   该版本在 npm 上**不存在**。已删除该字段，实际版本 11.7.0。
   统一用 `scripts/run.ps1` 定位运行时。
2. **Windows PowerShell 5.1 按 ANSI 读取 .ps1** —— 脚本里写中文注释会导致解析失败。
   `scripts/run.ps1` 因此刻意只用 ASCII。
3. **没有 `pwsh`**，执行脚本要用调用操作符 + 点源：`. ./scripts/run.ps1 install`。
4. **pnpm 11 的构建脚本白名单**写在 `pnpm-workspace.yaml` 的 `allowBuilds`（不是 package.json）。
   `better-sqlite3` 与 `esbuild` 需要允许，否则原生扩展不编译。

## 5. 检索层实测（本项目核心）

### 5.1 sqlite-vec（vec0）两个硬性约束

- **主键必须传 BigInt**。传 JS number 会抛
  `Only integers are allows for primary key values`（原文拼写错误来自上游）。
  → 封装在 `SqliteVecStore` 内部。
- **KNN 查询必须带 `LIMIT` 或 `k = ?`**，否则 prepare 阶段直接报错
  `A LIMIT or 'k = ?' constraint is required on vec0 knn queries`。
- 合法查询形态（已逐一验证）：`match + order by distance limit N`、`match + k = N`、
  `with knn as (...) ... join`、子查询 + 外层 join。
- **DDL 解析器不接受反引号包裹的列名**，且 `float[N]` 的 N 必须是字面量。

### 5.2 FTS5 与中文

- FTS5 的 `unicode61` 把**连续汉字当成一个 token**，`match '启动'` 无法命中「启动脚本」。
- 解法：写入期把中文展开为**单字 + 相邻二元组**（`packages/core/src/cjk.ts`），
  于是任意 ≥2 字子串都能命中，且保留 BM25 排序。
  实测 '启动' / '启动脚本' / '天气' / '天气网' / '包管理' 全部命中。
- 同时必须**保留英文字词**，否则 "GitHub Copilot" 会被整段丢弃（已被测试锁定）。
- `vec0` 200 条 512 维写入 16ms；5000 条建索引整体 4.5s；KNN 查询 2ms。

### 5.3 本地中文语义检索（最关键验证）

- 模型：`Xenova/bge-small-zh-v1.5`，**quantized 仅 24MB**，512 维。
- **transformers.js v4 不读 `HF_ENDPOINT`**，必须设 `env.remoteHost`。
- 加载耗时 315ms（已缓存）；10 站点 + 9 条查询全流程 576ms，**完全离线**。
- 语义检索 **9/9 命中**（cls 与 mean 池化均可），例如：
  - 「写代码的AI」→ Cursor / GitHub Copilot
  - 「帮我找个能画流程图的工具」→ Excalidraw
  - 「我要部署容器」→ Docker Hub
  - 「装依赖包」→ npm
- 结论：中文语义搜索无需任何外部 API 即可落地。

### 5.4 RRF 融合的关键教训（设计被实测推翻一次）

最初把个性化做成「融合后再乘一个 ≤20% 的系数」。实测算术证明**这是错的**：

```
rrf(1)  = 1/(60+1)  = 0.01639
rrf(8)  = 1/(60+8)  = 0.01471   -> 仅差 11%
rrf(50) = 1/(60+50) = 0.00909   -> 差 80%
```

RRF（k=60）会把靠前名次压得**非常接近**，因此任何 ≥11% 的事后加成都能把排 8 顶到排 1 ——
「越用越懂你」会退化成「搜什么都搜不到」。

**修正后的设计**：个性化是**一路独立通道**（`personal`，默认权重 0.3，
远低于相关性通道 0.9~1.4），与其它通道一起进 RRF。翻转能力由权重天然限界，
且能通过 `contributions` 解释「它为什么排这儿」。
另外 `personal` **不参与 coverage 共识度**，避免偏好伪装成相关性共识。

## 6. 前端读路径的关键坑

1. **首页原本同步读静态 JSON** —— 适配器是异步的，必须把 page.tsx 与 generateMetadata() 改成 async。
2. **异步化还不够，元信息会被构建期固化** —— 首页参与预渲染时 `<title>` 被写死在产物里。
   实测：库里标题已是「NavHub 导航」，页面 `<title>` 仍是构建时的回退值「NavSphere导航」。
   必须加 `export const dynamic = "force-dynamic"` 才会每次请求实时读取。
   注意：站点列表当时看起来是正常的（走动态路径），掩盖了这个问题 ——
   **判断"数据是否来自数据库"不能只看列表，必须连元信息一起验**。

另：`siteData.basic.title` 这类字段在渲染期被直接解引用，所以中枢**必须**返回带基线的站点配置，
否则首页会抛错而不是降级。

## 7. 写请求的编码（容易静默出错）

用 **PowerShell 的 `Invoke-RestMethod -Body`** 发含中文的 JSON 时，中文会被压成 `?`：

```
中枢 site.json basic.title = "NavHub ??"
码点 = ["4e","61","76","48","75","62","20","3f","3f"]   // 3f3f = 两个问号
```

危险之处：**页面看起来是对的**（浏览器/终端能把问号显示得像是正常文本，取决于字体与编码），
只有做字节级核对才会发现。因此：
- 发写请求统一用 Node 的 `fetch`（显式 UTF-8），不要用 PowerShell 的内建 cmdlet；
- 验证时不要只"看页面"，要核对**码点或数据库原始值**。

## 8. 已验证的测试覆盖

```
packages/core/test/core.test.ts    24 passed   CJK 分词 / MATCH 表达式 / 拼音 / RRF / 个性化通道
packages/store/test/store.test.ts  21 passed   向量存储 / hashSiteId / 真实 SQLite 集成 15 项
```

SQLite 集成测试跑的是**真实数据库**（临时文件 + sqlite-vec 扩展 + FTS5 触发器），
覆盖：中文子串命中、拼音全拼/首字母、英文前缀、类目含子类、标签过滤、
站点改名后索引同步、删除后不再命中、审计与事件落库。