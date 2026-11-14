'use client'

import { useEffect, useState } from 'react'
import { safeWindowOpen } from '@/lib/safe-url'
import { Search, ArrowRight, Plus } from 'lucide-react'
import {
  BUILTIN_SEARCH_ENGINES,
  CUSTOM_ENGINE_ID,
  QUICK_SEARCH_CUSTOM_ENGINE_KEY,
  QUICK_SEARCH_ENGINE_KEY,
  buildCustomEngineUrl,
  isValidCustomEngineTemplate,
  parseCustomEngine,
  resolveSelectedEngineId,
  type CustomSearchEngine,
  type SearchEngine,
} from '@/lib/quick-search-engines'

export function QuickSearchWidget({ config }: { config?: Record<string, unknown> }) {
  const requested = typeof config?.defaultEngine === 'string' ? config.defaultEngine.trim() : ''
  // 只认自有属性：`constructor` 这类原型链上的键会被 Record 查到，得当成不存在的引擎
  const isKnown = Object.prototype.hasOwnProperty.call(BUILTIN_SEARCH_ENGINES, requested)
  const unknownEngine = requested !== '' && !isKnown
  // 只认注册过的引擎：配置里写了不存在的键时高亮会落空（没有一个页签选中），
  // 而回车又静默走 Google，用户以为默认引擎生效了。
  const defaultEngineKey = isKnown ? requested : 'google'
  const [selectedEngine, setSelectedEngine] = useState<string>(defaultEngineKey)
  const [query, setQuery] = useState('')
  // 自定义引擎与“上次选了哪个引擎”只存本机（localStorage），不进账号、不上云：
  // 挂载后才读，首屏渲染仍用配置默认值，避免服务端与客户端渲染不一致。
  const [custom, setCustom] = useState<CustomSearchEngine | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorName, setEditorName] = useState('')
  const [editorTemplate, setEditorTemplate] = useState('')
  const [editorError, setEditorError] = useState('')

  useEffect(() => {
    const storedCustom = parseCustomEngine(
      window.localStorage.getItem(QUICK_SEARCH_CUSTOM_ENGINE_KEY),
    )
    setCustom(storedCustom)
    setSelectedEngine((prev) =>
      resolveSelectedEngineId({
        stored: window.localStorage.getItem(QUICK_SEARCH_ENGINE_KEY),
        configured: prev,
        hasCustom: storedCustom !== null,
      }),
    )
    // 只在挂载时读一次本机选择；之后的选择由点页签/保存自定义时写回
  }, [])

  const engines: SearchEngine[] = [
    ...Object.values(BUILTIN_SEARCH_ENGINES),
    ...(custom
      ? [
          {
            id: CUSTOM_ENGINE_ID,
            name: custom.name,
            icon: '🔗',
            buildUrl: (q: string) => buildCustomEngineUrl(custom.template, q),
          } satisfies SearchEngine,
        ]
      : []),
  ]

  const selectEngine = (id: string) => {
    setSelectedEngine(id)
    window.localStorage.setItem(QUICK_SEARCH_ENGINE_KEY, id)
  }

  const openEditor = () => {
    setEditorName(custom?.name ?? '')
    setEditorTemplate(custom?.template ?? '')
    setEditorError('')
    setEditorOpen(true)
  }

  const saveCustom = () => {
    const name = editorName.trim()
    if (!name || name.length > 12) {
      setEditorError('请给自定义引擎起个名字（1–12 字）。')
      return
    }
    if (!isValidCustomEngineTemplate(editorTemplate)) {
      setEditorError(
        '模板须以 https:// 开头，并含一个 %s（代表搜索词），如 https://example.com/search?q=%s。',
      )
      return
    }
    const next = { name, template: editorTemplate.trim() }
    window.localStorage.setItem(QUICK_SEARCH_CUSTOM_ENGINE_KEY, JSON.stringify(next))
    setCustom(next)
    selectEngine(CUSTOM_ENGINE_ID)
    setEditorOpen(false)
  }

  const deleteCustom = () => {
    window.localStorage.removeItem(QUICK_SEARCH_CUSTOM_ENGINE_KEY)
    setCustom(null)
    if (selectedEngine === CUSTOM_ENGINE_ID) selectEngine(defaultEngineKey)
    setEditorOpen(false)
  }

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    const engine =
      engines.find((item) => item.id === selectedEngine) ?? BUILTIN_SEARCH_ENGINES.google
    safeWindowOpen(engine!.buildUrl(trimmed))
  }

  const selectedName =
    engines.find((item) => item.id === selectedEngine)?.name ?? 'Google'

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      {/* 顶部标题与引擎选择栏 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium min-w-0">
          <Search className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="truncate">多引擎聚合搜索</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {engines.map((eng) => (
            <button
              type="button"
              key={eng.id}
              onClick={() => selectEngine(eng.id)}
              className={`px-1.5 py-0.5 rounded text-xs transition-all flex items-center gap-0.5 cursor-pointer ${
                selectedEngine === eng.id
                  ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title={`切换至 ${eng.name} 引擎`}
            >
              <span>{eng.icon}</span>
              <span className="hidden @[340px]:inline">{eng.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={openEditor}
            aria-label="自加一个搜索引擎"
            title={custom ? `自定义引擎：${custom.name}（点此修改）` : '自加一个搜索引擎（仅存本机）'}
            className="px-1.5 py-0.5 rounded text-xs transition-all flex items-center gap-0.5 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 自定义引擎编辑器（仅存本机，不上云） */}
      {editorOpen && (
        <div className="mt-2 rounded-xl border border-border/70 bg-background p-2 space-y-1.5">
          <input
            aria-label="自定义引擎名称"
            type="text"
            value={editorName}
            onChange={(e) => setEditorName(e.target.value)}
            placeholder="引擎名称，如：微信文章"
            maxLength={12}
            className="w-full text-xs px-2 py-1.5 rounded-lg border border-border/70 bg-background outline-none focus:border-blue-500/60"
          />
          <input
            aria-label="自定义引擎地址模板"
            type="text"
            value={editorTemplate}
            onChange={(e) => setEditorTemplate(e.target.value)}
            placeholder="地址模板，如 https://example.com/search?q=%s"
            className="w-full text-xs px-2 py-1.5 rounded-lg border border-border/70 bg-background outline-none focus:border-blue-500/60"
          />
          {editorError && (
            <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{editorError}</p>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">
            %s 会被换成你的搜索词；只接受 https 地址，且只存在你自己的浏览器里。
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={saveCustom}
              className="px-2 py-1 rounded-lg text-xs bg-primary/10 hover:bg-primary/20 text-primary cursor-pointer"
            >
              保存并使用
            </button>
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              取消
            </button>
            {custom && (
              <button
                type="button"
                onClick={deleteCustom}
                className="ml-auto px-2 py-1 rounded-lg text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
              >
                删除自定义引擎
              </button>
            )}
          </div>
        </div>
      )}

      {/* 搜索输入框 */}
      <form onSubmit={handleSearch} className="flex-1 flex flex-col justify-center py-2">
        <div className="relative">
          <input aria-label="搜索关键词"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`在 ${selectedName} 中快速搜索并直达...`}
            className="w-full text-base sm:text-xs px-3 py-2 rounded-xl border border-border/70 bg-background outline-none pr-9 focus:border-blue-500/60 shadow-xs"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors"
            title="回车或点击立即搜索"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>

      {/* 底部信息 */}
      <div className="pt-1 text-xs text-muted-foreground text-center font-mono space-y-0.5">
        {unknownEngine && (
          <p className="text-amber-600 dark:text-amber-400 leading-relaxed">
            配置的默认引擎「{requested}」不存在，已选中 Google。可用值：
            {Object.keys(BUILTIN_SEARCH_ENGINES).join(' / ')}。
          </p>
        )}
        <div>按 Enter 直达新标签页 · 零隐私追踪</div>
      </div>
    </div>
  )
}
