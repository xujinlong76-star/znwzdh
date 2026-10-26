/**
 * 种子插件：MCP 协议与智能体工具库生态包（site-pack）
 *
 * 遵循 2026 前沿技术标准打造的旗舰级专业网址包。
 * 覆盖 19 大核心分类与 191 个前沿站点。
 */
import type { SeedPluginDef } from "../types.ts";

export const mcpEcosystemArsenal: SeedPluginDef = {
  "slug": "mcp-ecosystem-arsenal",
  "status": "published",
  "manifest": {
    "manifestVersion": 1,
    "kind": "site-pack",
    "name": "MCP 协议与智能体工具库生态包",
    "description": "2026 前沿 Model Context Protocol (MCP) 标准与智能体连接生态全景导航（19 大分类 / 198 个精选站点）：系统收录官方协议规范、多语言 SDK、全网 MCP 市场目录、数据库与文件系统 Server、DevOps 与安全工具，助你构建无所不能的工具连接型智能体。",
    "icon": "🔌",
    "author": "山羊胡官方",
    "license": "MIT",
    "version": "1.0.0",
    "tags": [
      "MCP",
      "MCP协议",
      "Agent",
      "Tooling",
      "Anthropic",
      "智能体",
      "工具生态"
    ],
    "payload": {
      "categories": [
        {
          "title": "智能体与自动化",
          "description": "原生支持 MCP 工具调用协议的 Agent 框架、网关与编排核心"
        },
        {
          "title": "AI 编程助手",
          "description": "支持 MCP 动态扩展工具集的现代 AI 编辑器、IDE 与终端 Agent"
        },
        {
          "title": "向量库与 RAG",
          "description": "通过 MCP 暴露语义检索与知识库能力的向量引擎与嵌入服务"
        },
        {
          "title": "对话助手",
          "description": "具备深度推理、外部工具调用与协议集成的多模态对话入口"
        },
        {
          "title": "AI 硬件与具身",
          "description": "端侧运行 MCP Server 的硬件开发板、机器人中间件与传感器"
        },
        {
          "title": "API 设计与治理",
          "description": "MCP 工具协议定义、Schema 校验、API 契约与生命周期管理"
        },
        {
          "title": "数据库与存储",
          "description": "官方与社区针对主流数据库打造的原生 MCP Server 数据连接器"
        },
        {
          "title": "语言与运行时",
          "description": "构建高性能 MCP Server 的主流编程语言、官方 SDK 与运行时"
        },
        {
          "title": "消息与流处理",
          "description": "智能体事件驱动通信、消息队列与长连接流式通道服务"
        },
        {
          "title": "无服务器与事件",
          "description": "无服务器函数部署 MCP Server 的边缘运行时与事件触发平台"
        },
        {
          "title": "容器与编排",
          "description": "一键部署打包 MCP Server 的轻量容器化镜像与编排配置"
        },
        {
          "title": "可观测与监控",
          "description": "MCP 协议会话追踪、工具执行耗时监控与上下文遥测大盘"
        },
        {
          "title": "网关与流量",
          "description": "智能体网络代理、反向路由、SSE/Stdio 转发与流量控制网关"
        },
        {
          "title": "应用与密钥安全",
          "description": "MCP Server 鉴权、敏感环境变量隔离与沙箱权限最小化机制"
        },
        {
          "title": "官方文档",
          "description": "MCP 官方规范白皮书、快速上手指南与各主流工具技术参考"
        },
        {
          "title": "接口调试",
          "description": "MCP 协议原生 Inspector、测试客户端与 Stdio/SSE 调试器"
        },
        {
          "title": "命令行速查",
          "description": "管理、安装与调试本地 MCP 服务的命令行实用工具集"
        },
        {
          "title": "代码托管",
          "description": "开源 MCP Server 项目托管平台、代码索引与参考实现库"
        },
        {
          "title": "持续交付",
          "description": "自动化构建、安全审计与持续发布 MCP 服务的 CI/CD 流水线"
        }
      ],
      "sites": [
        {
          "url": "https://modelcontextprotocol.io/",
          "title": "MCP 官方主页",
          "description": "Anthropic 主导的开放标准 Model Context Protocol 官方网站与入门指南。",
          "category": "智能体与自动化",
          "subCategory": "协议核心",
          "tags": [
            "MCP",
            "官方",
            "规范"
          ]
        },
        {
          "url": "https://smithery.ai/",
          "title": "Smithery",
          "description": "全球最大 MCP Server 注册与发现平台，支持一键在各终端安装。",
          "category": "智能体与自动化",
          "subCategory": "市场发现",
          "tags": [
            "Smithery",
            "MCP市场"
          ]
        },
        {
          "url": "https://pulsemcp.com/",
          "title": "PulseMCP",
          "description": "实时追踪全网高质量 MCP Server 与客户端更新动态的生态发现中枢。",
          "category": "智能体与自动化",
          "subCategory": "动态追踪",
          "tags": [
            "PulseMCP",
            "生态"
          ]
        },
        {
          "url": "https://mcp.so/",
          "title": "mcp.so",
          "description": "精选 MCP 工具与服务目录，提供清晰的分类浏览与安装命令指南。",
          "category": "智能体与自动化",
          "subCategory": "工具目录",
          "tags": [
            "mcp.so",
            "工具集"
          ]
        },
        {
          "url": "https://glama.ai/mcp/servers",
          "title": "Glama MCP 目录",
          "description": "收录各类活跃 MCP Server 的开发者协作与展示目录。",
          "category": "智能体与自动化",
          "subCategory": "开发者目录",
          "tags": [
            "Glama",
            "目录"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/servers",
          "title": "MCP 官方 Reference Servers",
          "description": "Anthropic 官方参考实现的开源 MCP Server 仓库，涵盖 Git、Postgres 等。",
          "category": "智能体与自动化",
          "subCategory": "官方仓库",
          "tags": [
            "官方参考",
            "开源"
          ]
        },
        {
          "url": "https://github.com/wong2/awesome-mcp-servers",
          "title": "Awesome MCP Servers",
          "description": "社区高星精选 MCP 服务列表，汇集全球开发者贡献的高频工具。",
          "category": "智能体与自动化",
          "subCategory": "开源列表",
          "tags": [
            "Awesome",
            "精选"
          ]
        },
        {
          "url": "https://github.com/punkpeye/awesome-mcp-servers",
          "title": "Awesome MCP 生态合集",
          "description": "覆盖客户端、服务端、SDK 与教程的综合性 MCP 资源大全。",
          "category": "智能体与自动化",
          "subCategory": "资源合集",
          "tags": [
            "MCP合集",
            "指南"
          ]
        },
        {
          "url": "https://superagent.sh/",
          "title": "Superagent",
          "description": "内置多协议工具集的企业级 AI Agent 工作流与工具调用执行基础设施。",
          "category": "智能体与自动化",
          "subCategory": "Agent平台",
          "tags": [
            "Superagent",
            "工具编排"
          ]
        },
        {
          "url": "https://github.com/run-llama/llama-agents",
          "title": "llama-agents",
          "description": "LlamaIndex 推出的面向服务的多 Agent 编排框架，原生协同工具接口。",
          "category": "智能体与自动化",
          "subCategory": "服务编排",
          "tags": [
            "LlamaIndex",
            "分布式Agent"
          ]
        },
        {
          "url": "https://github.com/e2b-dev/E2B",
          "title": "E2B",
          "description": "为 AI 智能体打造的云端安全代码沙箱，通过代码执行安全调用工具。",
          "category": "智能体与自动化",
          "subCategory": "代码沙箱",
          "tags": [
            "E2B",
            "安全执行"
          ]
        },
        {
          "url": "https://claude.ai/download",
          "title": "Claude Desktop",
          "description": "Anthropic 官方桌面端，原生支持配置与挂载本地任意 Stdio MCP Server。",
          "category": "AI 编程助手",
          "subCategory": "官方宿主",
          "tags": [
            "Claude",
            "桌面宿主"
          ]
        },
        {
          "url": "https://www.cursor.com/features",
          "title": "Cursor (MCP 集成)",
          "description": "前沿 AI IDE，原生支持添加与调用外部 MCP Server 扩展编码工具链。",
          "category": "AI 编程助手",
          "subCategory": "AI IDE",
          "tags": [
            "Cursor",
            "MCP"
          ]
        },
        {
          "url": "https://codeium.com/windsurf/features",
          "title": "Windsurf (Cascade MCP)",
          "description": "首批原生支持 MCP 协议的智能 IDE，让代理自主读写外部数据源。",
          "category": "AI 编程助手",
          "subCategory": "AI IDE",
          "tags": [
            "Windsurf",
            "Cascade"
          ]
        },
        {
          "url": "https://github.com/cline/cline",
          "title": "Cline",
          "description": "VS Code 中的高星开源自主编程代理，率先全面支持动态 MCP 工具拓展。",
          "category": "AI 编程助手",
          "subCategory": "VS Code插件",
          "tags": [
            "Cline",
            "开源代理"
          ]
        },
        {
          "url": "https://github.com/RooVetGit/Roo-Code-MCP",
          "title": "Roo Code MCP 体系",
          "description": "支持配置自定义上下文模式与专有 MCP Server 的自主开发插件。",
          "category": "AI 编程助手",
          "subCategory": "VS Code插件",
          "tags": [
            "Roo Code",
            "模式切换"
          ]
        },
        {
          "url": "https://zed.dev/",
          "title": "Zed 编辑器",
          "description": "高性能 Rust 编写的现代化代码编辑器，支持 Assistant 面板与工具集成。",
          "category": "AI 编程助手",
          "subCategory": "Rust编辑器",
          "tags": [
            "Zed",
            "Rust"
          ]
        },
        {
          "url": "https://github.com/block/goose",
          "title": "Goose by Block",
          "description": "Block 公司开源的终端全自主 AI 开发者代理，具备强大可扩展工具系统。",
          "category": "AI 编程助手",
          "subCategory": "终端代理",
          "tags": [
            "Goose",
            "Block"
          ]
        },
        {
          "url": "https://github.com/anthropics/anthropic-quickstarts",
          "title": "Anthropic Quickstarts",
          "description": "官方提供的计算机操控与工具集成示例代码仓库，含 MCP 落地模板。",
          "category": "AI 编程助手",
          "subCategory": "官方范例",
          "tags": [
            "Anthropic",
            "Quickstart"
          ]
        },
        {
          "url": "https://continue.dev/docs/features/tools",
          "title": "Continue Tools",
          "description": "Continue 开源编程助手的扩展工具支持，桥接本地与外部服务数据。",
          "category": "AI 编程助手",
          "subCategory": "开源插件",
          "tags": [
            "Continue",
            "Tools"
          ]
        },
        {
          "url": "https://aider.chat/docs/scripting.html",
          "title": "Aider 自动化脚本",
          "description": "通过命令行与脚本管道扩展 Aider 的外部工具调用能力与自动化场景。",
          "category": "AI 编程助手",
          "subCategory": "终端工具",
          "tags": [
            "Aider",
            "脚本编排"
          ]
        },
        {
          "url": "https://github.com/qdrant/mcp-server-qdrant",
          "title": "Qdrant MCP Server",
          "description": "Qdrant 官方维护的 MCP 服务端，让智能体获得向量检索与点检索能力。",
          "category": "向量库与 RAG",
          "subCategory": "官方Server",
          "tags": [
            "Qdrant",
            "向量Server"
          ]
        },
        {
          "url": "https://github.com/chroma-core/chroma-mcp",
          "title": "Chroma MCP Server",
          "description": "Chroma 向量数据库的 MCP 适配层，支持知识库快速语义查找。",
          "category": "向量库与 RAG",
          "subCategory": "官方Server",
          "tags": [
            "Chroma",
            "知识检索"
          ]
        },
        {
          "url": "https://github.com/weaviate/weaviate-mcp",
          "title": "Weaviate MCP Server",
          "description": "连接 Weaviate 多模态向量知识图谱的 Model Context Protocol 适配服务。",
          "category": "向量库与 RAG",
          "subCategory": "向量Server",
          "tags": [
            "Weaviate",
            "图向量"
          ]
        },
        {
          "url": "https://github.com/milvus-io/milvus-mcp-server",
          "title": "Milvus MCP Server",
          "description": "面向海量企业知识库检索的 Milvus 原生 MCP 工具插件实现。",
          "category": "向量库与 RAG",
          "subCategory": "企业级Server",
          "tags": [
            "Milvus",
            "大规模"
          ]
        },
        {
          "url": "https://github.com/lancedb/lance-mcp",
          "title": "LanceDB MCP 适配器",
          "description": "为本地端侧 LanceDB 嵌入式向量数据库打造的无外部依赖 MCP 连接器。",
          "category": "向量库与 RAG",
          "subCategory": "轻量Server",
          "tags": [
            "LanceDB",
            "端侧RAG"
          ]
        },
        {
          "url": "https://github.com/run-llama/mcp-server-llamaindex",
          "title": "LlamaIndex MCP Server",
          "description": "将 LlamaIndex 的多数据源索引与查询引擎直接暴露为标准 MCP 工具。",
          "category": "向量库与 RAG",
          "subCategory": "引擎Server",
          "tags": [
            "LlamaIndex",
            "知识管道"
          ]
        },
        {
          "url": "https://github.com/deepset-ai/haystack-mcp",
          "title": "Haystack MCP Node",
          "description": "将工业级 NLP 问答流水线转化为智能体即插即用的 MCP 节点组件。",
          "category": "向量库与 RAG",
          "subCategory": "流水线Node",
          "tags": [
            "Haystack",
            "NLP检索"
          ]
        },
        {
          "url": "https://github.com/infiniflow/ragflow-mcp",
          "title": "RAGFlow MCP Server",
          "description": "把深度排版理解的精准非结构化文档知识提供给智能体的 MCP 接口。",
          "category": "向量库与 RAG",
          "subCategory": "文档解析Server",
          "tags": [
            "RAGFlow",
            "深度理解"
          ]
        },
        {
          "url": "https://github.com/dify-ai/dify-mcp",
          "title": "Dify MCP 桥接器",
          "description": "将 Dify 编排好的高级知识库与工作流转为标准 MCP 暴露给宿主。",
          "category": "向量库与 RAG",
          "subCategory": "工作流桥接",
          "tags": [
            "Dify",
            "工作流桥接"
          ]
        },
        {
          "url": "https://github.com/unstructured-io/unstructured-mcp",
          "title": "Unstructured MCP Server",
          "description": "向智能体提供万能文档解析、格式清洗与结构化切片能力的 MCP 节点。",
          "category": "向量库与 RAG",
          "subCategory": "清洗切片",
          "tags": [
            "Unstructured",
            "文档ETL"
          ]
        },
        {
          "url": "https://claude.ai/chats",
          "title": "Claude.ai 深度助手",
          "description": "具备强大 Reasoning 推理与上下文工程能力的旗舰对话工作台。",
          "category": "对话助手",
          "subCategory": "官方平台",
          "tags": [
            "Claude",
            "对话"
          ]
        },
        {
          "url": "https://chatgpt.com/gpts",
          "title": "ChatGPT GPTs 生态",
          "description": "OpenAI 的自定义 GPT 工具平台，支持 Function Calling 与外部 Actions。",
          "category": "对话助手",
          "subCategory": "生态平台",
          "tags": [
            "ChatGPT",
            "Actions"
          ]
        },
        {
          "url": "https://github.com/open-webui/open-webui",
          "title": "Open-WebUI",
          "description": "自托管离线 AI 对话前端，内置强大的 Tools 工具函数调用与拓展支持。",
          "category": "对话助手",
          "subCategory": "自托管",
          "tags": [
            "Open-WebUI",
            "Tools"
          ]
        },
        {
          "url": "https://github.com/lobehub/lobe-chat",
          "title": "LobeChat",
          "description": "现代化高颜值开源对话应用，拥有完备的插件市场与自定义模型体系。",
          "category": "对话助手",
          "subCategory": "开源客户端",
          "tags": [
            "LobeChat",
            "插件市场"
          ]
        },
        {
          "url": "https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web",
          "title": "NextChat",
          "description": "轻量跨平台 AI 对话客户端，支持一键部署到 Vercel 与自建服务器。",
          "category": "对话助手",
          "subCategory": "轻量客户端",
          "tags": [
            "NextChat",
            "一键部署"
          ]
        },
        {
          "url": "https://github.com/chatbox-ai/chatbox",
          "title": "Chatbox",
          "description": "全平台桌面开源 AI 客户端，支持本地数据存储与多服务商 API 密钥配置。",
          "category": "对话助手",
          "subCategory": "桌面客户端",
          "tags": [
            "Chatbox",
            "本地隐私"
          ]
        },
        {
          "url": "https://github.com/danny-avila/LibreChat",
          "title": "LibreChat",
          "description": "功能极其完备的企业级开源 ChatGPT 替代品，支持多用户与高级代理模式。",
          "category": "对话助手",
          "subCategory": "企业自托管",
          "tags": [
            "LibreChat",
            "多用户"
          ]
        },
        {
          "url": "https://github.com/Mintplex-Labs/anything-llm",
          "title": "AnythingLLM",
          "description": "全合一企业级私有知识库与多智能体工作台，支持零配置本地向量搜索。",
          "category": "对话助手",
          "subCategory": "私有化平台",
          "tags": [
            "AnythingLLM",
            "知识库"
          ]
        },
        {
          "url": "https://www.cherry-studio.net/",
          "title": "Cherry Studio",
          "description": "专为全平台设计的强大 AI 桌面客户端，内置多模型聚合与丰富插件体系。",
          "category": "对话助手",
          "subCategory": "国内客户端",
          "tags": [
            "Cherry Studio",
            "桌面客户端"
          ]
        },
        {
          "url": "https://jan.ai/",
          "title": "Jan 官方客户端",
          "description": "完全离线运行、尊重隐私的开源本地大模型对话桌面工作台。",
          "category": "对话助手",
          "subCategory": "离线本地",
          "tags": [
            "Jan",
            "本地运行"
          ]
        },
        {
          "url": "https://www.raspberrypi.com/products/ai-kit/",
          "title": "Raspberry Pi AI Kit",
          "description": "树莓派 5 专属 AI 加速扩展套件，可在边缘微型设备上驱动 MCP Server。",
          "category": "AI 硬件与具身",
          "subCategory": "单板电脑",
          "tags": [
            "树莓派",
            "边缘AI"
          ]
        },
        {
          "url": "https://developer.nvidia.com/embedded/jetson-nano",
          "title": "NVIDIA Jetson",
          "description": "英伟达边缘计算与嵌入式机器人平台，提供强大的本地张量计算能力。",
          "category": "AI 硬件与具身",
          "subCategory": "边缘计算",
          "tags": [
            "Jetson",
            "NVIDIA"
          ]
        },
        {
          "url": "https://www.home-assistant.io/",
          "title": "Home Assistant",
          "description": "全球知名的开源家庭自动化系统，现可通过 MCP 实现智能体全屋控制。",
          "category": "AI 硬件与具身",
          "subCategory": "智能家居",
          "tags": [
            "HomeAssistant",
            "物联网"
          ]
        },
        {
          "url": "https://github.com/home-assistant/core",
          "title": "Home Assistant 核心仓库",
          "description": "连接数千种智能硬件与传感器的开源物联网大脑与 Python 中枢。",
          "category": "AI 硬件与具身",
          "subCategory": "物联网内核",
          "tags": [
            "HA Core",
            "传感器"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
          "title": "Puppeteer MCP Server",
          "description": "Anthropic 官方参考实现的无头浏览器控制 MCP，实现智能体视觉与网页操作。",
          "category": "AI 硬件与具身",
          "subCategory": "浏览器自动化",
          "tags": [
            "Puppeteer",
            "网页操作"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
          "title": "Filesystem MCP Server",
          "description": "官方文件系统读写与目录遍历 MCP 服务端，严格限定安全沙箱路径。",
          "category": "AI 硬件与具身",
          "subCategory": "设备存储",
          "tags": [
            "文件系统",
            "沙箱"
          ]
        },
        {
          "url": "https://coral.ai/",
          "title": "Google Coral",
          "description": "谷歌 Edge TPU 硬件生态，为低功耗边缘设备带来极速本地推理能力。",
          "category": "AI 硬件与具身",
          "subCategory": "EdgeTPU",
          "tags": [
            "Coral",
            "TPU"
          ]
        },
        {
          "url": "https://www.arduino.cc/",
          "title": "Arduino 开发者生态",
          "description": "开源硬件与微控制器平台，连接物理世界开关与传感器执行器。",
          "category": "AI 硬件与具身",
          "subCategory": "微控制器",
          "tags": [
            "Arduino",
            "嵌入式"
          ]
        },
        {
          "url": "https://espressif.com/",
          "title": "Espressif (ESP32)",
          "description": "广受开发者青睐的 Wi-Fi/蓝牙 双模微芯片，可构建无线智能体硬件探针。",
          "category": "AI 硬件与具身",
          "subCategory": "无线芯片",
          "tags": [
            "ESP32",
            "物联网芯片"
          ]
        },
        {
          "url": "https://github.com/ros2/ros2",
          "title": "ROS 2 (Robot Operating System)",
          "description": "面向机器人自主导航、运动控制与传感器融合的下一代机器人操作系统。",
          "category": "AI 硬件与具身",
          "subCategory": "机器人系统",
          "tags": [
            "ROS2",
            "机器人"
          ]
        },
        {
          "url": "https://spec.modelcontextprotocol.io/",
          "title": "MCP Specification 规范白皮书",
          "description": "Model Context Protocol JSON-RPC 2.0 基础协议定义、能力协商与消息契约。",
          "category": "API 设计与治理",
          "subCategory": "协议规范",
          "tags": [
            "规范",
            "JSON-RPC"
          ]
        },
        {
          "url": "https://json-schema.org/",
          "title": "JSON Schema 官方门户",
          "description": "描述与校验 JSON 数据结构的全球标准，MCP 工具参数规范的基石。",
          "category": "API 设计与治理",
          "subCategory": "Schema规范",
          "tags": [
            "JSON Schema",
            "类型校验"
          ]
        },
        {
          "url": "https://zod.dev/",
          "title": "Zod",
          "description": "TypeScript 优先的模式声明与数据校验库，开发 TS 版 MCP Server 必用。",
          "category": "API 设计与治理",
          "subCategory": "类型验证",
          "tags": [
            "Zod",
            "TypeScript"
          ]
        },
        {
          "url": "https://docs.pydantic.dev/",
          "title": "Pydantic",
          "description": "Python 中广泛采纳的高性能数据验证与类型设置定义库，驱动 Python MCP。",
          "category": "API 设计与治理",
          "subCategory": "Python类型",
          "tags": [
            "Pydantic",
            "Python校验"
          ]
        },
        {
          "url": "https://www.openapis.org/",
          "title": "OpenAPI Initiative",
          "description": "业界标准 RESTful API 描述格式，生态内支持将 OpenAPI 自动转为 MCP。",
          "category": "API 设计与治理",
          "subCategory": "API规范",
          "tags": [
            "OpenAPI",
            "Swagger"
          ]
        },
        {
          "url": "https://github.com/stoplightio/prism",
          "title": "Prism",
          "description": "由 OpenAPI 驱动的高性能 HTTP Mock 与契约测试服务，保障接口一致性。",
          "category": "API 设计与治理",
          "subCategory": "契约测试",
          "tags": [
            "Prism",
            "Mock"
          ]
        },
        {
          "url": "https://buf.build/",
          "title": "Buf",
          "description": "现代 Protocol Buffers 与 gRPC 架构设计、静态检查与依赖管理协同平台。",
          "category": "API 设计与治理",
          "subCategory": "Protobuf管理",
          "tags": [
            "Buf",
            "Protobuf"
          ]
        },
        {
          "url": "https://stainlessapi.com/",
          "title": "Stainless",
          "description": "为现代 API 自动生成生产级多语言强类型 SDK 的知名工业平台。",
          "category": "API 设计与治理",
          "subCategory": "SDK生成",
          "tags": [
            "Stainless",
            "SDK"
          ]
        },
        {
          "url": "https://speakeasyapi.dev/",
          "title": "Speakeasy",
          "description": "从 API 规范自动生成企业级 SDK、Terraform Provider 与 MCP Server 的平台。",
          "category": "API 设计与治理",
          "subCategory": "代码生成",
          "tags": [
            "Speakeasy",
            "生成器"
          ]
        },
        {
          "url": "https://fern.com/",
          "title": "Fern",
          "description": "面向 API 开发者的文档生成与全语言 SDK 自动化发布解决方案。",
          "category": "API 设计与治理",
          "subCategory": "API文档",
          "tags": [
            "Fern",
            "文档发布"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
          "title": "PostgreSQL MCP Server",
          "description": "Anthropic 官方维护的只读/受控读写 Postgres 数据库结构与查询 Server。",
          "category": "数据库与存储",
          "subCategory": "官方Server",
          "tags": [
            "PostgreSQL",
            "关系型"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
          "title": "SQLite MCP Server",
          "description": "官方提供的轻量 SQLite 数据库文件读写、Schema 探测与执行工具。",
          "category": "数据库与存储",
          "subCategory": "官方Server",
          "tags": [
            "SQLite",
            "轻量数据库"
          ]
        },
        {
          "url": "https://github.com/designcomputer/mysql_mcp_server",
          "title": "MySQL MCP Server",
          "description": "社区高星 MySQL/MariaDB 数据库连接器，让智能体安全查询表元信息与记录。",
          "category": "数据库与存储",
          "subCategory": "社区Server",
          "tags": [
            "MySQL",
            "关系数据库"
          ]
        },
        {
          "url": "https://github.com/redis/mcp-redis",
          "title": "Redis MCP Server",
          "description": "Redis 官方支持的高性能键值缓存、分布式锁与数据流操作 MCP 工具服务。",
          "category": "数据库与存储",
          "subCategory": "官方Server",
          "tags": [
            "Redis",
            "缓存"
          ]
        },
        {
          "url": "https://github.com/mongodb-developer/mcp-server-mongodb",
          "title": "MongoDB MCP Server",
          "description": "连接 MongoDB 灵活文档数据库的官方示范服务，支持复杂聚合与查询。",
          "category": "数据库与存储",
          "subCategory": "文档数据库",
          "tags": [
            "MongoDB",
            "NoSQL"
          ]
        },
        {
          "url": "https://github.com/duckdb/mcp-duckdb",
          "title": "DuckDB MCP 适配器",
          "description": "针对 Parquet 与本地数据进行极速分析型 SQL 查询的 DuckDB MCP 节点。",
          "category": "数据库与存储",
          "subCategory": "分析数据库",
          "tags": [
            "DuckDB",
            "OLAP分析"
          ]
        },
        {
          "url": "https://supabase.com/docs/guides/ai",
          "title": "Supabase AI & MCP",
          "description": "开源 Firebase 替代品，通过 Postgres 与 pgvector 为智能体提供云原生存储。",
          "category": "数据库与存储",
          "subCategory": "云数据库",
          "tags": [
            "Supabase",
            "BaaS"
          ]
        },
        {
          "url": "https://neon.tech/docs/ai/mcp",
          "title": "Neon Serverless Postgres",
          "description": "支持即时计算分支的无服务器 Postgres，为每个智能体分配独立实验数据库。",
          "category": "数据库与存储",
          "subCategory": "Serverless",
          "tags": [
            "Neon",
            "分支数据库"
          ]
        },
        {
          "url": "https://planetscale.com/",
          "title": "PlanetScale",
          "description": "基于 Vitess 架构的超强伸缩 MySQL 兼容数据库，提供无停机架构变更。",
          "category": "数据库与存储",
          "subCategory": "分布式数据库",
          "tags": [
            "PlanetScale",
            "MySQL"
          ]
        },
        {
          "url": "https://turso.tech/",
          "title": "Turso (libSQL)",
          "description": "基于 libSQL 构建的边缘分布式 SQLite 数据库，毫秒级全球就近读取。",
          "category": "数据库与存储",
          "subCategory": "边缘数据库",
          "tags": [
            "Turso",
            "libSQL"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/typescript-sdk",
          "title": "MCP TypeScript SDK",
          "description": "Anthropic 官方维护的 TypeScript / JavaScript MCP Server & Client SDK。",
          "category": "语言与运行时",
          "subCategory": "官方SDK",
          "tags": [
            "TypeScript",
            "官方SDK"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/python-sdk",
          "title": "MCP Python SDK",
          "description": "Anthropic 官方推出的基于 asyncio 的现代 Python MCP 开发工具包。",
          "category": "语言与运行时",
          "subCategory": "官方SDK",
          "tags": [
            "Python",
            "官方SDK"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/kotlin-sdk",
          "title": "MCP Kotlin SDK",
          "description": "JetBrains 与社区支持的现代 JVM / Kotlin 版 MCP 官方协议驱动。",
          "category": "语言与运行时",
          "subCategory": "官方SDK",
          "tags": [
            "Kotlin",
            "JVM"
          ]
        },
        {
          "url": "https://github.com/metoro-io/mcp-golang",
          "title": "mcp-golang",
          "description": "高性能 Go 语言实现的原生 MCP 服务端库，轻松编译为单可执行文件。",
          "category": "语言与运行时",
          "subCategory": "Go生态",
          "tags": [
            "Go",
            "Golang"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/rust-sdk",
          "title": "MCP Rust SDK",
          "description": "社区主导的高性能、强类型且极小内存占用的 Rust 版 MCP 协议实现。",
          "category": "语言与运行时",
          "subCategory": "Rust生态",
          "tags": [
            "Rust",
            "系统级"
          ]
        },
        {
          "url": "https://deno.com/blog/mcp",
          "title": "Deno MCP 运行时支持",
          "description": "利用 Deno 零配置运行 TypeScript 与内置权限模型构建最安全的 MCP Server。",
          "category": "语言与运行时",
          "subCategory": "安全运行时",
          "tags": [
            "Deno",
            "沙箱安全"
          ]
        },
        {
          "url": "https://bun.sh/docs",
          "title": "Bun 快速运行 MCP",
          "description": "使用极速的 Bun 运行时几毫秒即可启动 Stdio 模式的本地 MCP 工具子进程。",
          "category": "语言与运行时",
          "subCategory": "极速运行时",
          "tags": [
            "Bun",
            "极速启动"
          ]
        },
        {
          "url": "https://pypi.org/project/mcp/",
          "title": "PyPI mcp 官方包",
          "description": "Python 官方包分发中心上的 mcp 基础协议核心包页面与版本发布记录。",
          "category": "语言与运行时",
          "subCategory": "Python包",
          "tags": [
            "PyPI",
            "Python"
          ]
        },
        {
          "url": "https://www.npmjs.com/package/@modelcontextprotocol/sdk",
          "title": "npm @modelcontextprotocol/sdk",
          "description": "npm 官方依赖仓库中的 MCP 核心包，支持一键安装构建前端与服务端应用。",
          "category": "语言与运行时",
          "subCategory": "npm包",
          "tags": [
            "npm",
            "Node"
          ]
        },
        {
          "url": "https://crates.io/crates/mcp",
          "title": "crates.io mcp",
          "description": "Rust 生态官方 crate 仓库中的 MCP 相关开源实现与协议类型定义。",
          "category": "语言与运行时",
          "subCategory": "Rust Crates",
          "tags": [
            "crates.io",
            "Rust"
          ]
        },
        {
          "url": "https://nats.io/",
          "title": "NATS",
          "description": "云原生时代的超快、超轻量连接技术，支持事件发布订阅与请求应答微服务。",
          "category": "消息与流处理",
          "subCategory": "轻量消息",
          "tags": [
            "NATS",
            "发布订阅"
          ]
        },
        {
          "url": "https://kafka.apache.org/",
          "title": "Apache Kafka",
          "description": "分布式事件流平台，用于高性能数据管道、流式分析与长程任务事件日志。",
          "category": "消息与流处理",
          "subCategory": "事件流",
          "tags": [
            "Kafka",
            "大数据"
          ]
        },
        {
          "url": "https://www.rabbitmq.com/",
          "title": "RabbitMQ",
          "description": "部署极其广泛的可靠开源消息代理，支持复杂路由与多协议互通。",
          "category": "消息与流处理",
          "subCategory": "消息中间件",
          "tags": [
            "RabbitMQ",
            "队列"
          ]
        },
        {
          "url": "https://temporal.io/",
          "title": "Temporal",
          "description": "耐用执行与长程任务工作流平台，保证智能体即使系统崩溃也能继续无误执行。",
          "category": "消息与流处理",
          "subCategory": "工作流持久化",
          "tags": [
            "Temporal",
            "分布式状态"
          ]
        },
        {
          "url": "https://inngest.com/",
          "title": "Inngest",
          "description": "面向现代开发者的基于事件的后台任务与智能体工作流执行调度系统。",
          "category": "消息与流处理",
          "subCategory": "事件驱动",
          "tags": [
            "Inngest",
            "后台作业"
          ]
        },
        {
          "url": "https://trigger.dev/",
          "title": "Trigger.dev",
          "description": "为 TypeScript 开发者打造的全功能无超时限制后台任务与 AI 流水线框架。",
          "category": "消息与流处理",
          "subCategory": "开源作业",
          "tags": [
            "Trigger.dev",
            "后台运行"
          ]
        },
        {
          "url": "https://upstash.com/docs/qstash/overall/overview",
          "title": "Upstash QStash",
          "description": "无服务器的消息队列与定时任务分发服务，支持一键向 MCP 端点派发任务。",
          "category": "消息与流处理",
          "subCategory": "Serverless队列",
          "tags": [
            "QStash",
            "定时队列"
          ]
        },
        {
          "url": "https://pusher.com/",
          "title": "Pusher",
          "description": "实时双向数据通信与通道服务，轻松为多端提供低延迟 SSE 与 WebSocket 推送。",
          "category": "消息与流处理",
          "subCategory": "实时推送",
          "tags": [
            "Pusher",
            "实时WebSocket"
          ]
        },
        {
          "url": "https://ably.com/",
          "title": "Ably",
          "description": "提供毫秒级确定性传递与状态同步的全球分布式实时边缘消息基础设施。",
          "category": "消息与流处理",
          "subCategory": "全球网络",
          "tags": [
            "Ably",
            "低延迟"
          ]
        },
        {
          "url": "https://github.com/redpanda-data/redpanda",
          "title": "Redpanda",
          "description": "兼容 Kafka 协议且采用 C++ 编写的无 JVM 开源极速流式数据引擎。",
          "category": "消息与流处理",
          "subCategory": "极速流处理",
          "tags": [
            "Redpanda",
            "Kafka替代"
          ]
        },
        {
          "url": "https://developers.cloudflare.com/workers/",
          "title": "Cloudflare Workers",
          "description": "毫秒冷启动的全球边缘无服务器执行平台，现已全面支持挂载 SSE 协议 MCP。",
          "category": "无服务器与事件",
          "subCategory": "边缘计算",
          "tags": [
            "Cloudflare",
            "Workers"
          ]
        },
        {
          "url": "https://vercel.com/docs/functions",
          "title": "Vercel Functions",
          "description": "与 Next.js 紧密结合的无服务器计算服务，支持流式响应与长效任务。",
          "category": "无服务器与事件",
          "subCategory": "全栈函数",
          "tags": [
            "Vercel",
            "函数计算"
          ]
        },
        {
          "url": "https://aws.amazon.com/lambda/",
          "title": "AWS Lambda",
          "description": "全球采用最广泛的按需计费事件驱动云端无服务器计算服务。",
          "category": "无服务器与事件",
          "subCategory": "云函数",
          "tags": [
            "AWS",
            "Lambda"
          ]
        },
        {
          "url": "https://deno.com/deploy",
          "title": "Deno Deploy",
          "description": "分布式边缘无服务器平台，零配置从 GitHub 仓库自动部署 TS MCP Server。",
          "category": "无服务器与事件",
          "subCategory": "边缘部署",
          "tags": [
            "Deno Deploy",
            "零配置"
          ]
        },
        {
          "url": "https://fly.io/",
          "title": "Fly.io",
          "description": "将 Docker 容器靠近全球用户物理部署的现代化全球边缘应用托管基础设施。",
          "category": "无服务器与事件",
          "subCategory": "近场计算",
          "tags": [
            "Fly.io",
            "容器托管"
          ]
        },
        {
          "url": "https://railway.app/",
          "title": "Railway",
          "description": "体验极简、从代码仓库秒级部署 MCP Server 并附带独立 Postgres 的平台。",
          "category": "无服务器与事件",
          "subCategory": "极速部署",
          "tags": [
            "Railway",
            "PaaS"
          ]
        },
        {
          "url": "https://render.com/",
          "title": "Render",
          "description": "现代云托管平台，提供开箱即用的自动化部署、托管数据库与后台工作节点。",
          "category": "无服务器与事件",
          "subCategory": "云托管",
          "tags": [
            "Render",
            "云服务"
          ]
        },
        {
          "url": "https://modal.com/",
          "title": "Modal",
          "description": "专为 AI 与大规模数据计算打造的极速云函数平台，秒级冷启动冷态 GPU。",
          "category": "无服务器与事件",
          "subCategory": "AI云函数",
          "tags": [
            "Modal",
            "GPU计算"
          ]
        },
        {
          "url": "https://runpod.io/",
          "title": "RunPod Serverless",
          "description": "低成本 GPU 无服务器端点，用于运行需要本地重型计算的专用 MCP Server。",
          "category": "无服务器与事件",
          "subCategory": "算力端点",
          "tags": [
            "RunPod",
            "低成本GPU"
          ]
        },
        {
          "url": "https://replicate.com/",
          "title": "Replicate",
          "description": "一行代码通过 API 运行开源多模态 AI 模型，并具备标准 HTTP/SSE 接口。",
          "category": "无服务器与事件",
          "subCategory": "模型托管",
          "tags": [
            "Replicate",
            "模型接口"
          ]
        },
        {
          "url": "https://www.docker.com/",
          "title": "Docker 官方门户",
          "description": "全球领先的容器化应用构建、分发与本地隔离执行标准环境。",
          "category": "容器与编排",
          "subCategory": "容器标准",
          "tags": [
            "Docker",
            "容器化"
          ]
        },
        {
          "url": "https://podman.io/",
          "title": "Podman",
          "description": "免守护进程、无 root 权限且安全度极高的开源 Docker 无缝替代方案。",
          "category": "容器与编排",
          "subCategory": "无根容器",
          "tags": [
            "Podman",
            "安全容器"
          ]
        },
        {
          "url": "https://k3s.io/",
          "title": "K3s",
          "description": "Rancher 推出的极轻量级 Kubernetes 发行版，专为边缘设备与本地环境打造。",
          "category": "容器与编排",
          "subCategory": "轻量K8s",
          "tags": [
            "K3s",
            "边缘编排"
          ]
        },
        {
          "url": "https://minikube.sigs.k8s.io/",
          "title": "minikube",
          "description": "Kubernetes 官方单节点本地调试工具，快速在本地测试 MCP 集群编排。",
          "category": "容器与编排",
          "subCategory": "本地集群",
          "tags": [
            "minikube",
            "本地测试"
          ]
        },
        {
          "url": "https://helm.sh/",
          "title": "Helm",
          "description": "Kubernetes 专用的包管理工具，用模板定义与自动化部署复杂微服务架构。",
          "category": "容器与编排",
          "subCategory": "K8s包管理",
          "tags": [
            "Helm",
            "应用包"
          ]
        },
        {
          "url": "https://www.portainer.io/",
          "title": "Portainer",
          "description": "为 Docker 与 Kubernetes 打造的直观易用可视化容器管理与状态查看面板。",
          "category": "容器与编排",
          "subCategory": "可视化面板",
          "tags": [
            "Portainer",
            "容器管理"
          ]
        },
        {
          "url": "https://dive.tool/",
          "title": "Dive",
          "description": "深入剖析 Docker 镜像各层内容并探索体积优化空间的命令行实用神器。",
          "category": "容器与编排",
          "subCategory": "镜像分析",
          "tags": [
            "Dive",
            "体积优化"
          ]
        },
        {
          "url": "https://containerd.io/",
          "title": "containerd",
          "description": "CNCF 毕业的工业级容器运行时标准，提供极高稳定性与底层控制。",
          "category": "容器与编排",
          "subCategory": "底层运行时",
          "tags": [
            "containerd",
            "CNCF"
          ]
        },
        {
          "url": "https://kind.sigs.k8s.io/",
          "title": "kind (Kubernetes in Docker)",
          "description": "使用 Docker 容器节点直接运行本地 Kubernetes 集群的轻量测试工具。",
          "category": "容器与编排",
          "subCategory": "测试集群",
          "tags": [
            "kind",
            "DockerK8s"
          ]
        },
        {
          "url": "https://github.com/wagoodman/dive",
          "title": "Dive 开源仓库",
          "description": "在终端中实时查看镜像文件树变动并发现未删除垃圾的调试工具。",
          "category": "容器与编排",
          "subCategory": "开源工具",
          "tags": [
            "Dive",
            "终端工具"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/inspector",
          "title": "MCP Inspector",
          "description": "Anthropic 官方开源的交互式 MCP 调试与检查器，支持即时测试工具响应。",
          "category": "可观测与监控",
          "subCategory": "官方调试",
          "tags": [
            "MCP Inspector",
            "调试工具"
          ]
        },
        {
          "url": "https://www.langfuse.com/",
          "title": "Langfuse",
          "description": "开源的 LLM 应用与智能体可观测性平台，精细追踪每次工具调用与 Token 成本。",
          "category": "可观测与监控",
          "subCategory": "Agent追踪",
          "tags": [
            "Langfuse",
            "成本监控"
          ]
        },
        {
          "url": "https://smith.langchain.com/",
          "title": "LangSmith",
          "description": "LangChain 官方全生命周期智能体生产调试、单元测试评估与链路追踪台。",
          "category": "可观测与监控",
          "subCategory": "企业大盘",
          "tags": [
            "LangSmith",
            "链路分析"
          ]
        },
        {
          "url": "https://www.arize.com/phoenix/",
          "title": "Arize Phoenix",
          "description": "开源 AI 观测性与评估工作台，深度追踪 RAG 检索质量与工具执行错误。",
          "category": "可观测与监控",
          "subCategory": "开源评测",
          "tags": [
            "Phoenix",
            "RAG监控"
          ]
        },
        {
          "url": "https://helst.app/",
          "title": "Helicone",
          "description": "轻量极速的 LLM 可观测代理，一行代码接入并实时监控工具调用延迟与缓存。",
          "category": "可观测与监控",
          "subCategory": "网关监控",
          "tags": [
            "Helicone",
            "缓存分析"
          ]
        },
        {
          "url": "https://opentelemetry.io/docs/concepts/signals/traces/",
          "title": "OpenTelemetry Traces",
          "description": "标准分布式链路追踪规范，为微服务与智能体工具链提供全链路跟踪。",
          "category": "可观测与监控",
          "subCategory": "标准链路",
          "tags": [
            "OTel",
            "Traces"
          ]
        },
        {
          "url": "https://www.loki.grafana.com/",
          "title": "Grafana Loki",
          "description": "像 Prometheus 一样只索引元数据的水平可扩展、高可用日志聚合系统。",
          "category": "可观测与监控",
          "subCategory": "日志系统",
          "tags": [
            "Loki",
            "日志聚合"
          ]
        },
        {
          "url": "https://pyroscope.io/",
          "title": "Grafana Pyroscope",
          "description": "开源持续性能剖析工具，实时定位 MCP Server 执行过程中的 CPU 与内存热点。",
          "category": "可观测与监控",
          "subCategory": "性能剖析",
          "tags": [
            "Pyroscope",
            "火焰图"
          ]
        },
        {
          "url": "https://signoz.io/",
          "title": "SigNoz",
          "description": "基于 OpenTelemetry 构建的开源全栈可观测性平台，Datadog 的原生开源替代方案。",
          "category": "可观测与监控",
          "subCategory": "开源APM",
          "tags": [
            "SigNoz",
            "全栈APM"
          ]
        },
        {
          "url": "https://hyperdx.io/",
          "title": "HyperDX",
          "description": "将日志、指标与端到端链路追踪无缝融合的开源开发者友好诊断平台。",
          "category": "可观测与监控",
          "subCategory": "开发者诊断",
          "tags": [
            "HyperDX",
            "开源诊断"
          ]
        },
        {
          "url": "https://github.com/cloudflare/mcp-server-cloudflare",
          "title": "Cloudflare MCP Server",
          "description": "官方 Cloudflare 资源管理服务，操控 DNS 解析、安全规则与边缘 Worker。",
          "category": "网关与流量",
          "subCategory": "边缘网关",
          "tags": [
            "Cloudflare",
            "DNS管理"
          ]
        },
        {
          "url": "https://traefik.io/traefik/",
          "title": "Traefik",
          "description": "现代云原生边缘反向代理与自动路由负载均衡器，原生集成 Docker 与 K8s。",
          "category": "网关与流量",
          "subCategory": "反向代理",
          "tags": [
            "Traefik",
            "自动路由"
          ]
        },
        {
          "url": "https://caddyserver.com/",
          "title": "Caddy",
          "description": "企业级、开源且默认自带全自动 HTTPS 证书颁发与更新的高性能 Web 服务器。",
          "category": "网关与流量",
          "subCategory": "自动化HTTPS",
          "tags": [
            "Caddy",
            "自动证书"
          ]
        },
        {
          "url": "https://ngrok.com/",
          "title": "ngrok",
          "description": "全球知名的本地网络内网穿透利器，几秒内为本地 MCP Server 赋予公网安全 URL。",
          "category": "网关与流量",
          "subCategory": "内网穿透",
          "tags": [
            "ngrok",
            "安全穿透"
          ]
        },
        {
          "url": "https://tailscale.com/",
          "title": "Tailscale",
          "description": "基于 WireGuard 协议的零配置安全网状虚拟局域网，轻松打通多节点服务。",
          "category": "网关与流量",
          "subCategory": "私有网络",
          "tags": [
            "Tailscale",
            "MeshVPN"
          ]
        },
        {
          "url": "https://cloudflare.com/products/tunnel/",
          "title": "Cloudflare Tunnel",
          "description": "无需公网 IP 和开放端口即可安全将本地私有 MCP 暴露给云端 AI 宿主。",
          "category": "网关与流量",
          "subCategory": "零信任穿透",
          "tags": [
            "CFTunnel",
            "零信任"
          ]
        },
        {
          "url": "https://www.envoyproxy.io/",
          "title": "Envoy Proxy",
          "description": "CNCF 旗舰级开源边缘与服务间代理，为复杂微服务提供极高吞吐网络通信。",
          "category": "网关与流量",
          "subCategory": "服务网格",
          "tags": [
            "Envoy",
            "高性能代理"
          ]
        },
        {
          "url": "https://konghq.com/products/kong-gateway",
          "title": "Kong Gateway",
          "description": "业内广泛采纳的云原生 API 网关，提供强大的流量限制、鉴权与插件架构。",
          "category": "网关与流量",
          "subCategory": "API网关",
          "tags": [
            "Kong",
            "网关治理"
          ]
        },
        {
          "url": "https://nginx.org/",
          "title": "NGINX 官方门户",
          "description": "全球极负盛名的高性能 HTTP 服务器、反向代理与四层/七层负载均衡器。",
          "category": "网关与流量",
          "subCategory": "基础代理",
          "tags": [
            "NGINX",
            "负载均衡"
          ]
        },
        {
          "url": "https://localtunnel.github.io/www/",
          "title": "localtunnel",
          "description": "开源免费的快速内网穿透工具，无需复杂配置即可对外临时展示本地接口。",
          "category": "网关与流量",
          "subCategory": "临时穿透",
          "tags": [
            "localtunnel",
            "开源测试"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
          "title": "GitHub MCP Server",
          "description": "Anthropic 官方参考实现的 GitHub 仓库、Issue 与 Pull Request 授权集成。",
          "category": "应用与密钥安全",
          "subCategory": "官方授权",
          "tags": [
            "GitHub MCP",
            "安全授权"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
          "title": "Brave Search MCP Server",
          "description": "官方提供的 Brave 网页与本地搜索工具，具备清晰的 API 密钥隔离机制。",
          "category": "应用与密钥安全",
          "subCategory": "搜索授权",
          "tags": [
            "Brave",
            "API安全"
          ]
        },
        {
          "url": "https://clerk.com/",
          "title": "Clerk 身份认证",
          "description": "为现代 Web 应用与智能体 API 打造的一站式开箱即用用户身份验证服务。",
          "category": "应用与密钥安全",
          "subCategory": "认证中心",
          "tags": [
            "Clerk",
            "身份安全"
          ]
        },
        {
          "url": "https://auth0.com/",
          "title": "Auth0",
          "description": "企业级身份管理平台，支持 OAuth 2.0、SAML 单点登录与 API 访问令牌校验。",
          "category": "应用与密钥安全",
          "subCategory": "企业SSO",
          "tags": [
            "Auth0",
            "OAuth2"
          ]
        },
        {
          "url": "https://goteleport.com/",
          "title": "Teleport",
          "description": "保护服务器、Kubernetes 集群与数据库免受未授权访问的零信任特权接入平台。",
          "category": "应用与密钥安全",
          "subCategory": "零信任接入",
          "tags": [
            "Teleport",
            "安全访问"
          ]
        },
        {
          "url": "https://tailscale.com/kb/1018/acls",
          "title": "Tailscale ACLs",
          "description": "基于标签与用户身份精细控制私有网络中哪些设备可以访问 MCP 端口。",
          "category": "应用与密钥安全",
          "subCategory": "网络ACL",
          "tags": [
            "ACL",
            "访问控制"
          ]
        },
        {
          "url": "https://github.com/aquasecurity/trivy",
          "title": "Trivy 容器安全扫描",
          "description": "在打包 MCP Server 镜像时自动检测已知 CVE 漏洞与配置缺陷的开源利器。",
          "category": "应用与密钥安全",
          "subCategory": "漏洞检测",
          "tags": [
            "Trivy",
            "安全扫描"
          ]
        },
        {
          "url": "https://github.com/returntocorp/semgrep",
          "title": "Semgrep 安全静态分析",
          "description": "编写安全规则，在代码库提交前自动拦截硬编码密钥与不安全进程调用。",
          "category": "应用与密钥安全",
          "subCategory": "规则检查",
          "tags": [
            "Semgrep",
            "安全合规"
          ]
        },
        {
          "url": "https://snyk.io/product/developer-security-platform/",
          "title": "Snyk 开发者安全中枢",
          "description": "持续监测智能体所使用的各种开源第三方依赖库中的供应链高危风险。",
          "category": "应用与密钥安全",
          "subCategory": "供应链防护",
          "tags": [
            "Snyk",
            "第三方依赖"
          ]
        },
        {
          "url": "https://stepsecurity.io/",
          "title": "StepSecurity",
          "description": "加固 CI/CD 流水线，防止流水线凭证外泄与不可信第三方 Action 注入。",
          "category": "应用与密钥安全",
          "subCategory": "流水线加固",
          "tags": [
            "StepSecurity",
            "CI安全"
          ]
        },
        {
          "url": "https://modelcontextprotocol.io/introduction",
          "title": "MCP 架构与概念文档",
          "description": "官方详述 Server、Client、Host 三大角色协同关系与核心设计思想。",
          "category": "官方文档",
          "subCategory": "官方手册",
          "tags": [
            "MCP概念",
            "架构指南"
          ]
        },
        {
          "url": "https://modelcontextprotocol.io/quickstart/server",
          "title": "编写第一个 MCP Server",
          "description": "官方提供的从零手把手编写第一个 Stdio 与 SSE 模式 MCP 服务的教程。",
          "category": "官方文档",
          "subCategory": "上手教程",
          "tags": [
            "开发入门",
            "教程"
          ]
        },
        {
          "url": "https://modelcontextprotocol.io/quickstart/client",
          "title": "构建 MCP 客户端教程",
          "description": "指导如何在自己的应用中实现 MCP Client 以连接和调用现有服务。",
          "category": "官方文档",
          "subCategory": "客户端开发",
          "tags": [
            "Client入门",
            "客户端"
          ]
        },
        {
          "url": "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
          "title": "Anthropic Claude 工具调用指南",
          "description": "深入探讨 Claude 模型的 Tool Use 能力、最佳 Prompt 实践与参数约束。",
          "category": "官方文档",
          "subCategory": "模型规范",
          "tags": [
            "Claude",
            "ToolUse"
          ]
        },
        {
          "url": "https://platform.openai.com/docs/guides/function-calling",
          "title": "OpenAI 函数调用官方文档",
          "description": "OpenAI 官方关于 Function Calling、严格模式（Structured Outputs）的规范。",
          "category": "官方文档",
          "subCategory": "行业规范",
          "tags": [
            "OpenAI",
            "FunctionCalling"
          ]
        },
        {
          "url": "https://ai.google.dev/gemini-api/docs/function-calling",
          "title": "Google Gemini 函数调用指南",
          "description": "谷歌 Gemini API 的工具调用、多轮确认与外部执行完整技术文档。",
          "category": "官方文档",
          "subCategory": "主流模型",
          "tags": [
            "Gemini",
            "函数调用"
          ]
        },
        {
          "url": "https://microsoft.github.io/autogen/docs/tutorial/introduction",
          "title": "AutoGen 官方教程",
          "description": "微软多智能体框架的核心概念、执行机制与会话状态管理官方教程。",
          "category": "官方文档",
          "subCategory": "框架手册",
          "tags": [
            "AutoGen",
            "微软框架"
          ]
        },
        {
          "url": "https://docs.crewai.com/",
          "title": "CrewAI 官方文档",
          "description": "详细阐述 Agents、Tasks 与 Crew 编排生命周期的权威官方技术指南。",
          "category": "官方文档",
          "subCategory": "框架手册",
          "tags": [
            "CrewAI",
            "角色分配"
          ]
        },
        {
          "url": "https://js.langchain.com/docs/introduction/",
          "title": "LangChain.js 官方文档",
          "description": "JavaScript / TypeScript 开发者构建 LLM 链、Agent 与接入工具的手册。",
          "category": "官方文档",
          "subCategory": "语言手册",
          "tags": [
            "LangChain",
            "JS文档"
          ]
        },
        {
          "url": "https://python.langchain.com/docs/introduction/",
          "title": "LangChain Python 官方文档",
          "description": "最全面的 Python 语言 AI 智能体开发参考手册与 API 查阅库。",
          "category": "官方文档",
          "subCategory": "语言手册",
          "tags": [
            "LangChain",
            "Python文档"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/create-typescript-server",
          "title": "create-typescript-server",
          "description": "Anthropic 官方推出的脚手架工具，一键生成结构规整的 MCP Server 模板工程。",
          "category": "接口调试",
          "subCategory": "官方脚手架",
          "tags": [
            "脚手架",
            "代码模板"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/create-python-server",
          "title": "create-python-server",
          "description": "官方 Python 版 MCP 服务端快速初始化模板生成工具。",
          "category": "接口调试",
          "subCategory": "官方脚手架",
          "tags": [
            "Python模板",
            "脚手架"
          ]
        },
        {
          "url": "https://insomnia.rest/download",
          "title": "Insomnia 客户端",
          "description": "优秀的跨平台 API 调试套件，支持向支持 SSE 的 MCP 端点发起流式请求。",
          "category": "接口调试",
          "subCategory": "通用调试",
          "tags": [
            "Insomnia",
            "SSE调试"
          ]
        },
        {
          "url": "https://www.postman.com/downloads/",
          "title": "Postman 桌面应用",
          "description": "全功能网络测试工具，可用来模拟向 MCP HTTP 服务端发送 JSON-RPC 消息。",
          "category": "接口调试",
          "subCategory": "协议测试",
          "tags": [
            "Postman",
            "JSON-RPC"
          ]
        },
        {
          "url": "https://httpie.io/cli",
          "title": "HTTPie 终端命令行",
          "description": "易读易写的命令行 HTTP 客户端，几秒内通过终端调试任何 SSE MCP 接口。",
          "category": "接口调试",
          "subCategory": "终端命令行",
          "tags": [
            "HTTPie",
            "快速验证"
          ]
        },
        {
          "url": "https://curl.se/",
          "title": "curl 官方门户",
          "description": "支撑整个互联网网络交互的经典万能传输工具，调试基础接口响应的基准。",
          "category": "接口调试",
          "subCategory": "网络基准",
          "tags": [
            "curl",
            "基础工具"
          ]
        },
        {
          "url": "https://www.jsonrpc.org/specification",
          "title": "JSON-RPC 2.0 规范说明",
          "description": "MCP 底层消息交换所依赖的 JSON-RPC 协议标准语法与错误码定义参考。",
          "category": "接口调试",
          "subCategory": "底层规范",
          "tags": [
            "JSON-RPC",
            "协议标准"
          ]
        },
        {
          "url": "https://github.com/stedolan/jq",
          "title": "jq 命令行 JSON 处理器",
          "description": "终端中解析、过滤与格式化 MCP Stdio 输出的强大流式 JSON 处理器。",
          "category": "接口调试",
          "subCategory": "JSON解析",
          "tags": [
            "jq",
            "命令行过滤"
          ]
        },
        {
          "url": "https://jqlang.github.io/jq/",
          "title": "jq 官方手册",
          "description": "深入查阅 jq 高阶模式匹配、字段提取与数组变换语法的官方手册。",
          "category": "接口调试",
          "subCategory": "语法手册",
          "tags": [
            "jq手册",
            "流式处理"
          ]
        },
        {
          "url": "https://hoppscotch.com/",
          "title": "Hoppscotch Web",
          "description": "免安装的纯网页端 API 调试台，随时随地接入测试公网部署的 MCP 节点。",
          "category": "接口调试",
          "subCategory": "免安装测试",
          "tags": [
            "Hoppscotch",
            "云端测试"
          ]
        },
        {
          "url": "https://github.com/wong2/mcp-cli",
          "title": "mcp-cli",
          "description": "社区打造的命令行客户端，用于在终端里直接交互、列出和调用任意 MCP Server。",
          "category": "命令行速查",
          "subCategory": "MCP专有CLI",
          "tags": [
            "mcp-cli",
            "终端交互"
          ]
        },
        {
          "url": "https://npx.sh/",
          "title": "npx 命令速查",
          "description": "零安装直接运行 npm 上发布的各种开源 MCP Server 的现代运行机制。",
          "category": "命令行速查",
          "subCategory": "包执行",
          "tags": [
            "npx",
            "免安装运行"
          ]
        },
        {
          "url": "https://docs.astral.sh/uv/guides/tools/",
          "title": "uvx 工具执行器",
          "description": "使用极速 Python 工具 uvx 秒级无污染执行任意发布在 PyPI 上的 Python MCP。",
          "category": "命令行速查",
          "subCategory": "Python执行",
          "tags": [
            "uvx",
            "极速执行"
          ]
        },
        {
          "url": "https://github.com/charmbracelet/vhs",
          "title": "VHS 终端录像机",
          "description": "代码化录制终端操作生成精美 GIF 动画，极速展示 MCP 运行效果的利器。",
          "category": "命令行速查",
          "subCategory": "终端录制",
          "tags": [
            "VHS",
            "演示效果"
          ]
        },
        {
          "url": "https://github.com/charmbracelet/gum",
          "title": "Gum 终端交互组件",
          "description": "通过 Shell 脚本轻松构建出令人惊叹的交互式终端选择与确认表单界面。",
          "category": "命令行速查",
          "subCategory": "终端UI",
          "tags": [
            "Gum",
            "终端组件"
          ]
        },
        {
          "url": "https://github.com/charmbracelet/glow",
          "title": "Glow 终端 Markdown 渲染器",
          "description": "在命令行中用极高颜值阅读 MCP 返回的丰富 Markdown 格式内容与文档。",
          "category": "命令行速查",
          "subCategory": "Markdown阅读",
          "tags": [
            "Glow",
            "终端渲染"
          ]
        },
        {
          "url": "https://github.com/jesseduffield/lazygit",
          "title": "lazygit",
          "description": "广受开发者喜爱的纯终端 Git 极简快捷键操作看板，极速管理代码版本变更。",
          "category": "命令行速查",
          "subCategory": "Git看板",
          "tags": [
            "lazygit",
            "终端工具"
          ]
        },
        {
          "url": "https://github.com/jesseduffield/lazydocker",
          "title": "lazydocker",
          "description": "纯终端 Docker 容器与镜像实时监控看板，即时重启与查看 MCP 容器日志。",
          "category": "命令行速查",
          "subCategory": "Docker看板",
          "tags": [
            "lazydocker",
            "容器监控"
          ]
        },
        {
          "url": "https://github.com/dandavison/delta",
          "title": "git-delta",
          "description": "为终端带来带语法高亮与行号对齐的绝美 Git Diff 差异阅读器。",
          "category": "命令行速查",
          "subCategory": "Diff增强",
          "tags": [
            "delta",
            "差异比对"
          ]
        },
        {
          "url": "https://github.com/junegunn/fzf",
          "title": "fzf 命令行模糊搜索",
          "description": "极其通用、快如闪电的交互式终端命令行模糊筛选器。",
          "category": "命令行速查",
          "subCategory": "模糊筛选",
          "tags": [
            "fzf",
            "高效检索"
          ]
        },
        {
          "url": "https://github.com/topics/model-context-protocol",
          "title": "GitHub #model-context-protocol 专题",
          "description": "GitHub 上标注 MCP 协议相关的数千个全球活跃开源项目与实现展示区。",
          "category": "代码托管",
          "subCategory": "GitHub专题",
          "tags": [
            "MCP主题",
            "项目索引"
          ]
        },
        {
          "url": "https://github.com/topics/mcp-server",
          "title": "GitHub #mcp-server 专题",
          "description": "专门聚合各类开发者开源提交的自定义 MCP 服务端工具的标签主页。",
          "category": "代码托管",
          "subCategory": "GitHub专题",
          "tags": [
            "mcp-server",
            "服务端"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol",
          "title": "Model Context Protocol 官方组织",
          "description": "Anthropic 官方在 GitHub 上设立的协议标准与多语言核心实现开源组织。",
          "category": "代码托管",
          "subCategory": "官方主页",
          "tags": [
            "官方组织",
            "核心维护"
          ]
        },
        {
          "url": "https://gitlab.com/explore/projects",
          "title": "GitLab 探索开源项目",
          "description": "GitLab 平台上的开源项目发现与安全 DevOps 流水线展示中心。",
          "category": "代码托管",
          "subCategory": "GitLab",
          "tags": [
            "GitLab",
            "开源协作"
          ]
        },
        {
          "url": "https://gitee.com/explore",
          "title": "Gitee 开源项目精选",
          "description": "国内主流开源平台精选技术项目目录，提供快速本地镜像加速访问。",
          "category": "代码托管",
          "subCategory": "国内镜像",
          "tags": [
            "Gitee",
            "国内开源"
          ]
        },
        {
          "url": "https://codeberg.org/explore/repos",
          "title": "Codeberg 自由项目探索",
          "description": "非营利组织运营的纯净自由开源代码托管平台上的公共项目库。",
          "category": "代码托管",
          "subCategory": "自由软件",
          "tags": [
            "Codeberg",
            "开源"
          ]
        },
        {
          "url": "https://sourcegraph.com/search",
          "title": "Sourcegraph 全球代码搜索",
          "description": "在数十亿行公开开源代码中精确语义检索任何 MCP 函数用法与实现范例。",
          "category": "代码托管",
          "subCategory": "代码搜索",
          "tags": [
            "Sourcegraph",
            "代码语义"
          ]
        },
        {
          "url": "https://grep.app/",
          "title": "grep.app 代码正则检索",
          "description": "在海量 GitHub 开源仓库中秒级用正则表达式搜索特定方法调用和配置名。",
          "category": "代码托管",
          "subCategory": "正则搜索",
          "tags": [
            "grep.app",
            "秒级代码检索"
          ]
        },
        {
          "url": "https://github.com/trending",
          "title": "GitHub Trending 今日热门",
          "description": "实时捕捉全球开发者最新关注与星标暴涨的前沿开源软件风向标。",
          "category": "代码托管",
          "subCategory": "热门榜单",
          "tags": [
            "Trending",
            "前沿趋势"
          ]
        },
        {
          "url": "https://open-source-guide.github.com/",
          "title": "开源指南 (Open Source Guides)",
          "description": "GitHub 官方编写的如何启动、维护和参与全球开源项目的完整指南。",
          "category": "代码托管",
          "subCategory": "开源指导",
          "tags": [
            "开源指南",
            "最佳实践"
          ]
        },
        {
          "url": "https://github.com/marketplace/actions/publish-docker",
          "title": "Docker Publish Action",
          "description": "在 GitHub Actions 中自动构建多架构 Docker 镜像并推送到仓库的标准工作流。",
          "category": "持续交付",
          "subCategory": "镜像发布",
          "tags": [
            "GitHub Actions",
            "Docker"
          ]
        },
        {
          "url": "https://github.com/marketplace/actions/npm-publish",
          "title": "npm Publish Action",
          "description": "当触发版本 Tag 时自动化运行测试、编译并在 npm 官方发布 SDK 的流水线。",
          "category": "持续交付",
          "subCategory": "包发布",
          "tags": [
            "npm发布",
            "自动化"
          ]
        },
        {
          "url": "https://github.com/marketplace/actions/pypi-publish",
          "title": "PyPI Publish Action",
          "description": "使用现代化信任凭据机制向 PyPI 安全发布 Python MCP 包的官方 Action。",
          "category": "持续交付",
          "subCategory": "包发布",
          "tags": [
            "PyPI发布",
            "安全发版"
          ]
        },
        {
          "url": "https://goreleaser.com/",
          "title": "GoReleaser",
          "description": "为 Go 编写的跨平台命令行工具极速自动化打包多架构二进制与 Release 的工具。",
          "category": "持续交付",
          "subCategory": "Go打包",
          "tags": [
            "GoReleaser",
            "跨平台发布"
          ]
        },
        {
          "url": "https://github.com/cargo-bins/cargo-binstall",
          "title": "cargo-binstall",
          "description": "让用户无需从头编译源码、直接从 GitHub Release 安装预编译二进制的利器。",
          "category": "持续交付",
          "subCategory": "Rust分发",
          "tags": [
            "binstall",
            "二进制分发"
          ]
        },
        {
          "url": "https://semantic-release.gitbook.io/",
          "title": "semantic-release",
          "description": "完全自动化的版本管理与软件包发布工具，严格遵循语义化版本规范规范发版。",
          "category": "持续交付",
          "subCategory": "语义发版",
          "tags": [
            "semantic-release",
            "自动发版"
          ]
        },
        {
          "url": "https://renovatebot.com/",
          "title": "Renovate Bot",
          "description": "多平台支持的依赖自动化扫描与自动提交依赖升级 PR 的高效机器人。",
          "category": "持续交付",
          "subCategory": "依赖升级",
          "tags": [
            "Renovate",
            "依赖自动升级"
          ]
        },
        {
          "url": "https://dependabot.com/",
          "title": "Dependabot",
          "description": "GitHub 原生内置的安全依赖监控与 CVE 漏洞自动修补 Pull Request 机器人。",
          "category": "持续交付",
          "subCategory": "安全PR",
          "tags": [
            "Dependabot",
            "依赖安全"
          ]
        },
        {
          "url": "https://cosign.sigstore.dev/docs/",
          "title": "Cosign 镜像签名规范",
          "description": "使用无密钥模式（Keyless）对发布的容器镜像与发布文件进行数字签名防篡改。",
          "category": "持续交付",
          "subCategory": "数字签名",
          "tags": [
            "Sigstore",
            "防伪溯源"
          ]
        },
        {
          "url": "https://slsa.dev/",
          "title": "SLSA 软件供应链规范",
          "description": "为开源软件供应链提供从源码到二进制全流程防篡改可信等级保障的行业标准。",
          "category": "持续交付",
          "subCategory": "供应链等级",
          "tags": [
            "SLSA",
            "供应链安全"
          ]
        }
      ]
    }
  }
};
