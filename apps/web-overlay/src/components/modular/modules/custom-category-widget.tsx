'use client'

import { useState } from 'react'
import { Folder, ExternalLink, Sparkles } from 'lucide-react'

interface CategoryPreset {
  id: string
  name: string
  icon: string
  sites: Array<{ title: string; href: string; desc: string; icon?: string }>
}

const PRESET_CATEGORIES: CategoryPreset[] = [
  {
    id: 'ai',
    name: '🤖 AI 与大模型',
    icon: 'Bot',
    sites: [
      { title: 'ChatGPT', href: 'https://chatgpt.com', desc: 'OpenAI 旗舰对话助手', icon: 'https://api.iconify.design/logos:openai-icon.svg' },
      { title: 'Claude', href: 'https://claude.ai', desc: 'Anthropic 强逻辑模型', icon: 'https://api.iconify.design/logos:claude-icon.svg' },
      { title: 'DeepSeek', href: 'https://chat.deepseek.com', desc: '开源深度推理大模型', icon: 'https://chat.deepseek.com/favicon.svg' },
      { title: 'Hugging Face', href: 'https://huggingface.co', desc: '全球开源 AI 模型社区', icon: 'https://huggingface.co/favicon.ico' },
    ],
  },
  {
    id: 'dev',
    name: '💻 前端与工程化',
    icon: 'Code',
    sites: [
      { title: 'React 19', href: 'https://react.dev', desc: '用户界面构建库', icon: 'https://react.dev/favicon.ico' },
      { title: 'Next.js 15', href: 'https://nextjs.org', desc: '全栈生产级 React 框架', icon: 'https://nextjs.org/favicon.ico' },
      { title: 'Tailwind CSS v4', href: 'https://tailwindcss.com', desc: '实用优先的 CSS 工具库', icon: 'https://tailwindcss.com/favicon.ico' },
      { title: 'TypeScript', href: 'https://www.typescriptlang.org', desc: '类型安全的 JavaScript', icon: 'https://www.typescriptlang.org/favicon.ico' },
    ],
  },
  {
    id: 'tools',
    name: '⚡ 效率与灵感',
    icon: 'Zap',
    sites: [
      { title: 'GitHub', href: 'https://github.com', desc: '全球代码托管协作平台', icon: 'https://github.com/favicon.ico' },
      { title: 'Penpot', href: 'https://penpot.app', desc: '开源矢量设计与原型工具', icon: 'https://penpot.app/favicon.ico' },
      { title: 'Coolify', href: 'https://coolify.io', desc: '自托管开源 PaaS', icon: 'https://coolify.io/favicon.ico' },
      { title: 'v0.dev', href: 'https://v0.dev', desc: '生成式 UI 代码生成器', icon: 'https://v0.dev/favicon.ico' },
    ],
  },
]

export function CustomCategoryWidget({ config }: { config?: Record<string, any> }) {
  // `categoryId` 只是本地演示页签的 id（ai/dev/tools），不是中枢类目 id/slug：
  // 这个组件的站点全是内置示例、直接外链，不会走 /api/sites，所以不随类目树升级改。
  const [selectedCatId, setSelectedCatId] = useState(() => config?.categoryId || 'ai')

  const currentCategory = PRESET_CATEGORIES.find((c) => c.id === selectedCatId) || PRESET_CATEGORIES[0]

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      {/* 顶部标题与分类选择切换 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium min-w-0">
          <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="truncate">精选分类导航</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {PRESET_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCatId(cat.id)}
              className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                selectedCatId === cat.id
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat.name.split(' ')[1] || cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* 站点卡片网格 */}
      <div className="flex-1 py-2 grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto min-h-0">
        {currentCategory.sites.map((site) => (
          <a
            key={site.href}
            href={site.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2.5 p-2 rounded-xl bg-muted/20 hover:bg-muted/50 border border-border/40 hover:border-primary/40 transition-all group"
          >
            <div className="w-7 h-7 rounded-lg bg-background border border-border/60 flex items-center justify-center p-1 shrink-0 group-hover:scale-105 transition-transform overflow-hidden">
              {site.icon ? (
                <img
                  src={site.icon}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <span className="text-xs font-bold text-muted-foreground">{site.title.slice(0, 1)}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate flex items-center gap-1">
                <span>{site.title}</span>
                <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {site.desc}
              </p>
            </div>
          </a>
        ))}
      </div>

      {/* 底部信息 */}
      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        收录 {currentCategory.sites.length} 个高频精选站点 · 点击直达
      </div>
    </div>
  )
}
