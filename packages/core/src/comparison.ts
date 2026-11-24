/**
 * 端侧 Agentic 竞品并排对比矩阵合成引擎 (Side-by-Side Comparison Engine)
 *
 * 核心设计目标：
 * 当用户在搜索框输入技术对决语法（如 "react vs vue", "cursor vs vscode", "pnpm vs bun"）时，
 * 系统在 0 毫秒内原地解析并合成多维结构化对比看板，消解开发者跨站跳转对比的信息摩擦。
 */

import { isBotBlockedHealthRecord } from "./probe-policy.ts";

/**
 * 逐字段来源三态（Batch 4 Phase 2 P2-5）：
 *   measured        实测——值与站内已核实结构化事实逐字相同；
 *   model_generated 模型生成——LLM 的转述与推断；
 *   unverified      未验证——值为空或“未验证”，无数据支撑。
 * 保守方向写死：匹配失败默认 model_generated，绝不默认 measured。
 */
export type ComparisonProvenance = "measured" | "model_generated" | "unverified";

export interface ComparisonDimension {
  dimName: string;
  valueA: string;
  valueB: string;
  winner?: 'A' | 'B' | 'TIE';
  provenanceA?: ComparisonProvenance;
  provenanceB?: ComparisonProvenance;
}

/** TechComparisonSpec 各字段的逐字段标注（开放文本字段恒为 model_generated，见 assignComparisonProvenance）。 */
export type TechComparisonSpecProvenance = Partial<
  Record<"category" | "license" | "primaryPros" | "tradeoffs" | "bestFor", ComparisonProvenance>
>;

export interface TechComparisonSpec {
  name: string;
  category: string;
  license: string;
  primaryPros: string[];
  tradeoffs: string[];
  bestFor: string;
  provenance?: TechComparisonSpecProvenance;
}

export interface TechComparisonMatrix {
  id: string;
  title: string;
  itemA: TechComparisonSpec;
  itemB: TechComparisonSpec;
  dimensions: ComparisonDimension[];
  verdict: string;
  /** verdict 的来源标注；LLM 路径恒为 model_generated，知识库路径为 measured。 */
  verdictProvenance?: ComparisonProvenance;
  /** true = 模型生成过，false = 未调用模型的结构化对照表；知识库矩阵不填。 */
  aiGenerated?: boolean;
}

