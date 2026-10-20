# NavHub 4.0 - 次世代 AI 开发者智能导航与知识工作台

<p align="center">
  <b>AI 原生混合检索</b> · <b>Bento-Flow 自由排版工作台</b> · <b>时序衰减自适应算法</b> · <b>0-RTT 原地推测执行</b> · <b>全生态 Agent MCP Server</b>
</p>

---

## 🌟 项目概览 (Overview)

**NavHub** 是一款专为极客与工程研发团队打造的 **AI 原生网址导航系统与开发者知识工作台 (Next-Gen Developer Knowledge OS)**。

系统在成熟的前端基底上进行了深度的架构重构与能力跃升：突破了传统网址导航单向展示、割裂静态的局限，融合了**五路混合召回智能检索**、**Bento-Flow 模块化自适应画布**、**双曲几何平替推理**与**端侧 0-RTT 语法微解析器**，并向外部 AI Agent（Claude / Cursor / Raycast）提供标准 MCP 工具协议，实现从静态收藏夹到个人智能工作台的跨越。

---

## 🚀 核心特性矩阵 (Core Features)

### 1. 五路混合检索引擎与自适应动态融合
* **五路异构召回通道**：
  * `exact`：精确中文/英文子串极速召回。
  * `fts`：基于 BM25 算法的 CJK 二元分词全文检索。
  * `pinyin`：全拼、拼音首字母缩写智能匹配（如 `qdjb` $\to$ `启动脚本`）。
  * `semantic`：本地量化 Embedding 向量检索（基于 BGE-Small-ZH 模型），实现「语义搜自然语言」（如「代码补全AI」$\to$ `GitHub Copilot`）。
  * `personal`：用户个人访问频次与置顶收藏权重微调。
* **时序衰减多臂老虎机 (Discounted-LinUCB)**：动态自适应调整多通道融合置信度上界，引入时间衰减因子 $\gamma=0.98$ 消除历史协方差矩阵钝化，结合驻留时长（Dwell Time）实现隐式负向惩罚与正向强化自学习。

### 2. Bento-Flow 次世代 DIY 智能工作台
* **卡片跨分类无缝拖拽重组 (Drag & Reclassify)**：进入排版模式后，站点卡片可自由拖拽并吸附投递到任意目标分类，底层通过 `siteCategoryOverrides` 响应式映射即时重新编排。
* **香农信息熵一键自愈排版 (Smart Auto-Tidy)**：内置人机工程学健康度模型，计算分类分布的信息熵 $H = -\sum p_i \log_2 p_i$。一键点击即可自动隐藏收录为 0 的空分类，折叠超载分类，开启物理半衰期热度推荐。
* **免登 URL-Hash 预设分享**：整套桌面排版、强调色、背景壁纸与重归类关系无损 Base64 编码为 `#diy=...` 轻量短链，好友打开链接即可秒级预览并一键应用相同桌面。
* **沉浸式环境光与自定义壁纸美学**：支持接入高清自定义壁纸、无级毛玻璃模糊（Backdrop Blur 0~30px）与卡片半透明度调节，营造沉浸式极客桌面。

### 3. 端侧 0-RTT 推测执行微应用 (Speculative Intent)
当在全局搜索框输入特定技术文本时，无需跳转外链，端侧 0 毫秒原地构建微组件并提供交互：
* **Cron 表达式解析器**：实时解析 5 段/6 段 Cron 语法，原地呈现自然语言执行频率与结构化分词。
* **JWT 离线解码与过期探测**：零网络开销反序列化 Header/Payload，实时计算有效期倒计时。
* **Curl-to-Fetch 代码生成器**：提取命令行请求动词与参数，自动反向生成标准 Fetch 语法块。
* **常用微工具**：时间戳秒/毫秒互转、十六进制/RGB 颜色速览调色、Base64 编解码、JSON 格式化校验、哈希指纹识别。

