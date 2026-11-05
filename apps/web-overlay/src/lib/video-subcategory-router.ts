/**
 * Intelligent Subcategory Router & Semantic Classifier
 * 智能子分类语义路由、技术栈标签萃取与模糊相似度去重引擎
 */

import type { NavigationSubCategory, NavigationSubItem } from '@/types/navigation'

export interface SubcategoryMatchResult {
  targetSub: NavigationSubCategory
  score: number
  matchedKeywords: string[]
  matchReason: string
}

/** 36 个核心技术子方向的强关联技术词表 */
const SUBCATEGORY_DOMAIN_LEXICON: Record<string, string[]> = {
  // AI 与大模型工程
  '大模型与本地部署推理': [
    'ollama', 'vllm', 'deepseek', 'llama', '本地部署', '蒸馏', '量化', 'gpt',
    '模型微调', 'gguf', 'unsloth', 'sft', 'lora', '微调', '推理加速', 'rwkv', 'chatgpt'
  ],
  'AI Agent 与智能编程工作流': [
    'agent', '智能体', 'cursor', 'copilot', 'mcp', 'autogen', 'crewai', '编程助手',
    'prompt', 'workflow', '工作流', 'dify', 'coze', 'n8n', 'cline', 'windsurf', 'rag'
  ],
  '深度学习与模型算法精粹': [
    'pytorch', 'transformer', '神经网络', '深度学习', '强化学习', 'rlhf', '损失函数',
    '卷积', 'cnn', 'rnn', 'attention', '注意力机制', '梯度下降', 'backprop', 'diffusion'
  ],

  // 现代全栈与微服务架构
  '现代前端与 React/Vue 生态': [
    'react', 'vue', 'next.js', 'nuxt', 'tailwind', 'vite', 'css', 'html', '前端',
    'zustand', 'redux', 'pinia', '组件库', 'shadcn', 'ui', 'astro', 'svelte'
  ],
  '后端微服务与企业级实战': [
    'springboot', 'springcloud', 'nestjs', '后端', '微服务', 'rpc', 'grpc', '架构',
    '分布式事务', '消息总线', '中间件', 'dubbo', 'gateway', '网关', 'auth'
  ],
  '语言进阶与工程化架构': [
    'typescript', 'ts', 'es6', '函数式编程', '设计模式', 'monorepo', '性能优化',
    '编译原理', 'ast', '规范', '重构', 'turborepo', 'pnpm', 'eslint', 'prettier'
  ],

  // 云原生与 DevOps 实战
  'Docker 容器与 Kubernetes 编排': [
    'docker', 'k8s', 'kubernetes', '容器', 'pod', 'helm', 'ingress', 'containerd',
    '镜像', 'dockerfile', 'cni', 'csi', 'kubelet', '集群'
  ],
  '网络可观测与服务网格': [
    'ebpf', 'prometheus', 'grafana', 'istio', 'cilium', '可观测', '链路追踪',
    'jaeger', '监控', 'skywalking', 'opentelemetry', 'otel', 'envoy', 'metrics', 'loki'
  ],
  'CI/CD 自动化与 IaC 基础设施': [
    'cicd', 'ci/cd', 'gitlab', 'github actions', 'terraform', 'ansible', 'iac',
    '自动化', '流水线', 'gitops', 'argo', 'jenkins', 'devops', '运维'
  ],

  // 系统底层与高性能计算
  'Rust 系统级开发与并发': [
    'rust', 'tokio', 'cargo', 'actix', '内存安全', '所有权', '生命周期', 'unsafe',
    'axum', 'pin', 'async', 'rayon', 'rustc'
  ],
  'Go 语言底层与高并发实战': [
    'golang', 'go语言', 'gin', 'gorm', 'channel', 'goroutine', '协程', 'gc',
    '并发编程', 'pprof', 'GMP', 'context', 'sync'
  ],
  '操作系统内核与 GPU 并行计算': [
    'kernel', '内核', 'linux', '操作系统', 'os', 'c++', 'gpu', 'cuda', 'webgpu',
    'simd', '汇编', '驱动', '底层', 'vulkan', 'opengl', '内存管理'
  ],

  // 现代存储引擎与海量数据架构
  '关系型数据库与高性能缓存': [
    'mysql', 'postgresql', 'pg', 'redis', '缓存', 'sql优化', '事务', '锁',
    'mvcc', '索引优化', 'b+树', '分库分表', '主从复制'
  ],
  'OLAP 列存分析与实时流计算': [
    'clickhouse', 'doris', 'starrocks', 'flink', 'spark', 'kafka', '数仓',
    '数据湖', '列存', '实时计算', 'iceberg', 'hudi', 'etl'
  ],
  '向量检索与分布式 NoSQL': [
    'milvus', 'pinecone', 'chromadb', 'elasticsearch', 'es', 'mongodb', 'nosql',
    '向量数据库', '相似度检索', 'qdrant', 'faiss', 'cassandara'
  ],

  // 开源神器与独立开发出海
  '独立开发出海与 AI 微 SaaS': [
    '独立开发', '出海', 'indie', 'saas', '微saas', 'stripe', '变现', '付费',
    '商业化', '增长', 'seo', 'landing page', '冷启动', '副业'
  ],
  'GitHub 高星开源项目精选': [
    'github', '开源项目', 'star', 'awesome', '趋势', '源码解读', '经典项目',
    'fork', 'pull request', 'top'
  ],
  '极客效率利器与插件生态': [
    '工具', '效率', '插件', 'vscode', '脚本', '自动化工具', '终端', 'raycast',
    'zsh', 'tmux', 'alfred', 'neovim', 'obsidian', 'notion'
  ],

  // 移动端与跨平台全栈开发
  'Flutter 与 React Native 跨平台开发': [
    'flutter', 'react native', 'rn', 'dart', 'cross-platform', '跨端', '移动端',
    'widget', 'bloc', 'provider', 'expo'
  ],
  'HarmonyOS 鸿蒙 NEXT 原生开发': [
    '鸿蒙', 'harmonyos', 'arkts', 'arkui', 'next', '仓颉', '鸿蒙开发', '纯血鸿蒙',
    '元服务', '分布式能力', 'hdc'
  ],
  'Android 与 iOS 原生工程进阶': [
    'android', 'ios', 'swift', 'swiftui', 'kotlin', 'jetpack', 'compose',
    'xcode', '原生开发', 'coroutine', 'combine', 'cocoapods'
  ],

  // 网络安全与攻防工程
  'Web 安全与渗透测试实战': [
    'web安全', '渗透测试', 'sql注入', 'xss', 'csrf', '靶场', '挖洞', 'src',
    '漏洞挖掘', 'burp', 'owasp', 'ssrf', '命令执行'
  ],
  '逆向工程与二进制安全': [
    '逆向', 'ida', 'ghidra', '破解', '脱壳', '二进制', 'pwn', '溢出',
    '逆向分析', '反编译', 'hook', 'frida', 'rop'
  ],
  '零信任安全与企业级防御体系': [
    '零信任', 'oauth2', 'iam', '等保', '防火墙', 'waf', '密码学', 'edr',
    '安全防御', '攻防演练', '密钥', 'tls', '证书'
  ],

  // 算法精粹与系统设计
  '高频数据结构与核心算法实战': [
    '算法', 'leetcode', '数据结构', '动态规划', '二叉树', '贪心', '排序',
    '刷题', '图论', '链表', '双指针', '回溯', '深度优先', '广度优先'
  ],
  '分布式系统架构与高并发设计': [
    '系统设计', '分布式', '高并发', '负载均衡', '限流', '降级', '熔断',
    'cap', '一致性', 'paxos', 'raft', '秒杀系统', '雪崩'
  ],
  '计算机体系底座与名校公开课': [
    'csapp', '计算机网络', '计算机组成原理', '体系结构', '操作系统', 'mit',
    '斯坦福', '公开课', 'tcp', 'ip', '汇编语言'
  ],

  // 游戏开发与 3D 图形渲染
  'Unity 3D 与 UE5 虚幻引擎实战': [
    'unity', 'unity3d', 'ue4', 'ue5', 'unreal engine', '虚幻引擎', '物理引擎',
    '游戏开发', 'c#', '蓝图', 'nanite', 'lumen'
  ],
  'Godot 开源引擎与独立游戏制作': [
    'godot', 'gdscript', '独立游戏', '2d游戏', '开源引擎', '像素游戏', '游戏制作'
  ],
  'WebGL、Three.js 与 Shader 着色器': [
    'three.js', 'webgl', 'shader', 'hlsl', 'glsl', '着色器', '渲染管线',
    '3d图形', '计算机图形学', '光线追踪', 'pbr'
  ],

  // 嵌入式系统与物联网硬件
  'STM32 单片机与微控制器实战': [
    'stm32', '单片机', 'mcu', 'hal库', 'arm', '寄存器', '嵌入式开发',
    '裸机', 'freertos', 'keil', 'cortex'
  ],
  'ESP32 物联网与智能硬件开发': [
    'esp32', 'esp8266', '物联网', 'arduino', '传感器', '蓝牙', 'wifi',
    '智能家居', 'iot', 'mqtt', 'zigbee'
  ],
  'ROS 机器人操作系统与嵌入式 Linux': [
    'ros', 'ros2', 'slam', '机器人', '激光雷达', '嵌入式linux', '驱动开发',
    '自动驾驶', 'navigation', 'gazebo'
  ],

  // 软件测试与自动化效能工程
  'Web 与移动端自动化测试实战': [
    'playwright', 'selenium', 'appium', 'cypress', 'ui自动化', '端到端测试',
    'e2e', '自动化测试', 'web测试'
  ],
  '接口测试与性能压测调优': [
    'jmeter', 'postman', 'locust', '压测', '性能测试', '接口测试', '吞吐量',
    'tps', 'qps', '瓶颈分析', 'gatling'
  ],
  '测试开发与效能平台建设': [
    '测开', '测试开发', '效能平台', 'pytest', 'mock', '门禁', '质量体系',
    '持续集成测试', '测试用例', '代码覆盖率'
  ],
}

