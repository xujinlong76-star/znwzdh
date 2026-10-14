/**
 * Graph-RAG 多跳技术栈链路配方引擎 (Architecture Stack Recipe Engine)
 *
 * 核心设计目标：
 * 终结传统网址导航孤立、割裂的单点搜索形态。
 * 当用户需要搭建特定系统（协同文档、本地大模型、全栈Web、微前端、高可用监控）时，
 * 系统在领域知识图谱中执行多跳子图遍历，直接合成端到端架构链路配方（Architecture Recipe）。
 */

export interface StackLayer {
  layerName: string;
  category: string;
  recommended: {
    id: string;
    title: string;
    url: string;
    description: string;
    highlights: string[];
  };
  alternatives: Array<{
    id: string;
    title: string;
    url: string;
  }>;
}

export interface ArchitectureRecipe {
  id: string;
  title: string;
  targetGoal: string;
  description: string;
  keywords: string[];
  layers: StackLayer[];
  quickStartSnippet?: string;
}

export const PRESET_RECIPES: ArchitectureRecipe[] = [
  {
    id: 'collaborative-editor',
    title: '现代化实时协同富文本/白板系统',
    targetGoal: '支持多人在线高并发无冲突协同编辑的文档平台',
    description: '采用 CRDT 算法驱动无中心数据收敛，结合 WebSocket 专有网关与分层富文本引擎。',
    keywords: ['协同', '协同文档', '协作', '白板', 'yjs', 'crdt', 'tiptap', 'collaborative'],
    layers: [
      {
        layerName: '1. UI 编辑与画布展现层',
        category: 'UI/Editor',
        recommended: {
          id: 'tiptap',
          title: 'TipTap (基于 ProseMirror)',
          url: 'https://tiptap.dev',
          description: '无头高度可定制富文本框架，天然集成 Yjs 协同扩展。',
          highlights: ['Headless 设计', '丰富插件生态', 'TypeScript 严密类型'],
        },
        alternatives: [
          { id: 'lexical', title: 'Lexical (Meta 开源)', url: 'https://lexical.dev' },
          { id: 'fabric', title: 'Fabric.js (画布白板)', url: 'http://fabricjs.com' },
        ],
      },
      {
        layerName: '2. 数据模型与 CRDT 冲突收敛层',
        category: 'CRDT/Data',
        recommended: {
          id: 'yjs',
          title: 'Yjs (高性能 CRDT 框架)',
          url: 'https://yjs.dev',
          description: '业界性能最顶尖的无冲突复制数据类型，支持增量状态向量同步。',
          highlights: ['微秒级合并速度', '紧凑二进制协议', '支持撤销重做堆栈'],
        },
        alternatives: [
          { id: 'automerge', title: 'Automerge (Rust/Wasm)', url: 'https://automerge.org' },
          { id: 'loro', title: 'Loro (超高性能 CRDT)', url: 'https://loro.dev' },
        ],
      },
      {
        layerName: '3. 信令广播与长连接网关层',
        category: 'Gateway/WebSocket',
        recommended: {
          id: 'hocuspocus',
          title: 'Hocuspocus (Node.js Yjs 服务端)',
          url: 'https://tiptap.dev/hocuspocus',
          description: '开箱即用的 Yjs 协同后端网关，支持鉴权钩子与持久化扩展。',
          highlights: ['Webhook 支持', 'Redis 广播集群扩展', '鉴权直连'],
        },
        alternatives: [
          { id: 'liveblocks', title: 'Liveblocks (托管云服务)', url: 'https://liveblocks.io' },
          { id: 'partykit', title: 'PartyKit (Cloudflare Workers 边缘协同)', url: 'https://partykit.io' },
        ],
      },
      {
        layerName: '4. 状态持久化与快照存储层',
        category: 'Storage',
        recommended: {
          id: 'postgres',
          title: 'PostgreSQL + Prisma / Drizzle',
          url: 'https://www.postgresql.org',
          description: '关系型数据库存储用户鉴权与元数据，结合二进制列存储 Yjs 文档快照。',
          highlights: ['ACID 强一致性', '二进制 Blob 存储', '成熟生态'],
        },
        alternatives: [
          { id: 'sqlite', title: 'SQLite / Turso (嵌入式轻量)', url: 'https://turso.tech' },
          { id: 's3', title: 'MinIO / Cloudflare R2 (对象存储归档)', url: 'https://min.io' },
        ],
      },
    ],
    quickStartSnippet: 'pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-collaboration yjs y-websocket',
  },
  {
    id: 'local-rag-agent',
    title: '端侧私有化 Agent 与本地 RAG 知识库',
    targetGoal: '零外网泄露、纯离线部署的企业私有知识库与推理中枢',
    description: '结合轻量量化大模型推理引擎与高性能本地嵌入模型，实现离线可运行问答检索。',
    keywords: ['rag', '知识库', '本地大模型', '私有化', 'agent', 'ollama', 'qdrant', '向量搜索'],
    layers: [
      {
        layerName: '1. 本地大语言模型运行底座',
        category: 'Model Inference',
        recommended: {
          id: 'ollama',
          title: 'Ollama',
          url: 'https://ollama.com',
          description: '轻量易用的本地大模型管理工具，开箱即用支持 Llama 3 / DeepSeek / Qwen。',
          highlights: ['支持 GGUF 4-bit 量化', 'OpenAI 兼容 API', '一键拉取运行'],
        },
        alternatives: [
          { id: 'vllm', title: 'vLLM (企业高并发推理)', url: 'https://github.com/vllm-project/vllm' },
          { id: 'lmstudio', title: 'LM Studio (桌面 GUI)', url: 'https://lmstudio.ai' },
        ],
      },
      {
        layerName: '2. 密集向量嵌入模型 (Embedding)',
        category: 'Embeddings',
        recommended: {
          id: 'bge',
          title: 'BAAI BGE-small-zh-v1.5 / BGE-M3',
          url: 'https://huggingface.co/BAAI/bge-small-zh-v1.5',
          description: '中文语义检索表现顶尖的稠密嵌入模型，量化后仅需数十兆内存。',
          highlights: ['中文语义高分', '支持 ONNX Runtime 极速前向', '512/1024 维'],
        },
        alternatives: [
          { id: 'nomic', title: 'Nomic Embed Text', url: 'https://nomic.ai' },
          { id: 'jina', title: 'Jina Embeddings v3', url: 'https://jina.ai' },
        ],
      },
      {
        layerName: '3. 向量存储与混合检索数据库',
        category: 'Vector Database',
        recommended: {
          id: 'qdrant',
          title: 'Qdrant (Rust 原生高性能向量数据库)',
          url: 'https://qdrant.tech',
          description: '专为 RAG 设计的高吞吐向量数据库，内置先进的负载过滤与 HNSW 索引。',
          highlights: ['内存压缩技术', '即时负载过滤', '支持本地内嵌或 Docker'],
        },
        alternatives: [
          { id: 'chroma', title: 'ChromaDB (轻量 Python 原生)', url: 'https://trychroma.com' },
          { id: 'milvus', title: 'Milvus (超大规模分布式)', url: 'https://milvus.io' },
          { id: 'pgvector', title: 'pgvector (PostgreSQL 扩展)', url: 'https://github.com/pgvector/pgvector' },
        ],
      },
      {
        layerName: '4. 编排流水线与 Agent 框架',
        category: 'Orchestration',
        recommended: {
          id: 'langchain',
          title: 'LangChain / LangGraph',
          url: 'https://langchain.com',
          description: '行业标准级 Agent 编排框架，支持多步决策循环、重排（Rerank）与知识切片。',
          highlights: ['丰富的 Loader 生态', '支持图状态机循环', '完善评估工具'],
        },
        alternatives: [
          { id: 'llamaindex', title: 'LlamaIndex (专注于复杂数据索引)', url: 'https://llamaindex.ai' },
          { id: 'difiy', title: 'Dify (可视化无代码工作流)', url: 'https://dify.ai' },
        ],
      },
    ],
    quickStartSnippet: 'ollama run qwen2.5:7b && docker run -p 6333:6333 qdrant/qdrant',
  },
  {
    id: 'modern-fullstack-web',
    title: '现代化极速全栈 Web 应用架构',
    targetGoal: '极致开发者体验、首屏近乎零等待、类型安全贯穿前后端的生产架构',
    description: '采用 React Server Components + 边缘运行时 + 零成本类型推导 ORM 与自动化 UI 组件。',
    keywords: ['全栈', 'fullstack', 'nextjs', 'tailwind', 'typescript', 'drizzle', 'react'],
    layers: [
      {
        layerName: '1. 全栈前端与 SSR 框架',
        category: 'Framework',
        recommended: {
          id: 'nextjs',
          title: 'Next.js 15 (App Router)',
          url: 'https://nextjs.org',
          description: '行业事实标准的 React 全栈框架，深度支持流式渲染与服务端组件。',
          highlights: ['React 19 支持', 'Server Actions 简化数据交互', '边缘运行时'],
        },
        alternatives: [
          { id: 'remix', title: 'Remix / React Router v7', url: 'https://remix.run' },
          { id: 'astro', title: 'Astro (内容导向群岛架构)', url: 'https://astro.build' },
        ],
      },
      {
        layerName: '2. 样式与设计组件体系',
        category: 'Styling & UI',
        recommended: {
          id: 'shadcn',
          title: 'Tailwind CSS v4 + shadcn/ui',
          url: 'https://ui.shadcn.com',
          description: '代码直接拷贝至仓库的无头可访问性组件库，杜绝黑盒 NPM 包束缚。',
          highlights: ['Radix UI 无障碍', '100% 源码可控', 'Tailwind v4 高性能引擎'],
        },
        alternatives: [
          { id: 'chakra', title: 'Chakra UI', url: 'https://chakra-ui.com' },
          { id: 'ant-design', title: 'Ant Design', url: 'https://ant.design' },
        ],
      },
      {
        layerName: '3. 数据库与类型安全 ORM',
        category: 'Database & ORM',
        recommended: {
          id: 'drizzle',
          title: 'Drizzle ORM',
          url: 'https://orm.drizzle.team',
          description: '轻量零开销的 TypeScript ORM，语法贴近原生 SQL，冷启动速度极快。',
          highlights: ['极小 Bundle 体积', '完全类型安全', '零代码生成包袱'],
        },
        alternatives: [
          { id: 'prisma', title: 'Prisma (DX 极佳但体积较大)', url: 'https://www.prisma.io' },
          { id: 'kysely', title: 'Kysely (类型安全 SQL 查询构建器)', url: 'https://kysely.dev' },
        ],
      },
      {
        layerName: '4. 部署与边缘基础设施',
        category: 'DevOps / Hosting',
        recommended: {
          id: 'cloudflare',
          title: 'Cloudflare Pages / Workers',
          url: 'https://workers.cloudflare.com',
          description: '覆盖全球 300+ 城市的极低延迟边缘计算平台，免费额度极高。',
          highlights: ['全球 Anycast 网络', '零冷启动开销', 'D1/KV/R2 完整边缘生态'],
        },
        alternatives: [
          { id: 'vercel', title: 'Vercel (与 Next.js 完美集成)', url: 'https://vercel.com' },
          { id: 'flyio', title: 'Fly.io (容器近边缘部署)', url: 'https://fly.io' },
        ],
      },
    ],
    quickStartSnippet: 'npx create-next-app@latest my-app --typescript --tailwind --app',
  },
];

/**
 * 根据查询词匹配最佳技术栈配方 (Graph-RAG Subgraph Matcher)
 */
export function findMatchingArchitectureRecipe(query: string): ArchitectureRecipe | null {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return null;

  for (const recipe of PRESET_RECIPES) {
    if (recipe.title.toLowerCase().includes(q) || recipe.targetGoal.toLowerCase().includes(q)) {
      return recipe;
    }
    for (const kw of recipe.keywords) {
      if (q.includes(kw) || kw.includes(q)) {
        return recipe;
      }
    }
  }

  return null;
}