### 4. 低代码动态微组件生态 (Live Widgets)
* **REST API 动态遥测小组件 (`LiveApiWidget`)**：支持填入任意目标接口 URL、提取 JSONPath 字段（如 `data.status`）与设定轮询周期，展示实时健康状态与数值。
* **技术早报与社区动态小组件 (`RssFeedWidget`)**：内置主流框架 Release 动态与技术资讯流，支持一键洗牌换一批与外链瞬开。
* **12+ 经典内置组件**：番茄钟时钟、天气气象、GitHub 贡献热力图、双曲平替雷达、本地备忘便签、系统性能监控指标。

### 5. 双曲几何平替推理与技术图谱 (Hyperbolic & Graph)
* **洛伦兹双曲超曲面模型 (Lorentz Hyperboloid)**：实现闵可夫斯基双线性内积与双曲测地线距离计算，消除庞加莱圆盘边缘奇点，准确度量技术工具间的层级包含与等阶平替关联。
* **多跳技术栈链路配方 (Architecture Recipes)**：通过拓扑知识遍历，为复杂开发目标（如协同文档、本地大模型）自动合成端到端架构选型方案。

### 6. 企业级安全与全生态集成
* **零知识 E2EE 金库**：采用 WebCrypto AES-GCM + PBKDF2（100,000次迭代）对敏感私密书签进行客户端端到端加密，密文同步至云端。
* **三层 SSRF 物理防击穿安全沙箱**：AI 自动抓取富化时严格执行协议白名单、解析后真实 IP 网段校验（防御 DNS Rebinding）与重定向逐跳审查。
* **MCP Server 扩展协议**：全面兼容 Model Context Protocol（stdio + HTTP），支持权限分级与操作审计，供 Claude Desktop、Cursor 等 Agent 直接调度。
* **双端扩展集成**：内置 Chrome 浏览器扩展（支持 Token 鉴权一键收录网页）与 Raycast 极速搜索扩展（支持一键复制 Markdown 链接）。

---

## 🏗️ 架构拓扑 (Architecture Topology)

NavHub 采用清晰的 pnpm Workspace Monorepo 组织结构，前后端通过契约严密解耦：

```
navhub/
├── apps/
│   ├── api/             # Fastify 后端中枢：REST API + 种子数据 + 任务队列 + 鉴权中心
│   ├── web-overlay/     # NavHub 自研前端事实源：Bento 画布 / DIY 排版 / 0-RTT 意图卡片
│   └── web/             # 前端运行环境镜像（与 web-overlay 保持 100% 同步）
├── packages/
│   ├── core/            # 核心领域模型 / Discounted-LinUCB / 洛伦兹双曲 / 卡尔曼滤波 / 0-RTT AST
│   ├── store/           # 存储层：Drizzle ORM + SQLite/PostgreSQL 双驱动 + 向量扩展 + FTS5
│   ├── ai/              # AI 能力包：ONNX embedding (bge-small-zh) + SSRF 防护 + 多模型 LLM 轮换
│   └── mcp/             # MCP Server：标准 Agent 工具接入协议 (stdio & HTTP)
├── extensions/
│   ├── chrome-extension/# 浏览器随身扩展：一键 AI 富化收录 + 弹出搜索 + Token 鉴权
│   └── raycast-extension/# Raycast 桌面快捷扩展：全局模糊检索 + Markdown 链接复制
├── docker/              # 生产级 Dockerfile 与多模式 Compose 编排
└── scripts/             # 自动化验证、上游同步与一键 GitHub 推仓脚本
```

### 两种运行模式 (Run Modes)

| 特性 | `lite` 模式（默认开箱即用） | `standard` 模式（企业/大规模） |
| :--- | :--- | :--- |
| **数据库** | 嵌入式 SQLite（纯本地文件存储） | PostgreSQL 16+ |
| **向量引擎** | sqlite-vec（支持内存自动回退） | pgvector（支持 HNSW 索引加速） |
| **全文检索** | FTS5 + CJK 二元分词索引 | tsvector + pg_trgm 混合模糊索引 |
| **适用场景** | 个人极客、本地开发、家庭 NAS 容器部署 | 团队协作、企业内部公开站、多租户海量数据 |

---

## 🛠️ 快速开始 (Quickstart)