export const COMPARISON_KNOWLEDGE_BASE: TechComparisonMatrix[] = [
  {
    id: 'react-vs-vue',
    title: 'React vs Vue.js 架构深度选型对比',
    itemA: {
      name: 'React 19',
      category: '前端基础视图库',
      license: 'MIT',
      primaryPros: ['极庞大生态与社区', 'JSX 高度灵活无模板限制', 'React Server Components 服务端原生创新'],
      tradeoffs: ['需配合大量第三方状态库', 'Hooks 心智负担与重渲染依赖项陷阱'],
      bestFor: '超大型跨团队企业应用、需高自由度架构抽象、跨端 React Native 方案',
    },
    itemB: {
      name: 'Vue 3',
      category: '渐进式前端框架',
      license: 'MIT',
      primaryPros: ['Composition API 响应式极精确', '单文件组件 (SFC) 体验优雅', '官方自带 Router/Pinia/Vite 统一规范'],
      tradeoffs: ['大型跨国企业采纳度略逊于 React', 'JSX 支持不如模板生态成熟'],
      bestFor: '中大型敏捷开发、中文生态优先、追求极低开发与心智门槛的团队',
    },
    dimensions: [
      { dimName: '响应式系统', valueA: '不可变数据 (Immutability) + 虚拟DOM对比', valueB: 'Proxy 细粒度依赖追踪 (Reactivity)', winner: 'B' },
      { dimName: '全栈与SSR', valueA: 'Next.js / Remix 业界主导', valueB: 'Nuxt 3 体验优秀但生态稍小', winner: 'A' },
      { dimName: '生态与招聘', valueA: '全球招聘基数最大', valueB: '国内招聘基数大，全球略少', winner: 'A' },
      { dimName: '上手与心智成本', valueA: '较复杂 (useCallback, useMemo)', valueB: '直观自然 (ref, reactive)', winner: 'B' },
    ],
    verdict: '若团队追求极致敏捷与官方全家桶一致性，首选 Vue 3；若追求全球化生态、深度跨平台（React Native）与前沿 RSC 范式，首选 React。',
  },
  {
    id: 'cursor-vs-vscode',
    title: 'Cursor vs VS Code + Copilot 开发效率对比',
    itemA: {
      name: 'Cursor',
      category: 'AI 原生智能 IDE',
      license: '闭源商业',
      primaryPros: ['Composer 原生跨文件多处精准编辑', '预测性光标 (Tab) 体验惊艳', '可自定义模型或带入 API Key'],
      tradeoffs: ['商业收费订阅', '基于旧版 VS Code 内核升级略微滞后'],
      bestFor: '重度依赖大模型协作重构代码、追求极致开发吞吐率的工程师',
    },
    itemB: {
      name: 'VS Code + Copilot',
      category: '主流扩展式 IDE',
      license: '核心开源 (MIT)',
      primaryPros: ['微软官方长期维护稳定保证', '海量插件市场 100% 原生支持', '企业合规与安全审查成熟'],
      tradeoffs: ['多文件复杂重构能力略弱于 Cursor 原生实现', 'AI 交互较为割裂在侧边栏'],
      bestFor: '严苛企业安全合规审计、轻量辅助代码补全与开源纯粹主义团队',
    },
    dimensions: [
      { dimName: '多文件批量重构', valueA: '原生支持 Agentic Composer 自动定位修改', valueB: '主要依靠单文件或工作区引用提示', winner: 'A' },
      { dimName: '模型灵活性', valueA: '支持 Claude 3.5 Sonnet / GPT-4o / 自定义 Key', valueB: '受限于 GitHub Copilot 官方提供通道', winner: 'A' },
      { dimName: '内核更新与稳定性', valueA: '下游 Fork，依赖官方合并同步', valueB: '微软一手官方源，第一时间享受最新功能', winner: 'B' },
      { dimName: '商业与合规门槛', valueA: '小型创业公司产品，部分大厂风控严格', valueB: '微软+GitHub 企业级背书，合规通过率高', winner: 'B' },
    ],
    verdict: '个人开发与前沿创业团队强烈推荐 Cursor，其 Composer 效率呈代差级领先；严苛安全审计与大厂流水线首选 VS Code 官方套件。',
  },
  {
    id: 'pnpm-vs-bun',
    title: 'pnpm vs Bun 包管理器与运行时选型对比',
    itemA: {
      name: 'pnpm',
      category: '极速且严格的包管理器',
      license: 'MIT',
      primaryPros: ['硬链接与内容寻址存储（CAS）极大节约磁盘', '严格的非扁平 node_modules 杜绝幽灵依赖', 'Monorepo 支持极其成熟'],
      tradeoffs: ['依然运行在 Node.js 之上，安装耗时受 V8 启动制约'],
      bestFor: '复杂的全栈 Monorepo 仓库、注重严谨依赖树的生产部署',
    },
    itemB: {
      name: 'Bun',
      category: 'Zig 编写的 All-in-One 原生运行时',
      license: 'MIT',
      primaryPros: ['极度夸张的原生安装速度（比 npm 快 20-30 倍）', '集成了打包器、测试器与运行时', '瞬时冷启动'],
      tradeoffs: ['部分 Node.js 深层 C++ 原生模块生态偶有兼容缺陷', 'Windows 支持仍在持续打磨'],
      bestFor: '脚本自动化、追求极致安装与测试启动速度、独立服务开发',
    },
    dimensions: [
      { dimName: '幽灵依赖治理', valueA: '严格符号链接隔离，彻底避免偷用未声明依赖', valueB: '扁平化存储，仍可能产生间接依赖暴露', winner: 'A' },
      { dimName: '冷安装吞吐耗时', valueA: '非常快 (远超 npm/yarn)', valueB: '极快 (C/Zig 级底层并发下载与解压)', winner: 'B' },
      { dimName: 'Monorepo 成熟度', valueA: '工业级事实标准 (workspace 协议)', valueB: '正在演进，边缘场景偶尔需要修补', winner: 'A' },
      { dimName: '多合一工具箱功能', valueA: '仅专注于包管理', valueB: '内置 test, run, bundle, 全家桶', winner: 'B' },
    ],
    verdict: '大型复杂团队与生产 Monorepo 优先推荐稳如磐石的 pnpm；本地快速原型验证、轻量脚手架与自动化脚本推荐极速的 Bun。',
  },
  {
    id: 'tailwind-vs-unocss',
    title: 'Tailwind CSS v4 vs UnoCSS 原子化 CSS 选型对比',
    itemA: {
      name: 'Tailwind CSS v4',
      category: '行业标准原子化 CSS 框架',
      license: 'MIT',
      primaryPros: ['v4 采用 Rust 引擎 Oxide 重构，编译极快', 'CSS 优先纯净配置无需 tailwind.config.js', '生态（如 shadcn/ui）统治级支持'],
      tradeoffs: ['定制化语法灵活性稍逊于纯原子正则引擎'],
      bestFor: '主流 UI 组件库体系、生产团队协作、极佳的 VS Code 补全提示',
    },
    itemB: {
      name: 'UnoCSS',
      category: '即时按需原子化 CSS 引擎',
      license: 'MIT',
      primaryPros: ['纯规则驱动，支持任意正则自定义样式属性', '零开销编译，原生支持属性化模式 (attributify)', '生态包袱极轻'],
      tradeoffs: ['主流商业组件生态多优先兼容标准 Tailwind'],
      bestFor: '追求极致自由度、属性化编写模式 (如 text="red bold") 与极限构建速度的团队',
    },
    dimensions: [
      { dimName: '生态与组件库兼容', valueA: '业界通用标准，shadcn 与各类库 100% 适配', valueB: '支持预设兼容，但在部分复杂预设中偶需适配', winner: 'A' },
      { dimName: '规则自由度', valueA: '基于类名模式，约束相对规整', valueB: '完全正则匹配，支持动态数值计算与属性化', winner: 'B' },
      { dimName: '构建引擎性能', valueA: 'v4 Rust 引擎将速度拉升至毫秒级', valueB: '纯内存极速扫描，同样处于毫秒级巅峰', winner: 'TIE' },
    ],
    verdict: '绝大多数开发场景首选 Tailwind v4（尤其是配合 shadcn/ui）；若重度喜爱属性化模式或需要高度自由定制原子化语法，推荐 UnoCSS。',
  },
  {
    id: 'cline-vs-cursor',
    title: 'Cline vs Cursor 自主 Agent 与智能 IDE 对决',
    itemA: {
      name: 'Cline (原 Claude Dev)',
      category: '自主执行型 VS Code Agent 扩展',
      license: '开源 (Apache-2.0)',
      primaryPros: ['直接在终端执行编译与测试指令', '自主查看文件树与循环改错直到通过', '支持接入任意商业或开源模型 (DeepSeek/Ollama)'],
      tradeoffs: ['Token 消耗较大，复杂任务耗时相对更长'],
      bestFor: '端到端复杂 Bug 自动定位修复、长链路自动化任务排查、自主执行流程',
    },
    itemB: {
      name: 'Cursor',
      category: '商业级 AI 深度融合 IDE',
      license: '闭源商业',
      primaryPros: ['预测性代码补全 (Tab) 极度丝滑', 'Composer 交互体验行业标杆', '上手门槛低，日常编码速度提升立竿见影'],
      tradeoffs: ['不可控终端全自主执行能力受限', '官方订阅制成本'],
      bestFor: '日常业务开发主 IDE、高频交互式重构、极速交互补全',
    },
    dimensions: [
      { dimName: '自主终端命令执行', valueA: '原生支持执行 bash/powershell 并根据报错自愈', valueB: '主要提供终端命令建议，需手动确认', winner: 'A' },
      { dimName: '代码补全实时响应', valueA: '专注于侧栏任务与指令', valueB: '毫秒级预测性光标补全', winner: 'B' },
      { dimName: '模型自主度与开源', valueA: '100% 开源，完全自持 API Key', valueB: '商业托管为主', winner: 'A' },
      { dimName: '日常编辑手感与流畅度', valueA: '依赖原生 VS Code 插件生态', valueB: '内核级深度优化，极度跟手', winner: 'B' },
    ],
    verdict: '日常编码打底首选 Cursor 作为主力 IDE；遇到跨目录复杂重构、难以复现的测试死循环或需要全自动闭环的任务，交给 Cline 自主解决。',
  },
  {
    id: 'ollama-vs-vllm',
    title: 'Ollama vs vLLM 本地与高并发大模型推理选型对比',
    itemA: {
      name: 'Ollama',
      category: '极简轻量级本地大模型运行时',
      license: 'MIT',
      primaryPros: ['一键安装与单命令启动 (ollama run)', '对 Mac (Metal) 与普通显卡优化友好', 'Modelfile 配置简单'],
      tradeoffs: ['多用户并发请求吞吐受限，缺乏企业级调度能力'],
      bestFor: '个人开发者本地调试、端侧私有化体验、轻量本地 Agent 外脑',
    },
    itemB: {
      name: 'vLLM',
      category: '高吞吐大模型分布式推理服务框架',
      license: 'Apache-2.0',
      primaryPros: ['自研 PagedAttention 显存零碎片化', '连续批处理 (Continuous Batching) 吞吐高 2-4 倍', '原生兼容 OpenAI 接口'],
      tradeoffs: ['需要较严格的 Linux + CUDA 环境，安装与调优门槛相对较高'],
      bestFor: '生产级 API 服务部署、企业内部多并发大模型集群、高吞吐推理平台',
    },
    dimensions: [
      { dimName: '安装与启动复杂度', valueA: '傻瓜式零门槛 (全平台安装包)', valueB: '需配置 CUDA、Python 环境与编译依赖', winner: 'A' },
      { dimName: '高并发高吞吐性能', valueA: '适合单用户或低并发交互', valueB: 'PagedAttention 业界霸主，吞吐极致', winner: 'B' },
      { dimName: '多模态与开源生态', valueA: '模型库极为丰富 (ollama pull)', valueB: '主流 Hugging Face 权重原生支持', winner: 'TIE' },
    ],
    verdict: '本地个人电脑极速调试、跑小模型与离线私有化首选 Ollama；云端 GPU 服务器构建企业级高并发 API 必须选择 vLLM。',
  },
];