/**
 * 智能路由：根据视频标题、描述、关键词将视频精准分流至匹配度最高的二级子方向
 */
export function routeVideoToSubcategory(
  item: {
    title: string
    description?: string
    trendKeyword?: string
    tags?: string[]
  },
  subCategories: NavigationSubCategory[]
): SubcategoryMatchResult {
  if (!subCategories || subCategories.length === 0) {
    throw new Error('分类中不存在可用子方向')
  }

  // 只有一个子分类时直接归入
  if (subCategories.length === 1) {
    return {
      targetSub: subCategories[0],
      score: 100,
      matchedKeywords: [subCategories[0].title],
      matchReason: '分类仅包含单一专属子方向',
    }
  }

  const titleLower = (item.title || '').toLowerCase()
  const descLower = (item.description || '').toLowerCase()
  const keywordLower = (item.trendKeyword || '').toLowerCase()
  const tagsLower = (item.tags || []).map(t => t.toLowerCase())

  let bestSub = subCategories[0]
  let highestScore = -1
  let bestKeywords: string[] = []

  for (const sub of subCategories) {
    let currentScore = 0
    const matched: string[] = []
    const subTitleLower = sub.title.toLowerCase()

    // 1. 子分类标题直接包含匹配（权重高：15分）
    // 拆分短词，如 "Docker" "Kubernetes"
    const titleTokens = subTitleLower
      .split(/[\s/、与与和&+,]+/)
      .map((t: string) => t.trim())
      .filter((t: string) => t.length >= 2)

    for (const token of titleTokens) {
      if (titleLower.includes(token)) {
        currentScore += 15
        matched.push(token)
      } else if (keywordLower.includes(token)) {
        currentScore += 10
        matched.push(token)
      } else if (tagsLower.some(t => t.includes(token))) {
        currentScore += 8
        matched.push(token)
      } else if (descLower.includes(token)) {
        currentScore += 3
        matched.push(token)
      }
    }

    // 2. 专业技术特征词典匹配（权重：5 - 12分）
    const domainKeywords = SUBCATEGORY_DOMAIN_LEXICON[sub.title] || []
    for (const kw of domainKeywords) {
      const kwLower = kw.toLowerCase()
      if (titleLower.includes(kwLower)) {
        currentScore += 12
        matched.push(kw)
      } else if (keywordLower.includes(kwLower)) {
        currentScore += 8
        matched.push(kw)
      } else if (tagsLower.includes(kwLower)) {
        currentScore += 6
        matched.push(kw)
      } else if (descLower.includes(kwLower)) {
        currentScore += 2
      }
    }

    if (currentScore > highestScore) {
      highestScore = currentScore
      bestSub = sub
      bestKeywords = Array.from(new Set(matched))
    }
  }

  // 若无任何命中，优先放入当前条目最少的子方向（容量负载均衡），避免头部子方向过载
  if (highestScore <= 0) {
    const sortedByCount = [...subCategories].sort(
      (a, b) => (a.items?.length || 0) - (b.items?.length || 0)
    )
    bestSub = sortedByCount[0] || subCategories[0]
    return {
      targetSub: bestSub,
      score: 10,
      matchedKeywords: [],
      matchReason: `技术语义无显著偏向，采用容量负载均衡分配至「${bestSub.title}」`,
    }
  }

  return {
    targetSub: bestSub,
    score: highestScore,
    matchedKeywords: bestKeywords.slice(0, 5),
    matchReason: `命中技术特征词 [${bestKeywords.slice(0, 3).join(', ')}]，精准路由至「${bestSub.title}」`,
  }
}

