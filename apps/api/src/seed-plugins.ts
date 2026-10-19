/**
 * 插件市场种子数据（开发 / 演示环境）。
 *
 * 目标：`pnpm seed` 之后插件市场立刻"有内容、看得出质量"，而不是空壳。
 * 覆盖三种 kind，并额外放一条**待审**样例用于演示审核链路：
 *   1. 设计师灵感导航包（site-pack，已上架）
 *   2. 数据洞察工作台（workspace-preset，已上架）
 *   3. 暮色罗盘（theme，已上架）
 *   4. 开发者效率精选（site-pack，待审 —— 演练 approve/reject）
 *
 * 约束与仓库纪律一致：
 *   - 全部为声明式 JSON（零可执行代码），入库前经 validateAndCleanPluginManifest 校验；
 *   - 幂等：固定 slug 作为去重键，重复执行不会产生副本；
 *   - 预设里的模块 type 全部取自前端 WIDGET_REGISTRY 已验证集，跨度在注册表 min/max 内。
 */
import type { PluginStatus } from "@navhub/core";

export interface SeedPluginDef {
  /** 固定 slug：既是详情页链接，也是幂等去重键 */
  slug: string;
  status: PluginStatus;
  /** 未校验的声明式清单，由 seed.ts 统一走 validateAndCleanPluginManifest */
  manifest: unknown;
}

