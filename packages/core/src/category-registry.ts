/**
 * 类目权威树（2026-10-22 类目树升级方案 §3、§5.2）。
 *
 * 为什么需要这么一个常量：同一棵 categories 表同时被四个写入口喂数据
 * （DB 种子 5 个平铺根、NavSphere 快照 9 根 46 子、29 个市场站点包声明的
 * 536 个类目标题、AI 富化按标题造根）。装包时代的实测形态是 **106 个平铺根 +
 * 488 子**，其中 489 个类目 0 站点——根因就是「按裸标题建类目且不传 parentId」。
 *
 * 这棵树是**封闭集合**：安装/富化/MCP 只允许解析到已有条目，解析不出就落
 * 「未分类」并产 `category_gap` 提案，绝不再凭空造根。
 *
 * `legacyTitles` 是旧包标题 → 本叶子的映射（P2a 的覆盖率契约：536 个包标题
 * 全部有归宿）。它同时承担 SKOS altLabel 的检索词扩展职责，所以必须全局唯一
 * ——一个旧标题只能指向一个叶子，否则标题解析又会退化成「凭存储顺序挑一个」。
 */

import { assertCategoryName, categorySlug } from "./taxonomy-rules.ts";

/** 一级根：只作导航，站点一律挂在它的叶子上（对标 G2 的硬规则） */
export interface RegistryLeafInput {
  slug: string;
  title: string;
  titleEn: string;
  icon?: string;
  description: string;
  /** SKOS altLabel：检索词扩展用 */
  altLabels?: string[];
  /** 旧类目/旧包标题 → 本叶子 */
  legacyTitles?: string[];
}

export interface RegistryRootInput extends RegistryLeafInput {
  /** 首页目录带按此排序（1–18），不再按站点数降序，避免哪 8 个随数据漂移 */
  sort: number;
  leaves: RegistryLeafInput[];
}

export interface RegistryCategory {
  slug: string;
  title: string;
  titleEn: string;
  icon: string | null;
  description: string;
  parentSlug?: string;
  /** 同级内排序：根用声明的 1–18，叶用声明顺序（1 起）——播种进 DB 后前台顺序不再随数据漂移 */
  sort: number;
  altLabels: string[];
  legacyTitles: string[];
}

/** 稳定内部 id：`reg-<slug>`，与种子时代的 `cat-ai` 等形态区分开 */
export function registryId(slug: string): string {
  return `reg-${slug}`;
}