/**
 * 模糊相似度去重：防止同一教程不同重制版或微调标题重复录入
 */
export function isFuzzyDuplicateVideo(
  candidateTitle: string,
  existingTitles: string[],
  threshold = 0.82
): { isDuplicate: boolean; matchedTitle?: string; similarity?: number } {
  const normCand = normalizeTitleForDedup(candidateTitle)
  if (normCand.length < 3) return { isDuplicate: false }

  const candBigrams = createBigrams(normCand)

  for (const raw of existingTitles) {
    const normExisting = normalizeTitleForDedup(raw)
    if (normExisting === normCand) {
      return { isDuplicate: true, matchedTitle: raw, similarity: 1.0 }
    }

    const existBigrams = createBigrams(normExisting)
    const sim = calculateBigramSimilarity(candBigrams, existBigrams)
    if (sim >= threshold) {
      return { isDuplicate: true, matchedTitle: raw, similarity: Math.round(sim * 100) / 100 }
    }
  }

  return { isDuplicate: false }
}

function normalizeTitleForDedup(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/【.*?】|\[.*?\]|（.*?）|\(.*?\)/g, '') // 剥离常见方括号说明
    .replace(/[4k高清完整版最新合集教程实战从入门到精通自学必看]/g, '') // 剥离通用修饰噪点
    .replace(/[\s\-_—·:：,，。！？!?;；]/g, '') // 剥离标点符号
}