/**
 * 识别并解析用户对比查询
 * 命中语法示例：
 *   "react vs vue", "react 对比 vue", "cursor vs vscode", "pnpm pk bun"
 */
export function parseTechComparisonQuery(query: string): TechComparisonMatrix | null {
  // 截断 200 字符：对比查询是人 typed 的短句；vs 正则的 (.+?) 懒惰匹配在超长输入上
  // 多项式回溯（CodeQL #21），200 字符内回溯量可忽略。
  const q = query.trim().toLowerCase().slice(0, 200);
  if (q.length < 3) return null;

  // 提取两方名称
  const vsPattern = /^(.*?)\s+(?:vs|对比|pk|对决|\/)\s+(.*?)$/i;
  const match = q.match(vsPattern);

  if (match && match[1] && match[2]) {
    const rawA = match[1].trim();
    const rawB = match[2].trim();

    for (const matrix of COMPARISON_KNOWLEDGE_BASE) {
      const idParts = matrix.id.split('-vs-');
      const nameA = idParts[0]?.toLowerCase() ?? '';
      const nameB = idParts[1]?.toLowerCase() ?? '';

      const matchDirect =
        (rawA.includes(nameA) || nameA.includes(rawA)) &&
        (rawB.includes(nameB) || nameB.includes(rawB));
      const matchReversed =
        (rawA.includes(nameB) || nameB.includes(rawA)) &&
        (rawB.includes(nameA) || nameA.includes(rawB));

      if (matchDirect || matchReversed) {
        return annotateKnowledgeBaseMatrix(matrix);
      }
    }
  }

  // 单独匹配 "react 对比" 或 "cursor vs"
  for (const matrix of COMPARISON_KNOWLEDGE_BASE) {
    if (q.includes(matrix.id.replace('-vs-', ' vs ')) || q.includes(matrix.id.replace('-vs-', ' 对比 '))) {
      return annotateKnowledgeBaseMatrix(matrix);
    }
  }

  return null;
}