export const CATEGORY_REGISTRY_ROOTS: readonly RegistryRootInput[] = [
  {
    slug: "ai-tools",
    title: "AI 工具",
    titleEn: "AI Tools",
    icon: "sparkles",
    description: "大模型与 AI 产品矩阵",
    altLabels: ["人工智能", "AI工具包", "大模型"],
    sort: 1,
    leaves: [
      { slug: "chat-assistants", title: "对话助手", titleEn: "Chat Assistants", description: "通用对话机器人与多模型入口", altLabels: ["AI 对话", "聊天机器人"], legacyTitles: ["大模型对话助手"] },
      { slug: "ai-coding-assistant", title: "AI 编程助手", titleEn: "AI Coding Assistant", description: "代码补全、AI IDE 与编程代理", legacyTitles: ["AI 编程助手", "AI 编码助手与 Prompt 工具"] },
      { slug: "ai-image-generation", title: "AI 图像生成", titleEn: "AI Image Generation", description: "文生图、图像编辑与视觉模型", legacyTitles: ["AI 图像与视频", "AI 设计工具"] },
      { slug: "ai-video-generation", title: "AI 视频生成", titleEn: "AI Video Generation", description: "文生视频、数字人与视频编辑模型" },
      { slug: "ai-audio-voice", title: "AI 音频语音", titleEn: "AI Audio & Voice", description: "语音合成、识别、克隆与音频生成", legacyTitles: ["AI 音频与语音", "语音克隆与变声"] },
      { slug: "ai-writing-office", title: "AI 写作办公", titleEn: "AI Writing & Office", description: "AI 写作、PPT 与办公流程助手", legacyTitles: ["AI 写作与办公", "AI 创作与智能工具", "AI 营销与内容生成"] },
      { slug: "ai-search-knowledge", title: "AI 搜索知识", titleEn: "AI Search & Knowledge", description: "AI 搜索引擎、知识问答与深度研究", legacyTitles: ["AI 搜索与知识"] },
      { slug: "agents-and-automation", title: "智能体与自动化", titleEn: "Agents & Automation", description: "Agent 框架、工作流与自动化编排", legacyTitles: ["智能体与自动化"] },
      { slug: "vector-db-and-rag", title: "向量库与 RAG", titleEn: "Vector DB & RAG", description: "向量数据库、嵌入与检索增强应用", legacyTitles: ["向量库与 RAG 应用"] },
      { slug: "model-training-and-finetuning", title: "模型训练与微调", titleEn: "Model Training & Finetuning", description: "训练平台、微调框架与提示词工程", legacyTitles: ["模型微调与训练平台", "提示词与资源"] },
      { slug: "models-and-datasets", title: "模型与数据集", titleEn: "Models & Datasets", description: "模型社区、数据集与标注服务", legacyTitles: ["模型与数据集社区", "AI 数据标注与数据集服务"] },
      { slug: "ai-hardware-and-embodied", title: "AI 硬件与具身", titleEn: "AI Hardware & Embodied", description: "推理硬件、端侧模型与机器人", legacyTitles: ["AI 硬件与本地推理", "具身智能与机器人"] },
      { slug: "ai-safety-and-alignment", title: "AI 安全与对齐", titleEn: "AI Safety & Alignment", description: "对齐研究、红队与合规评测", legacyTitles: ["AI 安全与对齐研究"] },
      { slug: "ai-eval-and-learning", title: "AI 评测与学习", titleEn: "AI Evals & Learning", description: "榜单基准、论文资讯与 AI 课程", legacyTitles: ["评测与基准榜单", "论文资讯与学习", "AI 教育与企业落地", "AI 产品评测与导航站"] },
    ],
  },
  {
    slug: "frontend-development",
    title: "前端开发",
    titleEn: "Frontend Development",
    icon: "code",
    description: "框架、工程化与交互实现",
    altLabels: ["前端", "Web 前端"],
    sort: 2,
    leaves: [
      { slug: "core-frameworks", title: "核心框架", titleEn: "Core Frameworks", description: "主流 UI 框架、元框架与类型系统", legacyTitles: ["核心框架与元框架"] },
      { slug: "build-and-tooling", title: "构建与工程化", titleEn: "Build & Tooling", description: "打包器、包管理器与 Monorepo", legacyTitles: ["构建工具与工程化"] },
      { slug: "css-and-styling", title: "CSS 与样式", titleEn: "CSS & Styling", description: "原子化 CSS、预处理器与 CSS-in-JS", legacyTitles: ["CSS 与样式方案"] },
      { slug: "components-and-ui", title: "组件与 UI 体系", titleEn: "Components & UI Kits", description: "组件库、无头组件与设计基座", legacyTitles: ["组件库与 UI 体系"] },
      { slug: "state-and-data-flow", title: "状态与数据流", titleEn: "State & Data Flow", description: "客户端状态、服务端数据同步与状态机", legacyTitles: ["状态管理与数据流"] },
      { slug: "frontend-testing", title: "前端测试", titleEn: "Frontend Testing", description: "单测、E2E、静态检查与格式化", legacyTitles: ["测试与质量保障"] },
      { slug: "performance-tuning", title: "性能优化", titleEn: "Performance Tuning", description: "性能指标、体积分析与体验监控", legacyTitles: ["性能与体验优化"] },
      { slug: "motion-and-interaction", title: "动效与交互", titleEn: "Motion & Interaction", description: "动画库、手势与滚动交互规范", legacyTitles: ["动效与交互", "动效与交互设计规范"] },
      { slug: "fullstack-and-server", title: "全栈与服务端", titleEn: "Fullstack & Server", description: "Node/Deno 运行时与类型安全接口层", legacyTitles: ["Node 全栈与服务端方案"] },
      { slug: "wasm-and-rust", title: "WASM 与 Rust", titleEn: "WASM & Rust", description: "WASM 生态、Rust 前端与编译工具链", legacyTitles: ["WebAssembly 与 Rust 前端"] },
      { slug: "low-code-builder", title: "低代码搭建", titleEn: "Low-Code Builder", description: "低代码平台、内部工具与可视化建站", legacyTitles: ["低代码与可视化搭建"] },
      { slug: "cross-platform-desktop", title: "跨端与桌面", titleEn: "Cross-Platform & Desktop", description: "桌面端与移动跨端框架", legacyTitles: ["跨端与桌面端框架"] },
      { slug: "browser-and-pwa", title: "浏览器与 PWA", titleEn: "Browser & PWA", description: "扩展开发、清单规范与渐进式应用", legacyTitles: ["浏览器扩展与 PWA"] },
      { slug: "i18n-and-a11y", title: "国际化无障碍", titleEn: "I18n & Accessibility", description: "i18n 方案、翻译平台与可用性实践", legacyTitles: ["国际化与无障碍"] },
    ],
  },
  {
    slug: "backend-and-cloud",
    title: "后端与云",
    titleEn: "Backend & Cloud",
    icon: "cloud",
    description: "运行时、数据库与基础设施",
    altLabels: ["后端", "云端"],
    sort: 3,
    leaves: [
      { slug: "languages-and-runtimes", title: "语言与运行时", titleEn: "Languages & Runtimes", description: "编程语言官网、运行时与版本管理", legacyTitles: ["语言与运行时"] },
      { slug: "backend-frameworks", title: "后端框架", titleEn: "Backend Frameworks", description: "Web 框架、RPC 与微服务框架", legacyTitles: ["后端框架"] },
      { slug: "databases-and-storage", title: "数据库与存储", titleEn: "Databases & Storage", description: "关系型、NoSQL 与对象存储", legacyTitles: ["数据库与存储"] },
      { slug: "messaging-and-streaming", title: "消息与流处理", titleEn: "Messaging & Streaming", description: "消息队列、事件总线与流计算", legacyTitles: ["消息队列与流处理"] },
      { slug: "containers-and-orchestration", title: "容器与编排", titleEn: "Containers & Orchestration", description: "容器镜像、编排与集群管理", legacyTitles: ["容器与编排"] },
      { slug: "cloud-and-iac", title: "IaC 与云厂商", titleEn: "IaC & Cloud Providers", description: "基础设施即代码与公有云控制台", legacyTitles: ["IaC 与云厂商"] },
      { slug: "api-design-and-governance", title: "API 设计与治理", titleEn: "API Design & Governance", description: "接口规范、网关治理与契约测试", legacyTitles: ["API 设计与治理"] },
      { slug: "serverless-and-events", title: "无服务器与事件", titleEn: "Serverless & Events", description: "函数计算、边缘运行时与事件驱动", altLabels: ["Serverless"], legacyTitles: ["事件驱动与 Serverless"] },
      { slug: "database-operations", title: "数据库运维", titleEn: "Database Operations", description: "迁移工具、性能诊断与备份恢复", legacyTitles: ["数据库运维与迁移工具"] },
      { slug: "caching-and-search", title: "缓存与搜索", titleEn: "Caching & Search", description: "缓存中间件、搜索引擎与索引服务", legacyTitles: ["缓存与搜索中间件"] },
      { slug: "distributed-and-ratelimit", title: "分布式与限流", titleEn: "Distributed & Rate Limiting", description: "协调服务、限流熔断与架构资料", legacyTitles: ["分布式协调与限流", "架构学习与社区"] },
      { slug: "xinchuang-and-private-cloud", title: "信创与私有云", titleEn: "Domestic Stack & Private Cloud", description: "国产化替代与私有化部署方案", legacyTitles: ["国产化信创与私有云"] },
    ],
  },
  {
    slug: "devops-and-security",
    title: "运维与安全",
    titleEn: "DevOps & Security",
    icon: "shield",
    description: "发布、监控与防护",
    altLabels: ["运维", "DevOps", "开发运维", "开发工具"],
    sort: 4,
    leaves: [
      { slug: "observability-and-monitoring", title: "可观测与监控", titleEn: "Observability & Monitoring", description: "指标、日志、链路与告警平台", legacyTitles: ["可观测性与监控"] },
      { slug: "ci-cd-and-releases", title: "持续交付", titleEn: "CI/CD & Releases", description: "流水线、制品库与发布管理", legacyTitles: ["CI/CD 与发布"] },
      { slug: "gateway-and-traffic", title: "网关与流量", titleEn: "Gateway & Traffic", description: "负载均衡、服务网格与流量治理", legacyTitles: ["网关与流量治理"] },
      { slug: "app-and-key-security", title: "应用与密钥安全", titleEn: "App & Secret Security", description: "应用防护、密钥管理与供应链合规", legacyTitles: ["安全与密钥管理", "供应链与安全合规", "安全与合规"] },
      { slug: "testing-and-load", title: "测试与压测", titleEn: "Testing & Load", description: "自动化测试、性能压测与质量平台", legacyTitles: ["测试与性能压测"] },
      { slug: "network-and-speedtest", title: "网络与测速", titleEn: "Network & Speedtest", description: "网络诊断、测速与协议资料", legacyTitles: ["网络诊断与测速"] },
      { slug: "backup-and-recovery", title: "备份与恢复", titleEn: "Backup & Recovery", description: "数据备份、灾难恢复与取证", legacyTitles: ["备份与数据恢复"] },
      { slug: "passwords-and-privacy", title: "密码与隐私", titleEn: "Passwords & Privacy", description: "密码管理器、匿名化与隐私工具", legacyTitles: ["密码与隐私安全"] },
      { slug: "sre-and-postmortem", title: "SRE 与复盘", titleEn: "SRE & Postmortem", description: "站点可靠性手册与故障复盘库", legacyTitles: ["SRE 手册与故障复盘库"] },
    ],
  },
  {
    slug: "developer-resources",
    title: "开发者资源",
    titleEn: "Developer Resources",
    icon: "laptop",
    description: "托管、文档、演练与速查",
    altLabels: ["开发者工具包", "开发资源"],
    sort: 5,
    leaves: [
      { slug: "code-hosting", title: "代码托管", titleEn: "Code Hosting", description: "仓库托管、代码搜索与协作平台", legacyTitles: ["代码托管与协作", "开源社区与代码搜索"] },
      { slug: "qa-communities", title: "问答社区", titleEn: "Q&A Communities", description: "技术问答、论坛与知识社区", legacyTitles: ["问答与知识社区", "社区资讯与学习", "学习社区与问答", "知识问答与百科"] },
      { slug: "official-docs", title: "官方文档", titleEn: "Official Docs", description: "规范原文、手册与标准组织", legacyTitles: ["官方文档与手册", "规范文档与标准"] },
      { slug: "playgrounds", title: "在线演练场", titleEn: "Online Playgrounds", description: "在线 IDE、调试与实验环境", legacyTitles: ["在线 IDE 与演练", "调试与开发工具"] },
      { slug: "coding-utilities", title: "编码小工具", titleEn: "Coding Utilities", description: "转换器、格式化与自托管小工具", legacyTitles: ["编码小工具", "程序员工具与 IDE", "在线工具合集", "开源自托管与替代方案", "工具查询"] },
      { slug: "api-inspection", title: "接口调试", titleEn: "API Inspection", description: "HTTP 客户端、抓包与接口mock", legacyTitles: ["接口与网络调试"] },
      { slug: "cheatsheets", title: "命令行速查", titleEn: "Cheatsheets", description: "命令速查表、快捷键与手册页", legacyTitles: ["命令行与速查表"] },
      { slug: "code-review", title: "代码评审", titleEn: "Code Review", description: "静态分析、代码质量与评审工具", legacyTitles: ["代码评审与静态分析"] },
      { slug: "learning-paths", title: "学习路线", titleEn: "Learning Paths", description: "路线图、课程与技能评估", legacyTitles: ["学习路线与课程"] },
      { slug: "algorithm-interviews", title: "算法面试", titleEn: "Algorithm Interviews", description: "刷题平台、面试题与竞赛", legacyTitles: ["算法与面试"] },
    ],
  },
  {
    slug: "design-and-creative",
    title: "设计与创意",
    titleEn: "Design & Creative",
    icon: "palette",
    description: "灵感、UI、字体与品牌",
    altLabels: ["设计资源", "设计素材"],
    sort: 6,
    leaves: [
      { slug: "inspiration-and-showcase", title: "灵感与作品集", titleEn: "Inspiration & Showcase", description: "作品社区、评审与求职作品集", legacyTitles: ["灵感社区与作品集", "设计求职与作品集平台"] },
      { slug: "ui-assets", title: "UI 资源素材", titleEn: "UI Assets", description: "界面套件、模型与插件素材", legacyTitles: ["UI 资源与组件素材"] },
      { slug: "icons-and-typefaces", title: "图标与字体", titleEn: "Icons & Typefaces", description: "图标集、插图与中英文字体", legacyTitles: ["图标与插画素材", "图标字体与素材", "字体与排版"] },
      { slug: "color-palettes", title: "配色与色板", titleEn: "Color Palettes", description: "取色器、色板与对比度工具", legacyTitles: ["配色与色板工具"] },
      { slug: "stock-media", title: "图片视频素材", titleEn: "Stock Media", description: "图库、视频素材与免版权资源", legacyTitles: ["图片与视频素材库"] },
      { slug: "prototyping-and-collab", title: "原型与协作", titleEn: "Prototyping & Collab", description: "原型工具、设计令牌与交付联调", legacyTitles: ["原型与协作工具", "设计交付与联调"] },
      { slug: "design-systems", title: "设计系统与规范", titleEn: "Design Systems", description: "设计系统、组件规范与印刷标准", legacyTitles: ["设计系统与规范", "开源设计系统与组件库", "印刷与排版规范"] },
      { slug: "brand-and-identity", title: "品牌与 VI", titleEn: "Brand & Identity", description: "品牌规范、Logo 与视觉识别素材", legacyTitles: ["品牌与 VI 规范", "品牌与设计素材"] },
      { slug: "three-d-and-ar", title: "3D 与 AR 设计", titleEn: "3D & AR Design", description: "三维、动效与沉浸式设计工具", legacyTitles: ["3D 与动效设计", "3D 与 AR/VR 设计"] },
      { slug: "design-blogs", title: "设计博客案例", titleEn: "Design Blogs & Cases", description: "设计媒体、团队博客与案例库", legacyTitles: ["网页与交互评审", "设计资讯与学习", "设计团队博客与案例库"] },
      { slug: "user-research", title: "用研与可用性", titleEn: "User Research & Usability", description: "调研方法、可用性测试与研究资讯", altLabels: ["用户体验"], legacyTitles: ["用户体验调研方法"] },
    ],
  },
  {
    slug: "office-productivity",
    title: "效率办公",
    titleEn: "Office Productivity",
    icon: "briefcase",
    description: "文档协作、笔记与桌面工具",
    altLabels: ["常用工具"],
    sort: 7,
    leaves: [
      { slug: "office-suites", title: "办公套件", titleEn: "Office Suites", description: "文档表格幻灯片套件与模板", legacyTitles: ["办公套件与文档"] },
      { slug: "collaborative-docs", title: "协作文档", titleEn: "Collaborative Docs", description: "在线文档、表格与团队空间", legacyTitles: ["在线文档与协作", "协作与效率工具"] },
      { slug: "notes-and-pkb", title: "笔记与知识库", titleEn: "Notes & Knowledge Bases", description: "笔记应用、维基与个人知识体系", legacyTitles: ["笔记与个人知识库", "知识库与笔记体系", "效率笔记与待办"] },
      { slug: "instant-messaging", title: "即时沟通", titleEn: "Instant Messaging", description: "团队 IM、屏幕共享与消息网关", legacyTitles: ["即时沟通", "远程协作与屏幕共享"] },
      { slug: "video-conferencing", title: "视频会议", titleEn: "Video Conferencing", description: "会议、直播与录制协作平台", legacyTitles: ["视频会议"] },
      { slug: "project-and-dev-management", title: "项目与研发管理", titleEn: "Project & Dev Management", description: "任务看板、敏捷与研发流程管理", legacyTitles: ["项目管理与任务", "研发管理与敏捷", "项目协作与管理"] },
      { slug: "mindmaps-and-boards", title: "思维导图与白板", titleEn: "Mindmaps & Whiteboards", description: "思维导图、流程图与在线白板", legacyTitles: ["思维导图", "白板与流程图"] },
      { slug: "forms-and-surveys", title: "表单与问卷", titleEn: "Forms & Surveys", description: "表单、问卷与投票收集工具", legacyTitles: ["表单与问卷"] },
      { slug: "cloud-drives-and-transfer", title: "网盘与传输", titleEn: "Cloud Drives & Transfer", description: "云盘、同步与大文件传输", legacyTitles: ["网盘与云存储", "文件传输与分享", "下载与传输工具", "网盘与同步"] },
      { slug: "calendar-and-tasks", title: "日历与待办", titleEn: "Calendar & Tasks", description: "日程、待办与专注计时", legacyTitles: ["日历与日程安排", "待办与专注", "时间管理与专注工具"] },
      { slug: "screenshots-and-pdf", title: "截图与 PDF", titleEn: "Screenshots & PDF", description: "截图标注、PDF 处理与扫描 OCR", legacyTitles: ["截图录屏与标注", "PDF 与文档转换", "扫描与电子签名", "PDF 与扫描 OCR", "截图录屏与录制"] },
      { slug: "desktop-utilities", title: "桌面实用工具", titleEn: "Desktop Utilities", description: "系统工具、启动器与硬件检测", legacyTitles: ["系统工具与驱动", "压缩与文件管理", "清理优化与硬件检测", "输入法与字体", "虚拟化与远程桌面", "效率启动器与搜索", "剪贴板与快捷启动"] },
    ],
  },
  {
    slug: "data-and-analytics",
    title: "数据与分析",
    titleEn: "Data & Analytics",
    icon: "database",
    description: "BI、埋点与可视化",
    altLabels: ["数据分析"],
    sort: 8,
    leaves: [
      { slug: "bi-and-reporting", title: "BI 与报表", titleEn: "BI & Reporting", description: "商业智能、仪表盘与报表平台" },
      { slug: "data-visualization", title: "数据可视化", titleEn: "Data Visualization", description: "图表库、可视化叙事与图形语法", legacyTitles: ["数据可视化与图表工具"] },
      { slug: "product-analytics", title: "埋点与分析", titleEn: "Product Analytics", description: "埋点SDK、用户分析与 CRM 数据", legacyTitles: ["数据分析与埋点", "客户数据与 CRM 平台"] },
      { slug: "data-collection", title: "数据采集与清洗", titleEn: "Data Collection & Cleaning", description: "爬虫、抽取与数据质量工具" },
      { slug: "data-integration-etl", title: "数据集成 ETL", titleEn: "Data Integration & ETL", description: "数据管道、仓库与湖仓一体" },
      { slug: "seo-and-growth", title: "SEO 与增长", titleEn: "SEO & Growth", description: "关键词、收录诊断与转化实验", legacyTitles: ["SEO 与关键词工具", "A/B 测试与转化优化"] },
    ],
  },
  {
    slug: "learning-growth",
    title: "学习成长",
    titleEn: "Learning & Growth",
    icon: "bookopen",
    description: "课程、考试、语言与技能",
    altLabels: ["学习教育", "学习"],
    sort: 9,
    leaves: [
      { slug: "k12-and-enrollment", title: "K12 与升学", titleEn: "K12 & Enrollment", description: "基础教育、招考政策与备课资源", legacyTitles: ["K12 与升学辅导", "教育政策与招考信息", "教师教案与备课资源", "教育资讯与资源", "教育考试"] },
      { slug: "higher-education", title: "高等学历", titleEn: "Higher Education", description: "高校官网、学籍学历与升学考试", legacyTitles: ["高校官网与学籍查询", "考试与学历提升"] },
      { slug: "postgrad-and-study-abroad", title: "考研与留学", titleEn: "Postgrad & Study Abroad", description: "考研备考、留学申请与国际教育", legacyTitles: ["考研与出国留学", "海外学习资源", "留学与国际教育", "考研考公考编备考"] },
      { slug: "certifications", title: "考证与资格", titleEn: "Certifications", description: "职业资格、技能认证与证书培训", legacyTitles: ["公务员与职业资格考证", "实用技能与证书培训", "职业资格与技能证书"] },
      { slug: "language-learning", title: "语言学习", titleEn: "Language Learning", description: "外语课程、练习与语言社区", legacyTitles: ["语言学习", "外语学习"] },
      { slug: "programming-learning", title: "编程学习", titleEn: "Programming Learning", description: "编程基础、算法与青少年科创", legacyTitles: ["编程与技术学习", "编程与计算机基础", "数学与算法", "青少年编程与科创"] },
      { slug: "online-courses", title: "在线课程", titleEn: "Online Courses", description: "MOOC 与综合课程平台", legacyTitles: ["在线课程平台（MOOC）", "综合课程平台"] },
      { slug: "question-banks", title: "题库刷题", titleEn: "Question Banks", description: "在线题库、智能刷题与组卷", legacyTitles: ["在线题库与智能刷题"] },
      { slug: "open-courses", title: "公开课与方法", titleEn: "Open Courses & Methods", description: "名校公开课、学习方法与通识训练", legacyTitles: ["公开课与名校讲座", "学习方法与工具", "职场与软技能", "演讲表达与写作训练", "思维方法与效率提升", "知识付费与专栏"] },
      { slug: "digital-libraries", title: "数字图书馆", titleEn: "Digital Libraries", description: "图书馆、电子书与阅读管理", legacyTitles: ["数字图书馆与开放资源", "阅读与知识管理", "百科与图书"] },
      { slug: "dictionaries-and-translators", title: "词典与翻译", titleEn: "Dictionaries & Translators", description: "词典、术语库与翻译工具", legacyTitles: ["词典与翻译工具"] },
      { slug: "kids-and-hobbies", title: "儿童与兴趣", titleEn: "Kids & Hobbies", description: "儿童教育、兴趣培养与亲子学习", legacyTitles: ["兴趣与儿童教育", "早教与启蒙", "儿童读物与绘本"] },
      { slug: "popular-science", title: "科普与通识", titleEn: "Popular Science", description: "科普媒体、科学视频与通识内容", legacyTitles: ["科普媒体", "科普与通识教育", "科学视频与播客"] },
      { slug: "school-subjects", title: "学科基础", titleEn: "School Subjects", description: "数理、生命科学与人文社科学科站", legacyTitles: ["天文与航天", "物理与化学", "生命科学与医学", "地球与环境", "数学", "历史与考古", "哲学", "心理学", "经济与社会", "博物馆与文博"] },
    ],
  },
  {
    slug: "academic-research",
    title: "学术科研",
    titleEn: "Academic Research",
    icon: "book",
    description: "文献、检索与学术出版",
    altLabels: ["科研", "学术"],
    sort: 10,
    leaves: [
      { slug: "literature-search", title: "文献检索", titleEn: "Literature Search", description: "数据库、索引与全文检索入口", legacyTitles: ["学术文献与科研工具", "学术检索与论文写作", "海外医疗与学术文献"] },
      { slug: "paper-writing", title: "论文写作", titleEn: "Paper Writing", description: "写作辅助、排版与引用格式" },
      { slug: "research-management", title: "科研管理", titleEn: "Research Management", description: "文献管理、项目与实验室工具", legacyTitles: ["科研工具与文献管理"] },
      { slug: "academic-community", title: "学术社区", titleEn: "Academic Community", description: "学者社区、预印本与科研机构", legacyTitles: ["科技与科研机构"] },
      { slug: "open-access", title: "开放获取", titleEn: "Open Access", description: "开放期刊、仓储与公共学术资源", legacyTitles: ["公开课与学术资源"] },
      { slug: "academic-conferences", title: "学术会议", titleEn: "Academic Conferences", description: "会议征集、日程与论文投稿", legacyTitles: ["学术会议与论文投稿"] },
      { slug: "fact-checking", title: "事实核查", titleEn: "Fact Checking", description: "论文打假、学术诚信与辟谣平台", legacyTitles: ["事实核查与学术诚信", "事实核查"] },
    ],
  },
  {
    slug: "news-and-media",
    title: "资讯媒体",
    titleEn: "News & Media",
    icon: "filetext",
    description: "权威媒体、垂类资讯与核查",
    altLabels: ["媒体资讯", "资讯"],
    sort: 11,
    leaves: [
      { slug: "official-releases", title: "权威与政务发布", titleEn: "Official Releases", description: "党报党刊、部委与官方发布", legacyTitles: ["权威媒体与政务发布"] },
      { slug: "general-news-portals", title: "门户综合资讯", titleEn: "General News Portals", description: "综合门户与头条聚合", legacyTitles: ["门户与综合资讯", "新闻资讯"] },
      { slug: "finance-news", title: "财经新闻", titleEn: "Finance News", description: "财经媒体、监管机构与行情资讯", legacyTitles: ["财经新闻", "财经资讯与监管机构"] },
      { slug: "tech-news", title: "科技资讯", titleEn: "Tech News", description: "科技媒体、行业观察与开发者新闻", legacyTitles: ["科技资讯"] },
      { slug: "longform-journalism", title: "深度报道", titleEn: "Longform Journalism", description: "特稿、调查与长篇非虚构", legacyTitles: ["深度报道与特稿"] },
      { slug: "international-media", title: "国际媒体", titleEn: "International Media", description: "境外媒体、国际频道与区域新闻", legacyTitles: ["国际视野", "港台与海外华文媒体", "英文与海外媒体"] },
      { slug: "local-news", title: "本地民生", titleEn: "Local News", description: "城市新闻与本地生活服务媒体", legacyTitles: ["本地民生与城市新闻"] },
      { slug: "niche-industry-news", title: "垂类资讯", titleEn: "Niche Industry News", description: "行业垂直媒体与专业资讯", legacyTitles: ["行业垂类资讯", "垂直行业与专业媒体"] },
      { slug: "news-aggregators", title: "新闻聚合", titleEn: "News Aggregators", description: "聚合阅读、热点榜单与推送工具", legacyTitles: ["新闻聚合与热搜榜"] },
      { slug: "independent-media", title: "独立媒体", titleEn: "Independent Media", description: "评论专栏、思想理论与独立出版", legacyTitles: ["评论、专栏与思想理论", "独立媒体与 Newsletter"] },
      { slug: "data-journalism", title: "数据新闻", titleEn: "Data Journalism", description: "数据新闻、可视化报道与核查", legacyTitles: ["事实核查与数据新闻"] },
      { slug: "media-toolkit", title: "媒体工具", titleEn: "Media Toolkit", description: "采编、排版与媒体从业工具", legacyTitles: ["媒体工具与写作"] },
    ],
  },
  {
    slug: "content-creation",
    title: "内容创作",
    titleEn: "Content Creation",
    icon: "edit",
    description: "自媒体、排版与音视频制作",
    altLabels: ["自媒体工具包", "创作"],
    sort: 12,
    leaves: [
      { slug: "writing-and-layout", title: "图文创作排版", titleEn: "Writing & Layout", description: "编辑器、排版与图文素材", legacyTitles: ["内容创作与排版", "营销学习与案例库"] },
      { slug: "video-editing", title: "视频剪辑后期", titleEn: "Video Editing", description: "剪辑、特效与字幕后期工具", legacyTitles: ["视频剪辑与后期", "视频创作与剪辑工具"] },
      { slug: "podcast-production", title: "播客与音频制作", titleEn: "Podcast Production", description: "录音、剪辑与音频发布链路", legacyTitles: ["播客与音频制作"] },
      { slug: "live-streaming-ops", title: "直播运营", titleEn: "Live Streaming Ops", description: "开播工具、设备与直播数据", legacyTitles: ["直播运营与设备", "短视频与直播运营"] },
      { slug: "social-and-growth-ops", title: "社媒与增长", titleEn: "Social & Growth Ops", description: "社媒矩阵、排期与投放增长", legacyTitles: ["社交媒体运营与排期", "流量平台与广告投放"] },
      { slug: "private-community", title: "私域与社群", titleEn: "Private Community", description: "社群运营、会员与私域工具", legacyTitles: ["私域与社群运营", "私域与会员运营"] },
      { slug: "email-newsletter", title: "邮件通讯", titleEn: "Email & Newsletter", description: "邮件营销、订阅与自动化发送", legacyTitles: ["邮件营销与 Newsletter", "邮件营销与自动化"] },
      { slug: "landing-page-builder", title: "落地页搭建", titleEn: "Landing Page Builder", description: "建站工具、活动页与表单落地", legacyTitles: ["落地页与活动页搭建", "落地页与建站工具"] },
      { slug: "content-assets", title: "素材与模板", titleEn: "Assets & Templates", description: "模板市场、商用音乐与音效素材", legacyTitles: ["素材与模板市场", "图片设计与素材", "商用音乐与音效素材", "音频工具与音效素材"] },
      { slug: "trend-topics", title: "选题与热点数据", titleEn: "Trend & Topic Data", description: "热点榜单、舆情与竞品数据", legacyTitles: ["数据平台与热点", "舆情与行业数据", "舆情监测与竞品分析", "内容营销与选题"] },
      { slug: "copyright-and-compliance", title: "内容合规版权", titleEn: "Copyright & Compliance", description: "版权登记、素材授权与内容审核", legacyTitles: ["内容合规与版权素材"] },
      { slug: "creator-community", title: "创作者社区", titleEn: "Creator Community", description: "创作社区、投稿渠道与作者服务", legacyTitles: ["创作者社区与投稿"] },
      { slug: "monetization-and-mcn", title: "变现与 MCN", titleEn: "Monetization & MCN", description: "内容平台变现、带货与达人对接", legacyTitles: ["变现与内容平台", "电商与带货", "广告投放与增长", "达人营销与 MCN 对接"] },
      { slug: "global-creation", title: "出海创作", titleEn: "Going Global Creation", description: "海外平台、跨境内容与出海工具", legacyTitles: ["跨境出海与海外平台", "出海营销与海外推广"] },
    ],
  },
  {
    slug: "jobs-and-career",
    title: "职业招聘",
    titleEn: "Jobs & Career",
    icon: "users",
    description: "招聘、简历、面试与劳动权益",
    altLabels: ["招聘", "求职"],
    sort: 13,
    leaves: [
      { slug: "general-job-boards", title: "综合招聘", titleEn: "General Job Boards", description: "全行业招聘平台与垂直岗位", legacyTitles: ["综合招聘平台", "教师招聘与教育人才", "行业垂直招聘平台", "求职招聘"] },
      { slug: "tech-hiring", title: "技术招聘", titleEn: "Tech Hiring", description: "研发岗位、大厂内推与开发者简历", legacyTitles: ["互联网与科技招聘", "互联网大厂与科技公司招聘", "开发者求职与简历"] },
      { slug: "campus-and-internship", title: "校招实习", titleEn: "Campus & Internship", description: "校园招聘、实习与宣讲会", legacyTitles: ["校园招聘与实习"] },
      { slug: "executive-search", title: "猎头中高端", titleEn: "Executive Search", description: "猎头服务与中高端人才平台", legacyTitles: ["中高端人才与猎头服务"] },
      { slug: "blue-collar-and-gig", title: "蓝领灵活用工", titleEn: "Blue Collar & Gig Work", description: "蓝领招聘、兼职与灵活用工", legacyTitles: ["蓝领与灵活用工"] },
      { slug: "civil-service-exams", title: "公职招考", titleEn: "Civil Service Exams", description: "公务员、事业单位与央企招考", legacyTitles: ["公务员与事业单位招考", "国有企业与央企招聘"] },
      { slug: "remote-and-overseas-jobs", title: "海外与远程", titleEn: "Remote & Overseas Jobs", description: "远程岗位、海外求职与签证信息", legacyTitles: ["海外就业与远程工作"] },
      { slug: "professional-networking", title: "职场社交", titleEn: "Professional Networking", description: "职业社交、人脉与行业社群", legacyTitles: ["职场社交与人脉拓展"] },
      { slug: "resume-tools", title: "简历工具", titleEn: "Resume Tools", description: "简历制作、模板与在线主页", legacyTitles: ["简历制作与在线工具"] },
      { slug: "interview-prep", title: "面试题库", titleEn: "Interview Prep", description: "面试题、笔试与模拟面试", legacyTitles: ["面试准备与笔试题库"] },
      { slug: "salary-insights", title: "薪酬洞察", titleEn: "Salary Insights", description: "薪酬报告、行业工资与职级对比", legacyTitles: ["薪酬查询与行业洞察"] },
      { slug: "career-planning", title: "职业规划", titleEn: "Career Planning", description: "职业测评、生涯规划与技能培训", legacyTitles: ["职业测评与生涯规划", "职业培训与技能认证"] },
      { slug: "freelance", title: "自由职业", titleEn: "Freelance", description: "接单平台、副业与自由职业者服务", legacyTitles: ["自由职业与副业接单"] },
      { slug: "labor-rights", title: "劳动权益", titleEn: "Labor Rights", description: "劳动合同、社保与维权渠道", legacyTitles: ["劳动权益与社保公积金"] },
    ],
  },
  {
    slug: "finance-and-investing",
    title: "金融财经",
    titleEn: "Finance & Investing",
    icon: "layers",
    description: "银行、证券、基金与个人财务",
    altLabels: ["投资者工具包", "金融"],
    sort: 14,
    leaves: [
      { slug: "banking", title: "银行", titleEn: "Banking", description: "商业银行、网银与网点服务", legacyTitles: ["银行与网上银行"] },
      { slug: "securities-and-quotes", title: "证券与行情", titleEn: "Securities & Quotes", description: "券商、行情软件与投资社区", legacyTitles: ["证券公司与行情软件", "投资社区与财商学习", "海外券商与全球市场"] },
      { slug: "funds-and-wealth", title: "基金理财", titleEn: "Funds & Wealth", description: "基金销售、理财与资产配置", legacyTitles: ["基金与理财平台", "金融理财"] },
      { slug: "insurance", title: "保险", titleEn: "Insurance", description: "保单、比价与理赔服务", legacyTitles: ["保险与保障", "保险比价与理赔服务", "旅行保险与出行保障", "健康保险与医疗支付"] },
      { slug: "payments-and-wallets", title: "支付与钱包", titleEn: "Payments & Wallets", description: "第三方支付、钱包与收单", legacyTitles: ["第三方支付与钱包", "支付与钱包"] },
      { slug: "personal-finance", title: "记账与财务", titleEn: "Personal Finance", description: "记账、预算与个人财务报表", legacyTitles: ["记账与个人财务"] },
      { slug: "credit-and-reports", title: "征信与信用", titleEn: "Credit & Reports", description: "征信查询、信用评级与监管", legacyTitles: ["信用与征信服务", "金融监管与征信服务"] },
      { slug: "tax-and-invoicing", title: "财税发票", titleEn: "Tax & Invoicing", description: "税务申报、发票与企业财税", legacyTitles: ["财税发票与工商服务", "税务与财务合规", "税务与发票", "售后发票与消费维权"] },
      { slug: "research-and-reports", title: "财经数据研报", titleEn: "Financial Data & Research", description: "宏观数据、行业研报与终端", legacyTitles: ["财经数据与研究报告"] },
      { slug: "forex-and-metals", title: "外汇与贵金属", titleEn: "Forex & Precious Metals", description: "外汇行情、汇率与贵金属", legacyTitles: ["外汇与贵金属"] },
      { slug: "futures-and-derivatives", title: "期货与衍生品", titleEn: "Futures & Derivatives", description: "期货交易所、期权与衍生品", legacyTitles: ["期货与衍生品"] },
      { slug: "crypto-and-web3", title: "加密与区块链", titleEn: "Crypto & Web3", description: "加密资产、链上数据与合规", legacyTitles: ["加密货币与区块链"] },
      { slug: "trusts-and-am", title: "信托资管", titleEn: "Trusts & Asset Management", description: "信托、资管与私募产品", legacyTitles: ["信托与资产管理"] },
      { slug: "property-exchanges", title: "产权交易", titleEn: "Property Exchanges", description: "产权交易所与区域股权市场", legacyTitles: ["产权交易与区域股权市场"] },
    ],
  },
  {
    slug: "entertainment",
    title: "影音娱乐",
    titleEn: "Entertainment",
    icon: "film",
    description: "长短视频、音乐、播客与演出",
    altLabels: ["娱乐", "影音"],
    sort: 15,
    leaves: [
      { slug: "long-video", title: "长视频", titleEn: "Long Video", description: "剧集、电影与综合视频平台", legacyTitles: ["长视频平台", "视频影音"] },
      { slug: "short-video", title: "短视频", titleEn: "Short Video", description: "短视频与中视频社区", legacyTitles: ["短视频平台", "短视频与视频新闻"] },
      { slug: "music", title: "音乐", titleEn: "Music", description: "流媒体音乐、曲库与歌词", legacyTitles: ["在线音乐", "音乐音频"] },
      { slug: "podcast-and-audiobooks", title: "播客与有声书", titleEn: "Podcasts & Audiobooks", description: "播客托管、有声书与听书", legacyTitles: ["播客与有声书", "音频与播客资讯"] },
      { slug: "anime-and-fandom", title: "动漫与二次元", titleEn: "Anime & Fandom", description: "番剧、漫画与二次元社区周边", legacyTitles: ["动漫二次元", "二次元社区与周边", "科幻与未来"] },
      { slug: "live-streaming", title: "直播", titleEn: "Live Streaming", description: "综合直播、赛事直播与主播平台", legacyTitles: ["直播平台", "体育赛事直播", "直播与视频内容平台"] },
      { slug: "radio-and-broadcast", title: "电台广播", titleEn: "Radio & Broadcast", description: "网络电台、广播台与音频栏目", legacyTitles: ["电台与广播"] },
      { slug: "ratings-and-reviews", title: "影视评分", titleEn: "Ratings & Reviews", description: "评分榜单、片单与影视资料库", legacyTitles: ["影视资讯与评分"] },
      { slug: "subtitle-communities", title: "字幕社区", titleEn: "Subtitle Communities", description: "字幕组、弹幕与译制社区", legacyTitles: ["弹幕与字幕社区"] },
      { slug: "event-ticketing", title: "演出票务", titleEn: "Event Ticketing", description: "演唱会、展览与线下娱乐票务", legacyTitles: ["演出票务与线下娱乐"] },
      { slug: "documentaries", title: "纪录片", titleEn: "Documentaries", description: "纪录片、人文与自然影像", legacyTitles: ["纪录片与人文内容", "纪录片与自然影像"] },
      { slug: "overseas-streaming", title: "海外流媒体", titleEn: "Overseas Streaming", description: "境外流媒体与区域片库", legacyTitles: ["海外流媒体"] },
      { slug: "cinema-ticketing", title: "影院票务", titleEn: "Cinema Ticketing", description: "院线、排片与购票平台", legacyTitles: ["电影院线与购票"] },
      { slug: "film-criticism", title: "影评媒体", titleEn: "Film Criticism", description: "影评刊物、行业观察与影史资料", legacyTitles: ["影视行业与影评媒体"] },
    ],
  },
  {
    slug: "gaming-and-esports",
    title: "游戏电竞",
    titleEn: "Gaming & Esports",
    icon: "gamepad2",
    description: "游戏、赛事、攻略与开发",
    altLabels: ["游戏"],
    sort: 16,
    leaves: [
      { slug: "game-platforms", title: "游戏平台", titleEn: "Game Platforms", description: "PC 与主机商店、折扣比价", legacyTitles: ["游戏平台与商店", "购买比价与折扣追踪", "游戏交易与电竞陪玩"] },
      { slug: "console-and-cloud-gaming", title: "主机与云游戏", titleEn: "Console & Cloud Gaming", description: "主机生态、云游戏与外设硬件", legacyTitles: ["主机与云游戏", "游戏硬件与电竞外设"] },
      { slug: "mobile-game-channels", title: "手游渠道", titleEn: "Mobile Game Channels", description: "手游分发、加速器与官方渠道", legacyTitles: ["手游与分发渠道"] },
      { slug: "esports-events", title: "电竞赛事", titleEn: "Esports Events", description: "赛事、战队与战绩数据", legacyTitles: ["电竞赛事与战队", "电竞数据与战绩查询"] },
      { slug: "gaming-media", title: "游戏媒体", titleEn: "Gaming Media", description: "游戏资讯、评测与发行媒体", legacyTitles: ["游戏媒体与评测"] },
      { slug: "game-wikis-and-data", title: "攻略与数据", titleEn: "Game Wikis & Data", description: "攻略站、数据库与统计平台", legacyTitles: ["攻略与数据库", "游戏数据与销量统计"] },
      { slug: "gaming-community", title: "游戏社区", titleEn: "Gaming Community", description: "玩家论坛、模组与创作社区", legacyTitles: ["游戏社区与论坛", "模组与玩家创作"] },
      { slug: "engines-and-tools", title: "引擎与工具", titleEn: "Engines & Tools", description: "游戏引擎、中间件与开发工具", legacyTitles: ["游戏开发引擎与工具"] },
      { slug: "game-art-assets", title: "美术素材", titleEn: "Game Art Assets", description: "模型、贴图与音频素材资源", legacyTitles: ["游戏美术与素材资源"] },
      { slug: "indie-games", title: "独立游戏", titleEn: "Indie Games", description: "独立游戏、发行与展区", legacyTitles: ["独立游戏与发行"] },
      { slug: "game-conventions", title: "游戏展会", titleEn: "Game Conventions", description: "展会、奖项与行业活动", legacyTitles: ["游戏展会与行业活动"] },
    ],
  },
  {
    slug: "consumer-life",
    title: "消费生活",
    titleEn: "Consumer Life",
    icon: "shoppingbag",
    description: "购物、美食、出行、运动与家庭",
    altLabels: ["生活服务"],
    sort: 17,
    leaves: [
      { slug: "ecommerce", title: "电商购物", titleEn: "E-commerce", description: "综合商城、品牌店与商家工具", legacyTitles: ["综合电商平台", "品牌官方商城", "团购与本地生活", "供应链与商家工具", "数字商品与虚拟充值", "电商运营与选品", "购物电商", "农产品电商与流通"] },
      { slug: "digital-and-home", title: "数码与家居", titleEn: "Digital & Home", description: "数码家电、家居百货与装修服务", legacyTitles: ["数码家电垂类", "家居百货垂类", "厨具与厨房电器", "家装建材与装修服务", "房产家居"] },
      { slug: "fashion-and-beauty", title: "服饰美妆", titleEn: "Fashion & Beauty", description: "服装、鞋包与美妆个护", legacyTitles: ["服饰美妆垂类"] },
      { slug: "grocery-and-delivery", title: "生鲜与外卖", titleEn: "Grocery & Delivery", description: "外卖到家、生鲜食材与商超", legacyTitles: ["外卖与到家", "生鲜与食材", "生鲜买菜与商超"] },
      { slug: "cross-border-shopping", title: "跨境海淘", titleEn: "Cross-border Shopping", description: "海淘直邮、跨境平台与区域站", legacyTitles: ["跨境电商与海淘", "跨境平台区域站"] },
      { slug: "deals-and-comparison", title: "折扣与比价", titleEn: "Deals & Comparison", description: "返利、比价与消费口碑", legacyTitles: ["折扣返利与比价", "消费点评与口碑"] },
      { slug: "secondhand-market", title: "二手闲置", titleEn: "Secondhand Market", description: "二手交易、闲置回收与翻新", legacyTitles: ["二手闲置交易", "二手交易与闲置"] },
      { slug: "food-and-drink", title: "美食与饮品", titleEn: "Food & Drink", description: "菜谱、点评、茶饮酒水与食品科学", legacyTitles: ["菜谱与做法", "美食社区与点评", "调味与酱料", "烘焙与甜品", "咖啡", "茶与茶文化", "葡萄酒", "白酒与黄酒", "精酿啤酒", "鸡尾酒与烈酒", "美食媒体与纪录片", "餐厅评鉴与榜单", "烹饪科学与食材百科", "酒水电商与购买", "美食生活", "食品安全与营养"] },
      { slug: "travel-and-lodging", title: "旅行与住宿", titleEn: "Travel & Lodging", description: "OTA、酒店民宿与目的地服务", legacyTitles: ["综合在线旅行平台", "酒店预订", "民宿与短租", "海外旅行预订平台", "目的地官方旅游机构", "邮轮与海岛度假", "目的地玩乐与门票预订", "旅行工具与实用查询", "旅游攻略与社区", "旅游"] },
      { slug: "transit-and-mobility", title: "交通与出行", titleEn: "Transit & Mobility", description: "票务、地图导航、通勤与物流", legacyTitles: ["机票与航班服务", "火车票与长途客运", "地图导航与实时路况", "打车与租车", "通勤与公共交通查询", "机场与口岸服务", "出行交通", "快递与物流查询", "物流快递查询"] },
      { slug: "car-and-driving", title: "汽车与驾驶", titleEn: "Car & Driving", description: "购车、用车、赛事与汽车产业", legacyTitles: ["购车平台与报价", "汽车媒体与评测", "自主品牌与新势力", "国际车企", "新能源与充电", "维修保养", "用品与配件", "摩托车与骑行", "驾培与安全评测", "车险与理赔", "二手车与交易", "改装与性能", "赛车与赛事", "自动驾驶与智能网联", "轮胎与耗材", "汽车金融与租赁", "车友社区与行业组织", "行业数据与政策", "汽车与驾考"] },
      { slug: "sports-and-outdoor", title: "运动与户外", titleEn: "Sports & Outdoor", description: "综合运动、赛事数据与户外装备", legacyTitles: ["体育综合媒体", "足球", "篮球", "网球", "跑步与田径", "健身与力量", "游泳与水上运动", "骑行", "登山徒步与露营", "滑雪与冬季运动", "钓鱼", "瑜伽与普拉提", "羽毛球与乒乓球", "格斗与搏击", "赛事直播与数据", "运动装备与电商", "运动医学与康复", "体育产业与政策", "户外露营与徒步", "运动健身与训练计划"] },
      { slug: "pets-and-family", title: "宠物与家庭", titleEn: "Pets & Family", description: "宠物养护、母婴育儿与家校服务", legacyTitles: ["宠物综合社区与媒体", "宠物医疗与健康", "宠物领养与救助", "宠物用品与电商", "宠物训练与行为", "宠物品种与百科", "宠物保险与出行服务", "母婴综合平台", "孕期与产后", "婴幼儿护理", "儿童健康与医疗", "育儿知识科普", "亲子活动与场馆", "家校衔接与家庭教育", "儿童安全与保护", "家庭关系与心理", "母婴与育儿"] },
      { slug: "social-and-dating", title: "社交与婚恋", titleEn: "Social & Dating", description: "社交平台、社区与婚恋服务", legacyTitles: ["社交社区", "婚恋与社交"] },
    ],
  },
  {
    slug: "public-services",
    title: "公共服务",
    titleEn: "Public Services",
    icon: "building",
    description: "政务、法律、医疗、三农与生命关怀",
    altLabels: ["政务", "民生"],
    sort: 18,
    leaves: [
      { slug: "government-affairs", title: "政务办事", titleEn: "Government Affairs", description: "部委、地方门户与一网通办", legacyTitles: ["中央政府与部委", "地方政府门户", "政务服务与一网通办", "公共数据与统计", "政务办事", "政府法制与监管", "交通管理与车辆业务"] },
      { slug: "social-security-and-housing-fund", title: "社保公积金", titleEn: "Social Security & Housing Fund", description: "社保、医保与住房公积金", legacyTitles: ["社保与医保", "公积金与住房保障"] },
      { slug: "household-and-entry-exit", title: "户籍与出入境", titleEn: "Household & Entry-Exit", description: "户籍、护照签证与出入境口岸", legacyTitles: ["户政与出入境", "签证与出入境服务"] },
      { slug: "justice-and-law", title: "司法法律", titleEn: "Justice & Law", description: "法规库、裁判文书、律师与合规", legacyTitles: ["法律法规数据库", "司法案例与裁判文书", "法院与检察院", "司法与法律服务", "律师与律所", "法律咨询平台", "合同模板与电子签署", "知识产权", "商标与专利检索", "知识产权与版权服务", "劳动人事合规", "数据隐私与网络安全合规", "企业工商与信用", "破产重整与强制执行", "仲裁与替代争议解决", "公证与司法鉴定", "法律学习与职业考试", "涉外法律与贸易合规", "司法法律"] },
      { slug: "market-regulation", title: "市场监管", titleEn: "Market Regulation", description: "市场监管、标准计量与消费者维权", legacyTitles: ["市场监管与消费者维权", "有机与绿色认证"] },
      { slug: "healthcare", title: "医疗健康", titleEn: "Healthcare", description: "就医、问诊、药事与公共卫生", legacyTitles: ["预约挂号与就医服务", "在线问诊与互联网医院", "医药电商与用药查询", "权威医学机构与政策", "健康科普与医学百科", "体检与检验报告解读", "慢病管理与健康档案", "中医与养生", "医疗从业者专业资源", "口腔与眼科专科", "疫苗与免疫接种", "医疗健康", "营养饮食与热量管理", "母婴与儿童健康"] },
      { slug: "mental-health", title: "心理健康", titleEn: "Mental Health", description: "心理咨询、危机干预与自助资源", legacyTitles: ["心理健康与咨询", "心理健康"] },
      { slug: "elderly-care", title: "养老照护", titleEn: "Elderly Care", description: "养老政策、机构与居家适老化", legacyTitles: ["养老政策与主管", "养老机构与照护服务", "居家照护与适老化", "长期护理保险与养老金融", "老年健康与慢病管理", "认知症与失智照护", "行业组织与职业教育", "养老与适老服务"] },
      { slug: "end-of-life-care", title: "生命关怀", titleEn: "End-of-Life Care", description: "安宁疗护、捐献殡葬与哀伤支持", legacyTitles: ["安宁疗护与临终关怀", "生前预嘱与医疗决策", "器官与遗体捐献", "殡葬管理与政策", "殡仪服务与礼仪", "公墓陵园与生态葬", "祭祀文化与家族纪念", "遗嘱与遗产继承", "哀伤辅导与丧亲支持", "生命教育与死亡素养", "数字纪念与数字遗产"] },
      { slug: "agriculture-and-rural", title: "三农服务", titleEn: "Agriculture & Rural", description: "农业农村政策、产销与数字乡村", legacyTitles: ["农业农村政策与主管", "农业科研与院校", "种植技术与农艺", "种业与品种", "畜牧与养殖", "水产与渔业", "农机与智能装备", "农资与化肥农药", "农业金融与保险", "农业气象与土壤", "农业展会与商贸", "农业数据与行情", "林业与生态", "农业国际合作", "农业科普与媒体", "数字农业与智慧乡村"] },
      { slug: "weather-and-environment", title: "气象与环境", titleEn: "Weather & Environment", description: "天气预报、空气质量与环境监测", legacyTitles: ["天气与空气质量", "气象与环境"] },
      { slug: "education-and-civic-services", title: "教育民生服务", titleEn: "Education & Civic Services", description: "学历认证、教育考试与人才服务", legacyTitles: ["教育与学历服务", "就业与人才服务", "文化旅游与文物保护"] },
      { slug: "charity-and-volunteering", title: "公益志愿", titleEn: "Charity & Volunteering", description: "公益组织、捐赠与志愿服务", legacyTitles: ["民政与公益服务", "公益志愿"] },
    ],
  },
];

