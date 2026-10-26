import type { SeedPluginDef } from "../types.ts";

export const aiDeepSearchPack: SeedPluginDef = {
  "slug": "ai-deep-search-pack",
  "status": "published",
  "manifest": {
    "manifestVersion": 1,
    "kind": "search-pack",
    "name": "AI 深度研究与前沿模型搜索引擎包",
    "description": "38 个前沿 AI 模型与深度研究引擎一次装齐：在主搜索框用 !ppx、!felo、!gsp、!phind、!sci、!kimi、!deepseek、!qwen 等前缀直接向对话模型、学术引用网络、前沿预印本与算力社区发起定向穿透检索。",
    "icon": "🔬",
    "author": "山羊胡官方",
    "license": "MIT",
    "version": "1.0.0",
    "tags": [
      "AI搜索",
      "深度研究",
      "Perplexity",
      "DeepSeek",
      "前沿模型",
      "文献问答"
    ],
    "payload": {
      "engines": [
        {
          "name": "Perplexity",
          "prefix": "!ppx",
          "searchUrl": "https://www.perplexity.ai/search?q={q}",
          "icon": "🔮",
          "description": "具备深度可信信源引用的 AI 智能搜索引擎"
        },
        {
          "name": "Felo AI 搜索",
          "prefix": "!felo",
          "searchUrl": "https://felo.ai/search?q={q}",
          "icon": "⚡",
          "description": "跨语言多来源组织答案的 AI 深度研究引擎"
        },
        {
          "name": "GenSpark",
          "prefix": "!gsp",
          "searchUrl": "https://www.genspark.ai/search?query={q}",
          "icon": "✨",
          "description": "自动生成个性化微型研究火花页面的 AI 搜索"
        },
        {
          "name": "Phind",
          "prefix": "!phind",
          "searchUrl": "https://www.phind.com/search?q={q}",
          "icon": "💡",
          "description": "专为程序员量身定制的技术深度问答搜索引擎"
        },
        {
          "name": "SciSpace",
          "prefix": "!sci",
          "searchUrl": "https://typeset.io/search?q={q}",
          "icon": "📄",
          "description": "学术论文 AI 深度解读、结论对比与文献查阅台"
        },
        {
          "name": "Consensus",
          "prefix": "!consensus",
          "searchUrl": "https://consensus.app/results/?q={q}",
          "icon": "🎯",
          "description": "基于同行评审学术论文输出科学共识与结论的 AI 引擎"
        },
        {
          "name": "Semantic Scholar",
          "prefix": "!semanticscholar",
          "searchUrl": "https://www.semanticscholar.org/search?q={q}",
          "icon": "🧠",
          "description": "艾伦人工智能研究院学术语义引用网络检索"
        },
        {
          "name": "OpenAlex",
          "prefix": "!oalex",
          "searchUrl": "https://openalex.org/works?page=1&filter=default.search%3A{q}",
          "icon": "🌐",
          "description": "全球最大完全开放获取学术文献与知识图谱搜索"
        },
        {
          "name": "arXiv AI",
          "prefix": "!arxai",
          "searchUrl": "https://arxiv.org/search/?query={q}&searchtype=all",
          "icon": "📑",
          "description": "康奈尔大学计算机与 AI 预印本学术论文总库检索"
        },
        {
          "name": "bioRxiv",
          "prefix": "!biorxiv",
          "searchUrl": "https://www.biorxiv.org/search/{q}",
          "icon": "🧬",
          "description": "冷泉港实验室生命科学前沿学术预印本检索"
        },
        {
          "name": "Papers with Code",
          "prefix": "!pwc",
          "searchUrl": "https://paperswithcode.com/search?q_meta=&q_type=&q={q}",
          "icon": "📊",
          "description": "检索论文附带的开源复现代码与基准评测榜单"
        },
        {
          "name": "DeepSeek",
          "prefix": "!deepseek",
          "searchUrl": "https://chat.deepseek.com/?q={q}",
          "icon": "🐋",
          "description": "深度求索官方对话与深度推理模型定向问答"
        },
        {
          "name": "Kimi 智能助手",
          "prefix": "!kimi",
          "searchUrl": "https://kimi.moonshot.cn/?q={q}",
          "icon": "🌙",
          "description": "月之暗面长上下文资料深度阅读与分析问答"
        },
        {
          "name": "通义千问",
          "prefix": "!qwen",
          "searchUrl": "https://tongyi.aliyun.com/qianwen/?q={q}",
          "icon": "🏮",
          "description": "阿里巴巴通用多模态大语言模型官方入口问答"
        },
        {
          "name": "智谱清言",
          "prefix": "!glm",
          "searchUrl": "https://chatglm.cn/main/alltoolsdetail?q={q}",
          "icon": "📘",
          "description": "清华智谱 GLM 旗舰大语言模型与智能体检索"
        },
        {
          "name": "豆包",
          "prefix": "!doubao",
          "searchUrl": "https://www.doubao.com/chat/?q={q}",
          "icon": "🥟",
          "description": "字节跳动出品的多功能 AI 创作与通用对话助手"
        },
        {
          "name": "秘塔 AI 搜索",
          "prefix": "!metaso",
          "searchUrl": "https://metaso.cn/?q={q}",
          "icon": "🧭",
          "description": "无广告直达核心结论的大纲式全网 AI 搜索引擎"
        },
        {
          "name": "ChatGPT",
          "prefix": "!chatgpt",
          "searchUrl": "https://chatgpt.com/?q={q}",
          "icon": "🤖",
          "description": "OpenAI 官方通用对话与多模态智能体平台"
        },
        {
          "name": "Claude",
          "prefix": "!claude",
          "searchUrl": "https://claude.ai/new?q={q}",
          "icon": "🎭",
          "description": "Anthropic 旗舰逻辑长文本与编程大模型"
        },
        {
          "name": "Google Gemini",
          "prefix": "!gemini",
          "searchUrl": "https://gemini.google.com/app?q={q}",
          "icon": "💎",
          "description": "谷歌原生多模态实时全球知识深度搜索模型"
        },
        {
          "name": "Google AI Studio",
          "prefix": "!aistudio",
          "searchUrl": "https://aistudio.google.com/live?q={q}",
          "icon": "🛠️",
          "description": "谷歌开发者原型平台最新模型直接调用测试"
        },
        {
          "name": "Groq",
          "prefix": "!groq",
          "searchUrl": "https://groq.com/?q={q}",
          "icon": "⚡",
          "description": "LPU 架构驱动的每秒数百 Token 极限极速推理体验"
        },
        {
          "name": "Mistral Le Chat",
          "prefix": "!mistral",
          "searchUrl": "https://chat.mistral.ai/chat?q={q}",
          "icon": "🌪️",
          "description": "欧洲顶尖开源大模型官方智能会话与代码助手"
        },
        {
          "name": "Poe 聚合搜索",
          "prefix": "!poe",
          "searchUrl": "https://poe.com/search?q={q}",
          "icon": "🪶",
          "description": "Quora 旗下聚合数十款前沿商业模型的对话平台"
        },
        {
          "name": "Hugging Face 模型",
          "prefix": "!hfmodels",
          "searchUrl": "https://huggingface.co/models?search={q}",
          "icon": "🤗",
          "description": "全球最大开源机器学习模型权重与架构检索"
        },
        {
          "name": "Hugging Face 数据集",
          "prefix": "!hfdata",
          "searchUrl": "https://huggingface.co/datasets?search={q}",
          "icon": "📂",
          "description": "公开训练集、测试集与自然语言语料库检索"
        },
        {
          "name": "Hugging Face Spaces",
          "prefix": "!hfspaces",
          "searchUrl": "https://huggingface.co/spaces?search={q}",
          "icon": "🚀",
          "description": "全球开发者共享的可交互 Gradio / Streamlit AI 应用"
        },
        {
          "name": "魔搭社区模型",
          "prefix": "!modelscope",
          "searchUrl": "https://modelscope.cn/models?page=1&search={q}",
          "icon": "🎪",
          "description": "阿里魔搭开源模型库国内高速下载与算力体验"
        },
        {
          "name": "Ollama 官方库",
          "prefix": "!ollama",
          "searchUrl": "https://ollama.com/library?q={q}",
          "icon": "🦙",
          "description": "本地可一键拉取运行的量化大模型权重检索"
        },
        {
          "name": "Civitai 创意模型",
          "prefix": "!civitai",
          "searchUrl": "https://civitai.com/search/models?query={q}",
          "icon": "🎨",
          "description": "文生图与视觉多模态 LoRA 及 Checkpoint 模型集市"
        },
        {
          "name": "Replicate 容器模型",
          "prefix": "!replicate",
          "searchUrl": "https://replicate.com/explore?query={q}",
          "icon": "📦",
          "description": "通过云端 API 快速调用运行的开源多模态模型库"
        },
        {
          "name": "Fal.ai 极速生成",
          "prefix": "!fal",
          "searchUrl": "https://fal.ai/models?q={q}",
          "icon": "🦅",
          "description": "针对生成式媒体深度优化的极低延迟模型推理平台"
        },
        {
          "name": "Together AI",
          "prefix": "!together",
          "searchUrl": "https://www.together.ai/models?q={q}",
          "icon": "🤝",
          "description": "开源大模型云端 API 推理平台与微调端点目录"
        },
        {
          "name": "Fireworks AI",
          "prefix": "!fireworks",
          "searchUrl": "https://fireworks.ai/models?q={q}",
          "icon": "🎆",
          "description": "生产级高质量开源模型极速推理托管目录"
        },
        {
          "name": "LMSYS Arena 榜单",
          "prefix": "!arena",
          "searchUrl": "https://chat.lmsys.org/?leaderboard={q}",
          "icon": "🏆",
          "description": "全网人类双盲实测大模型胜率天梯榜查询"
        },
        {
          "name": "SWE-bench 任务",
          "prefix": "!swebench",
          "searchUrl": "https://www.swebench.com/?search={q}",
          "icon": "🏅",
          "description": "AI 解决真实 GitHub 软件工程难题能力榜单"
        },
        {
          "name": "Artificial Analysis",
          "prefix": "!artanalysis",
          "searchUrl": "https://artificialanalysis.ai/?search={q}",
          "icon": "📈",
          "description": "大模型价格、吞吐量与首字延迟真实基准对比"
        },
        {
          "name": "You.com 深度搜索",
          "prefix": "!you",
          "searchUrl": "https://you.com/search?q={q}",
          "icon": "🔍",
          "description": "融合多来源信源的生成式研究搜索工作台"
        }
      ]
    }
  }
};
