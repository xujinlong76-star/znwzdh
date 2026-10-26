/**
 * 种子插件：AI Agentic 编码与自动化开发包（site-pack）
 *
 * 遵循 2026 前沿技术标准打造的旗舰级专业网址包。
 * 覆盖 20 大核心分类与 204 个前沿站点。
 */
import type { SeedPluginDef } from "../types.ts";

export const aiAgenticCoding: SeedPluginDef = {
  "slug": "ai-agentic-coding",
  "status": "published",
  "manifest": {
    "manifestVersion": 1,
    "kind": "site-pack",
    "name": "AI Agentic 编码与自动化开发包",
    "description": "2026 前沿 AI 智能体开发武器库（20 大分类 / 210+ 精选站点）：全面覆盖 AI IDE、Agent 框架、RAG 向量库、模型微调、评测基准、全栈框架、DevOps 与安全工具，助你极速构建自主编程智能体。",
    "icon": "⚡",
    "author": "山羊胡官方",
    "license": "MIT",
    "version": "1.0.0",
    "tags": [
      "AI",
      "Agent",
      "Coding",
      "IDE",
      "自动化",
      "大模型",
      "全栈"
    ],
    "payload": {
      "categories": [
        {
          "title": "AI 编程助手",
          "description": "AI 原生编辑器、代码补全插件与全自动编程 Agent"
        },
        {
          "title": "智能体与自动化",
          "description": "多智能体协作框架、自主执行工作流与编排引擎"
        },
        {
          "title": "向量库与 RAG",
          "description": "知识库检索增强、向量数据库与文档语义切片"
        },
        {
          "title": "模型训练与微调",
          "description": "轻量微调工具、强化学习对齐与算力集群编排"
        },
        {
          "title": "模型与数据集",
          "description": "开源代码权重、评测数据集与模型托管中心"
        },
        {
          "title": "AI 评测与学习",
          "description": "权威代码榜单、智能体评测基准与前沿架构文献"
        },
        {
          "title": "对话助手",
          "description": "顶级大语言模型对话端、深度推理与研究助手"
        },
        {
          "title": "核心框架",
          "description": "现代化 Web 全栈框架、响应式组件与前端元框架"
        },
        {
          "title": "构建与工程化",
          "description": "下一代打包工具、类型检查器与 Monorepo 管理"
        },
        {
          "title": "全栈与服务端",
          "description": "高性能服务端运行时、轻量 API 框架与全栈方案"
        },
        {
          "title": "代码托管",
          "description": "全球分布式版本控制、开源社区与自建代码仓库"
        },
        {
          "title": "官方文档",
          "description": "权威语言标准、技术规范速查与官方 API 文档"
        },
        {
          "title": "在线演练场",
          "description": "免配置云端 IDE、沙盒演练场与即时原型验证"
        },
        {
          "title": "编码小工具",
          "description": "正则调试、格式转换、代码截图与高频开发小工具"
        },
        {
          "title": "接口调试",
          "description": "API 协同设计、本地 Mock、环境管理与自动化压测"
        },
        {
          "title": "命令行速查",
          "description": "终端生产力工具、命令解释器与现代化 Shell 环境"
        },
        {
          "title": "代码评审",
          "description": "静态代码质量扫描、合规审查与自动化 Code Review"
        },
        {
          "title": "持续交付",
          "description": "云原生 CI/CD 流水线、GitOps 自动化与构建部署"
        },
        {
          "title": "可观测与监控",
          "description": "分布式链路追踪、应用 APM、告警与实时日志"
        },
        {
          "title": "应用与密钥安全",
          "description": "密钥生命周期管理、依赖漏洞扫描与代码安全护栏"
        }
      ],
      "sites": [
        {
          "url": "https://www.cursor.com/",
          "title": "Cursor",
          "description": "新一代 AI 优先代码编辑器，支持多文件上下文索引与智能改写。",
          "category": "AI 编程助手",
          "subCategory": "AI IDE",
          "tags": [
            "Cursor",
            "AI IDE"
          ]
        },
        {
          "url": "https://windsurf.ai/",
          "title": "Windsurf",
          "description": "Codeium 打造的智能代理 IDE，深度融合 Cascade 自主工作流。",
          "category": "AI 编程助手",
          "subCategory": "AI IDE",
          "tags": [
            "Windsurf",
            "Cascade"
          ]
        },
        {
          "url": "https://claude.ai/code",
          "title": "Claude Code",
          "description": "Anthropic 命令行自主编程代理，直接操作本地终端与 Git 仓库。",
          "category": "AI 编程助手",
          "subCategory": "CLI Agent",
          "tags": [
            "Claude",
            "CLI"
          ]
        },
        {
          "url": "https://www.trae.ai/",
          "title": "Trae",
          "description": "字节跳动出品的自适应 AI IDE，深度集成国内优质大模型与智能补全。",
          "category": "AI 编程助手",
          "subCategory": "AI IDE",
          "tags": [
            "Trae",
            "国产"
          ]
        },
        {
          "url": "https://github.com/RooVetGit/Roo-Code",
          "title": "Roo Code",
          "description": "开源 VS Code 自主编程代理插件，支持架构模式与代码自主修复。",
          "category": "AI 编程助手",
          "subCategory": "开源插件",
          "tags": [
            "Roo Code",
            "开源"
          ]
        },
        {
          "url": "https://aider.chat/",
          "title": "Aider",
          "description": "终端中的结对编程 AI 工具，与本地 git 深度协作并自动编写提交记录。",
          "category": "AI 编程助手",
          "subCategory": "CLI Agent",
          "tags": [
            "Aider",
            "终端"
          ]
        },
        {
          "url": "https://github.com/features/copilot",
          "title": "GitHub Copilot",
          "description": "微软与 OpenAI 联合打造的旗舰级代码补全与智能聊天助手。",
          "category": "AI 编程助手",
          "subCategory": "补全插件",
          "tags": [
            "Copilot",
            "微软"
          ]
        },
        {
          "url": "https://continue.dev/",
          "title": "Continue",
          "description": "领先的开源 AI 代码助手扩展，支持任意本地及云端模型自由接入。",
          "category": "AI 编程助手",
          "subCategory": "开源插件",
          "tags": [
            "Continue",
            "开源"
          ]
        },
        {
          "url": "https://sourcegraph.com/cody",
          "title": "Cody",
          "description": "Sourcegraph 出品的代码智能体，凭借海量全局代码图谱理解工程。",
          "category": "AI 编程助手",
          "subCategory": "企业级",
          "tags": [
            "Cody",
            "企业级"
          ]
        },
        {
          "url": "https://supermaven.com/",
          "title": "Supermaven",
          "description": "具备 100 万 token 超长上下文窗口的极速代码补全引擎。",
          "category": "AI 编程助手",
          "subCategory": "极速补全",
          "tags": [
            "Supermaven",
            "补全"
          ]
        },
        {
          "url": "https://v0.dev/",
          "title": "v0 by Vercel",
          "description": "自然语言驱动的生成式 UI 系统，一键产出生产级 React 与 Tailwind 代码。",
          "category": "AI 编程助手",
          "subCategory": "生成式UI",
          "tags": [
            "v0",
            "UI生成"
          ]
        },
        {
          "url": "https://bolt.new/",
          "title": "Bolt.new",
          "description": "StackBlitz 推出的浏览器全栈 AI 开发环境，提示词即全栈 Web 应用。",
          "category": "AI 编程助手",
          "subCategory": "Web Agent",
          "tags": [
            "Bolt",
            "全栈"
          ]
        },
        {
          "url": "https://microsoft.github.io/autogen/",
          "title": "AutoGen",
          "description": "微软开源的多智能体协同开发框架，支持复杂多角色的对话与执行。",
          "category": "智能体与自动化",
          "subCategory": "多智能体",
          "tags": [
            "AutoGen",
            "微软"
          ]
        },
        {
          "url": "https://www.crewai.com/",
          "title": "CrewAI",
          "description": "面向生产环境的角色型多智能体协同调度框架，简单且易于工程化落地。",
          "category": "智能体与自动化",
          "subCategory": "多智能体",
          "tags": [
            "CrewAI",
            "角色协作"
          ]
        },
        {
          "url": "https://www.langchain.com/",
          "title": "LangChain",
          "description": "全球最广泛采用的 LLM 应用与上下文工程开源开发框架。",
          "category": "智能体与自动化",
          "subCategory": "Agent框架",
          "tags": [
            "LangChain",
            "LLM"
          ]
        },
        {
          "url": "https://langchain-ai.github.io/langgraph/",
          "title": "LangGraph",
          "description": "支持带环循环控制与图状态管理的高可靠智能体编排引擎。",
          "category": "智能体与自动化",
          "subCategory": "状态图",
          "tags": [
            "LangGraph",
            "状态机"
          ]
        },
        {
          "url": "https://dify.ai/",
          "title": "Dify",
          "description": "开源的 LLM 应用开发与可视化工作流平台，支持一键编排发布 Agent。",
          "category": "智能体与自动化",
          "subCategory": "可视化平台",
          "tags": [
            "Dify",
            "工作流"
          ]
        },
        {
          "url": "https://www.coze.com/",
          "title": "Coze",
          "description": "下一代一站式 AI 智能体开发平台，拥有丰富的插件生态与自动化工作流。",
          "category": "智能体与自动化",
          "subCategory": "平台",
          "tags": [
            "Coze",
            "Bot"
          ]
        },
        {
          "url": "https://flowiseai.com/",
          "title": "Flowise",
          "description": "基于 LangChain 构建的低代码拖拽式 LLM 应用搭建可视化框架。",
          "category": "智能体与自动化",
          "subCategory": "低代码",
          "tags": [
            "Flowise",
            "拖拽"
          ]
        },
        {
          "url": "https://github.com/geekan/MetaGPT",
          "title": "MetaGPT",
          "description": "模拟软件公司的多智能体框架，分配产品经理、架构师等标准 SOP。",
          "category": "智能体与自动化",
          "subCategory": "SOP协同",
          "tags": [
            "MetaGPT",
            "软件公司"
          ]
        },
        {
          "url": "https://github.com/OpenBMB/ChatDev",
          "title": "ChatDev",
          "description": "通过虚拟多角色交流协作完成定制软件开发的智能体虚拟园区。",
          "category": "智能体与自动化",
          "subCategory": "虚拟团队",
          "tags": [
            "ChatDev",
            "开源"
          ]
        },
        {
          "url": "https://github.com/Significant-Gravitas/AutoGPT",
          "title": "AutoGPT",
          "description": "探索自主完成目标的开创性智能体项目，支持长程任务自动拆解。",
          "category": "智能体与自动化",
          "subCategory": "自主智能体",
          "tags": [
            "AutoGPT",
            "自主"
          ]
        },
        {
          "url": "https://tasking.ai/",
          "title": "TaskingAI",
          "description": "集模型调用、检索增强与工具代理于一体的统一企业级 Agent 平台。",
          "category": "智能体与自动化",
          "subCategory": "统一平台",
          "tags": [
            "TaskingAI",
            "企业级"
          ]
        },
        {
          "url": "https://www.trychroma.com/",
          "title": "Chroma",
          "description": "开源且专为开发者设计的嵌入式向量数据库，支持毫秒级部署使用。",
          "category": "向量库与 RAG",
          "subCategory": "向量数据库",
          "tags": [
            "Chroma",
            "向量库"
          ]
        },
        {
          "url": "https://qdrant.tech/",
          "title": "Qdrant",
          "description": "使用 Rust 构建的高性能、高可靠开源向量搜索引擎与知识检索平台。",
          "category": "向量库与 RAG",
          "subCategory": "向量数据库",
          "tags": [
            "Qdrant",
            "Rust"
          ]
        },
        {
          "url": "https://milvus.io/",
          "title": "Milvus",
          "description": "面向海量规模向量检索设计的分布式开源云原生向量数据库。",
          "category": "向量库与 RAG",
          "subCategory": "分布式向量库",
          "tags": [
            "Milvus",
            "海量检索"
          ]
        },
        {
          "url": "https://www.pinecone.io/",
          "title": "Pinecone",
          "description": "完全托管、高扩展性的无服务器云端向量数据库服务。",
          "category": "向量库与 RAG",
          "subCategory": "托管云库",
          "tags": [
            "Pinecone",
            "Serverless"
          ]
        },
        {
          "url": "https://weaviate.io/",
          "title": "Weaviate",
          "description": "开源的 AI 原生多模态向量数据库，支持混合检索与模块化模型扩展。",
          "category": "向量库与 RAG",
          "subCategory": "多模态向量库",
          "tags": [
            "Weaviate",
            "多模态"
          ]
        },
        {
          "url": "https://lancedb.com/",
          "title": "LanceDB",
          "description": "基于 Lance 列式格式的无服务器轻量向量数据库，支持多模态持久化。",
          "category": "向量库与 RAG",
          "subCategory": "轻量向量库",
          "tags": [
            "LanceDB",
            "嵌入式"
          ]
        },
        {
          "url": "https://www.llamaindex.ai/",
          "title": "LlamaIndex",
          "description": "专为 LLM 应用连接私有数据源设计的数据接入与高级索引编排框架。",
          "category": "向量库与 RAG",
          "subCategory": "RAG框架",
          "tags": [
            "LlamaIndex",
            "数据索引"
          ]
        },
        {
          "url": "https://haystack.deepset.ai/",
          "title": "Haystack",
          "description": "端到端开源 NLP 与 RAG 流水线编排系统，支持工业级问答构建。",
          "category": "向量库与 RAG",
          "subCategory": "RAG流水线",
          "tags": [
            "Haystack",
            "NLP"
          ]
        },
        {
          "url": "https://ragflow.io/",
          "title": "RAGFlow",
          "description": "基于深度文档理解的下一代开源 RAG 引擎，解决复杂排版解析难题。",
          "category": "向量库与 RAG",
          "subCategory": "开源RAG",
          "tags": [
            "RAGFlow",
            "文档理解"
          ]
        },
        {
          "url": "https://fastgpt.in/",
          "title": "FastGPT",
          "description": "基于 LLM 大语言模型的知识库问答系统，支持复杂数据预处理与工作流。",
          "category": "向量库与 RAG",
          "subCategory": "知识库",
          "tags": [
            "FastGPT",
            "国内知识库"
          ]
        },
        {
          "url": "https://unstructured.io/",
          "title": "Unstructured",
          "description": "将 PDF、Word、PPT 等非结构化文档一键预处理转为 LLM 准备数据的工具。",
          "category": "向量库与 RAG",
          "subCategory": "ETL预处理",
          "tags": [
            "Unstructured",
            "文档切片"
          ]
        },
        {
          "url": "https://unsloth.ai/",
          "title": "Unsloth",
          "description": "将 LLaMA、Mistral 等大模型微调速度提升 5 倍且显存占用降低 80% 的神级框架。",
          "category": "模型训练与微调",
          "subCategory": "极速微调",
          "tags": [
            "Unsloth",
            "高效微调"
          ]
        },
        {
          "url": "https://github.com/hiyouga/LLaMA-Factory",
          "title": "LLaMA-Factory",
          "description": "开源易用的大模型全生命周期微调平台，内置 100+ 模型支持与可视化 WebUI。",
          "category": "模型训练与微调",
          "subCategory": "微调框架",
          "tags": [
            "LLaMA-Factory",
            "WebUI"
          ]
        },
        {
          "url": "https://github.com/axolotl-ai-cloud/axolotl",
          "title": "Axolotl",
          "description": "配置驱动、支持丰富数据集格式与量化技术的端到端大模型微调套件。",
          "category": "模型训练与微调",
          "subCategory": "配置微调",
          "tags": [
            "Axolotl",
            "训练套件"
          ]
        },
        {
          "url": "https://github.com/pytorch/torchtune",
          "title": "torchtune",
          "description": "PyTorch 官方推出的原生大模型微调与后训练易读库。",
          "category": "模型训练与微调",
          "subCategory": "官方框架",
          "tags": [
            "torchtune",
            "PyTorch"
          ]
        },
        {
          "url": "https://www.deepspeed.ai/",
          "title": "DeepSpeed",
          "description": "微软推出的极速深度学习分布式优化与大规模训练推理加速引擎。",
          "category": "模型训练与微调",
          "subCategory": "分布式优化",
          "tags": [
            "DeepSpeed",
            "微软"
          ]
        },
        {
          "url": "https://github.com/huggingface/peft",
          "title": "PEFT",
          "description": "Hugging Face 参数高效微调库，覆盖 LoRA、Prefix-Tuning 等前沿算法。",
          "category": "模型训练与微调",
          "subCategory": "高效算法",
          "tags": [
            "PEFT",
            "LoRA"
          ]
        },
        {
          "url": "https://github.com/huggingface/trl",
          "title": "TRL",
          "description": "包含 SFT、DPO、PPO 等全流程大模型强化学习与对齐的开源算法库。",
          "category": "模型训练与微调",
          "subCategory": "强化学习",
          "tags": [
            "TRL",
            "DPO"
          ]
        },
        {
          "url": "https://www.ray.io/",
          "title": "Ray",
          "description": "用于扩展 AI 和 Python 生产级负载的分布式统一计算框架。",
          "category": "模型训练与微调",
          "subCategory": "分布式编排",
          "tags": [
            "Ray",
            "计算集群"
          ]
        },
        {
          "url": "https://colossalai.org/",
          "title": "Colossal-AI",
          "description": "提供完整大规模 AI 模型训练与推理部署的分布式异构内存管理系统。",
          "category": "模型训练与微调",
          "subCategory": "异构训练",
          "tags": [
            "Colossal-AI",
            "分布式"
          ]
        },
        {
          "url": "https://github.com/OpenRLHF/OpenRLHF",
          "title": "OpenRLHF",
          "description": "支持 70B+ 模型高效分布式强化学习对齐的高性能开源训练框架。",
          "category": "模型训练与微调",
          "subCategory": "超大规模RL",
          "tags": [
            "OpenRLHF",
            "大规模"
          ]
        },
        {
          "url": "https://huggingface.co/",
          "title": "Hugging Face",
          "description": "全球最大 AI 开源社区，汇聚数百万模型权重、数据集与交互式 Spaces。",
          "category": "模型与数据集",
          "subCategory": "国际枢纽",
          "tags": [
            "Hugging Face",
            "社区"
          ]
        },
        {
          "url": "https://modelscope.cn/",
          "title": "魔搭社区 (ModelScope)",
          "description": "阿里发起并运营的国内顶级开源模型社区，提供海量免费算力与体验通道。",
          "category": "模型与数据集",
          "subCategory": "国内枢纽",
          "tags": [
            "魔搭",
            "阿里"
          ]
        },
        {
          "url": "https://openxlab.org.cn/",
          "title": "OpenXLab",
          "description": "上海人工智能实验室打造的开源大模型算法与数据集一体化开放平台。",
          "category": "模型与数据集",
          "subCategory": "开源开放",
          "tags": [
            "OpenXLab",
            "数据集"
          ]
        },
        {
          "url": "https://www.kaggle.com/datasets",
          "title": "Kaggle Datasets",
          "description": "全球数据科学竞技社区，拥有庞大且经实践验证的优质公共数据集。",
          "category": "模型与数据集",
          "subCategory": "数据中心",
          "tags": [
            "Kaggle",
            "数据挖掘"
          ]
        },
        {
          "url": "https://paperswithcode.com/datasets",
          "title": "Papers with Code",
          "description": "追踪学术文献对应代码复现、评测基准与开放数据集的专业学术平台。",
          "category": "模型与数据集",
          "subCategory": "学术标杆",
          "tags": [
            "Papers with Code",
            "基准"
          ]
        },
        {
          "url": "https://ollama.com/library",
          "title": "Ollama 官方模型库",
          "description": "Ollama 精选模型目录，提供即下即用的量化权重与一键运行指令。",
          "category": "模型与数据集",
          "subCategory": "模型库",
          "tags": [
            "Ollama",
            "量化模型"
          ]
        },
        {
          "url": "https://civitai.com/",
          "title": "Civitai",
          "description": "全球知名的文生图与多模态扩散模型 LoRA 社区与创意资源中心。",
          "category": "模型与数据集",
          "subCategory": "创作者社区",
          "tags": [
            "Civitai",
            "LoRA"
          ]
        },
        {
          "url": "https://huggingface.co/models?search=gguf",
          "title": "Hugging Face GGUF Hub",
          "description": "汇聚全球由社区量化的最新 GGUF 格式本地模型中心。",
          "category": "模型与数据集",
          "subCategory": "本地格式",
          "tags": [
            "GGUF",
            "本地推理"
          ]
        },
        {
          "url": "https://github.com/ggerganov/llama.cpp",
          "title": "llama.cpp",
          "description": "纯 C/C++ 实现的极致轻量大模型推理引擎，定义了现代 GGUF 量化标准。",
          "category": "模型与数据集",
          "subCategory": "核心推理",
          "tags": [
            "llama.cpp",
            "C++"
          ]
        },
        {
          "url": "https://github.com/vllm-project/vllm",
          "title": "vLLM",
          "description": "高吞吐、极低延迟的生产级 LLM 服务推理框架，创导 PagedAttention 显存技术。",
          "category": "模型与数据集",
          "subCategory": "服务端推理",
          "tags": [
            "vLLM",
            "高吞吐"
          ]
        },
        {
          "url": "https://www.swebench.com/",
          "title": "SWE-bench",
          "description": "衡量 AI 自主解决 GitHub 真实软件工程问题能力的权威公认基准。",
          "category": "AI 评测与学习",
          "subCategory": "代码榜单",
          "tags": [
            "SWE-bench",
            "基准测试"
          ]
        },
        {
          "url": "https://chat.lmsys.org/",
          "title": "LMSYS Chatbot Arena",
          "description": "基于海量人类双盲盲测投票的大模型胜率天梯排行榜。",
          "category": "AI 评测与学习",
          "subCategory": "天梯榜",
          "tags": [
            "LMSYS",
            "Arena"
          ]
        },
        {
          "url": "https://opencompass.org.cn/",
          "title": "司南 (OpenCompass)",
          "description": "上海人工智能实验室发布的开源大模型评测平台与多维度排行榜单。",
          "category": "AI 评测与学习",
          "subCategory": "综合评测",
          "tags": [
            "OpenCompass",
            "司南"
          ]
        },
        {
          "url": "https://artificialanalysis.ai/",
          "title": "Artificial Analysis",
          "description": "独立第三方大模型服务质量评测：提供价格、首字延迟与吞吐真实对比。",
          "category": "AI 评测与学习",
          "subCategory": "性能测速",
          "tags": [
            "性能",
            "价格对比"
          ]
        },
        {
          "url": "https://livecodebench.github.io/",
          "title": "LiveCodeBench",
          "description": "随竞赛实时动态更新防作弊的代码大模型综合测试基准排行榜。",
          "category": "AI 评测与学习",
          "subCategory": "代码竞技",
          "tags": [
            "LiveCodeBench",
            "防污染"
          ]
        },
        {
          "url": "https://crfm.stanford.edu/helm/",
          "title": "HELM (Stanford)",
          "description": "斯坦福基础模型研究中心主导的全面、透明、多维度模型基准体系。",
          "category": "AI 评测与学习",
          "subCategory": "学术标杆",
          "tags": [
            "HELM",
            "斯坦福"
          ]
        },
        {
          "url": "https://github.com/bigcode-project/bigcode-evaluation-harness",
          "title": "BigCode Harness",
          "description": "代码生成模型评估框架，支持 HumanEval、MBPP 等多种标准测试。",
          "category": "AI 评测与学习",
          "subCategory": "评估工具",
          "tags": [
            "BigCode",
            "HumanEval"
          ]
        },
        {
          "url": "https://arxiv.org/list/cs.AI/recent",
          "title": "arXiv cs.AI",
          "description": "康奈尔大学预印本库计算机与人工智能最新研究成果发布源头。",
          "category": "AI 评测与学习",
          "subCategory": "预印本文献",
          "tags": [
            "arXiv",
            "前沿论文"
          ]
        },
        {
          "url": "https://huggingface.co/papers",
          "title": "Hugging Face Daily Papers",
          "description": "每日由全球 AI 社区点赞精选的高价值顶会前沿论文速览。",
          "category": "AI 评测与学习",
          "subCategory": "每日论文",
          "tags": [
            "Papers",
            "论文精选"
          ]
        },
        {
          "url": "https://deeplearning.ai/",
          "title": "DeepLearning.AI",
          "description": "吴恩达创办的全球知名 AI 学习平台，提供前沿短课与系统课程。",
          "category": "AI 评测与学习",
          "subCategory": "权威课程",
          "tags": [
            "吴恩达",
            "AI课程"
          ]
        },
        {
          "url": "https://chat.deepseek.com/",
          "title": "DeepSeek 官方入口",
          "description": "深度求索大模型对话端，推理能力顶尖且支持代码与深度思考。",
          "category": "对话助手",
          "subCategory": "国内顶级",
          "tags": [
            "DeepSeek",
            "推理"
          ]
        },
        {
          "url": "https://claude.ai/",
          "title": "Claude 官方入口",
          "description": "Anthropic 旗舰大语言模型，以严密逻辑、超长上下文与优秀代码力著称。",
          "category": "对话助手",
          "subCategory": "海外领先",
          "tags": [
            "Claude",
            "Anthropic"
          ]
        },
        {
          "url": "https://chatgpt.com/",
          "title": "ChatGPT",
          "description": "OpenAI 官方对话端，具备深度研究、Canvas 协同与代码解释器。",
          "category": "对话助手",
          "subCategory": "全球基准",
          "tags": [
            "ChatGPT",
            "OpenAI"
          ]
        },
        {
          "url": "https://www.perplexity.ai/",
          "title": "Perplexity AI",
          "description": "对话式 AI 搜索引擎先驱，答案标注来源信源且支持多引擎切分。",
          "category": "对话助手",
          "subCategory": "AI搜索",
          "tags": [
            "Perplexity",
            "搜索问答"
          ]
        },
        {
          "url": "https://aistudio.google.com/",
          "title": "Google AI Studio",
          "description": "谷歌开发者原型设计环境，可免费试用最新顶级 Gemini 1.5/2.0 模型。",
          "category": "对话助手",
          "subCategory": "开发接入",
          "tags": [
            "Google",
            "Gemini"
          ]
        },
        {
          "url": "https://kimi.moonshot.cn/",
          "title": "Kimi 智能助手",
          "description": "月之暗面长文本对话助手，支持几十万字超长资料深度阅读与总结。",
          "category": "对话助手",
          "subCategory": "长上下文",
          "tags": [
            "Kimi",
            "月之暗面"
          ]
        },
        {
          "url": "https://tongyi.aliyun.com/",
          "title": "通义千问官方入口",
          "description": "阿里云主力大模型，涵盖多种模态并在代码和逻辑领域持续演进。",
          "category": "对话助手",
          "subCategory": "国内主力",
          "tags": [
            "通义千问",
            "阿里"
          ]
        },
        {
          "url": "https://x.ai/",
          "title": "Grok",
          "description": "xAI 打造的高时效性大模型，实时整合 X 平台一手突发技术动态与讨论。",
          "category": "对话助手",
          "subCategory": "实时资讯",
          "tags": [
            "Grok",
            "xAI"
          ]
        },
        {
          "url": "https://www.phind.com/",
          "title": "Phind",
          "description": "面向开发者的专属 AI 搜索引擎与编程技术问答助手。",
          "category": "对话助手",
          "subCategory": "开发者搜索",
          "tags": [
            "Phind",
            "编程搜索"
          ]
        },
        {
          "url": "https://you.com/",
          "title": "You.com",
          "description": "提供自选模型模式的多功能生成式 AI 搜索与知识协同工作台。",
          "category": "对话助手",
          "subCategory": "混合搜索",
          "tags": [
            "You",
            "智能搜索"
          ]
        },
        {
          "url": "https://nextjs.org/",
          "title": "Next.js",
          "description": "Vercel 打造的业界标杆 React 全栈框架，深度支持服务端组件与路由。",
          "category": "核心框架",
          "subCategory": "React生态",
          "tags": [
            "Next.js",
            "React"
          ]
        },
        {
          "url": "https://react.dev/",
          "title": "React 官方门户",
          "description": "用于构建用户界面的权威组件化 JavaScript 库与现代规范。",
          "category": "核心框架",
          "subCategory": "主流视图",
          "tags": [
            "React",
            "UI库"
          ]
        },
        {
          "url": "https://vuejs.org/",
          "title": "Vue.js 官方门户",
          "description": "渐进式 JavaScript 框架，易学易用且具备优秀的组合式 API 设计。",
          "category": "核心框架",
          "subCategory": "主流视图",
          "tags": [
            "Vue",
            "组合式API"
          ]
        },
        {
          "url": "https://svelte.dev/",
          "title": "Svelte 官方门户",
          "description": "将界面编译为极小原生 JS 的无运行时前端框架，Svelte 5 携 Runes 焕新。",
          "category": "核心框架",
          "subCategory": "编译型",
          "tags": [
            "Svelte",
            "Runes"
          ]
        },
        {
          "url": "https://astro.build/",
          "title": "Astro",
          "description": "专为内容优先站点打造的现代化全栈元框架，独创组件群岛架构。",
          "category": "核心框架",
          "subCategory": "内容框架",
          "tags": [
            "Astro",
            "群岛架构"
          ]
        },
        {
          "url": "https://www.solidjs.com/",
          "title": "SolidJS",
          "description": "拥有极致响应性能与极小开销的细粒度响应式前端框架。",
          "category": "核心框架",
          "subCategory": "细粒度响应",
          "tags": [
            "SolidJS",
            "性能"
          ]
        },
        {
          "url": "https://nuxt.com/",
          "title": "Nuxt 官方门户",
          "description": "直观、健壮的 Vue 全栈元框架，提供极致的开发者开箱即用体验。",
          "category": "核心框架",
          "subCategory": "Vue生态",
          "tags": [
            "Nuxt",
            "Vue全栈"
          ]
        },
        {
          "url": "https://remix.run/",
          "title": "Remix",
          "description": "由 React Router 团队主导、专注 Web 标准与极致网络弹性的全栈框架。",
          "category": "核心框架",
          "subCategory": "Web标准",
          "tags": [
            "Remix",
            "全栈"
          ]
        },
        {
          "url": "https://angular.dev/",
          "title": "Angular",
          "description": "Google 维护的企业级 TypeScript 前端应用平台，包含新一代 Signals。",
          "category": "核心框架",
          "subCategory": "企业级",
          "tags": [
            "Angular",
            "Google"
          ]
        },
        {
          "url": "https://vite.dev/",
          "title": "Vite 官方中文",
          "description": "下一代前端开发与构建工具，以闪电般的冷启动和热更新重塑开发体验。",
          "category": "核心框架",
          "subCategory": "通用工具",
          "tags": [
            "Vite",
            "前端构建"
          ]
        },
        {
          "url": "https://turbo.build/repo",
          "title": "Turborepo",
          "description": "Vercel 打造的高性能 JavaScript 与 TypeScript Monorepo 构建系统。",
          "category": "构建与工程化",
          "subCategory": "Monorepo",
          "tags": [
            "Turborepo",
            "构建缓存"
          ]
        },
        {
          "url": "https://biomejs.dev/",
          "title": "Biome",
          "description": "采用 Rust 编写的极速工具链，兼具极速格式化与代码质量静态检查能力。",
          "category": "构建与工程化",
          "subCategory": "Rust工具",
          "tags": [
            "Biome",
            "格式化"
          ]
        },
        {
          "url": "https://bun.sh/",
          "title": "Bun",
          "description": "集全功能包管理、测试器、打包器于一身的极致超快全合一 JS/TS 运行时。",
          "category": "构建与工程化",
          "subCategory": "全能运行时",
          "tags": [
            "Bun",
            "极速"
          ]
        },
        {
          "url": "https://pnpm.io/",
          "title": "pnpm",
          "description": "基于硬链接与符号链接的极速、节省磁盘空间的现代包管理器。",
          "category": "构建与工程化",
          "subCategory": "包管理",
          "tags": [
            "pnpm",
            "依赖管理"
          ]
        },
        {
          "url": "https://esbuild.github.io/",
          "title": "esbuild",
          "description": "使用 Go 编写的极速 JavaScript 与 CSS 极简代码打包编译器。",
          "category": "构建与工程化",
          "subCategory": "编译器",
          "tags": [
            "esbuild",
            "Go"
          ]
        },
        {
          "url": "https://swc.rs/",
          "title": "SWC",
          "description": "使用 Rust 编写的超快 TypeScript / JavaScript 编译与压缩平台。",
          "category": "构建与工程化",
          "subCategory": "编译器",
          "tags": [
            "SWC",
            "Rust"
          ]
        },
        {
          "url": "https://www.rspack.dev/",
          "title": "Rspack",
          "description": "基于 Rust 编写的高性能 Web 构建工具，与 Webpack 架构生态高度兼容。",
          "category": "构建与工程化",
          "subCategory": "高性能构建",
          "tags": [
            "Rspack",
            "字节跳动"
          ]
        },
        {
          "url": "https://nx.dev/",
          "title": "Nx",
          "description": "智能、高扩展性的 Monorepo 编排套件，具备强大的任务调度与依赖图谱。",
          "category": "构建与工程化",
          "subCategory": "Monorepo",
          "tags": [
            "Nx",
            "依赖图"
          ]
        },
        {
          "url": "https://rollupjs.org/",
          "title": "Rollup",
          "description": "下一代 ES 模块打包器，构建纯净小巧类库与 SDK 的行业公认标准。",
          "category": "构建与工程化",
          "subCategory": "库打包",
          "tags": [
            "Rollup",
            "ESM"
          ]
        },
        {
          "url": "https://prettier.io/",
          "title": "Prettier",
          "description": "广受采纳的代码美化与强制统一格式化工具，支持几乎全部前端语言。",
          "category": "构建与工程化",
          "subCategory": "格式化",
          "tags": [
            "Prettier",
            "规范"
          ]
        },
        {
          "url": "https://nodejs.org/",
          "title": "Node.js 官方网站",
          "description": "基于 Chrome V8 引擎构建的异步事件驱动 JavaScript 全球通用运行时。",
          "category": "全栈与服务端",
          "subCategory": "基础设施",
          "tags": [
            "Node.js",
            "V8"
          ]
        },
        {
          "url": "https://deno.com/",
          "title": "Deno 官方网站",
          "description": "原生支持 TypeScript、具备严密安全沙箱与开箱即用 Web 标准的现代运行时。",
          "category": "全栈与服务端",
          "subCategory": "现代运行时",
          "tags": [
            "Deno",
            "TypeScript"
          ]
        },
        {
          "url": "https://hono.dev/",
          "title": "Hono",
          "description": "极速、极轻量且支持 Cloudflare、Deno、Bun 等任意环境的 Web 标准框架。",
          "category": "全栈与服务端",
          "subCategory": "边缘框架",
          "tags": [
            "Hono",
            "极轻量"
          ]
        },
        {
          "url": "https://elysiajs.com/",
          "title": "ElysiaJS",
          "description": "为 Bun 深度定制的人体工学校验强类型极速服务端 API 框架。",
          "category": "全栈与服务端",
          "subCategory": "Bun框架",
          "tags": [
            "Elysia",
            "类型安全"
          ]
        },
        {
          "url": "https://fastify.dev/",
          "title": "Fastify",
          "description": "专注于极高吞吐量与极低开销的 Node.js 现代异步高并发 Web 框架。",
          "category": "全栈与服务端",
          "subCategory": "高并发",
          "tags": [
            "Fastify",
            "吞吐量"
          ]
        },
        {
          "url": "https://nestjs.com/",
          "title": "NestJS",
          "description": "采用优雅模块化架构与依赖注入的企业级 TypeScript 服务端开发框架。",
          "category": "全栈与服务端",
          "subCategory": "企业级架构",
          "tags": [
            "NestJS",
            "架构"
          ]
        },
        {
          "url": "https://trpc.io/",
          "title": "tRPC",
          "description": "无需代码生成或模式校验的端到端类型安全 API 协同方案。",
          "category": "全栈与服务端",
          "subCategory": "类型安全",
          "tags": [
            "tRPC",
            "全栈通讯"
          ]
        },
        {
          "url": "https://nitro.unjs.io/",
          "title": "Nitro",
          "description": "UnJS 打造的跨引擎全栈服务端工具包，驱动 Nuxt 等现代元框架核心。",
          "category": "全栈与服务端",
          "subCategory": "服务引擎",
          "tags": [
            "Nitro",
            "UnJS"
          ]
        },
        {
          "url": "https://expressjs.com/",
          "title": "Express 官方门户",
          "description": "历史悠久、生态庞大且简洁灵活的经典 Node.js Web 应用程序基础设施。",
          "category": "全栈与服务端",
          "subCategory": "经典框架",
          "tags": [
            "Express",
            "成熟稳定"
          ]
        },
        {
          "url": "https://graphql.org/",
          "title": "GraphQL 官方门户",
          "description": "用于 API 的查询语言，让客户端精确声明所需要的数据结构。",
          "category": "全栈与服务端",
          "subCategory": "API规范",
          "tags": [
            "GraphQL",
            "查询语言"
          ]
        },
        {
          "url": "https://github.com/",
          "title": "GitHub",
          "description": "全球顶级开源社区与协同开发平台，汇聚亿级开发者与核心软件生态。",
          "category": "代码托管",
          "subCategory": "全球顶级",
          "tags": [
            "GitHub",
            "开源社区"
          ]
        },
        {
          "url": "https://gitlab.com/",
          "title": "GitLab",
          "description": "集代码托管、审查、CI/CD 与 DevSecOps 于一体的一站式敏捷协同套件。",
          "category": "代码托管",
          "subCategory": "一站式",
          "tags": [
            "GitLab",
            "DevSecOps"
          ]
        },
        {
          "url": "https://gitee.com/",
          "title": "Gitee (码云)",
          "description": "国内领先的开源代码托管与研发协作平台，深度适配信创环境。",
          "category": "代码托管",
          "subCategory": "国内主力",
          "tags": [
            "Gitee",
            "国内协作"
          ]
        },
        {
          "url": "https://codeberg.org/",
          "title": "Codeberg",
          "description": "由非营利组织运营、基于 Forgejo 打造的尊重隐私自由软件托管社区。",
          "category": "代码托管",
          "subCategory": "开源公益",
          "tags": [
            "Codeberg",
            "自由软件"
          ]
        },
        {
          "url": "https://gitea.com/",
          "title": "Gitea",
          "description": "超轻量、易搭建且低资源开销的自托管 Git 协同软件。",
          "category": "代码托管",
          "subCategory": "自托管",
          "tags": [
            "Gitea",
            "轻量"
          ]
        },
        {
          "url": "https://forgejo.org/",
          "title": "Forgejo",
          "description": "致力于完全社区驱动、免受商业控制的独立 Git 协作托管平台分支。",
          "category": "代码托管",
          "subCategory": "社区开源",
          "tags": [
            "Forgejo",
            "独立"
          ]
        },
        {
          "url": "https://bitbucket.org/",
          "title": "Bitbucket",
          "description": "Atlassian 旗下代码托管，与 Jira 及 Confluence 深度联动的企业方案。",
          "category": "代码托管",
          "subCategory": "企业套件",
          "tags": [
            "Bitbucket",
            "Jira"
          ]
        },
        {
          "url": "https://sr.ht/",
          "title": "sourcehut",
          "description": "无追踪、无 JS 依赖的高性能纯粹黑客级模块化代码协作基础设施。",
          "category": "代码托管",
          "subCategory": "极简黑客",
          "tags": [
            "sourcehut",
            "极简"
          ]
        },
        {
          "url": "https://radicle.xyz/",
          "title": "Radicle",
          "description": "基于点对点网络的去中心化、抗审查分布式代码协作与托管协议。",
          "category": "代码托管",
          "subCategory": "P2P网络",
          "tags": [
            "Radicle",
            "去中心化"
          ]
        },
        {
          "url": "https://gitkraken.com/",
          "title": "GitKraken",
          "description": "具备卓越可视化界面的跨平台 Git 客户端与团队协同工具箱。",
          "category": "代码托管",
          "subCategory": "GUI工具",
          "tags": [
            "GitKraken",
            "Git客户端"
          ]
        },
        {
          "url": "https://devdocs.io/",
          "title": "DevDocs",
          "description": "将数百份主流开源技术与语言手册汇聚一处的高性能离线 API 速查手册。",
          "category": "官方文档",
          "subCategory": "聚合速查",
          "tags": [
            "DevDocs",
            "全栈手册"
          ]
        },
        {
          "url": "https://developer.mozilla.org/",
          "title": "MDN Web Docs",
          "description": "由 Mozilla 维护的 Web 前端标准技术权威文献与详尽实践参考。",
          "category": "官方文档",
          "subCategory": "Web标准",
          "tags": [
            "MDN",
            "Web规范"
          ]
        },
        {
          "url": "https://www.typescriptlang.org/docs/",
          "title": "TypeScript 官方手册",
          "description": "TypeScript 语法、高级类型系统与编译器配置全面官方参考。",
          "category": "官方文档",
          "subCategory": "类型语言",
          "tags": [
            "TypeScript",
            "手册"
          ]
        },
        {
          "url": "https://docs.python.org/zh-cn/3/",
          "title": "Python 官方中文文档",
          "description": "Python 3 标准库规范、解释器使用与内置函数权威官方指南。",
          "category": "官方文档",
          "subCategory": "官方中文",
          "tags": [
            "Python",
            "标准库"
          ]
        },
        {
          "url": "https://doc.rust-lang.org/book/",
          "title": "The Rust Programming Language",
          "description": "全球知名的 Rust 官方入门与进阶核心概念权威原著与指南。",
          "category": "官方文档",
          "subCategory": "系统编程",
          "tags": [
            "Rust",
            "RustBook"
          ]
        },
        {
          "url": "https://go.dev/doc/",
          "title": "Go 官方文档",
          "description": "Go 语言规范、包管理工具与官方并发模式标准参考资料。",
          "category": "官方文档",
          "subCategory": "并发语言",
          "tags": [
            "Go",
            "Golang"
          ]
        },
        {
          "url": "https://docs.docker.com/",
          "title": "Docker 官方文档",
          "description": "容器镜像构建、网络配置与 Compose 编排的官方指南与手册。",
          "category": "官方文档",
          "subCategory": "容器标准",
          "tags": [
            "Docker",
            "容器化"
          ]
        },
        {
          "url": "https://kubernetes.io/docs/home/",
          "title": "Kubernetes 官方文档",
          "description": "生产级容器集群编排系统核心概念、API 对象与运维标准说明书。",
          "category": "官方文档",
          "subCategory": "集群编排",
          "tags": [
            "Kubernetes",
            "K8s"
          ]
        },
        {
          "url": "https://tailwindcss.com/docs",
          "title": "Tailwind CSS 文档",
          "description": "原子化 CSS 框架的工具类速查、配置指南与样式设计系统。",
          "category": "官方文档",
          "subCategory": "CSS系统",
          "tags": [
            "Tailwind",
            "CSS"
          ]
        },
        {
          "url": "https://docs.github.com/",
          "title": "GitHub 官方文档",
          "description": "GitHub 全部功能模块、Actions 编写规范与 REST/GraphQL API 手册。",
          "category": "官方文档",
          "subCategory": "协同平台",
          "tags": [
            "GitHub Docs",
            "API"
          ]
        },
        {
          "url": "https://stackblitz.com/",
          "title": "StackBlitz",
          "description": "在浏览器原生运行 Node.js 运行时的超快免配置云端 WebContainers IDE。",
          "category": "在线演练场",
          "subCategory": "Web容器",
          "tags": [
            "StackBlitz",
            "云IDE"
          ]
        },
        {
          "url": "https://codesandbox.io/",
          "title": "CodeSandbox",
          "description": "强大的全栈即时开发与代码沙箱平台，支持多人实时协作与分支预览。",
          "category": "在线演练场",
          "subCategory": "协作沙盒",
          "tags": [
            "CodeSandbox",
            "即时协作"
          ]
        },
        {
          "url": "https://replit.com/",
          "title": "Replit",
          "description": "支持 50+ 种语言的协同云编程平台，内置 AI 辅助与一键托管能力。",
          "category": "在线演练场",
          "subCategory": "多语言云端",
          "tags": [
            "Replit",
            "在线运行"
          ]
        },
        {
          "url": "https://codepen.io/",
          "title": "CodePen",
          "description": "全球前端设计师与开发者展示 HTML、CSS、JS 交互原型的创意社交沙盒。",
          "category": "在线演练场",
          "subCategory": "前端创意",
          "tags": [
            "CodePen",
            "前端演示"
          ]
        },
        {
          "url": "https://jsfiddle.net/",
          "title": "JSFiddle",
          "description": "极简经典且经久不衰的 Web 代码片段即时测试与 Bug 复现分享平台。",
          "category": "在线演练场",
          "subCategory": "复现调试",
          "tags": [
            "JSFiddle",
            "代码调试"
          ]
        },
        {
          "url": "https://play.rust-lang.org/",
          "title": "Rust Playground",
          "description": "Rust 官方提供的在线代码编写、实时编译与汇编代码查看演练场。",
          "category": "在线演练场",
          "subCategory": "语言官方",
          "tags": [
            "Rust Playground",
            "在线编译"
          ]
        },
        {
          "url": "https://www.typescriptlang.org/play",
          "title": "TypeScript Playground",
          "description": "官方在线调试 TS 类型推导、查看转译 JS 与修改 tsconfig 的调试台。",
          "category": "在线演练场",
          "subCategory": "类型演算",
          "tags": [
            "TS Playground",
            "类型调试"
          ]
        },
        {
          "url": "https://go.dev/play/",
          "title": "Go Playground",
          "description": "Go 官方沙盒环境，即时运行并安全分享 Go 程序代码片段。",
          "category": "在线演练场",
          "subCategory": "语言官方",
          "tags": [
            "Go Playground",
            "并发运行"
          ]
        },
        {
          "url": "https://glitch.com/",
          "title": "Glitch",
          "description": "充满趣味的全栈 Web 应用协作孵化沙盒，支持快速混搭现有开源代码。",
          "category": "在线演练场",
          "subCategory": "应用混搭",
          "tags": [
            "Glitch",
            "原型验证"
          ]
        },
        {
          "url": "https://pythontutor.com/",
          "title": "Python Tutor",
          "description": "逐行可视化程序内存图、指针与变量状态变化的教学级演练工具。",
          "category": "在线演练场",
          "subCategory": "可视化执行",
          "tags": [
            "Python Tutor",
            "执行分析"
          ]
        },
        {
          "url": "https://regex101.com/",
          "title": "Regex101",
          "description": "支持实时语法拆解、详尽错误诊断与代码生成的一站式正则表达式调试台。",
          "category": "编码小工具",
          "subCategory": "正则分析",
          "tags": [
            "Regex",
            "正则表达式"
          ]
        },
        {
          "url": "https://jsoncrack.com/",
          "title": "JSON Crack",
          "description": "将复杂的嵌套 JSON 数据一键转化为清晰树状交互图的可视化工具。",
          "category": "编码小工具",
          "subCategory": "数据透视",
          "tags": [
            "JSON",
            "数据可视化"
          ]
        },
        {
          "url": "https://transform.tools/",
          "title": "Transform Tools",
          "description": "多语言在线数据转换站：支持 JSON 转 TS、SVG 转 JSX、CSS 转 JS 等。",
          "category": "编码小工具",
          "subCategory": "格式转译",
          "tags": [
            "Transform",
            "代码转换"
          ]
        },
        {
          "url": "https://carbon.now.sh/",
          "title": "Carbon",
          "description": "将代码片段生成为精美、带高亮配色与自定义阴影的绝美截图工具。",
          "category": "编码小工具",
          "subCategory": "代码排版",
          "tags": [
            "Carbon",
            "截图分享"
          ]
        },
        {
          "url": "https://quicktype.io/",
          "title": "quicktype",
          "description": "从任意 JSON、Schema 即时自动生成几十种语言的强类型接口模型。",
          "category": "编码小工具",
          "subCategory": "类型生成",
          "tags": [
            "quicktype",
            "类型生成"
          ]
        },
        {
          "url": "https://gchq.github.io/CyberChef/",
          "title": "CyberChef",
          "description": "英国 GCHQ 出品的全能数据网络瑞士军刀，支持百种编解码与加密算法。",
          "category": "编码小工具",
          "subCategory": "密码转换",
          "tags": [
            "CyberChef",
            "加密解密"
          ]
        },
        {
          "url": "https://crontab.guru/",
          "title": "Crontab Guru",
          "description": "直观交互式 Cron 定时表达式编写、含义解析与下次执行时刻预演工具。",
          "category": "编码小工具",
          "subCategory": "运维定时",
          "tags": [
            "Cron",
            "时间表达式"
          ]
        },
        {
          "url": "https://diffchecker.com/",
          "title": "Diffchecker",
          "description": "支持文本、图片、PDF 和表格文件的在线多行对比与差异高亮工具。",
          "category": "编码小工具",
          "subCategory": "文本比对",
          "tags": [
            "Diff",
            "差异比对"
          ]
        },
        {
          "url": "https://squoosh.app/",
          "title": "Squoosh",
          "description": "Google 推出的浏览器端极速图片压缩利器，支持 WebP、AVIF 无损优化。",
          "category": "编码小工具",
          "subCategory": "资源压缩",
          "tags": [
            "Squoosh",
            "图片处理"
          ]
        },
        {
          "url": "https://base64.guru/",
          "title": "Base64 Guru",
          "description": "专业的 Base64 编码解码、图片预览与各种网络协议转化参考站。",
          "category": "编码小工具",
          "subCategory": "数据转换",
          "tags": [
            "Base64",
            "格式互转"
          ]
        },
        {
          "url": "https://hoppscotch.io/",
          "title": "Hoppscotch",
          "description": "完全开源且轻量优雅的 Web 原生 API 开发调试与测试套件。",
          "category": "接口调试",
          "subCategory": "开源轻量",
          "tags": [
            "Hoppscotch",
            "REST"
          ]
        },
        {
          "url": "https://www.postman.com/",
          "title": "Postman",
          "description": "全球领先的 API 协同开发与生命周期平台，支持测试集合与 Mock。",
          "category": "接口调试",
          "subCategory": "全功能",
          "tags": [
            "Postman",
            "API测试"
          ]
        },
        {
          "url": "https://insomnia.rest/",
          "title": "Insomnia",
          "description": "Kong 旗下简洁高效的开源 API 客户端，全面支持 GraphQL 与 gRPC 调试。",
          "category": "接口调试",
          "subCategory": "现代化客户端",
          "tags": [
            "Insomnia",
            "gRPC"
          ]
        },
        {
          "url": "https://usebruno.com/",
          "title": "Bruno",
          "description": "完全离线、以纯文本文件存储在 Git 仓库里的下一代轻量 API 客户端。",
          "category": "接口调试",
          "subCategory": "Git友好",
          "tags": [
            "Bruno",
            "本地优先"
          ]
        },
        {
          "url": "https://apifox.com/",
          "title": "Apifox (ApiFox)",
          "description": "集 API 文档、API 调试、API Mock 与自动化测试于一体的高效协作神器。",
          "category": "接口调试",
          "subCategory": "一体化",
          "tags": [
            "Apifox",
            "国内标杆"
          ]
        },
        {
          "url": "https://httpie.io/",
          "title": "HTTPie",
          "description": "拥有现代图形界面与人类友好命令行的优雅网络测试工具。",
          "category": "接口调试",
          "subCategory": "终端/GUI",
          "tags": [
            "HTTPie",
            "人机友好"
          ]
        },
        {
          "url": "https://mockoon.com/",
          "title": "Mockoon",
          "description": "开源本地 Mock 服务器工具，几秒内快速模拟高度定制的 REST 接口。",
          "category": "接口调试",
          "subCategory": "本地Mock",
          "tags": [
            "Mockoon",
            "接口模拟"
          ]
        },
        {
          "url": "https://editor.swagger.io/",
          "title": "Swagger Editor",
          "description": "OpenAPI (Swagger) 规范的官方在线编写、验证与客户端代码生成台。",
          "category": "接口调试",
          "subCategory": "规范设计",
          "tags": [
            "Swagger",
            "OpenAPI"
          ]
        },
        {
          "url": "https://yaak.app/",
          "title": "Yaak",
          "description": "使用 Rust 与 Tauri 构建的极快极简桌面 API 接口客户端。",
          "category": "接口调试",
          "subCategory": "Tauri客户端",
          "tags": [
            "Yaak",
            "Rust"
          ]
        },
        {
          "url": "https://echoapi.com/",
          "title": "EchoAPI",
          "description": "超轻量级的 API 调试工具，无需登录即可秒级发起各种复杂 HTTP 请求。",
          "category": "接口调试",
          "subCategory": "即时调试",
          "tags": [
            "EchoAPI",
            "免登"
          ]
        },
        {
          "url": "https://explainshell.com/",
          "title": "explainshell",
          "description": "将复杂的 Linux 终端复合命令逐个参数匹配并拆解其 man 手册含义。",
          "category": "命令行速查",
          "subCategory": "命令拆解",
          "tags": [
            "explainshell",
            "Linux"
          ]
        },
        {
          "url": "https://tldr.sh/",
          "title": "tldr pages",
          "description": "社区驱动的简明实用终端命令手册，直奔最常使用的案例代码范式。",
          "category": "命令行速查",
          "subCategory": "实战案例",
          "tags": [
            "tldr",
            "速查表"
          ]
        },
        {
          "url": "https://cheat.sh/",
          "title": "cheat.sh",
          "description": "终端专用的统一速查入口，用 curl 即可直接获取语言与命令高亮答案。",
          "category": "命令行速查",
          "subCategory": "终端速查",
          "tags": [
            "cheat.sh",
            "curl"
          ]
        },
        {
          "url": "https://cmdchallenge.com/",
          "title": "Command Challenge",
          "description": "交互式命令行挑战靶场，通过一系列趣味实战题磨炼高级 Shell 技能。",
          "category": "命令行速查",
          "subCategory": "实战打靶",
          "tags": [
            "Linux靶场",
            "挑战"
          ]
        },
        {
          "url": "https://www.commandlinefu.com/",
          "title": "Commandlinefu",
          "description": "全球 Unix/Linux 极客分享与点赞高阶精妙一行命令的宝库。",
          "category": "命令行速查",
          "subCategory": "极客技巧",
          "tags": [
            "一行命令",
            "极客"
          ]
        },
        {
          "url": "https://wangchujiang.com/linux-command/",
          "title": "Linux 命令搜索",
          "description": "最全面的 Linux 命令中文搜索引擎，提供详细示例与说明文档。",
          "category": "命令行速查",
          "subCategory": "中文手册",
          "tags": [
            "Linux",
            "中文命令"
          ]
        },
        {
          "url": "https://www.shellcheck.net/",
          "title": "ShellCheck",
          "description": "静态分析 Bash / sh 脚本的知名利器，精准指出语法陷阱与安全隐患。",
          "category": "命令行速查",
          "subCategory": "脚本静态检查",
          "tags": [
            "ShellCheck",
            "Bash检查"
          ]
        },
        {
          "url": "https://www.warp.dev/",
          "title": "Warp Terminal",
          "description": "针对现代软件团队打造的 AI 驱动现代化终端，具备块级交互与云端知识库。",
          "category": "命令行速查",
          "subCategory": "现代终端",
          "tags": [
            "Warp",
            "AI终端"
          ]
        },
        {
          "url": "https://starship.rs/",
          "title": "Starship",
          "description": "极快、极具可定制性、适用任意 Shell 终端的跨环境通用提示符引擎。",
          "category": "命令行速查",
          "subCategory": "终端美化",
          "tags": [
            "Starship",
            "提示符"
          ]
        },
        {
          "url": "https://ohmyz.sh/",
          "title": "Oh My Zsh",
          "description": "全球极受欢迎的开源社区驱动 Zsh 配置管理框架，内置海量插件与主题。",
          "category": "命令行速查",
          "subCategory": "Zsh框架",
          "tags": [
            "OhMyZsh",
            "终端环境"
          ]
        },
        {
          "url": "https://www.sonarsource.com/products/sonarqube/",
          "title": "SonarQube",
          "description": "业界知名的代码质量与静态安全检查平台，深度监控异味与测试覆盖度。",
          "category": "代码评审",
          "subCategory": "质量平台",
          "tags": [
            "SonarQube",
            "静态分析"
          ]
        },
        {
          "url": "https://codeclimate.com/",
          "title": "Code Climate",
          "description": "为工程团队提供自动化代码评审、技术债务分析与测试覆盖率跟踪。",
          "category": "代码评审",
          "subCategory": "质量追踪",
          "tags": [
            "Code Climate",
            "技术债"
          ]
        },
        {
          "url": "https://github.com/reviewdog/reviewdog",
          "title": "reviewdog",
          "description": "将任意静态代码检查工具的报错自动以评论形式呈现在 Pull Request 中。",
          "category": "代码评审",
          "subCategory": "自动评论",
          "tags": [
            "reviewdog",
            "PR机器人"
          ]
        },
        {
          "url": "https://codescene.com/",
          "title": "CodeScene",
          "description": "通过分析代码变更频率与开发者行为洞察代码健康度与组织风险的智能分析台。",
          "category": "代码评审",
          "subCategory": "行为分析",
          "tags": [
            "CodeScene",
            "架构风险"
          ]
        },
        {
          "url": "https://www.gitguardian.com/",
          "title": "GitGuardian",
          "description": "实时扫描代码仓库与提交历史中的 API 密钥、密码与敏感凭证泄露。",
          "category": "代码评审",
          "subCategory": "密钥扫描",
          "tags": [
            "GitGuardian",
            "安全合规"
          ]
        },
        {
          "url": "https://deepsource.com/",
          "title": "DeepSource",
          "description": "接入 CI/CD 的持续代码分析套件，支持自动修复安全隐患与性能缺陷。",
          "category": "代码评审",
          "subCategory": "自动修复",
          "tags": [
            "DeepSource",
            "持续分析"
          ]
        },
        {
          "url": "https://www.jetbrains.com/qodana/",
          "title": "Qodana",
          "description": "JetBrains 打造的代码质量监控引擎，将 IDE 级的静态检查带入 CI 流水线。",
          "category": "代码评审",
          "subCategory": "IDE级引擎",
          "tags": [
            "Qodana",
            "JetBrains"
          ]
        },
        {
          "url": "https://reviewable.io/",
          "title": "Reviewable",
          "description": "专为 GitHub 设计的高效代码审查辅助工具，支持逐字 diff 与状态标记。",
          "category": "代码评审",
          "subCategory": "审查增强",
          "tags": [
            "Reviewable",
            "GitHub增强"
          ]
        },
        {
          "url": "https://www.gerritcodereview.com/",
          "title": "Gerrit",
          "description": "Google 开发的基于 Git 的基于变更的网页代码审查系统，专为超大项目设计。",
          "category": "代码评审",
          "subCategory": "巨型项目",
          "tags": [
            "Gerrit",
            "Google架构"
          ]
        },
        {
          "url": "https://semgrep.dev/",
          "title": "Semgrep",
          "description": "轻量、超快的静态代码分析与安全规则扫描引擎，用代码模式搜寻漏洞。",
          "category": "代码评审",
          "subCategory": "代码模式扫描",
          "tags": [
            "Semgrep",
            "安全规则"
          ]
        },
        {
          "url": "https://github.com/features/actions",
          "title": "GitHub Actions",
          "description": "深度内嵌于 GitHub 的全自动 CI/CD 流水线，拥有海量现成市场插件。",
          "category": "持续交付",
          "subCategory": "主流流水线",
          "tags": [
            "GitHub Actions",
            "CI/CD"
          ]
        },
        {
          "url": "https://argoproj.github.io/cd/",
          "title": "Argo CD",
          "description": "专为 Kubernetes 打造的声明式、GitOps 持续交付控制器行业事实标准。",
          "category": "持续交付",
          "subCategory": "GitOps标准",
          "tags": [
            "ArgoCD",
            "Kubernetes"
          ]
        },
        {
          "url": "https://fluxcd.io/",
          "title": "Flux",
          "description": "CNCF 毕业项目，保证 K8s 集群与 Git 配置完全一致的 GitOps 工具族。",
          "category": "持续交付",
          "subCategory": "GitOps控制",
          "tags": [
            "Flux",
            "CNCF"
          ]
        },
        {
          "url": "https://www.jenkins.io/",
          "title": "Jenkins",
          "description": "经典开源自动化服务器，提供数千个集成插件满足任意企业定制构建。",
          "category": "持续交付",
          "subCategory": "经典引擎",
          "tags": [
            "Jenkins",
            "自动化构建"
          ]
        },
        {
          "url": "https://drone.io/",
          "title": "Drone",
          "description": "基于 Docker 容器原生架构构建的极简、轻量级持续集成平台。",
          "category": "持续交付",
          "subCategory": "容器原生",
          "tags": [
            "Drone",
            "容器CI"
          ]
        },
        {
          "url": "https://woodpecker-ci.org/",
          "title": "Woodpecker CI",
          "description": "社区驱动、由 Drone 分裂而来的开源纯净多架构容器化流水线系统。",
          "category": "持续交付",
          "subCategory": "社区开源",
          "tags": [
            "Woodpecker",
            "容器化"
          ]
        },
        {
          "url": "https://tekton.dev/",
          "title": "Tekton",
          "description": "强大而灵活的 Kubernetes 原生开源 CI/CD 流水线构建框架与基础抽象。",
          "category": "持续交付",
          "subCategory": "K8s原生",
          "tags": [
            "Tekton",
            "云原生CI"
          ]
        },
        {
          "url": "https://circleci.com/",
          "title": "CircleCI",
          "description": "支持智能测试拆分与高并发构建的知名云原生持续集成企业服务平台。",
          "category": "持续交付",
          "subCategory": "企业级CI",
          "tags": [
            "CircleCI",
            "并发加速"
          ]
        },
        {
          "url": "https://spinnaker.io/",
          "title": "Spinnaker",
          "description": "Netflix 主导的开源多云持续交付平台，提供高级部署策略如灰度和蓝绿。",
          "category": "持续交付",
          "subCategory": "多云发布",
          "tags": [
            "Spinnaker",
            "灰度发布"
          ]
        },
        {
          "url": "https://dagger.io/",
          "title": "Dagger",
          "description": "用普通编程语言即可编写的便携式 CI/CD 引擎，消灭流水线胶水脚本。",
          "category": "持续交付",
          "subCategory": "代码化流水线",
          "tags": [
            "Dagger",
            "可编程CI"
          ]
        },
        {
          "url": "https://prometheus.io/",
          "title": "Prometheus",
          "description": "开源监控与时序警报系统的绝对标准，拥有强大的 PromQL 聚合语言。",
          "category": "可观测与监控",
          "subCategory": "指标时序",
          "tags": [
            "Prometheus",
            "时序监控"
          ]
        },
        {
          "url": "https://grafana.com/",
          "title": "Grafana",
          "description": "业内广泛采纳的操作与指标可视化仪表盘，兼容数十种主流数据源接入。",
          "category": "可观测与监控",
          "subCategory": "仪表大盘",
          "tags": [
            "Grafana",
            "大盘展示"
          ]
        },
        {
          "url": "https://opentelemetry.io/",
          "title": "OpenTelemetry",
          "description": "CNCF 旗舰规范，为应用指标、链路日志与追踪提供统一标准 API 与 SDK。",
          "category": "可观测与监控",
          "subCategory": "统一标准",
          "tags": [
            "OTel",
            "链路追踪"
          ]
        },
        {
          "url": "https://sentry.io/",
          "title": "Sentry",
          "description": "应用崩溃报错实时捕获、堆栈回溯与全链路性能监控的行业黄金标准。",
          "category": "可观测与监控",
          "subCategory": "错误跟踪",
          "tags": [
            "Sentry",
            "崩溃告警"
          ]
        },
        {
          "url": "https://www.datadoghq.com/",
          "title": "Datadog",
          "description": "云时代全面的全栈应用监控、日志分析与安全态势综合感知服务商。",
          "category": "可观测与监控",
          "subCategory": "全栈APM",
          "tags": [
            "Datadog",
            "企业APM"
          ]
        },
        {
          "url": "https://www.jaegertracing.io/",
          "title": "Jaeger",
          "description": "由 Uber 开源的 CNCF 分布式端到端链路追踪与微服务根因定位系统。",
          "category": "可观测与监控",
          "subCategory": "微服务追踪",
          "tags": [
            "Jaeger",
            "链路分析"
          ]
        },
        {
          "url": "https://victoriametrics.com/",
          "title": "VictoriaMetrics",
          "description": "极快、高性价比、极省内存的高可用时序数据库与 Prometheus 替代方案。",
          "category": "可观测与监控",
          "subCategory": "高性能时序",
          "tags": [
            "VictoriaMetrics",
            "低成本"
          ]
        },
        {
          "url": "https://uptime.kuma.pet/",
          "title": "Uptime Kuma",
          "description": "界面精美、支持多协议探测与丰富通知推送的自托管服务可用性监控利器。",
          "category": "可观测与监控",
          "subCategory": "探活告警",
          "tags": [
            "UptimeKuma",
            "自托管"
          ]
        },
        {
          "url": "https://glitchtip.com/",
          "title": "GlitchTip",
          "description": "与 Sentry API 深度兼容、尊重隐私且易于轻量私有化部署的开源错误追踪站。",
          "category": "可观测与监控",
          "subCategory": "开源Sentry",
          "tags": [
            "GlitchTip",
            "开源替代"
          ]
        },
        {
          "url": "https://betterstack.com/uptime",
          "title": "Better Stack Uptime",
          "description": "为团队提供优雅的状态页展示、异常心跳监控与快速事件响应协同台。",
          "category": "可观测与监控",
          "subCategory": "状态页协同",
          "tags": [
            "BetterStack",
            "状态页"
          ]
        },
        {
          "url": "https://infisical.com/",
          "title": "Infisical",
          "description": "开源的端到端端加密秘密与配置管理平台，轻松在团队与 CI/CD 间同步密钥。",
          "category": "应用与密钥安全",
          "subCategory": "秘密管理",
          "tags": [
            "Infisical",
            "环境变量"
          ]
        },
        {
          "url": "https://www.vaultproject.io/",
          "title": "HashiCorp Vault",
          "description": "企业级敏感数据、访问令牌、动态证书与加密密钥安全管理事实标准。",
          "category": "应用与密钥安全",
          "subCategory": "企业秘密中心",
          "tags": [
            "Vault",
            "HashiCorp"
          ]
        },
        {
          "url": "https://www.doppler.com/",
          "title": "Doppler",
          "description": "为所有开发环境与云平台集中自动化管理应用机密与环境配置的云服务。",
          "category": "应用与密钥安全",
          "subCategory": "云机密管理",
          "tags": [
            "Doppler",
            "配置中心"
          ]
        },
        {
          "url": "https://github.com/getsops/sops",
          "title": "SOPS",
          "description": "支持通过 PGP、AWS KMS、GCP KMS 等对配置文件进行原子加密的开源工具。",
          "category": "应用与密钥安全",
          "subCategory": "配置加密",
          "tags": [
            "SOPS",
            "GitOps安全"
          ]
        },
        {
          "url": "https://bitwarden.com/products/secrets-manager/",
          "title": "Bitwarden Secrets Manager",
          "description": "Bitwarden 出品的开发者机密管理器，保护生产 API 凭据防泄漏。",
          "category": "应用与密钥安全",
          "subCategory": "团队秘密库",
          "tags": [
            "Bitwarden",
            "凭据保护"
          ]
        },
        {
          "url": "https://trivy.dev/",
          "title": "Trivy",
          "description": "全面的开源漏洞扫描器，可检测容器镜像、代码依赖、IaC 配置的安全隐患。",
          "category": "应用与密钥安全",
          "subCategory": "漏洞扫描",
          "tags": [
            "Trivy",
            "容器安全"
          ]
        },
        {
          "url": "https://snyk.io/",
          "title": "Snyk",
          "description": "开发者优先的安全平台，自动分析开源依赖库并提交一键修复漏洞的 PR。",
          "category": "应用与密钥安全",
          "subCategory": "依赖安全",
          "tags": [
            "Snyk",
            "漏洞修补"
          ]
        },
        {
          "url": "https://owasp.org/www-project-zap/",
          "title": "OWASP ZAP",
          "description": "全球广受采纳的免费开源 Web 应用程序自动化动态渗透安全测试工具。",
          "category": "应用与密钥安全",
          "subCategory": "动态扫描",
          "tags": [
            "ZAP",
            "OWASP"
          ]
        },
        {
          "url": "https://developer.1password.com/",
          "title": "1Password Developer Tools",
          "description": "将 1Password 的安全性带入命令行、SSH 密钥管理与流水线编排中。",
          "category": "应用与密钥安全",
          "subCategory": "SSH与凭证",
          "tags": [
            "1Password",
            "CLI凭证"
          ]
        },
        {
          "url": "https://cosign.sigstore.dev/",
          "title": "Sigstore Cosign",
          "description": "Linux 基金会托管的容器镜像签名、验证与软件供应链防篡改标准工具。",
          "category": "应用与密钥安全",
          "subCategory": "供应链安全",
          "tags": [
            "Cosign",
            "数字签名"
          ]
        }
      ]
    }
  }
};