/* ==================================================================
 * Batch 4 Phase 2 P2-5：动态对比 LLM 改造——LLM 只做翻译，不做裁判。
 *
 * 本文件保持零 import（前端逐字镜像 apps/web-overlay/src/lib/comparison.ts
 * 由 scripts/sync-core-mirrors.mjs 生成）：分面中文 label 不在这里 import，
 * 由调用方把 getFacetOptionLabel 以 facetLabel 选项传进来；不传时回退为
 * 原值（路由层必须传，见 apps/api/src/routes/recipes.ts）。
 * 分类标题同理：core 不查库，由调用方把“分类 id → 标题”以 categoryLabel
 * 选项传进来（路由层查库得标题，见 recipes.ts 无 Key 分支）；不传或查无
 * 标题时，无 Key 结构化表的 category 显示“未验证”，不显示原始 categoryId。
 * ================================================================== */

/**
 * buildStructuredComparisonContext / buildStructuredMatrix 的输入：
 * Site 的结构化子集。故意不用 `import type { Site }`——types.ts 不在前端
 * 镜像里，任何 import（哪怕 type-only）都会让前端 tsc 找不到模块。
 * Site 在结构上可直接传入。
 */
export interface StructuredComparisonSiteInput {
  title: string;
  url: string;
  description?: string | null;
  categoryId?: string | null;
  facets?: Record<string, string[]> | null;
  health?: { ok: boolean; lastCheckedAt?: number | null; error?: string | null } | null;
  updatedAt?: number | null;
}