### 本地环境要求
- **Node.js**：`v24.x`（LTS）及以上（内置标准 ES 模块支持）
- **包管理器**：`pnpm` (`v11+` 推荐)

### 1. 克隆与安装依赖
```bash
# 进入工程根目录
pnpm install
cp .env.example .env
```

### 2. 播种初始化数据
```bash
# 初始化分类并注入精选技术站点与专题合集
# 注意：必须在仓库根目录执行 —— config.ts 的库路径默认是 cwd 相对的 ./data/navhub.db，
# 而 dev-all / Docker 用的都是仓库根的 data/navhub.db（写成 pnpm --filter @navhub/api seed
# 会以 apps/api 为 CWD，把种子播进 apps/api/data/navhub.db，开发服务器永远看不到）
pnpm seed
```

### 3. 启动开发服务
```bash
# 启动 API 中枢服务 (默认端口: http://localhost:8787)
pnpm dev

# 在新终端启动 Web 前端服务 (默认端口: http://localhost:3000)
pnpm dev:web
```

### 4. 运行质量与一致性验证
```bash
# 检查前端覆盖层镜像一致性
pnpm check:overlay

# 运行全库单元测试与核心算法验证
pnpm test
```

---

## 🐳 Docker 生产容器化部署 (Deployment)

NavHub 提供了多阶段构建的轻量镜像，不依赖宿主机复杂的构建环境。

```bash
cd docker

# 1. 采用 lite 模式一键启动（单机零外部依赖）
docker compose up -d

# 2. 采用 standard 模式启动（联动真实 PostgreSQL 与 pgvector）
docker compose --profile standard up -d
```

启动完成后：
- Web 前端访问地址：`http://localhost:3000`
- API 接口文档地址：`http://localhost:8787/docs`（OpenAPI Swagger 交互界面）
- 探针健康检查地址：`http://localhost:8787/api/health`

---

## ⚙️ 核心环境变量指南 (Environment Variables)

详细配置项见 [`.env.example`](.env.example)。关键核心项说明如下：

| 变量名 | 默认值 | 作用说明 |
| :--- | :--- | :--- |
| `NAVHUB_MODE` | `lite` | 运行模式：可选 `lite`（SQLite）或 `standard`（PostgreSQL） |
| `PORT` | `8787` | API 中枢监听端口 |
| `STORAGE_ADAPTER` | `http` | Web 端存储适配器：`http`（指向中枢）、`github`（个人仓库） |
| `NAVHUB_AUTH_REQUIRED` | `false` | 是否开启 API 鉴权。公开部署建议设为 `true`，保护写操作 |
| `NAVHUB_IDENTITY_SECRET` | `(可选)` | 终端用户身份的 HMAC 签名密钥。配置后带身份的请求必须携带 `x-navhub-identity-signature`（由 Web 的 `/api/hub/*` 代理自动附带），否则 401；不配置则行为不变 |
| `NAVHUB_EMBEDDING_ENDPOINT`| `https://hf-mirror.com` | 本地 Embedding 模型下载镜像源，保障国内稳定拉取 |
| `NAVHUB_LLM_BASE_URL` | `https://api.deepseek.com` | 大语言模型兼容接口地址（支持 DeepSeek / OpenAI / Ollama） |
| `NAVHUB_LLM_API_KEY` | `(可选)` | LLM 密钥。未配置时自动降级为纯规则启发式元数据提取 |

---

## 📦 自动化 GitHub 仓库推仓脚本 (Repository Push)

项目已内置跨平台的快速推仓脚本，支持自动绑定目标远端、建立 `main` 分支并完成代码同步：

* **Windows 环境（CMD / PowerShell）**：
  ```cmd
  scripts\push-to-github.bat xujinlong76-star/znwzdh <您的GitHub_PAT>
  ```
* **macOS / Linux 环境**：
  ```bash
  ./scripts/push-to-github.sh xujinlong76-star/znwzdh <您的GitHub_PAT>
  ```

---

## 📜 许可证 (License)

* NavHub 核心自研模块与算法库遵循 [MIT License](LICENSE)。
* 前端基底派生自开源项目 NavSphere（MIT），严格保留其原始版权声明。