/** 兜底类目：显式常量，不进导航、不进 sitemap（方案 §5.6） */
export const UNCATEGORIZED_SLUG = "uncategorized";

/**
 * 被**刻意**移出树的名字（方案 §3.4）：它们不是缺口，而是轴外移的结果。
 * 审计与迁移脚本要能区分「当年有、现在不该有」和「真的没地方放」。
 */
export const RETIRED_TAXONOMY_NAMES: Readonly<Record<string, string>> = {
  常用推荐: "时效轴：改 /hot 排序与「编辑精选」合集",
  热门推荐: "时效轴：改 /hot 排序与「编辑精选」合集",
  最新网址: "时效轴：改排序",
  热门AI工具: "时效轴：改排序",
  素材资源: "受众/资源轴：由 设计与创意 的叶子承接",
  开源项目: "授权轴：改 facets.pricing=open_source + 合集「开源替代」",
  开源自托管与替代方案: "授权轴：改 facets.pricing=open_source + 合集「开源替代」",
  工具目录: "元类目：降为合集",
  AI产品评测与导航站: "元类目：降为合集",
};

function flatten(root: RegistryRootInput): RegistryCategory[] {
  const out: RegistryCategory[] = [
    {
      slug: root.slug,
      title: root.title,
      titleEn: root.titleEn,
      icon: root.icon ?? null,
      description: root.description,
      sort: root.sort,
      altLabels: root.altLabels ?? [],
      legacyTitles: root.legacyTitles ?? [],
    },
  ];
  root.leaves.forEach((leaf, i) => {
    out.push({
      slug: leaf.slug,
      title: leaf.title,
      titleEn: leaf.titleEn,
      icon: leaf.icon ?? null,
      description: leaf.description,
      parentSlug: root.slug,
      sort: i + 1,
      altLabels: leaf.altLabels ?? [],
      legacyTitles: leaf.legacyTitles ?? [],
    });
  });
  return out;
}

