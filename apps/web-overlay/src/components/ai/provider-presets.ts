/**
 * 常见主流大模型厂商预设模版（管理端与个人用户设置中心共用）。
 * 用户或管理员选择预设后，可一键自动填充显示名称、Base URL、模型 ID 与策略。
 */

export interface ProviderPreset {
  id: string
  name: string
  label: string
  model: string
  baseUrl: string
  apiKeyPlaceholder: string
  description: string
  supportsThinking?: boolean
  jsonMode?: 'auto' | 'response_format' | 'prompt'
  allowPrivateNetwork?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'agnes-30-flash',
    name: 'Agnes 3.0 Flash',
    label: 'Agnes 3.0 Flash (系统推荐 / 深度思考)',
    model: 'agnes-3.0-flash',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    apiKeyPlaceholder: 'sk-***',
    description: '官方推荐旗舰模型，高性价比，极速响应，支持 native 原生深度思考',
    supportsThinking: true,
    jsonMode: 'auto',
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    label: 'DeepSeek (deepseek-chat / deepseek-reasoner)',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyPlaceholder: 'sk-***',
    description: '深度求索通用大模型，支持高并发与高性价比编程问答',
    supportsThinking: true,
    jsonMode: 'auto',
  },
  {
    id: 'openai-gpt4o-mini',
    name: 'OpenAI GPT-4o-mini',
    label: 'OpenAI (gpt-4o-mini / gpt-4o)',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyPlaceholder: 'sk-***',
    description: 'OpenAI 国际通用 API',
    supportsThinking: false,
    jsonMode: 'auto',
  },
  {
    id: 'qwen-plus',
    name: '通义千问 Qwen Plus',
    label: '通义千问 Qwen (qwen-plus / qwen-max)',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyPlaceholder: 'sk-***',
    description: '阿里云 DashScope 兼容接口',
    supportsThinking: false,
    jsonMode: 'auto',
  },
  {
    id: 'ollama-llama3',
    name: 'Ollama 本地模型',
    label: 'Ollama 本地私有化模型 (llama3 / qwen2.5)',
    model: 'llama3',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyPlaceholder: 'ollama (可留空或输入任意字符)',
    description: '本地运行开源模型，完全离线与私有化，需开启允许内网地址',
    supportsThinking: false,
    jsonMode: 'prompt',
    allowPrivateNetwork: true,
  },
  {
    id: 'custom',
    name: '自定义模型',
    label: '自定义兼容模型 (OpenAI API Compatible)',
    model: '',
    baseUrl: '',
    apiKeyPlaceholder: 'sk-***',
    description: '任意兼容 OpenAI /chat/completions 协议的私有或云端网关',
    supportsThinking: false,
    jsonMode: 'auto',
  },
]