export interface StructuredComparisonSide {
  title: string | null;
  url: string | null;
  description: string | null;
  categoryId: string | null;
  /** 付费模式中文 label（已去重；"unknown" 不是已核实事实，直接去掉）。空 = 未核实。 */
  pricing: string[];
  /** 支持平台中文 label 数组。空 = 未核实。 */
  platform: string[];
  /** 产品形态中文 label 数组。空 = 未核实。 */
  form: string[];
  /**
   * 是否还在维护：只信 lastCheckedAt（与 site-comparison.ts 的 maintenanceCell
   * 同规则——health.ok 为 NULL 时折为 false，与巡检失败不可区分）。
   * 从未巡检过为 null。
   */
  maintenance: { status: "可达" | "不可达"; lastCheckedAt: number } | null;
}

export interface StructuredComparisonContext {
  /** null = 该侧未收录（站内无此工具条目）。 */
  sideA: StructuredComparisonSide | null;
  sideB: StructuredComparisonSide | null;
  /** 规范串（查询顺序 A→B）：prompt 的结构化事实输入。 */
  text: string;
  /**
   * 缓存指纹输入：两侧事实块排序后拼接——与 text 的唯一区别是顺序无关，
   * 保证 "A vs B" 与 "B vs A" 命中同一缓存（pairKey 已排序，与旧行为一致）。
   * 分面改了、健康巡检更新了，指纹即变，旧矩阵失效。
   */
  fingerprint: string;
}

export interface StructuredComparisonOptions {
  /** 分面值 → 中文 label；默认原样返回（路由层传 getFacetOptionLabel）。 */
  facetLabel?: (key: string, value: string) => string;
  /**
   * 分类 id → 分类标题；默认无标题。由路由层查库后传入（core 不查库）；
   * 不传、返回空串或查无此分类时，无 Key 结构化表的 category 显示“未验证”。
   */
  categoryLabel?: (categoryId: string) => string | null | undefined;
}

const UNVERIFIED = "未验证";

