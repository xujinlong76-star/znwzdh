/**
 * 浏览器端竞品对比矩阵适配器 (Browser-side Comparison Adapter)
 */

export interface ComparisonDimension {
  dimName: string;
  valueA: string;
  valueB: string;
  winner?: 'A' | 'B' | 'TIE';
}

export interface TechComparisonSpec {
  name: string;
  category: string;
  license: string;
  primaryPros: string[];
  tradeoffs: string[];
  bestFor: string;
}

export interface TechComparisonMatrix {
  id: string;
  title: string;
  itemA: TechComparisonSpec;
  itemB: TechComparisonSpec;
  dimensions: ComparisonDimension[];
  verdict: string;
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
      { dimName: '响应式系统', valueA: '不可变数据 + 虚拟DOM对比', valueB: 'Proxy 细粒度依赖追踪 (Reactivity)', winner: 'B' },
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
      bestFor: '追求极致自由度、属性化编写模式与极限构建速度的团队',
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

export function parseTechComparisonQuery(query: string): TechComparisonMatrix | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;

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
        return matrix;
      }
    }
  }

  for (const matrix of COMPARISON_KNOWLEDGE_BASE) {
    if (q.includes(matrix.id.replace('-vs-', ' vs ')) || q.includes(matrix.id.replace('-vs-', ' 对比 '))) {
      return matrix;
    }
  }

  return null;
}