/** 权威树全量（先根后叶，按 sort 升序） */
export const CATEGORY_REGISTRY: readonly RegistryCategory[] = CATEGORY_REGISTRY_ROOTS.flatMap(flatten);

export const REGISTRY_BY_SLUG: ReadonlyMap<string, RegistryCategory> = new Map(
  CATEGORY_REGISTRY.map((c) => [c.slug, c]),
);

/** 旧标题 / altLabel → 条目（小写归一）。全局唯一，重名在构造期即报错。 */
function buildTitleIndex(): Map<string, RegistryCategory> {
  const index = new Map<string, RegistryCategory>();
  for (const entry of CATEGORY_REGISTRY) {
    for (const name of [entry.title, ...entry.altLabels, ...entry.legacyTitles]) {
      const key = (name ?? "").trim().toLowerCase();
      if (!key) continue;
      const hit = index.get(key);
      if (hit && hit.slug !== entry.slug) {
        throw new Error(`registry 标题「${name}」同时指向 ${hit.slug} 与 ${entry.slug}：一个旧标题只能有一个归宿`);
      }
      index.set(key, entry);
    }
  }
  return index;
}

export const REGISTRY_BY_TITLE: ReadonlyMap<string, RegistryCategory> = buildTitleIndex();

/** 一级根（带 sort，首页目录带按此取前 8） */
export function registryRoots(): RegistryCategory[] {
  return CATEGORY_REGISTRY.filter((c) => !c.parentSlug);
}