function facetLabels(
  facets: Record<string, string[]> | null | undefined,
  key: string,
  label: (k: string, v: string) => string,
): string[] {
  const raw = (facets?.[key] ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    // pricing 的 "unknown" 是数据完备性标记（尚未核实标注），不是已核实事实。
    if (key === "pricing" && v === "unknown") continue;
    const l = label(key, v);
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}

function toStructuredSide(
  hit: StructuredComparisonSiteInput | null,
  label: (k: string, v: string) => string,
): StructuredComparisonSide | null {
  if (!hit) return null;
  const lastCheckedAt = hit.health?.lastCheckedAt ?? null;
  return {
    title: hit.title,
    url: hit.url,
    description: hit.description ?? null,
    categoryId: hit.categoryId ?? null,
    pricing: facetLabels(hit.facets, "pricing", label),
    platform: facetLabels(hit.facets, "platform", label),
    form: facetLabels(hit.facets, "form", label),
    maintenance:
      lastCheckedAt == null || isBotBlockedHealthRecord(hit.health?.error)
        ? null
        : { status: hit.health?.ok ? "可达" : "不可达", lastCheckedAt },
  };
}

function sideFactLines(side: StructuredComparisonSide | null): string[] {
  if (!side) return ["未收录：站内无此工具的条目，以下事实均未验证"];
  const maintenance = side.maintenance
    ? `${side.maintenance.status}（最后核实于 ${new Date(side.maintenance.lastCheckedAt).toISOString().slice(0, 10)}）`
    : UNVERIFIED;
  return [
    `- 标题：${side.title ?? UNVERIFIED}`,
    `- 网址：${side.url ?? UNVERIFIED}`,
    `- 描述：${side.description?.trim() ? side.description : UNVERIFIED}`,
    `- 分类 ID：${side.categoryId ?? UNVERIFIED}`,
    `- 付费模式：${side.pricing.length > 0 ? side.pricing.join("、") : UNVERIFIED}`,
    `- 支持平台：${side.platform.length > 0 ? side.platform.join("、") : UNVERIFIED}`,
    `- 产品形态：${side.form.length > 0 ? side.form.join("、") : UNVERIFIED}`,
    `- 是否还在维护：${maintenance}`,
  ];
}

function sideBlock(side: StructuredComparisonSide | null, tag: "A" | "B"): string {
  return [`【${tag}·站内已核实事实】`, ...sideFactLines(side)].join("\n");
}

/**
 * 第 1 步：结构化取数。公开站数据，不取用户备注/标签/价格数值
 * （本路由是 public scope；P2-2 的价格是 per-owner 数据，公开路由无权用）。
 */
export function buildStructuredComparisonContext(
  hitA: StructuredComparisonSiteInput | null,
  hitB: StructuredComparisonSiteInput | null,
  opts?: StructuredComparisonOptions,
): StructuredComparisonContext {
  const label = opts?.facetLabel ?? ((_k: string, v: string) => v);
  const sideA = toStructuredSide(hitA, label);
  const sideB = toStructuredSide(hitB, label);
  const blockA = sideBlock(sideA, "A");
  const blockB = sideBlock(sideB, "B");
  return {
    sideA,
    sideB,
    text: `${blockA}\n${blockB}`,
    // 指纹用去位置标记的事实行排序拼接：块头【A/B】是查询顺序的标记，
    // 跟着位置走会让对调后的两块排完序仍不同，指纹也就失去了对称性。
    fingerprint: [sideFactLines(sideA).join("\n"), sideFactLines(sideB).join("\n")].sort().join("\n"),
  };
}

/** prompt 硬指令：测试断言其逐字存在（见 comparison-provenance.test.ts）。 */
export const DYNAMIC_COMPARISON_HARD_RULES =
  "只转述以下结构化事实；结构化事实里没有的，写‘未验证’，不许编造；不许新增对照维度；winner 只能取 A / B / TIE，依据不足时取 TIE。";

/** LLM 路径允许的对照维度（白名单）：模型新增的维度服务端直接丢弃。 */
export const DYNAMIC_COMPARISON_DIMENSIONS = ["核心能力", "免费与性价比", "上手与生态"] as const;

/**
 * 第 1 步：prompt 组装。结构化事实是唯一对照依据；title/url/description
 * 降为补充上下文（仅供参考，不作为对照依据）。
 */
export function buildDynamicComparisonPrompt(
  rawA: string,
  rawB: string,
  context: StructuredComparisonContext,
  infoA: string,
  infoB: string,
): string {
  return `你是工具选型评测专家。请针对「${rawA}」与「${rawB}」进行精炼并排对比。

【站内已核实结构化事实】
${context.text}

【补充上下文（仅供参考：标题/网址/描述，不作为对照依据）】
- A参考: ${infoA}
- B参考: ${infoB}

硬指令：${DYNAMIC_COMPARISON_HARD_RULES}

请严格返回以下 JSON 结构（文字简明扼要）：
{
  "id": "ai-cmp-slug",
  "title": "${rawA} vs ${rawB} 深度选型对比",
  "itemA": {
    "name": "${rawA}",
    "category": "所属品类",
    "license": "免费/订阅模式",
    "primaryPros": ["优势1", "优势2"],
    "tradeoffs": ["局限1"],
    "bestFor": "最适合人群与场景（25字内）"
  },
  "itemB": {
    "name": "${rawB}",
    "category": "所属品类",
    "license": "免费/订阅模式",
    "primaryPros": ["优势1", "优势2"],
    "tradeoffs": ["局限1"],
    "bestFor": "最适合人群与场景（25字内）"
  },
  "dimensions": [
    { "dimName": "核心能力", "valueA": "A表现（15字内）", "valueB": "B表现（15字内）", "winner": "A" },
    { "dimName": "免费与性价比", "valueA": "A定价（15字内）", "valueB": "B定价（15字内）", "winner": "B" },
    { "dimName": "上手与生态", "valueA": "A体验（15字内）", "valueB": "B体验（15字内）", "winner": "TIE" }
  ],
  "verdict": "终极选型建议：何时选 ${rawA}，何时选 ${rawB}（45字内）"
}`;
}

/* ------------------------------------------------------------------
 * 第 2 步：三态标注（服务端定夺，不信任模型自标）。
 *
 * 规则（保守方向写死）：
 *  - 闭合词汇字段（license / category / 维度值）：与结构化上下文**精确
 *    匹配**（分面 label 全等或健康状态全等）→ measured；否则 model_generated。
 *    精确匹配不是启发式猜测：measured 当且仅当值逐字等于一条已核实事实，
 *    此时值本身就是那条事实，误标成 measured 的唯一可能是模型恰好逐字
 *    复述了事实——那仍是事实。改述、发挥、拼凑一律落 model_generated；
 *    误标方向只朝保守，不朝 measured。
 *  - 开放文本字段（primaryPros / tradeoffs / bestFor / verdict）：恒为
 *    model_generated（转述与推断，定义如此），即使逐字撞上事实也不升格。
 *  - 值为空或“未验证”→ unverified。
 *  - 模型自己在 JSON 里标的 provenance 一律忽略：本函数只读值字段，
 *    从头重算，从不读入参的任何 provenance 键。
 *  - 缺标注的字段服务端直接丢弃：见 isComparisonMatrixFullyAnnotated，
 *    路由层对标注不完整的矩阵按无结果处理、不缓存（本函数本身是全函数，
 *    每个字段必有标注；该判定是防御层）。
 * ------------------------------------------------------------------ */

/** 一侧的闭合词汇集合：已核实事实的逐字原文（分面 label + 健康状态 + 分类 ID）。 */
function closedVocabulary(side: StructuredComparisonSide | null): Set<string> {
  const set = new Set<string>();
  if (!side) return set;
  for (const v of side.pricing) set.add(v);
  for (const v of side.platform) set.add(v);
  for (const v of side.form) set.add(v);
  if (side.maintenance) set.add(side.maintenance.status);
  if (side.categoryId) set.add(side.categoryId);
  return set;
}

function classifyClosedValue(value: string | null | undefined, closed: Set<string>): ComparisonProvenance {
  const v = (value ?? "").trim();
  if (!v || v === UNVERIFIED) return "unverified";
  return closed.has(v) ? "measured" : "model_generated";
}

function classifyOpenText(value: string | string[] | null | undefined): ComparisonProvenance {
  if (Array.isArray(value)) return value.length === 0 ? "unverified" : "model_generated";
  const v = (value ?? "").trim();
  return !v || v === UNVERIFIED ? "unverified" : "model_generated";
}

function annotateSpec(
  spec: TechComparisonSpec,
  closed: Set<string>,
): TechComparisonSpec {
  return {
    name: spec.name,
    category: spec.category,
    license: spec.license,
    primaryPros: Array.isArray(spec.primaryPros) ? spec.primaryPros : [],
    tradeoffs: Array.isArray(spec.tradeoffs) ? spec.tradeoffs : [],
    bestFor: spec.bestFor,
    provenance: {
      category: classifyClosedValue(spec.category, closed),
      license: classifyClosedValue(spec.license, closed),
      primaryPros: classifyOpenText(spec.primaryPros),
      tradeoffs: classifyOpenText(spec.tradeoffs),
      bestFor: classifyOpenText(spec.bestFor),
    },
  };
}

export function assignComparisonProvenance(
  matrix: TechComparisonMatrix,
  context: StructuredComparisonContext,
  opts?: { source?: "knowledge_base" | "llm" },
): TechComparisonMatrix {
  // 短路（协调人已定，方案二）：知识库矩阵是站方写死内容，来源即站方，
  // 全字段 measured；不伪造基准上下文。注意不改 COMPARISON_KNOWLEDGE_BASE
  // 原对象（返回全新深拷贝），且 verdict 在此路径同样为 measured——
  // 它是站方写死的结论句，不是模型输出。
  if (opts?.source === "knowledge_base") {
    const measuredSpec = (spec: TechComparisonSpec): TechComparisonSpec => ({
      name: spec.name,
      category: spec.category,
      license: spec.license,
      primaryPros: [...spec.primaryPros],
      tradeoffs: [...spec.tradeoffs],
      bestFor: spec.bestFor,
      provenance: {
        category: "measured",
        license: "measured",
        primaryPros: "measured",
        tradeoffs: "measured",
        bestFor: "measured",
      },
    });
    return {
      id: matrix.id,
      title: matrix.title,
      itemA: measuredSpec(matrix.itemA),
      itemB: measuredSpec(matrix.itemB),
      dimensions: matrix.dimensions.map((d) => ({
        dimName: d.dimName,
        valueA: d.valueA,
        valueB: d.valueB,
        winner: d.winner,
        provenanceA: "measured",
        provenanceB: "measured",
      })),
      verdict: matrix.verdict,
      verdictProvenance: "measured",
      aiGenerated: matrix.aiGenerated,
    };
  }

  const closedA = closedVocabulary(context.sideA);
  const closedB = closedVocabulary(context.sideB);
  return {
    id: matrix.id,
    title: matrix.title,
    itemA: annotateSpec(matrix.itemA, closedA),
    itemB: annotateSpec(matrix.itemB, closedB),
    dimensions: matrix.dimensions.map((d) => ({
      dimName: d.dimName,
      valueA: d.valueA,
      valueB: d.valueB,
      winner: d.winner,
      provenanceA: classifyClosedValue(d.valueA, closedA),
      provenanceB: classifyClosedValue(d.valueB, closedB),
    })),
    // verdict 恒为 model_generated（LLM 路径）：它是选型推断，不是事实转述。
    verdict: matrix.verdict,
    verdictProvenance: classifyOpenText(matrix.verdict),
    aiGenerated: matrix.aiGenerated,
  };
}

/** 知识库矩阵出口：parseTechComparisonQuery 命中即带上全字段 measured 标注。 */
function annotateKnowledgeBaseMatrix(matrix: TechComparisonMatrix): TechComparisonMatrix {
  return assignComparisonProvenance(matrix, { sideA: null, sideB: null, text: "", fingerprint: "" }, { source: "knowledge_base" });
}

/** 标注完整性判定：任一字段缺 provenance 即不完整（缓存读到即视为 miss）。 */
export function isComparisonMatrixFullyAnnotated(matrix: TechComparisonMatrix): boolean {
  const specKeys = ["category", "license", "primaryPros", "tradeoffs", "bestFor"] as const;
  for (const spec of [matrix.itemA, matrix.itemB]) {
    if (!spec.provenance) return false;
    for (const k of specKeys) {
      if (!spec.provenance[k]) return false;
    }
  }
  for (const d of matrix.dimensions) {
    if (!d.provenanceA || !d.provenanceB) return false;
  }
  return matrix.verdictProvenance != null;
}

/* ------------------------------------------------------------------
 * 第 3 步：无 Key 结构化对照表（不调模型，只列站内已核实字段）。
 * ------------------------------------------------------------------ */

/** 无 Key 矩阵的 verdict 固定句（模板句，诚实标 model_generated）。 */
export const STRUCTURED_COMPARISON_VERDICT = "未调用模型，仅列出站内已核实字段";

/** 结构化对照表的维度：分面/健康度的并集（固定顺序）。 */
export const STRUCTURED_COMPARISON_DIMENSIONS = ["付费模式", "支持平台", "产品形态", "是否还在维护"] as const;

function structuredSideValue(side: StructuredComparisonSide | null, dim: (typeof STRUCTURED_COMPARISON_DIMENSIONS)[number]): string {
  if (!side) return UNVERIFIED;
  switch (dim) {
    case "付费模式":
      return side.pricing.length > 0 ? side.pricing.join("、") : UNVERIFIED;
    case "支持平台":
      return side.platform.length > 0 ? side.platform.join("、") : UNVERIFIED;
    case "产品形态":
      return side.form.length > 0 ? side.form.join("、") : UNVERIFIED;
    case "是否还在维护":
      return side.maintenance ? side.maintenance.status : UNVERIFIED;
  }
}

function structuredSpec(
  side: StructuredComparisonSide | null,
  fallbackName: string,
  categoryLabel?: (categoryId: string) => string | null | undefined,
): TechComparisonSpec {
  // category 只显示分类标题，不显示原始 categoryId：标题由调用方以
  // categoryLabel 选项传入；无标题（未传 / 查无此分类 / 空串）时标“未验证”，
  // provenance 同步为 unverified——无标题即无已核实事实可展示。
  const categoryTitle = side?.categoryId ? categoryLabel?.(side.categoryId)?.trim() : undefined;
  const category = categoryTitle ? categoryTitle : UNVERIFIED;
  const license = side && side.pricing.length > 0 ? side.pricing[0]! : UNVERIFIED;
  return {
    name: side?.title ?? fallbackName,
    category,
    license,
    primaryPros: [],
    tradeoffs: [],
    bestFor: UNVERIFIED,
    provenance: {
      category: categoryTitle ? "measured" : "unverified",
      license: license === UNVERIFIED ? "unverified" : "measured",
      primaryPros: "unverified",
      tradeoffs: "unverified",
      bestFor: "unverified",
    },
  };
}

export function buildStructuredMatrix(
  hitA: StructuredComparisonSiteInput | null,
  hitB: StructuredComparisonSiteInput | null,
  nameA?: string,
  nameB?: string,
  opts?: StructuredComparisonOptions,
): TechComparisonMatrix {
  const context = buildStructuredComparisonContext(hitA, hitB, opts);
  const labelA = nameA ?? hitA?.title ?? UNVERIFIED;
  const labelB = nameB ?? hitB?.title ?? UNVERIFIED;
  return {
    id: `structured:${labelA}__vs__${labelB}`,
    title: `${labelA} vs ${labelB} 站内已核实对照`,
    itemA: structuredSpec(context.sideA, labelA, opts?.categoryLabel),
    itemB: structuredSpec(context.sideB, labelB, opts?.categoryLabel),
    // winner 一律省略：无模型裁决，不分胜负。
    dimensions: STRUCTURED_COMPARISON_DIMENSIONS.map((dimName) => {
      const valueA = structuredSideValue(context.sideA, dimName);
      const valueB = structuredSideValue(context.sideB, dimName);
      return {
        dimName,
        valueA,
        valueB,
        provenanceA: valueA === UNVERIFIED ? "unverified" : "measured",
        provenanceB: valueB === UNVERIFIED ? "unverified" : "measured",
      };
    }),
    verdict: STRUCTURED_COMPARISON_VERDICT,
    verdictProvenance: "model_generated",
    aiGenerated: false,
  };
}
