/**
 * 种子插件：开源大模型与本地私有化推理包（site-pack）
 *
 * 遵循 2026 前沿技术标准打造的旗舰级专业网址包。
 * 覆盖 19 大核心分类与 191 个前沿站点。
 */
import type { SeedPluginDef } from "../types.ts";

export const openModelsLocalInference: SeedPluginDef = {
  "slug": "open-models-local-inference",
  "status": "published",
  "manifest": {
    "manifestVersion": 1,
    "kind": "site-pack",
    "name": "开源大模型与本地私有化推理包",
    "description": "2026 前沿开源大模型与本地私有化推理全景武器库（19 大分类 / 195 个精选站点）：涵盖 DeepSeek、Qwen、Llama 等开源权重、Ollama 与 vLLM 本地推理引擎、端侧量化工具、GPU 显卡算力调优与私有化合规部署方案。",
    "icon": "🦙",
    "author": "NavHub 官方",
    "license": "Apache-2.0",
    "version": "1.0.0",
    "tags": [
      "开源大模型",
      "本地推理",
      "DeepSeek",
      "Ollama",
      "vLLM",
      "私有化",
      "量化"
    ],
    "payload": {
      "categories": [
        {
          "title": "模型与数据集",
          "description": "开源大模型权重、GGUF/AWQ 量化版本下载与官方模型仓库"
        },
        {
          "title": "AI 硬件与具身",
          "description": "AI 推理加速卡、GPU 算力集群管理、端侧推理板卡与驱动栈"
        },
        {
          "title": "模型训练与微调",
          "description": "本地全参及 LoRA/QLoRA 高效微调、长上下文扩展与训练套件"
        },
        {
          "title": "对话助手",
          "description": "支持本地直连 Ollama、vLLM 的现代化自托管与桌面对话客户端"
        },
        {
          "title": "AI 评测与学习",
          "description": "开源模型排行榜、显存计算器、本地推理基准测速与进阶教程"
        },
        {
          "title": "AI 安全与对齐",
          "description": "私有化内容安全护栏、数据脱敏、Prompt 注入防御与模型审计"
        },
        {
          "title": "向量库与 RAG",
          "description": "与本地模型紧密配合的本地嵌入模型、轻量向量库与私有知识库"
        },
        {
          "title": "智能体与自动化",
          "description": "完全使用本地开源模型驱动的自主任务编排与本地智能体框架"
        },
        {
          "title": "语言与运行时",
          "description": "驱动本地推理服务的高性能语言运行时、C/C++ 核心与 Python 绑定"
        },
        {
          "title": "容器与编排",
          "description": "GPU 容器化驱动、NVIDIA Container Toolkit 与 K8s 算力调度编排"
        },
        {
          "title": "数据库与存储",
          "description": "高速存储海量模型权重与中间张量的高性能文件系统与对象存储"
        },
        {
          "title": "可观测与监控",
          "description": "GPU 显存占用、利用率、推理吞吐 TPS 与首字延迟 TTFT 监控"
        },
        {
          "title": "信创与私有云",
          "description": "国产化算力芯片适配、私有云算力纳管与企业信创落地解决方案"
        },
        {
          "title": "代码托管",
          "description": "开源本地推理项目仓库、核心算法实现与代码索引平台"
        },
        {
          "title": "官方文档",
          "description": "主流开源框架官方部署手册、架构说明书与参数调优指南"
        },
        {
          "title": "算法面试",
          "description": "大模型算法工程师求职面试题库、手撕 Transformer 与系统架构"
        },
        {
          "title": "学术社区",
          "description": "顶级 AI 学术会议、论文复现代码榜与前沿技术交流讨论社区"
        },
        {
          "title": "开放获取",
          "description": "开放研究机构、开源学术联盟与免付费学术资源共享组织"
        },
        {
          "title": "文献检索",
          "description": "检索最新大模型架构、量化剪枝与推理加速突破的学术检索平台"
        }
      ],
      "sites": [
        {
          "url": "https://ollama.com/",
          "title": "Ollama 官方网站",
          "description": "在本地快速运行 Llama 3、DeepSeek、Qwen 等开源大模型的极简工具。",
          "category": "模型与数据集",
          "subCategory": "本地引擎",
          "tags": [
            "Ollama",
            "极简运行"
          ]
        },
        {
          "url": "https://lmstudio.ai/",
          "title": "LM Studio",
          "description": "优雅易用的跨平台桌面应用，轻松在本地机器搜索、下载与运行大模型。",
          "category": "模型与数据集",
          "subCategory": "桌面工具",
          "tags": [
            "LM Studio",
            "跨平台"
          ]
        },
        {
          "url": "https://github.com/ggerganov/llama.cpp/releases",
          "title": "llama.cpp Releases",
          "description": "纯 C/C++ 实现的本地推理基石项目，支持 CPU 与多后端 GPU 混合加速。",
          "category": "模型与数据集",
          "subCategory": "推理基石",
          "tags": [
            "llama.cpp",
            "C++加速"
          ]
        },
        {
          "url": "https://github.com/vllm-project/vllm/releases",
          "title": "vLLM 官方发布页",
          "description": "生产级高吞吐大模型推理与 Serving 框架，广泛应用于企业私有化部署。",
          "category": "模型与数据集",
          "subCategory": "高吞吐推理",
          "tags": [
            "vLLM",
            "PagedAttention"
          ]
        },
        {
          "url": "https://github.com/DeepSeek-ai/DeepSeek-V3",
          "title": "DeepSeek-V3 源码仓库",
          "description": "深度求索开源的高性能混合专家 (MoE) 架构大语言模型官方仓库。",
          "category": "模型与数据集",
          "subCategory": "开源标杆",
          "tags": [
            "DeepSeek",
            "MoE"
          ]
        },
        {
          "url": "https://github.com/DeepSeek-ai/DeepSeek-R1",
          "title": "DeepSeek-R1 推理模型",
          "description": "通过强化学习涌现出超强长思维链推理能力的前沿开源模型家族。",
          "category": "模型与数据集",
          "subCategory": "推理强化",
          "tags": [
            "DeepSeek-R1",
            "深度思考"
          ]
        },
        {
          "url": "https://github.com/QwenLM/Qwen2.5",
          "title": "通义千问 Qwen2.5",
          "description": "阿里巴巴开源的旗舰大模型家族，涵盖 0.5B 到 72B 全尺寸与优秀多模态。",
          "category": "模型与数据集",
          "subCategory": "国内开源",
          "tags": [
            "Qwen",
            "阿里开源"
          ]
        },
        {
          "url": "https://github.com/meta-llama/llama",
          "title": "Meta LLaMA 官方仓库",
          "description": "Meta 开源的全球标杆基础大模型项目，奠定现代开源大语言模型生态。",
          "category": "模型与数据集",
          "subCategory": "全球基准",
          "tags": [
            "LLaMA",
            "Meta"
          ]
        },
        {
          "url": "https://github.com/mistralai/mistral-src",
          "title": "Mistral AI 核心源码",
          "description": "Mistral 开源的系列高效架构模型（Mistral 7B、Mixtral 8x7B/8x22B）。",
          "category": "模型与数据集",
          "subCategory": "高效架构",
          "tags": [
            "Mistral",
            "开源权重"
          ]
        },
        {
          "url": "https://huggingface.co/models",
          "title": "Hugging Face 开源模型库",
          "description": "全球最大机器学习模型集散地，提供千万级开源权重下载与在线体验。",
          "category": "模型与数据集",
          "subCategory": "全球模型库",
          "tags": [
            "Hugging Face",
            "权重托管"
          ]
        },
        {
          "url": "https://modelscope.cn/models",
          "title": "魔搭 ModelScope 模型库",
          "description": "国内领先的开源模型开放平台，国内直连高速下载并提供免费推理算力。",
          "category": "模型与数据集",
          "subCategory": "国内加速",
          "tags": [
            "魔搭",
            "国内镜像"
          ]
        },
        {
          "url": "https://www.nvidia.com/en-us/data-center/h100/",
          "title": "NVIDIA H100 Tensor Core GPU",
          "description": "专为大模型训练与超高并发推理设计的行业顶尖算力硬件基石。",
          "category": "AI 硬件与具身",
          "subCategory": "算力芯片",
          "tags": [
            "NVIDIA",
            "H100"
          ]
        },
        {
          "url": "https://developer.nvidia.com/cuda-toolkit",
          "title": "NVIDIA CUDA Toolkit",
          "description": "GPU 通用并行计算架构开发套件，支撑全球绝大多数现代 AI 框架加速。",
          "category": "AI 硬件与具身",
          "subCategory": "计算工具包",
          "tags": [
            "CUDA",
            "GPU加速"
          ]
        },
        {
          "url": "https://github.com/NVIDIA/TensorRT-LLM",
          "title": "TensorRT-LLM",
          "description": "NVIDIA 官方针对自家 GPU 深度优化的超低延迟企业级推理加速套件。",
          "category": "AI 硬件与具身",
          "subCategory": "官方加速",
          "tags": [
            "TensorRT",
            "NVIDIA"
          ]
        },
        {
          "url": "https://www.amd.com/en/products/accelerators/instinct.html",
          "title": "AMD Instinct 加速卡",
          "description": "AMD 针对大规模 AI 推理与数据中心打造的高带宽内存硬件加速矩阵。",
          "category": "AI 硬件与具身",
          "subCategory": "AMD硬件",
          "tags": [
            "AMD",
            "Instinct"
          ]
        },
        {
          "url": "https://rocm.docs.amd.com/",
          "title": "AMD ROCm 开放计算平台",
          "description": "AMD 开源的高性能计算与 GPU 驱动软件栈，深度兼容 PyTorch 生态。",
          "category": "AI 硬件与具身",
          "subCategory": "开源驱动",
          "tags": [
            "ROCm",
            "AMD计算"
          ]
        },
        {
          "url": "https://developer.apple.com/metal/",
          "title": "Apple Metal",
          "description": "苹果平台底层图形与高性能并行张量计算 API，驱动 Mac M 系列芯片极速推理。",
          "category": "AI 硬件与具身",
          "subCategory": "Mac芯片",
          "tags": [
            "Metal",
            "Apple Silicon"
          ]
        },
        {
          "url": "https://github.com/ml-explore/mlx",
          "title": "MLX (Apple Silicon)",
          "description": "苹果机器学习研究团队专门针对 M 系列芯片统一内存架构打造的机器学习框架。",
          "category": "AI 硬件与具身",
          "subCategory": "Mac专用框架",
          "tags": [
            "MLX",
            "统一内存"
          ]
        },
        {
          "url": "https://www.qualcomm.com/products/technology/artificial-intelligence",
          "title": "Qualcomm AI Hub",
          "description": "高通骁龙端侧 NPU 优化模型集合，将大模型流畅带入手机与边缘终端。",
          "category": "AI 硬件与具身",
          "subCategory": "移动端侧",
          "tags": [
            "高通",
            "NPU加速"
          ]
        },
        {
          "url": "https://coral.ai/products/",
          "title": "Google Coral Edge TPU",
          "description": "谷歌低功耗本地 AI 推理硬件模块，广泛用于工业与机器人边缘计算。",
          "category": "AI 硬件与具身",
          "subCategory": "边缘TPU",
          "tags": [
            "Coral",
            "EdgeTPU"
          ]
        },
        {
          "url": "https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/overview.html",
          "title": "Intel OpenVINO Toolkit",
          "description": "英特尔官方推出的深度学习部署套件，在普通 CPU 与集成显卡上加速推理。",
          "category": "AI 硬件与具身",
          "subCategory": "CPU加速",
          "tags": [
            "OpenVINO",
            "Intel"
          ]
        },
        {
          "url": "https://github.com/hiyouga/LLaMA-Factory/wiki",
          "title": "LLaMA-Factory 使用指南",
          "description": "一站式模型微调平台，支持主流开源大模型无代码可视化 WebUI 训练配置。",
          "category": "模型训练与微调",
          "subCategory": "微调框架",
          "tags": [
            "LLaMA-Factory",
            "WebUI"
          ]
        },
        {
          "url": "https://github.com/unslothai/unsloth",
          "title": "Unsloth 开源主仓库",
          "description": "手写 Triton 内核极致优化，微调大模型速度飞跃且大幅削减显存开销。",
          "category": "模型训练与微调",
          "subCategory": "极速微调",
          "tags": [
            "Unsloth",
            "Triton"
          ]
        },
        {
          "url": "https://github.com/OpenAccess-AI-Collective/axolotl",
          "title": "Axolotl 框架",
          "description": "支持丰富格式数据集、Flash Attention 2 与多种量化微调技术的一体化套件。",
          "category": "模型训练与微调",
          "subCategory": "训练套件",
          "tags": [
            "Axolotl",
            "微调"
          ]
        },
        {
          "url": "https://github.com/pytorch/torchtune/tree/main",
          "title": "torchtune 仓库",
          "description": "PyTorch 官方出品的原生大模型微调库，架构精简、纯 Python 且易于定制。",
          "category": "模型训练与微调",
          "subCategory": "PyTorch官方",
          "tags": [
            "torchtune",
            "PyTorch"
          ]
        },
        {
          "url": "https://github.com/microsoft/DeepSpeed",
          "title": "DeepSpeed 源码",
          "description": "微软开源的大规模模型并行训练框架，支持 ZeRO 内存优化与分布式通信。",
          "category": "模型训练与微调",
          "subCategory": "分布式训练",
          "tags": [
            "DeepSpeed",
            "ZeRO"
          ]
        },
        {
          "url": "https://github.com/PanQiWei/AutoGPTQ",
          "title": "AutoGPTQ",
          "description": "基于 GPTQ 算法的高精度 4-bit 权重后量化工具，支持极低显存运行大模型。",
          "category": "模型训练与微调",
          "subCategory": "模型量化",
          "tags": [
            "GPTQ",
            "4bit量化"
          ]
        },
        {
          "url": "https://github.com/mit-han-lab/llm-awq",
          "title": "AWQ (Activation-aware Weight Quantization)",
          "description": "麻省理工韩松团队开发的激活感知权重量化方案，保持极高量化后模型精度。",
          "category": "模型训练与微调",
          "subCategory": "先进量化",
          "tags": [
            "AWQ",
            "韩松团队"
          ]
        },
        {
          "url": "https://github.com/casper-hansen/AutoAWQ",
          "title": "AutoAWQ",
          "description": "易用、高效的 AWQ 量化工具包，广泛为 vLLM 与 Hugging Face 原生支持。",
          "category": "模型训练与微调",
          "subCategory": "量化工具",
          "tags": [
            "AutoAWQ",
            "vLLM兼容"
          ]
        },
        {
          "url": "https://github.com/OpenLLMAI/OpenRLHF",
          "title": "OpenRLHF 项目",
          "description": "面向开源社区的高性能全栈强化学习框架，支持千亿参数规模高效 DPO/PPO。",
          "category": "模型训练与微调",
          "subCategory": "对齐强化",
          "tags": [
            "OpenRLHF",
            "DPO"
          ]
        },
        {
          "url": "https://github.com/huggingface/transformers",
          "title": "Hugging Face Transformers",
          "description": "数以万计开源预训练模型的通用 API 与统一抽象规范标准实现库。",
          "category": "模型训练与微调",
          "subCategory": "基础标准",
          "tags": [
            "Transformers",
            "标准库"
          ]
        },
        {
          "url": "https://openwebui.com/",
          "title": "Open WebUI 官方社区",
          "description": "功能极其强大的自托管离线 LLM 前端，支持管道、知识库 RAG 与角色定制。",
          "category": "对话助手",
          "subCategory": "自托管标杆",
          "tags": [
            "Open-WebUI",
            "自托管"
          ]
        },
        {
          "url": "https://github.com/jan-toolkit/jan",
          "title": "Jan 开源仓库",
          "description": "100% 离线运行的本地大模型桌面应用，支持任意 GGUF 格式拖拽即跑。",
          "category": "对话助手",
          "subCategory": "离线桌面",
          "tags": [
            "Jan",
            "本地隐私"
          ]
        },
        {
          "url": "https://chatboxai.app/",
          "title": "Chatbox AI 官网",
          "description": "全平台桌面 AI 客户端，支持直连本地 Ollama 接口与云端多模型聚合。",
          "category": "对话助手",
          "subCategory": "多端客户端",
          "tags": [
            "Chatbox",
            "本地连接"
          ]
        },
        {
          "url": "https://github.com/kangfenfei/cherry-studio",
          "title": "Cherry Studio 仓库",
          "description": "专为多模型设计的桌面客户端，拥有极佳的国内体验与本地端点集成支持。",
          "category": "对话助手",
          "subCategory": "国产桌面",
          "tags": [
            "Cherry Studio",
            "本地端点"
          ]
        },
        {
          "url": "https://lobehub.com/",
          "title": "LobeHub / LobeChat",
          "description": "视觉设计极为出色的开源现代化对话框架，支持海量插件与自适应多端布局。",
          "category": "对话助手",
          "subCategory": "前沿UI",
          "tags": [
            "LobeChat",
            "开源"
          ]
        },
        {
          "url": "https://www.librechat.ai/",
          "title": "LibreChat 官方主页",
          "description": "可替代 ChatGPT 的开源全功能多模型会话协作平台，支持企业级权限管控。",
          "category": "对话助手",
          "subCategory": "企业级平台",
          "tags": [
            "LibreChat",
            "多用户"
          ]
        },
        {
          "url": "https://useanything.com/",
          "title": "AnythingLLM 官方门户",
          "description": "支持一键桌面安装的企业级私有知识库系统，内置本地向量数据库与嵌入器。",
          "category": "对话助手",
          "subCategory": "私有知识库",
          "tags": [
            "AnythingLLM",
            "桌面知识库"
          ]
        },
        {
          "url": "https://bloopai.github.io/",
          "title": "Bloop",
          "description": "AI 驱动的代码搜索与本地代码仓库问答客户端，深度理解工程依赖。",
          "category": "对话助手",
          "subCategory": "代码搜索",
          "tags": [
            "Bloop",
            "本地代码"
          ]
        },
        {
          "url": "https://github.com/ollama-webui/ollama-webui",
          "title": "Ollama WebUI 经典版",
          "description": "为 Ollama 打造的轻量级纯 Web 控制面板与聊天界面。",
          "category": "对话助手",
          "subCategory": "轻量面板",
          "tags": [
            "OllamaWebUI",
            "简洁"
          ]
        },
        {
          "url": "https://github.com/PromtDesk/PromtDesk",
          "title": "PromptDesk",
          "description": "面向本地开源大模型的提示词工程调优与快速回归测试桌面工作台。",
          "category": "对话助手",
          "subCategory": "调优工作台",
          "tags": [
            "PromptDesk",
            "提示词调试"
          ]
        },
        {
          "url": "https://canirunit.com/",
          "title": "Can I Run It (LLM Calculator)",
          "description": "输入显卡型号与模型参数，实时估算显存占用、量化损失与推理吞吐。",
          "category": "AI 评测与学习",
          "subCategory": "硬件算力",
          "tags": [
            "显存计算器",
            "硬件评估"
          ]
        },
        {
          "url": "https://huggingface.co/spaces/HuggingFaceH4/open_llm_leaderboard",
          "title": "Open LLM Leaderboard",
          "description": "Hugging Face 官方全球开源大语言模型权威评测天梯排行榜。",
          "category": "AI 评测与学习",
          "subCategory": "官方榜单",
          "tags": [
            "Leaderboard",
            "天梯榜"
          ]
        },
        {
          "url": "https://artificialanalysis.ai/models",
          "title": "Artificial Analysis 模型库",
          "description": "横向对比数十种主流开源模型在各大服务商上的推理测速与延迟指标。",
          "category": "AI 评测与学习",
          "subCategory": "测速对比",
          "tags": [
            "测速",
            "延迟对比"
          ]
        },
        {
          "url": "https://github.com/EleutherAI/lm-evaluation-harness",
          "title": "LM Evaluation Harness",
          "description": "开源大模型评测的行业事实标准框架，支持 200+ 项经典学术基准测试。",
          "category": "AI 评测与学习",
          "subCategory": "评测框架",
          "tags": [
            "EleutherAI",
            "标准评估"
          ]
        },
        {
          "url": "https://opencompass.org.cn/leaderboard-multimodal",
          "title": "司南多模态评测榜",
          "description": "上海 AI 实验室针对图文、代码、逻辑多维度综合能力发布的权威榜单。",
          "category": "AI 评测与学习",
          "subCategory": "国内权威",
          "tags": [
            "司南",
            "多模态榜单"
          ]
        },
        {
          "url": "https://vllm.ai/blog",
          "title": "vLLM 官方技术博客",
          "description": "持续发布关于 PagedAttention、推测解码、Chunked Prefill 等前沿优化文章。",
          "category": "AI 评测与学习",
          "subCategory": "工程前沿",
          "tags": [
            "vLLM博客",
            "推理内核"
          ]
        },
        {
          "url": "https://huggingface.co/blog",
          "title": "Hugging Face 官方博客",
          "description": "深度解读开源最新模型发布、量化技术突破与社区生态的最佳信息源。",
          "category": "AI 评测与学习",
          "subCategory": "深度解读",
          "tags": [
            "HF博客",
            "技术洞见"
          ]
        },
        {
          "url": "https://crfm.stanford.edu/",
          "title": "斯坦福基础模型研究中心 (CRFM)",
          "description": "全球顶尖学者针对基础模型透明度、可靠性与社会影响的学术研究重镇。",
          "category": "AI 评测与学习",
          "subCategory": "学术机构",
          "tags": [
            "斯坦福",
            "基础模型"
          ]
        },
        {
          "url": "https://newsletter.lmsys.org/",
          "title": "LMSYS 官方通讯",
          "description": "Chatbot Arena 竞技场背后算法团队定期发布的模型评测分析洞见。",
          "category": "AI 评测与学习",
          "subCategory": "竞技洞察",
          "tags": [
            "LMSYS",
            "模型洞察"
          ]
        },
        {
          "url": "https://llm.extractum.io/",
          "title": "LLM 参数量与显存速查",
          "description": "开源模型参数量、激活内存占用与批处理最佳实践的交互式速查表。",
          "category": "AI 评测与学习",
          "subCategory": "实用参数",
          "tags": [
            "显存速查",
            "参数评估"
          ]
        },
        {
          "url": "https://github.com/NVIDIA/NeMo-Guardrails",
          "title": "NeMo Guardrails",
          "description": "NVIDIA 开源的大模型对话安全护栏系统，通过可编程规则规避违规内容。",
          "category": "AI 安全与对齐",
          "subCategory": "安全护栏",
          "tags": [
            "NeMo",
            "NVIDIA安全"
          ]
        },
        {
          "url": "https://github.com/meta-llama/PurpleLlama",
          "title": "Purple Llama",
          "description": "Meta 发布的开源网络安全评测工具包与网络安全提示词评估基准。",
          "category": "AI 安全与对齐",
          "subCategory": "红队测试",
          "tags": [
            "PurpleLlama",
            "Meta"
          ]
        },
        {
          "url": "https://github.com/protectai/rebuff",
          "title": "Rebuff",
          "description": "专为防止 Prompt 注入攻击打造的开源自适应防御框架与沙箱层。",
          "category": "AI 安全与对齐",
          "subCategory": "Prompt防御",
          "tags": [
            "Rebuff",
            "注入拦截"
          ]
        },
        {
          "url": "https://github.com/leondz/garak",
          "title": "Garak LLM 漏洞扫描器",
          "description": "开源的大语言模型脆弱性探测器，自动化扫描越狱、幻觉与数据泄露风险。",
          "category": "AI 安全与对齐",
          "subCategory": "漏洞扫描",
          "tags": [
            "Garak",
            "越狱检测"
          ]
        },
        {
          "url": "https://github.com/microsoft/presidio",
          "title": "Microsoft Presidio",
          "description": "上下文感知的 PII 隐私敏感个人信息自动识别、脱敏与匿名化引擎。",
          "category": "AI 安全与对齐",
          "subCategory": "数据脱敏",
          "tags": [
            "Presidio",
            "隐私脱敏"
          ]
        },
        {
          "url": "https://owasp.org/www-project-top-10-for-large-language-model-applications/",
          "title": "OWASP Top 10 for LLMs",
          "description": "OWASP 权威发布的大语言模型应用十大核心安全风险与防范准则。",
          "category": "AI 安全与对齐",
          "subCategory": "安全准则",
          "tags": [
            "OWASP",
            "安全标准"
          ]
        },
        {
          "url": "https://github.com/chathis/jailbreak_llms",
          "title": "LLM 越狱研究仓库",
          "description": "学术界收集与分类各种典型对抗提示词样本的研究合集库。",
          "category": "AI 安全与对齐",
          "subCategory": "对抗样本",
          "tags": [
            "越狱测试",
            "对抗样本"
          ]
        },
        {
          "url": "https://huggingface.co/spaces/allenai/open-instruct",
          "title": "Open-Instruct 对齐套件",
          "description": "艾伦人工智能研究所 (AI2) 开源的纯透明模型指令微调与对齐框架。",
          "category": "AI 安全与对齐",
          "subCategory": "透明对齐",
          "tags": [
            "AI2",
            "对齐套件"
          ]
        },
        {
          "url": "https://cleanlab.ai/",
          "title": "Cleanlab",
          "description": "自动发现与修复训练数据与标注中的错误、异常样本与污点的开源平台。",
          "category": "AI 安全与对齐",
          "subCategory": "数据清洗",
          "tags": [
            "Cleanlab",
            "数据质量"
          ]
        },
        {
          "url": "https://www.alignmentsubstack.com/",
          "title": "Alignment Newsletter",
          "description": "追踪全球技术对齐与 AI 安全前沿论文的精选学术周刊。",
          "category": "AI 安全与对齐",
          "subCategory": "学术周刊",
          "tags": [
            "对齐周刊",
            "AI安全"
          ]
        },
        {
          "url": "https://qdrant.tech/documentation/",
          "title": "Qdrant 官方文档",
          "description": "Rust 打造的高性能向量搜索引擎完整文档，提供过滤、分片与载荷存储指南。",
          "category": "向量库与 RAG",
          "subCategory": "向量文档",
          "tags": [
            "Qdrant",
            "向量搜索"
          ]
        },
        {
          "url": "https://docs.trychroma.com/",
          "title": "Chroma 官方使用文档",
          "description": "专为本地快速开发打造的嵌入式向量库上手指南与 Python/JS API。",
          "category": "向量库与 RAG",
          "subCategory": "嵌入式向量",
          "tags": [
            "Chroma",
            "轻量向量"
          ]
        },
        {
          "url": "https://milvus.io/docs",
          "title": "Milvus 官方文档",
          "description": "大规模分布式向量数据库架构解析与生产环境集群部署调优指南。",
          "category": "向量库与 RAG",
          "subCategory": "分布式架构",
          "tags": [
            "Milvus",
            "分布式集群"
          ]
        },
        {
          "url": "https://lancedb.github.io/lancedb/",
          "title": "LanceDB 官方文档",
          "description": "无服务器架构、超快启动且支持海量持久化向量存储的轻量文档。",
          "category": "向量库与 RAG",
          "subCategory": "无服务存储",
          "tags": [
            "LanceDB",
            "轻量文档"
          ]
        },
        {
          "url": "https://github.com/facebookresearch/faiss",
          "title": "FAISS (Facebook AI Similarity Search)",
          "description": "Meta 开源的高效相似性搜索与稠密向量聚类核心工业级 C++ 库。",
          "category": "向量库与 RAG",
          "subCategory": "检索基石",
          "tags": [
            "FAISS",
            "Meta核心"
          ]
        },
        {
          "url": "https://docs.llamaindex.ai/",
          "title": "LlamaIndex 官方文档",
          "description": "连接私有结构化与非结构化数据源的数据索引框架与查询引擎指南。",
          "category": "向量库与 RAG",
          "subCategory": "索引框架",
          "tags": [
            "LlamaIndex",
            "数据连接"
          ]
        },
        {
          "url": "https://github.com/FlagOpen/FlagEmbedding",
          "title": "FlagEmbedding (BGE)",
          "description": "智源研究院开源的 BGE 顶级多语言文本嵌入与重排序 (Reranker) 模型体系。",
          "category": "向量库与 RAG",
          "subCategory": "嵌入模型",
          "tags": [
            "BGE",
            "智源"
          ]
        },
        {
          "url": "https://github.com/netease-youdao/BCEmbedding",
          "title": "BCEmbedding",
          "description": "网易有道开源的双语双向检索与重排模型，专为企业级复杂 RAG 打造。",
          "category": "向量库与 RAG",
          "subCategory": "双语嵌入",
          "tags": [
            "BCEmbedding",
            "重排"
          ]
        },
        {
          "url": "https://github.com/mosecorg/mosec",
          "title": "Mosec",
          "description": "使用 Rust 编写的高性能模型服务框架，专为动态批处理与管道加速优化。",
          "category": "向量库与 RAG",
          "subCategory": "批处理服务",
          "tags": [
            "Mosec",
            "Rust服务"
          ]
        },
        {
          "url": "https://github.com/jina-ai/jina",
          "title": "Jina AI 全球搜索",
          "description": "将多模态数据一键转化为高维向量并构建跨模态语义检索的云原生开源套件。",
          "category": "向量库与 RAG",
          "subCategory": "跨模态检索",
          "tags": [
            "Jina",
            "多模态向量"
          ]
        },
        {
          "url": "https://github.com/microsoft/autogen",
          "title": "AutoGen 核心开源仓库",
          "description": "微软主导的事件驱动、多代理协同对话与复杂任务自动解决框架。",
          "category": "智能体与自动化",
          "subCategory": "微软多智能体",
          "tags": [
            "AutoGen",
            "智能体协作"
          ]
        },
        {
          "url": "https://github.com/crewAIInc/crewAI",
          "title": "CrewAI 开源仓库",
          "description": "生产级多智能体协同引擎，通过角色明确分工驱动智能体组队完成业务。",
          "category": "智能体与自动化",
          "subCategory": "角色协同",
          "tags": [
            "CrewAI",
            "团队协作"
          ]
        },
        {
          "url": "https://github.com/langchain-ai/langchain",
          "title": "LangChain 源码",
          "description": "包含庞大组件生态与连接器的全球顶级大模型应用开发抽象套件。",
          "category": "智能体与自动化",
          "subCategory": "核心抽象",
          "tags": [
            "LangChain",
            "生态核心"
          ]
        },
        {
          "url": "https://github.com/langchain-ai/langgraph",
          "title": "LangGraph 源码",
          "description": "支持有环图流转、持久化状态快照与人机交互介入的高容错智能体框架。",
          "category": "智能体与自动化",
          "subCategory": "图状态机",
          "tags": [
            "LangGraph",
            "状态管理"
          ]
        },
        {
          "url": "https://github.com/dify-ai/dify",
          "title": "Dify 官方仓库",
          "description": "可视化编排、高质量 Prompt 工程与应用一键发布的开源 LLM 开发平台。",
          "category": "智能体与自动化",
          "subCategory": "可视化平台",
          "tags": [
            "Dify",
            "应用编排"
          ]
        },
        {
          "url": "https://github.com/FlowiseAI/Flowise",
          "title": "Flowise 官方仓库",
          "description": "基于 Node 构建的拖拽式 UI 框架，轻松直观拼装基于本地模型的 Agent 逻辑。",
          "category": "智能体与自动化",
          "subCategory": "拖拽式开发",
          "tags": [
            "Flowise",
            "节点连线"
          ]
        },
        {
          "url": "https://github.com/yoheinakajima/babyagi",
          "title": "BabyAGI",
          "description": "探索通过任务创建、优先级排序与逐步执行实现自主目标的经典极简 Agent。",
          "category": "智能体与自动化",
          "subCategory": "极简探索",
          "tags": [
            "BabyAGI",
            "自主任务"
          ]
        },
        {
          "url": "https://github.com/OpenDevin/OpenDevin",
          "title": "OpenHands (原 OpenDevin)",
          "description": "开源的自主全栈软件工程师智能体，可在安全沙箱内独立执行编程长任务。",
          "category": "智能体与自动化",
          "subCategory": "自主软件工程",
          "tags": [
            "OpenHands",
            "编程Agent"
          ]
        },
        {
          "url": "https://github.com/All-Hands-AI/OpenHands",
          "title": "OpenHands 官方主页",
          "description": "为开发者提供与人类并肩编程的下一代开源软件开发代理系统。",
          "category": "智能体与自动化",
          "subCategory": "官方系统",
          "tags": [
            "OpenHands",
            "AI结对"
          ]
        },
        {
          "url": "https://github.com/camel-ai/camel",
          "title": "CAMEL-AI",
          "description": "沟通智能体自主探索与合作的基础框架，最早提出角色互动的学术标杆。",
          "category": "智能体与自动化",
          "subCategory": "学术标杆",
          "tags": [
            "CAMEL",
            "角色扮演"
          ]
        },
        {
          "url": "https://www.python.org/",
          "title": "Python 官方主页",
          "description": "人工智能与数据科学事实上的通用第一语言，生态庞大且调用库极度丰富。",
          "category": "语言与运行时",
          "subCategory": "AI基准语言",
          "tags": [
            "Python",
            "核心生态"
          ]
        },
        {
          "url": "https://www.rust-lang.org/",
          "title": "Rust 官方主页",
          "description": "兼具 C/C++ 极限性能与内存安全的现代系统编程语言，驱动高性能推理引擎。",
          "category": "语言与运行时",
          "subCategory": "系统语言",
          "tags": [
            "Rust",
            "内存安全"
          ]
        },
        {
          "url": "https://pytorch.org/",
          "title": "PyTorch 官方门户",
          "description": "全球顶级开源深度学习平台，从学术研究到企业工业部署的绝对核心支柱。",
          "category": "语言与运行时",
          "subCategory": "深度学习框架",
          "tags": [
            "PyTorch",
            "张量计算"
          ]
        },
        {
          "url": "https://jax.readthedocs.io/",
          "title": "JAX (Google)",
          "description": "结合 Autograd 和 XLA 高性能编译的极速 Python 张量计算与自动微分库。",
          "category": "语言与运行时",
          "subCategory": "XLA编译",
          "tags": [
            "JAX",
            "GoogleAI"
          ]
        },
        {
          "url": "https://triton-lang.org/",
          "title": "OpenAI Triton",
          "description": "让普通开发者用类似 Python 语法编写极速定制 GPU 核心算子的开源语言与编译器。",
          "category": "语言与运行时",
          "subCategory": "GPU算子",
          "tags": [
            "Triton",
            "OpenAI"
          ]
        },
        {
          "url": "https://onnx.ai/",
          "title": "ONNX (Open Neural Network Exchange)",
          "description": "跨框架模型表示开放标准，打通 PyTorch、TensorFlow 与各端侧运行时互通。",
          "category": "语言与运行时",
          "subCategory": "模型交换标准",
          "tags": [
            "ONNX",
            "跨平台格式"
          ]
        },
        {
          "url": "https://onnxruntime.ai/",
          "title": "ONNX Runtime",
          "description": "微软打造的跨平台跨硬件高性能推理加速引擎，支持全系硬件极速推理。",
          "category": "语言与运行时",
          "subCategory": "通用推理引擎",
          "tags": [
            "ONNX Runtime",
            "微软加速"
          ]
        },
        {
          "url": "https://github.com/numba/numba",
          "title": "Numba",
          "description": "利用 LLVM 将 Python 与 NumPy 代码即时编译为机器原生代码的高性能 JIT 编译器。",
          "category": "语言与运行时",
          "subCategory": "JIT加速",
          "tags": [
            "Numba",
            "NumPy加速"
          ]
        },
        {
          "url": "https://cython.org/",
          "title": "Cython",
          "description": "让为 Python 编写 C 扩展就像写普通 Python 一样轻松的经典静态编译器。",
          "category": "语言与运行时",
          "subCategory": "C扩展",
          "tags": [
            "Cython",
            "C加速"
          ]
        },
        {
          "url": "https://julialang.org/",
          "title": "Julia 官方网站",
          "description": "专为科学计算与高并发数值算法打造的高性能动态编程语言。",
          "category": "语言与运行时",
          "subCategory": "科学计算",
          "tags": [
            "Julia",
            "数值计算"
          ]
        },
        {
          "url": "https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html",
          "title": "NVIDIA Container Toolkit",
          "description": "使 Docker 容器能够无缝透传并调用宿主机 GPU 算力硬件的官方运行时套件。",
          "category": "容器与编排",
          "subCategory": "GPU容器",
          "tags": [
            "NVIDIA",
            "GPU容器化"
          ]
        },
        {
          "url": "https://kubernetes.io/",
          "title": "Kubernetes 集群系统",
          "description": "自动化部署、弹性扩缩与容器化大模型推理服务的分布式编排中枢。",
          "category": "容器与编排",
          "subCategory": "集群编排",
          "tags": [
            "Kubernetes",
            "集群管理"
          ]
        },
        {
          "url": "https://keda.sh/",
          "title": "KEDA (Kubernetes Event-driven Autoscaling)",
          "description": "基于队列积压与并发请求事件对 K8s 算力 Pod 进行毫秒级弹性扩缩容的组件。",
          "category": "容器与编排",
          "subCategory": "弹性伸缩",
          "tags": [
            "KEDA",
            "弹性伸缩"
          ]
        },
        {
          "url": "https://www.run.ai/",
          "title": "Run:ai",
          "description": "专为 AI 与大模型负载打造的 GPU 资源动态池化、切片共享与调度平台。",
          "category": "容器与编排",
          "subCategory": "GPU切片调度",
          "tags": [
            "Run:ai",
            "GPU池化"
          ]
        },
        {
          "url": "https://github.com/kubeflow/kubeflow",
          "title": "Kubeflow",
          "description": "基于 Kubernetes 的端到端机器学习平台，支持复杂训练流水线编排。",
          "category": "容器与编排",
          "subCategory": "MLOps流水线",
          "tags": [
            "Kubeflow",
            "MLOps"
          ]
        },
        {
          "url": "https://kueue.sigs.k8s.io/",
          "title": "Kueue",
          "description": "Kubernetes 官方批处理作业队列系统，实现多租户 GPU 资源按配额公平借调。",
          "category": "容器与编排",
          "subCategory": "任务队列",
          "tags": [
            "Kueue",
            "配额管理"
          ]
        },
        {
          "url": "https://docs.docker.com/compose/",
          "title": "Docker Compose",
          "description": "使用单个声明式 YAML 文件即可定义并一键启动多服务复杂推理栈的工具。",
          "category": "容器与编排",
          "subCategory": "轻量编排",
          "tags": [
            "Docker Compose",
            "多容器"
          ]
        },
        {
          "url": "https://harbor.io/",
          "title": "Harbor",
          "description": "企业级可信云原生容器镜像仓库，支持漏洞签名校验与私有镜像托管。",
          "category": "容器与编排",
          "subCategory": "企业镜像仓库",
          "tags": [
            "Harbor",
            "私有镜像"
          ]
        },
        {
          "url": "https://gvisor.dev/",
          "title": "gVisor (Google)",
          "description": "谷歌开源的应用内核沙箱技术，提供严格虚拟化边界以安全运行不可信模型代码。",
          "category": "容器与编排",
          "subCategory": "安全沙箱",
          "tags": [
            "gVisor",
            "隔离运行"
          ]
        },
        {
          "url": "https://firecracker-microvm.github.io/",
          "title": "Firecracker",
          "description": "AWS 开源的高性能轻量 MicroVM 虚拟机监控器，几毫秒内创建绝对隔离环境。",
          "category": "容器与编排",
          "subCategory": "微虚拟机",
          "tags": [
            "Firecracker",
            "极致轻量"
          ]
        },
        {
          "url": "https://min.io/",
          "title": "MinIO",
          "description": "高性能、兼容 S3 API 的开源分布式对象存储，最适合企业私有化存储大模型权重。",
          "category": "数据库与存储",
          "subCategory": "对象存储",
          "tags": [
            "MinIO",
            "S3兼容"
          ]
        },
        {
          "url": "https://www.postgresql.org/",
          "title": "PostgreSQL 数据库",
          "description": "全球功能最强大的开源对象关系型数据库，通过扩展无缝支持向量与全文检索。",
          "category": "数据库与存储",
          "subCategory": "关系核心",
          "tags": [
            "PostgreSQL",
            "强一致性"
          ]
        },
        {
          "url": "https://github.com/pgvector/pgvector",
          "title": "pgvector 插件",
          "description": "为 PostgreSQL 赋予原生高维向量索引与相似性检索能力的极热开源插件。",
          "category": "数据库与存储",
          "subCategory": "向量插件",
          "tags": [
            "pgvector",
            "Postgres"
          ]
        },
        {
          "url": "https://redis.io/",
          "title": "Redis",
          "description": "内存级超高速键值数据存储，广泛用作大模型会话缓存与 KV Cache 暂存中枢。",
          "category": "数据库与存储",
          "subCategory": "内存缓存",
          "tags": [
            "Redis",
            "会话缓存"
          ]
        },
        {
          "url": "https://duckdb.org/",
          "title": "DuckDB 嵌入式数据库",
          "description": "专为分析型查询设计的超快单文件数据库，直接在内存中秒级查询海量 Parquet 数据。",
          "category": "数据库与存储",
          "subCategory": "分析数据库",
          "tags": [
            "DuckDB",
            "列式存储"
          ]
        },
        {
          "url": "https://www.sqlite.org/",
          "title": "SQLite",
          "description": "世界上部署最多的零配置轻量嵌入式关系数据库，私有客户端本地存储利器。",
          "category": "数据库与存储",
          "subCategory": "嵌入式",
          "tags": [
            "SQLite",
            "零配置"
          ]
        },
        {
          "url": "https://ceph.io/",
          "title": "Ceph 分布式存储",
          "description": "统一的分布式块、对象与文件存储平台，为大型 AI 算力集群提供海量持久卷。",
          "category": "数据库与存储",
          "subCategory": "分布式存储",
          "tags": [
            "Ceph",
            "集群存储"
          ]
        },
        {
          "url": "https://juicefs.com/",
          "title": "JuiceFS",
          "description": "专为云原生设计的分布式 POSIX 文件系统，结合对象存储带来超高吞吐读取性能。",
          "category": "数据库与存储",
          "subCategory": "云原生存储",
          "tags": [
            "JuiceFS",
            "POSIX兼容"
          ]
        },
        {
          "url": "https://parquet.apache.org/",
          "title": "Apache Parquet",
          "description": "面向列式存储的高效压缩数据文件格式，大模型训练预处理数据的行业共识标准。",
          "category": "数据库与存储",
          "subCategory": "列式格式",
          "tags": [
            "Parquet",
            "高效压缩"
          ]
        },
        {
          "url": "https://arrow.apache.org/",
          "title": "Apache Arrow",
          "description": "跨语言的内存列式数据交换格式，消灭不同数据处理引擎之间的数据序列化开销。",
          "category": "数据库与存储",
          "subCategory": "零拷贝交互",
          "tags": [
            "Arrow",
            "零拷贝"
          ]
        },
        {
          "url": "https://github.com/NVIDIA/gpu-monitoring-tools",
          "title": "NVIDIA DCGM Exporter",
          "description": "将 NVIDIA GPU 的硬件温度、功耗、显存与核心利用率导出给 Prometheus 监控。",
          "category": "可观测与监控",
          "subCategory": "GPU监控",
          "tags": [
            "DCGM",
            "NVIDIA监控"
          ]
        },
        {
          "url": "https://prometheus.io/docs/introduction/overview/",
          "title": "Prometheus 监控体系",
          "description": "针对指标采集与报警规则定义的权威监控体系，全天候守护私有化推理节点。",
          "category": "可观测与监控",
          "subCategory": "指标监控",
          "tags": [
            "Prometheus",
            "指标报警"
          ]
        },
        {
          "url": "https://grafana.com/grafana/dashboards/",
          "title": "Grafana Dashboards",
          "description": "海量社区共享的开箱即用仪表盘模板，涵盖 GPU 状态、vLLM 与 K8s 视图。",
          "category": "可观测与监控",
          "subCategory": "仪表盘市场",
          "tags": [
            "Grafana",
            "开箱即用大盘"
          ]
        },
        {
          "url": "https://opentelemetry.io/docs/",
          "title": "OpenTelemetry 架构手册",
          "description": "全链路监控、日志与追踪的统一云原生标准规范与各语言 SDK 说明。",
          "category": "可观测与监控",
          "subCategory": "统一标准",
          "tags": [
            "OpenTelemetry",
            "全链路"
          ]
        },
        {
          "url": "https://grafana.com/oss/loki/",
          "title": "Grafana Loki 日志中枢",
          "description": "与 Grafana 紧密集成的高效日志收集引擎，轻松聚合多台私有推理机推理日志。",
          "category": "可观测与监控",
          "subCategory": "日志聚合",
          "tags": [
            "Loki",
            "轻量日志"
          ]
        },
        {
          "url": "https://www.jaegertracing.io/docs/",
          "title": "Jaeger 追踪手册",
          "description": "微服务与推理服务排障指南，定位长文本输入时显卡耗时的每一个细粒度阶段。",
          "category": "可观测与监控",
          "subCategory": "链路排障",
          "tags": [
            "Jaeger",
            "追踪排障"
          ]
        },
        {
          "url": "https://github.com/wandb/wandb",
          "title": "Weights & Biases (W&B)",
          "description": "机器学习团队首选的实验追踪、超参数调优与模型训练版本管理平台。",
          "category": "可观测与监控",
          "subCategory": "实验管理",
          "tags": [
            "W&B",
            "超参调优"
          ]
        },
        {
          "url": "https://mlflow.org/",
          "title": "MLflow",
          "description": "开源的端到端机器学习全生命周期管理平台，涵盖模型打包、评估与注册中心。",
          "category": "可观测与监控",
          "subCategory": "开源MLOps",
          "tags": [
            "MLflow",
            "模型注册"
          ]
        },
        {
          "url": "https://tensorboard.dev/",
          "title": "TensorBoard",
          "description": "经典的模型训练损失曲线、网络拓扑图与权重直方图可视化分析套件。",
          "category": "可观测与监控",
          "subCategory": "训练可视化",
          "tags": [
            "TensorBoard",
            "损失分析"
          ]
        },
        {
          "url": "https://github.com/netdata/netdata",
          "title": "Netdata",
          "description": "秒级高精度、开箱即用的实时系统性能与基础设施监控看板，资源消耗极低。",
          "category": "可观测与监控",
          "subCategory": "秒级监控",
          "tags": [
            "Netdata",
            "实时性能"
          ]
        },
        {
          "url": "https://www.hiascend.com/",
          "title": "华为昇腾计算 (Ascend)",
          "description": "国产全栈自主 AI 基础设施生态，覆盖芯片、CANN 驱动栈与 MindSpore 框架。",
          "category": "信创与私有云",
          "subCategory": "国产芯片",
          "tags": [
            "昇腾",
            "华为AI"
          ]
        },
        {
          "url": "https://www.cambricon.com/",
          "title": "寒武纪 (Cambricon)",
          "description": "国内领先的云端及边缘智能计算芯片提供商，深度适配信创大模型推理部署。",
          "category": "信创与私有云",
          "subCategory": "国产算力",
          "tags": [
            "寒武纪",
            "智能芯片"
          ]
        },
        {
          "url": "https://www.iluvatar.com/",
          "title": "天数智芯 (Iluvatar)",
          "description": "国内通用 GPU 研发商，拥有全自研架构的高性能 GPGPU 训练与推理芯片。",
          "category": "信创与私有云",
          "subCategory": "通用GPU",
          "tags": [
            "天数智芯",
            "通用GPGPU"
          ]
        },
        {
          "url": "https://www.mthreads.com/",
          "title": "摩尔线程 (Moore Threads)",
          "description": "基于全功能 GPU 架构打造的高性能智能计算平台，兼容主流深度学习生态。",
          "category": "信创与私有云",
          "subCategory": "全功能GPU",
          "tags": [
            "摩尔线程",
            "国产显卡"
          ]
        },
        {
          "url": "https://openstack.org/",
          "title": "OpenStack",
          "description": "成熟稳定、广泛应用于各大型企业私有云基础设施构建的开源云计算管理平台。",
          "category": "信创与私有云",
          "subCategory": "私有云底座",
          "tags": [
            "OpenStack",
            "私有云"
          ]
        },
        {
          "url": "https://cloudstack.apache.org/",
          "title": "Apache CloudStack",
          "description": "高度可用、高扩展性的开源基础设施即服务 (IaaS) 云计算管理平台。",
          "category": "信创与私有云",
          "subCategory": "IaaS云平台",
          "tags": [
            "CloudStack",
            "开源IaaS"
          ]
        },
        {
          "url": "https://www.kylinos.cn/",
          "title": "麒麟软件 (KylinOS)",
          "description": "国内主流信创安全操作系统，广泛支撑党政企核心业务与算力设备平稳运行。",
          "category": "信创与私有云",
          "subCategory": "信创操作系统",
          "tags": [
            "麒麟",
            "信创系统"
          ]
        },
        {
          "url": "https://www.chinauos.com/",
          "title": "统信软件 (UOS)",
          "description": "面向多 CPU 架构深度优化的国产商业操作系统，提供安全稳固的基础底座。",
          "category": "信创与私有云",
          "subCategory": "国产操作系统",
          "tags": [
            "统信",
            "UOS"
          ]
        },
        {
          "url": "https://www.openanolis.cn/",
          "title": "龙蜥社区 (OpenAnolis)",
          "description": "国内中立开源操作系统社区，专注服务器级性能优化与云原生技术创新。",
          "category": "信创与私有云",
          "subCategory": "开源操作系统",
          "tags": [
            "龙蜥",
            "服务器系统"
          ]
        },
        {
          "url": "https://openEuler.org/",
          "title": "openEuler 社区",
          "description": "面向数字基础设施的开源操作系统，支持多样性算力协同与全栈使能。",
          "category": "信创与私有云",
          "subCategory": "华为开源",
          "tags": [
            "openEuler",
            "数字基础设施"
          ]
        },
        {
          "url": "https://github.com/vllm-project",
          "title": "vLLM 开源组织",
          "description": "vLLM 官方核心团队在 GitHub 上的开源组织，汇聚前沿推理服务演进讨论。",
          "category": "代码托管",
          "subCategory": "推理前沿",
          "tags": [
            "vLLM组织",
            "开源维护"
          ]
        },
        {
          "url": "https://github.com/ollama",
          "title": "Ollama 官方组织",
          "description": "Ollama 项目主库及其多平台支持、模型转换工具集的核心代码所在地。",
          "category": "代码托管",
          "subCategory": "官方组织",
          "tags": [
            "Ollama主页",
            "代码托管"
          ]
        },
        {
          "url": "https://github.com/huggingface",
          "title": "Hugging Face 组织仓库",
          "description": "维护 Transformers、Accelerate、PEFT、Datasets 等基础机器学习库的代码中心。",
          "category": "代码托管",
          "subCategory": "基础类库",
          "tags": [
            "Hugging Face",
            "核心项目"
          ]
        },
        {
          "url": "https://github.com/meta-llama",
          "title": "Meta LLaMA 组织",
          "description": "Meta 维护的 LLaMA 权重转换工具、快速启动范例与责任使用指南库。",
          "category": "代码托管",
          "subCategory": "Meta官方",
          "tags": [
            "Meta LLaMA",
            "开源代码"
          ]
        },
        {
          "url": "https://github.com/QwenLM",
          "title": "Qwen 通义千问开源组织",
          "description": "通义千问全系模型权重、评测复现代码与技术报告的权威代码存放地。",
          "category": "代码托管",
          "subCategory": "阿里组织",
          "tags": [
            "通义开源",
            "Qwen仓库"
          ]
        },
        {
          "url": "https://github.com/DeepSeek-ai",
          "title": "DeepSeek 官方代码组织",
          "description": "深度求索在 GitHub 上的开源组织，发布 V3、R1、Coder 等系列模型源码。",
          "category": "代码托管",
          "subCategory": "国产标杆",
          "tags": [
            "DeepSeek",
            "源码发布"
          ]
        },
        {
          "url": "https://gitlab.com/",
          "title": "GitLab 代码协作",
          "description": "支持完整自建私有化代码仓库与安全审计的敏捷软件开发平台。",
          "category": "代码托管",
          "subCategory": "私有化托管",
          "tags": [
            "GitLab",
            "自主托管"
          ]
        },
        {
          "url": "https://gitee.com/models",
          "title": "Gitee AI 模型频道",
          "description": "国内代码托管平台上的 AI 模型与算力体验频道，提供国内高速下载通道。",
          "category": "代码托管",
          "subCategory": "国内通道",
          "tags": [
            "Gitee AI",
            "国内高速"
          ]
        },
        {
          "url": "https://github.com/pytorch/pytorch",
          "title": "PyTorch 核心仓库",
          "description": "全球人工智能研究者共同维护的深度学习张量计算底层开源核心代码。",
          "category": "代码托管",
          "subCategory": "底层核心",
          "tags": [
            "PyTorch核心",
            "张量计算"
          ]
        },
        {
          "url": "https://github.com/tensorflow/tensorflow",
          "title": "TensorFlow 官方仓库",
          "description": "Google 推出的端到端开源机器学习平台，在各行业有广泛工业化积淀。",
          "category": "代码托管",
          "subCategory": "Google核心",
          "tags": [
            "TensorFlow",
            "工业沉淀"
          ]
        },
        {
          "url": "https://docs.vllm.ai/en/latest/",
          "title": "vLLM 官方文档门户",
          "description": "详细讲解 PagedAttention 配置、分布式推理、多 GPU 聚合与服务化 API。",
          "category": "官方文档",
          "subCategory": "框架手册",
          "tags": [
            "vLLM手册",
            "分布式推理"
          ]
        },
        {
          "url": "https://github.com/ollama/ollama/blob/main/docs/modelfile.md",
          "title": "Ollama Modelfile 指南",
          "description": "深入指导如何通过声明式 Modelfile 定制系统 Prompt、上下文参数与格式。",
          "category": "官方文档",
          "subCategory": "配置指南",
          "tags": [
            "Modelfile",
            "参数定制"
          ]
        },
        {
          "url": "https://huggingface.co/docs/transformers/index",
          "title": "Transformers 官方指南",
          "description": "从零开始加载模型、配置分词器、多 GPU 推理与管道调用的详尽技术手册。",
          "category": "官方文档",
          "subCategory": "经典文档",
          "tags": [
            "Transformers手册",
            "分词器"
          ]
        },
        {
          "url": "https://huggingface.co/docs/peft/index",
          "title": "PEFT 官方文档",
          "description": "深入探讨 LoRA、AdaLoRA 等参数高效微调原理与快速上手的官方权威指南。",
          "category": "官方文档",
          "subCategory": "算法手册",
          "tags": [
            "PEFT文档",
            "LoRA教程"
          ]
        },
        {
          "url": "https://pytorch.org/docs/stable/index.html",
          "title": "PyTorch 稳定版参考文档",
          "description": "PyTorch 官方全部 API 函数、分布式通信模块与张量操作详尽参考大全。",
          "category": "官方文档",
          "subCategory": "官方参考",
          "tags": [
            "PyTorch文档",
            "API手册"
          ]
        },
        {
          "url": "https://deepspeed.readthedocs.io/en/latest/",
          "title": "DeepSpeed 技术文档",
          "description": "如何在大规模集群中配置 ZeRO-1/2/3、Offload 内存卸载与流水线并行。",
          "category": "官方文档",
          "subCategory": "分布式调优",
          "tags": [
            "DeepSpeed文档",
            "内存卸载"
          ]
        },
        {
          "url": "https://docs.nvidia.com/",
          "title": "NVIDIA 技术文档中心",
          "description": "英伟达全线 GPU 产品、CUDA 驱动、TensorRT 与网络加速芯片技术文档。",
          "category": "官方文档",
          "subCategory": "硬件文档",
          "tags": [
            "NVIDIA文档",
            "驱动中心"
          ]
        },
        {
          "url": "https://kubernetes.io/docs/concepts/services-networking/ingress/",
          "title": "Kubernetes Ingress 概念指南",
          "description": "K8s 官方关于外部流量路由、负载均衡与 SSL 终止的标准配置教程。",
          "category": "官方文档",
          "subCategory": "网络配置",
          "tags": [
            "K8s Ingress",
            "网络路由"
          ]
        },
        {
          "url": "https://docs.docker.com/reference/",
          "title": "Docker 命令与语法参考",
          "description": "详查 Dockerfile 全部指令规范、Docker CLI 选项与守护进程配置。",
          "category": "官方文档",
          "subCategory": "容器参考",
          "tags": [
            "Docker参考",
            "Dockerfile"
          ]
        },
        {
          "url": "https://docs.kernel.org/",
          "title": "Linux 内核官方文档",
          "description": "深入探究操作系统内存管理、进程调度、IO 多路复用与 cgroup 机制。",
          "category": "官方文档",
          "subCategory": "内核标准",
          "tags": [
            "Linux内核",
            "底层系统"
          ]
        },
        {
          "url": "https://leetcode.com/",
          "title": "LeetCode 全球站",
          "description": "全球程序员与算法工程师刷题必备平台，海量经典算法与数据结构题目库。",
          "category": "算法面试",
          "subCategory": "算法题库",
          "tags": [
            "LeetCode",
            "算法刷题"
          ]
        },
        {
          "url": "https://leetcode.cn/",
          "title": "力扣 (LeetCode 中国)",
          "description": "国内顶尖技术求职者刷题交流社区，提供企业高频真题与中文题解精选。",
          "category": "算法面试",
          "subCategory": "国内求职",
          "tags": [
            "力扣",
            "企业真题"
          ]
        },
        {
          "url": "https://github.com/labuladong/fucking-algorithm",
          "title": "labuladong 的算法小抄",
          "description": "用框架思维带你攻克动态规划、二叉树、回溯算法等高频经典面试难题。",
          "category": "算法面试",
          "subCategory": "解题框架",
          "tags": [
            "labuladong",
            "刷题框架"
          ]
        },
        {
          "url": "https://github.com/youngyangyang04/leetcode-master",
          "title": "代码随想录",
          "description": "通俗易懂的算法训练路线图，按专题系统拆解刷题路径与常见误区避坑指南。",
          "category": "算法面试",
          "subCategory": "系统路线",
          "tags": [
            "代码随想录",
            "算法路线"
          ]
        },
        {
          "url": "https://neetcode.io/",
          "title": "NeetCode",
          "description": "清晰分类的精选 150/75 题算法清单，附带详尽的复杂度分析与视频题解。",
          "category": "算法面试",
          "subCategory": "精选清单",
          "tags": [
            "NeetCode",
            "精选题解"
          ]
        },
        {
          "url": "https://www.codewars.com/",
          "title": "Codewars",
          "description": "通过通关武士段位挑战精妙算法题，磨练极致代码表达力的趣味编程平台。",
          "category": "算法面试",
          "subCategory": "段位挑战",
          "tags": [
            "Codewars",
            "趣味挑战"
          ]
        },
        {
          "url": "https://www.hackerrank.com/",
          "title": "HackerRank",
          "description": "全球众多知名科技企业指定的技术笔试评测与技能认证实战平台。",
          "category": "算法面试",
          "subCategory": "企业测评",
          "tags": [
            "HackerRank",
            "技术认证"
          ]
        },
        {
          "url": "https://github.com/geohot/tinygrad",
          "title": "tinygrad",
          "description": "深研深度学习底层计算图与自动微分极简实现的典范，极佳学习源码。",
          "category": "算法面试",
          "subCategory": "底层实操",
          "tags": [
            "tinygrad",
            "深度学习实现"
          ]
        },
        {
          "url": "https://github.com/karpathy/micrograd",
          "title": "micrograd (Karpathy)",
          "description": "Andrej Karpathy 编写的百行核心自动微分引擎，透彻搞懂反向传播求导。",
          "category": "算法面试",
          "subCategory": "反向传播",
          "tags": [
            "micrograd",
            "反向求导"
          ]
        },
        {
          "url": "https://github.com/karpathy/llm.c",
          "title": "llm.c (Karpathy)",
          "description": "纯纯粹粹的纯 C 语言无庞大依赖训练 GPT-2 的极简杰作，透视底层并行计算。",
          "category": "算法面试",
          "subCategory": "极简纯C",
          "tags": [
            "llm.c",
            "底层并行"
          ]
        },
        {
          "url": "https://neurips.cc/",
          "title": "NeurIPS 官方网站",
          "description": "神经信息处理系统大会，全球最负盛名的人工智能顶会学术前沿风向标。",
          "category": "学术社区",
          "subCategory": "顶会盛宴",
          "tags": [
            "NeurIPS",
            "顶级学术"
          ]
        },
        {
          "url": "https://icml.cc/",
          "title": "ICML 国际机器学习大会",
          "description": "国际顶级机器学习学术盛会，发表众多开创性理论研究与核心架构突破。",
          "category": "学术社区",
          "subCategory": "理论前沿",
          "tags": [
            "ICML",
            "机器学习"
          ]
        },
        {
          "url": "https://iclr.cc/",
          "title": "ICLR 国际学习表征大会",
          "description": "深度学习领域最具活力的顶会之一，开创全公开 OpenReview 透明评审机制。",
          "category": "学术社区",
          "subCategory": "表征学习",
          "tags": [
            "ICLR",
            "OpenReview"
          ]
        },
        {
          "url": "https://cvpr.thecvf.com/",
          "title": "CVPR 计算机视觉大会",
          "description": "全球计算机视觉与模式识别领域水平最高、规模最大的顶级学术会议。",
          "category": "学术社区",
          "subCategory": "视觉计算",
          "tags": [
            "CVPR",
            "多模态视觉"
          ]
        },
        {
          "url": "https://acl2024.org/",
          "title": "ACL 计算语言学年会",
          "description": "自然语言处理 (NLP) 领域历史悠久、声誉卓著的顶级国际学术会议。",
          "category": "学术社区",
          "subCategory": "语言处理",
          "tags": [
            "ACL",
            "NLP顶会"
          ]
        },
        {
          "url": "https://openreview.net/",
          "title": "OpenReview 评审平台",
          "description": "促进科学研究透明度与学术同行评审公开公正的知名网络学术评审平台。",
          "category": "学术社区",
          "subCategory": "公开评审",
          "tags": [
            "OpenReview",
            "学术评审"
          ]
        },
        {
          "url": "https://paperswithcode.com/",
          "title": "Papers with Code 主站",
          "description": "将全球顶尖 AI 论文、对应开源实现代码与标准化测试基准建立完整关联的枢纽。",
          "category": "学术社区",
          "subCategory": "论文代码互联",
          "tags": [
            "Papers with Code",
            "代码复现"
          ]
        },
        {
          "url": "https://www.aminer.cn/",
          "title": "AMiner 科技情报",
          "description": "清华大学打造的科技情报与学者知识图谱挖掘平台，快速追踪全球学术大家。",
          "category": "学术社区",
          "subCategory": "知识图谱",
          "tags": [
            "AMiner",
            "学者分析"
          ]
        },
        {
          "url": "https://www.semanticscholar.org/",
          "title": "Semantic Scholar",
          "description": "艾伦人工智能研究所打造的基于 AI 提取要点与引用影响力的学术知识库。",
          "category": "学术社区",
          "subCategory": "语义检索",
          "tags": [
            "Semantic Scholar",
            "学术引用"
          ]
        },
        {
          "url": "https://connectedpapers.com/",
          "title": "Connected Papers",
          "description": "输入一篇核心论文，通过引文网络生成直观的可视化相关研究脉络图谱。",
          "category": "学术社区",
          "subCategory": "脉络图谱",
          "tags": [
            "引文网络",
            "研究脉络"
          ]
        },
        {
          "url": "https://doaj.org/",
          "title": "DOAJ 开放存取期刊目录",
          "description": "独立且声誉卓著的开放存取期刊指南，收录经过严格质量把关的高质量开放学术成果。",
          "category": "开放获取",
          "subCategory": "开放期刊",
          "tags": [
            "DOAJ",
            "开放获取"
          ]
        },
        {
          "url": "https://openalex.org/",
          "title": "OpenAlex 开放学术知识图谱",
          "description": "包含数亿篇论文、作者、机构与研究主题的完全开放全球学术文献数据库。",
          "category": "开放获取",
          "subCategory": "开放文献库",
          "tags": [
            "OpenAlex",
            "免费学术"
          ]
        },
        {
          "url": "https://arxiv.org/",
          "title": "arXiv 预印本总库",
          "description": "全球计算机科学、数学与物理学学者抢先发布突破性研究的首选开放预印本库。",
          "category": "开放获取",
          "subCategory": "预印本中心",
          "tags": [
            "arXiv",
            "预印本"
          ]
        },
        {
          "url": "https://biorxiv.org/",
          "title": "bioRxiv 生命科学预印本",
          "description": "由冷泉港实验室运营的生物与生命科学领域的非营利开放获取论文发布平台。",
          "category": "开放获取",
          "subCategory": "生命科学",
          "tags": [
            "bioRxiv",
            "生物学"
          ]
        },
        {
          "url": "https://medrxiv.org/",
          "title": "medRxiv 医学预印本",
          "description": "专为医学、临床研究与公共卫生领域打造的快速预印本文献发布分享库。",
          "category": "开放获取",
          "subCategory": "医学前沿",
          "tags": [
            "medRxiv",
            "医学研究"
          ]
        },
        {
          "url": "https://unpaywall.org/",
          "title": "Unpaywall",
          "description": "合法的开放获取学术论文搜索引擎与浏览器插件，帮助免费阅读海量文献。",
          "category": "开放获取",
          "subCategory": "合法免费",
          "tags": [
            "Unpaywall",
            "免付费文献"
          ]
        },
        {
          "url": "https://europepmc.org/",
          "title": "Europe PMC",
          "description": "由欧洲生物信息学研究所托管的欧洲生命科学与生物医学开放学术文献中心。",
          "category": "开放获取",
          "subCategory": "欧洲学术",
          "tags": [
            "EuropePMC",
            "医学文献"
          ]
        },
        {
          "url": "https://core.ac.uk/",
          "title": "CORE 开放研究聚合器",
          "description": "全球最大的开放获取研究论文聚合服务，汇聚全球大学机构知识库的珍贵资产。",
          "category": "开放获取",
          "subCategory": "机构知识库",
          "tags": [
            "CORE",
            "研究聚合"
          ]
        },
        {
          "url": "https://zenodo.org/",
          "title": "Zenodo 开放科学归档",
          "description": "由 CERN 运营的通用开放数据存储库，为任意研究项目、数据集赋予永久 DOI。",
          "category": "开放获取",
          "subCategory": "数据归档",
          "tags": [
            "Zenodo",
            "CERN数据"
          ]
        },
        {
          "url": "https://osf.io/",
          "title": "OSF (Open Science Framework)",
          "description": "支持整个科研生命周期计划、执行与透明数据共享的开源协作网络平台。",
          "category": "开放获取",
          "subCategory": "开放科研",
          "tags": [
            "OSF",
            "科研透明"
          ]
        },
        {
          "url": "https://scholar.google.com/",
          "title": "Google 学术搜索 (Google Scholar)",
          "description": "涵盖最广泛学术领域期刊、专著与预印本的全球通用学术文献搜索引擎。",
          "category": "文献检索",
          "subCategory": "全球搜索",
          "tags": [
            "Google Scholar",
            "学术搜索"
          ]
        },
        {
          "url": "https://www.sciencedirect.com/",
          "title": "ScienceDirect (Elsevier)",
          "description": "爱思唯尔旗下的同行评审全文科学与医学研究学术数据库。",
          "category": "文献检索",
          "subCategory": "学术期刊",
          "tags": [
            "ScienceDirect",
            "权威出版"
          ]
        },
        {
          "url": "https://ieeexplore.ieee.org/",
          "title": "IEEE Xplore 数字图书馆",
          "description": "电气工程、计算机科学与电子技术领域最权威的会议与期刊文献平台。",
          "category": "文献检索",
          "subCategory": "工程技术",
          "tags": [
            "IEEE",
            "电气与计算机"
          ]
        },
        {
          "url": "https://dl.acm.org/",
          "title": "ACM Digital Library",
          "description": "美国计算机学会权威全文数据库，计算机前沿软件算法研究文献的核心源头。",
          "category": "文献检索",
          "subCategory": "计算机学会",
          "tags": [
            "ACM",
            "计算机文献"
          ]
        },
        {
          "url": "https://www.nature.com/",
          "title": "Nature 自然杂志",
          "description": "全球最具声望的跨学科科学周刊之一，发表最具影响力的开创性科学成果。",
          "category": "文献检索",
          "subCategory": "顶级顶刊",
          "tags": [
            "Nature",
            "科学顶刊"
          ]
        },
        {
          "url": "https://www.science.org/",
          "title": "Science 科学杂志",
          "description": "美国科学促进会 (AAAS) 主办的全球顶尖同行评审学术期刊门户。",
          "category": "文献检索",
          "subCategory": "顶级顶刊",
          "tags": [
            "Science",
            "顶尖期刊"
          ]
        },
        {
          "url": "https://pubmed.ncbi.nlm.nih.gov/",
          "title": "PubMed",
          "description": "美国国家生物技术信息中心 (NCBI) 维护的全球生物医学与生命科学文献检索入口。",
          "category": "文献检索",
          "subCategory": "生物医学",
          "tags": [
            "PubMed",
            "NCBI"
          ]
        },
        {
          "url": "https://www.cnki.net/",
          "title": "中国知网 (CNKI)",
          "description": "国内最大学术资源总库，收录海量中文学术期刊、学位论文与会议文献。",
          "category": "文献检索",
          "subCategory": "中文文献",
          "tags": [
            "知网",
            "中文学术"
          ]
        },
        {
          "url": "https://www.wanfangdata.com.cn/",
          "title": "万方数据知识服务平台",
          "description": "国内领先的科技文献综合检索服务商，涵盖期刊、学术论文与专利数据库。",
          "category": "文献检索",
          "subCategory": "国内数据库",
          "tags": [
            "万方",
            "文献检索"
          ]
        },
        {
          "url": "https://citeseerx.ist.psu.edu/",
          "title": "CiteSeerX",
          "description": "宾夕法尼亚州立大学维护的计算机与信息科学公共数字图书馆与自主引文索引系统。",
          "category": "文献检索",
          "subCategory": "引文索引",
          "tags": [
            "CiteSeerX",
            "引文检索"
          ]
        }
      ]
    }
  }
};