export function registryLeaves(parentSlug: string): RegistryCategory[] {
  return CATEGORY_REGISTRY.filter((c) => c.parentSlug === parentSlug);
}

export function isRegistryRoot(slug: string): boolean {
  const entry = REGISTRY_BY_SLUG.get(slug);
  return Boolean(entry && !entry.parentSlug);
}

export function isRegistryLeaf(slug: string): boolean {
  const entry = REGISTRY_BY_SLUG.get(slug);
  return Boolean(entry && entry.parentSlug);
}

/** 按 slug 或任意历史标题/别名解析到条目；解析不出返回 null（调用方落「未分类」并产提案） */
export function resolveRegistryEntry(ref: string | null | undefined): RegistryCategory | null {
  const key = (ref ?? "").trim().toLowerCase();
  if (!key) return null;
  return REGISTRY_BY_SLUG.get(key) ?? REGISTRY_BY_TITLE.get(key) ?? null;
}

/** 站点归属解析：只接受叶子，根一律拒绝（G2 规则） */
export function resolveRegistryLeaf(ref: string | null | undefined): RegistryCategory | null {
  const entry = resolveRegistryEntry(ref);
  return entry && entry.parentSlug ? entry : null;
}

/** 稳定内部 id */
export function registryEntryId(ref: string): string {
  const entry = resolveRegistryEntry(ref);
  return entry ? registryId(entry.slug) : registryId(UNCATEGORIZED_SLUG);
}