function createBigrams(str: string): Set<string> {
  const bigrams = new Set<string>()
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2))
  }
  return bigrams
}

function calculateBigramSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  return (2 * intersection) / (setA.size + setB.size)
}

/**
 * 智能萃取技术栈标签与内容深度定级
 */
export function extractTechBadgesAndDifficulty(
  title: string,
  description?: string
): {
  tags: string[]
  difficulty: 'beginner' | 'intermediate' | 'advanced'
} {
  const text = `${title} ${description || ''}`
  const foundTags = new Set<string>()

  // 常见主流技术词典
  const TECH_TOKENS = [
    'DeepSeek', 'LangChain', 'Agent', 'Cursor', 'MCP', 'PyTorch', 'Transformer', 'Ollama',
    'React', 'Vue', 'Next.js', 'TypeScript', 'Tailwind', 'Rust', 'Go', 'Golang',
    'Docker', 'Kubernetes', 'K8s', 'eBPF', 'Prometheus', 'Grafana', 'CI/CD', 'Terraform',
    'PostgreSQL', 'MySQL', 'Redis', 'ClickHouse', 'Kafka', 'Milvus', 'Elasticsearch',
    'Flutter', 'HarmonyOS', '鸿蒙', 'Android', 'iOS', 'Swift', 'Kotlin',
    'Playwright', 'JMeter', 'Selenium', 'Unity', 'UE5', 'Godot', 'WebGL', 'Three.js',
    'STM32', 'ESP32', 'ROS2', 'Web安全', '逆向工程', '零信任', 'LeetCode', '系统设计'
  ]

  for (const tok of TECH_TOKENS) {
    const regex = new RegExp(`\\b${tok}\\b|${tok}`, 'i')
    if (regex.test(text)) {
      foundTags.add(tok)
    }
  }

  // 深度与难度评定
  let difficulty: 'beginner' | 'intermediate' | 'advanced' = 'intermediate'
  const textLower = text.toLowerCase()

  if (
    textLower.includes('入门') ||
    textLower.includes('小白') ||
    textLower.includes('零基础') ||
    textLower.includes('新手') ||
    textLower.includes('速成')
  ) {
    difficulty = 'beginner'
  } else if (
    textLower.includes('内核') ||
    textLower.includes('底层') ||
    textLower.includes('源码') ||
    textLower.includes('架构') ||
    textLower.includes('高并发') ||
    textLower.includes('优化') ||
    textLower.includes('进阶') ||
    textLower.includes('深入理解')
  ) {
    difficulty = 'advanced'
  }

  return {
    tags: Array.from(foundTags).slice(0, 5),
    difficulty,
  }
}

/**
 * 高清封面规范化与防盗链/缩略图增强
 */
export function normalizeVideoCoverUrl(rawUrl?: string, platform?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '/assets/cover/default-video.jpg'
  }

  let url = rawUrl.trim()
  if (url.startsWith('//')) {
    url = `https:${url}`
  } else if (url.startsWith('http://')) {
    url = `https://${url.slice('http://'.length)}`
  }

  // Bilibili 封面高清处理：去除低清裁切后缀，统一使用高效标准尺寸
  if (platform === 'bilibili' || url.includes('hdslb.com')) {
    // 移除旧格式的低清尺寸
    url = url.replace(/@\d+w_\d+h.*$/, '')
  }

  return url
}