export function seedPluginDefs(): SeedPluginDef[] {
  return [
    {
      slug: "dev-search-arsenal",
      status: "published",
      manifest: {
        manifestVersion: 1,
        kind: "search-pack",
        name: "极客开发者搜索引擎包",
        description:
          "主流技术社区与权威文档快捷直达引擎包：支持在主搜索框以 !gh、!npm、!mdn、!so、!dd、!caniuse 等快捷前缀跨库检索，极客开发必备。",
        icon: "🔍",
        author: "NavHub 官方",
        license: "MIT",
        version: "1.0.0",
        tags: ["搜索", "极客", "GitHub", "npm", "MDN", "工具"],
        payload: {
          engines: [
            {
              id: "github",
              name: "GitHub",
              prefix: "!gh",
              searchUrl: "https://github.com/search?q={q}",
              description: "全球最大代码托管平台，检索开源项目、代码与 Issue",
              icon: "https://github.githubassets.com/favicons/favicon.svg",
            },
            {
              id: "npm",
              name: "npm",
              prefix: "!npm",
              searchUrl: "https://www.npmjs.com/search?q={q}",
              description: "JavaScript / TypeScript 依赖包检索",
              icon: "https://static-production.npmjs.com/b0f1a8318363185cc2ea6a400e32622c.png",
            },
            {
              id: "mdn",
              name: "MDN Web Docs",
              prefix: "!mdn",
              searchUrl: "https://developer.mozilla.org/zh-CN/search?q={q}",
              description: "权威 Web 技术规范、API 文档与参考手册",
              icon: "https://developer.mozilla.org/favicon-48x48.png",
            },
            {
              id: "stackoverflow",
              name: "Stack Overflow",
              prefix: "!so",
              searchUrl: "https://stackoverflow.com/search?q={q}",
              description: "全球程序员问答社区，疑难 Bug 与方案直达",
              icon: "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico",
            },
            {
              id: "devdocs",
              name: "DevDocs",
              prefix: "!dd",
              searchUrl: "https://devdocs.io/#q={q}",
              description: "全栈离线与在线 API 一站式快速手册",
              icon: "https://devdocs.io/favicon.ico",
            },
            {
              id: "caniuse",
              name: "Can I use",
              prefix: "!caniuse",
              searchUrl: "https://caniuse.com/?search={q}",
              description: "浏览器前沿特性与 HTML/CSS/JS 兼容度速查",
              icon: "https://caniuse.com/img/favicon-128.png",
            },
          ],
        },
      },
    },
    {
      slug: "front-end-arsenal",
      status: "published",
      manifest: {
        manifestVersion: 1,
        kind: "site-pack",
        name: "前端开发武器库",
        description:
          "现代前端工程师核心装备库：React / Vue / Next.js / Vite / Tailwind 等主流生态权威文档、前沿规范、动效演练场与调试工具。",
        icon: "⚡",
        author: "NavHub 官方",
        license: "MIT",
        version: "1.0.0",
        tags: ["前端", "开发", "React", "Vue", "CSS", "工具"],
        payload: {
          categories: [
            { title: "主流框架与运行时", description: "前端核心框架与应用脚手架" },
            { title: "构建与样式生态", description: "打包工具、CSS 引擎与 UI 体系" },
            { title: "规范与基准参考", description: "Web 标准、动效方案与兼容性查询" },
          ],
          sites: [
            {
              url: "https://react.dev/",
              title: "React",
              description: "用于构建 Web 和原生交互界面的声明式 UI 库。",
              category: "主流框架与运行时",
              tags: ["React", "UI", "库"],
            },
            {
              url: "https://vuejs.org/",
              title: "Vue.js",
              description: "易学易用、性能出色且功能丰富的渐进式 JavaScript 框架。",
              category: "主流框架与运行时",
              tags: ["Vue", "框架"],
            },
            {
              url: "https://nextjs.org/",
              title: "Next.js",
              description: "全栈 React 框架，提供服务端渲染、静态生成与路由优化。",
              category: "主流框架与运行时",
              tags: ["Next.js", "React", "SSR"],
            },
            {
              url: "https://vite.dev/",
              title: "Vite",
              description: "下一代前端开发与构建工具，极速冷启动与热更新体验。",
              category: "构建与样式生态",
              tags: ["构建", "DevServer"],
            },
            {
              url: "https://tailwindcss.com/",
              title: "Tailwind CSS",
              description: "原子优先的 CSS 实用类框架，快速构建高可定制界面。",
              category: "构建与样式生态",
              tags: ["CSS", "样式"],
            },
            {
              url: "https://www.typescriptlang.org/",
              title: "TypeScript",
              description: "添加类型系统的 JavaScript 超集，提升代码健壮性与团队协作。",
              category: "主流框架与运行时",
              tags: ["TypeScript", "类型"],
            },
            {
              url: "https://web.dev/",
              title: "web.dev",
              description: "Google Chrome 团队打造的 Web 开发者指南、核心指标与最佳实践。",
              category: "规范与基准参考",
              tags: ["Web", "性能", "指南"],
            },
            {
              url: "https://motion.dev/",
              title: "Motion (Framer Motion)",
              description: "现代 Web 与 React 动效开发库，原生手势与物理弹簧动画支持。",
              category: "规范与基准参考",
              tags: ["动效", "React"],
            },
          ],
        },
      },
    },
    {
      slug: "devops-workbench",
      status: "published",
      manifest: {
        manifestVersion: 1,
        kind: "workspace-preset",
        name: "运维与 SRE 看板预设",
        description:
          "专为运维架构师与 SRE 工程师打造的双看板布局：全景实时监控（系统指标、全网热榜、极客工具箱）与应急速查响应台。",
        icon: "🛠️",
        author: "NavHub 官方",
        license: "MIT",
        version: "1.0.0",
        tags: ["运维", "SRE", "监控", "工作台"],
        payload: {
          boards: [
            {
              name: "集群全景监控",
              widgets: [
                { type: "system-metrics", customTitle: "集群负载与健康度", colSpan: 4, rowSpan: 2 },
                { type: "trending-radar", customTitle: "技术雷达热榜", colSpan: 5, rowSpan: 2 },
                { type: "quick-tools", customTitle: "网络诊断工具", colSpan: 3, rowSpan: 1 },
                { type: "clock-pomodoro", customTitle: "运维轮值时钟", colSpan: 3, rowSpan: 1 },
              ],
            },
            {
              name: "故障应急响应",
              widgets: [
                { type: "speculative-terminal", customTitle: "指令交互终端", colSpan: 5, rowSpan: 2 },
                { type: "markdown-notes", customTitle: "SOP 应急手册与速记", colSpan: 7, rowSpan: 2 },
              ],
            },
          ],
        },
      },
    },
    {
      slug: "dracula-dark",
      status: "published",
      manifest: {
        manifestVersion: 1,
        kind: "theme",
        name: "赛博深色主题 (Dracula Dark)",
        description:
          "致敬经典 Dracula 与赛博朋克高对比配色体系：极黑深邃底色配合高饱和粉紫霓虹强调色，深夜专注编码不刺眼。",
        icon: "🧛",
        author: "NavHub 官方",
        license: "MIT",
        version: "1.0.0",
        tags: ["主题", "深色", "Dracula", "赛博朋克"],
        payload: {
          accent: "rose",
          tokens: {
            "--primary": "336 90% 65%",
            "--ring": "336 90% 65%",
            "--radius": "0.75rem",
          },
        },
      },
    },
    {
      slug: "seed-design-inspiration",
      status: "published",
      manifest: {
        manifestVersion: 1,
        kind: "site-pack",
        name: "设计师灵感导航包",
        description:
          "为设计师与产品视觉同学准备的灵感采集与配色工具合集：作品集平台、灵感流站点、社区评审榜与在线调色板，一次导入即用。",
        icon: "🎨",
        author: "NavHub 官方",
        license: "MIT",
        version: "1.0.0",
        tags: ["设计", "灵感", "配色", "UI"],
        payload: {
          categories: [
            { title: "设计灵感", description: "灵感采集、作品集与设计社区" },
            { title: "配色工具", description: "调色板生成与配色方案参考" },
          ],
          sites: [
            {
              url: "https://www.behance.net/",
              title: "Behance",
              description: "Adobe 旗下全球创意作品集平台，覆盖平面、UI、插画与动效。",
              category: "设计灵感",
              tags: ["作品集", "社区"],
            },
            {
              url: "https://dribbble.com/",
              title: "Dribbble",
              description: "设计师作品分享社区，界面临摹与视觉趋势的风向标。",
              category: "设计灵感",
              tags: ["UI", "趋势"],
            },
            {
              url: "https://www.awwwards.com/",
              title: "Awwwards",
              description: "全球网页设计评审与获奖榜单，站点交互与视觉的天花板参考。",
              category: "设计灵感",
              tags: ["网页设计", "榜单"],
            },
            {
              url: "https://www.zcool.com.cn/",
              title: "站酷 ZCOOL",
              description: "国内头部设计师社区，作品展示、教程与商业需求对接。",
              category: "设计灵感",
              tags: ["中文社区", "作品集"],
            },
            {
              url: "https://huaban.com/",
              title: "花瓣网",
              description: "图片采集与灵感画板工具，适合建立个人情绪板。",
              category: "设计灵感",
              tags: ["情绪板", "采集"],
            },
            {
              url: "https://mobbin.com/",
              title: "Mobbin",
              description: "真实 App 界面截图库，按流程与组件检索移动端最佳实践。",
              category: "设计灵感",
              tags: ["移动端", "截图库"],
            },
            {
              url: "https://www.figma.com/community",
              title: "Figma Community",
              description: "Figma 官方社区：插件、设计系统与可复用组件资源。",
              category: "设计灵感",
              tags: ["Figma", "资源"],
            },
            {
              url: "https://coolors.co/",
              title: "Coolors",
              description: "秒级生成配色方案并导出多格式色板，支持对比度检查。",
              category: "配色工具",
              tags: ["调色", "色板"],
            },
            {
              url: "https://realtimecolors.com/",
              title: "Realtime Colors",
              description: "在真实页面上实时预览字体与配色组合的选型工具。",
              category: "配色工具",
              tags: ["预览", "配色"],
            },
          ],
        },
      },
    },
    {
      slug: "seed-data-workbench",
      status: "published",
      manifest: {
        manifestVersion: 1,
        kind: "workspace-preset",
        name: "数据洞察工作台",
        description:
          "面向技术趋势观察者的双看板布局：热榜雷达 + 系统监控 + 速查终端 + 专注时钟，外加一块用于沉淀速记的极客看板。",
        icon: "📊",
        author: "NavHub 官方",
        license: "MIT",
        version: "1.0.0",
        tags: ["工作台", "看板", "效率"],
        payload: {
          boards: [
            {
              name: "数据洞察",
              widgets: [
                { type: "trending-radar", customTitle: "全网技术热榜", colSpan: 6, rowSpan: 2 },
                { type: "system-metrics", customTitle: "中枢运行监控", colSpan: 4, rowSpan: 2 },
                { type: "quick-tools", customTitle: "常用工具速达", colSpan: 4, rowSpan: 1 },
                { type: "clock-pomodoro", customTitle: "专注时钟", colSpan: 3, rowSpan: 1 },
              ],
            },
            {
              name: "极客速查",
              widgets: [
                { type: "speculative-terminal", customTitle: "预判终端", colSpan: 4, rowSpan: 1 },
                { type: "markdown-notes", customTitle: "速记台", colSpan: 5, rowSpan: 2 },
                { type: "hyperbolic-radar", customTitle: "双曲技术雷达", colSpan: 5, rowSpan: 2 },
              ],
            },
          ],
        },
      },
    },
    {
      slug: "seed-dusk-compass",
      status: "published",
      manifest: {
        manifestVersion: 1,
        kind: "theme",
        name: "暮色罗盘",
        description:
          "以暮色紫罗兰为强调色的主题：更柔和的圆角与聚焦环色彩，在深色背景下保持清晰层次，适合长时间浏览。",
        icon: "🌆",
        author: "NavHub 官方",
        license: "MIT",
        version: "1.0.0",
        tags: ["主题", "深色", "紫罗兰"],
        payload: {
          accent: "violet",
          tokens: {
            "--primary": "262 83% 58%",
            "--ring": "262 83% 58%",
            "--radius": "0.9rem",
          },
        },
      },
    },
    {
      slug: "seed-dev-efficiency",
      status: "pending",
      manifest: {
        manifestVersion: 1,
        kind: "site-pack",
        name: "开发者效率精选",
        description:
          "编码、调试、文档查阅与排期工具的精简合集。此包以「待审」状态入库，用于演示管理员审核 → 上架的完整链路。",
        icon: "⚡",
        author: "NavHub 官方",
        license: "MIT",
        version: "1.0.0",
        tags: ["开发", "效率", "工具"],
        payload: {
          categories: [{ title: "开发工具", description: "编码、调试与文档查阅" }],
          sites: [
            {
              url: "https://github.com/",
              title: "GitHub",
              description: "全球最大的代码托管与协作平台。",
              category: "开发工具",
              tags: ["代码托管"],
            },
            {
              url: "https://stackoverflow.com/",
              title: "Stack Overflow",
              description: "开发者问答社区，报错信息的第一检索现场。",
              category: "开发工具",
              tags: ["问答"],
            },
            {
              url: "https://developer.mozilla.org/",
              title: "MDN Web Docs",
              description: "Web 标准权威文档，HTML/CSS/JS 的官方参考。",
              category: "开发工具",
              tags: ["文档", "Web"],
            },
            {
              url: "https://devdocs.io/",
              title: "DevDocs",
              description: "多语言 API 文档聚合搜索，离线可用。",
              category: "开发工具",
              tags: ["文档", "检索"],
            },
            {
              url: "https://caniuse.com/",
              title: "Can I use",
              description: "浏览器特性兼容性查询，前端选型的必查项。",
              category: "开发工具",
              tags: ["兼容性"],
            },
            {
              url: "https://regex101.com/",
              title: "regex101",
              description: "正则表达式在线调试与解释器。",
              category: "开发工具",
              tags: ["正则", "调试"],
            },
            {
              url: "https://roadmap.sh/",
              title: "roadmap.sh",
              description: "开发者学习路线图与技能树参考。",
              category: "开发工具",
              tags: ["学习路线"],
            },
            {
              url: "https://crontab.guru/",
              title: "crontab.guru",
              description: "cron 表达式可视化解释与校验。",
              category: "开发工具",
              tags: ["定时任务"],
            },
          ],
        },
      },
    },
  ];
}
