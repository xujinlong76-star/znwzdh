'use client'

import { useState, useEffect, useRef } from 'react'
import { safeHref } from '@/lib/safe-url'
import { Button } from "@/registry/new-york/ui/button"
import { Input } from "@/registry/new-york/ui/input"
import { Textarea } from "@/registry/new-york/ui/textarea"
import { Label } from "@/registry/new-york/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/registry/new-york/ui/select"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/registry/new-york/ui/card"
import { Alert, AlertDescription } from "@/registry/new-york/ui/alert"
import { Loader2, CheckCircle, XCircle, Send, Globe, FileText, Tag, Sparkles } from 'lucide-react'
import type { NavigationData, NavigationItem, NavigationCategory } from '@/types/navigation'
import type { SubmissionData, SubmissionResponse } from '@/types/submission'

interface SubmissionFormProps {
    navigationData: NavigationData
    /** A11：从搜索零结果带词跳来时的预填（只作表单初始值，用户可改；非法值由 parseSubmitPrefill 事先滤掉） */
    initialTitle?: string
    initialUrl?: string
}

export function SubmissionForm({ navigationData, initialTitle, initialUrl }: SubmissionFormProps) {
    const [formData, setFormData] = useState<SubmissionData>({
        title: initialTitle ?? '',
        url: initialUrl ?? '',
        description: '',
        category: '',
        subcategory: '',
        submitterNote: ''
    })

    const [subCategories, setSubCategories] = useState<NavigationCategory[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isAiPrefilling, setIsAiPrefilling] = useState(false)
    const [result, setResult] = useState<SubmissionResponse | null>(null)
    // AI 识别增强态：图标预览、分类置信度/备选、查重预告（URL 防抖自动识别链路）
    const [aiEnhance, setAiEnhance] = useState<{
        icon: string
        confidence: number
        candidates: Array<{ category: string; subcategory: string; reason: string }>
        duplicateSiteId: string | null
        /** 本次识别的目标 URL：改 URL 后旧查重/图标不得误伤新地址 */
        checkedUrl: string
    } | null>(null)
    // 防抖自动识别的记账（声明在 handleAiPrefill 之前，供入口内掐定时器/去重）
    const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastAutoUrlRef = useRef('')
    // 识别请求序号：用户快速改 URL 时旧请求晚返回不得覆盖新 URL 的表单内容
    const prefillSeqRef = useRef(0)
    // 当前最新 URL：用户改 URL 后、防抖新请求发出前的窗口内，旧响应也必须丢弃
    const latestUrlRef = useRef('')

    const handleAiPrefill = async () => {
        const targetUrl = formData.url.trim()
        if (!targetUrl) return
        // 不再用 isAiPrefilling 布尔锁拒绝新请求：上一次识别在飞时用户改了网址，
        // 若在这里 return，防抖回调已把 lastAutoUrlRef 标成新网址，effect 的
        // 「同 URL 不重复」会让新网址永远不再自动识别。改为允许并发，靠 seq
        // 序号 + latestUrlRef 保证只有最新请求的结果落地（旧请求返回即丢弃）。
        const seq = ++prefillSeqRef.current
        setIsAiPrefilling(true)
        setResult(null)
        // 手动按钮与防抖自动触发共用本入口：记账 lastAutoUrl 并掐掉挂起的防抖
        // 定时器，避免「点按钮后 800ms 内自动又触发一次」的重复识别。
        lastAutoUrlRef.current = targetUrl
        if (autoTimerRef.current) {
            clearTimeout(autoTimerRef.current)
            autoTimerRef.current = null
        }
        // 新一轮识别先清上一轮增强态：识别失败时不留旧 icon/查重提示误导用户
        setAiEnhance(null)
        try {
            const categoriesPayload = navigationData.navigationItems
                .filter((item) => item.enabled !== false)
                .map((item) => ({
                    id: item.id,
                    title: item.title,
                    description: (item as { description?: string }).description || '',
                    subCategories: (item.subCategories || [])
                        .filter((sub) => sub.enabled !== false)
                        .map((sub) => ({
                            id: sub.id,
                            title: sub.title,
                            description: (sub as { description?: string }).description || '',
                        })),
                }))
            const res = await fetch('/api/hub/submissions/prefill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: targetUrl, categories: categoriesPayload }),
            })
            // 响应体不是 JSON（如 502 网关页）时按「无预填」处理，下面 res.ok 分支会兜底
            const data = await res.json().catch(() => { /* 解析失败即视为无数据，由 res.ok 判定 */ return null })
            if (seq !== prefillSeqRef.current || latestUrlRef.current !== targetUrl) return
            if (res.ok && data?.success && data.prefill) {
                const p = data.prefill
                setFormData((prev) => {
                    const nextCategory = p.category || prev.category
                    // 主分类变化时旧子分类失效：不能沿用（否则 A 类的子类挂到 B 类下），
                    // 用 AI 给的子类（须属于新主类，后端已校验父子一致），否则清空。
                    const nextSub = nextCategory === prev.category
                        ? (p.subcategory || prev.subcategory)
                        : (p.subcategory || '')
                    return {
                        ...prev,
                        title: p.title || prev.title,
                        description: p.description || prev.description,
                        category: nextCategory,
                        subcategory: nextSub,
                        submitterNote: p.submitterNote || prev.submitterNote,
                    }
                })
                setAiEnhance({
                    icon: p.icon || '',
                    confidence: typeof p.confidence === 'number' ? p.confidence : 0,
                    candidates: Array.isArray(p.candidates) ? p.candidates : [],
                    duplicateSiteId: p.duplicate?.siteId ?? null,
                    checkedUrl: targetUrl,
                })
            } else {
                setResult({
                    success: false,
                    message: data?.message || '无法识别该网址，请确认输入了完整的 https:// 网址',
                })
            }
        } catch {
            if (seq !== prefillSeqRef.current) return
            setResult({
                success: false,
                message: 'AI 识别服务请求失败，请手动填写或稍后重试',
            })
        } finally {
            if (seq === prefillSeqRef.current) setIsAiPrefilling(false)
        }
    }

    // 自动识别：URL 合法后静默 800ms 自动触发 AI 填表（自动采集元数据 + 自动选分类），
    // 不再强制手点按钮；同一 URL 不重复触发，手动按钮保留做重试。
    useEffect(() => {
        const url = formData.url.trim()
        latestUrlRef.current = url
        if (!url || !/^https?:\/\//i.test(url)) return
        if (url === lastAutoUrlRef.current) return
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
        autoTimerRef.current = setTimeout(() => {
            lastAutoUrlRef.current = url
            void handleAiPrefill()
        }, 800)
        return () => {
            if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
        }
        // handleAiPrefill 每次渲染重建，不进依赖：防抖只跟 URL 走
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.url])

    // 当主分类变化时，更新子分类列表
    useEffect(() => {
        if (formData.category) {
            const selectedCategory = navigationData.navigationItems.find(
                item => item.id === formData.category
            )
            if (selectedCategory?.subCategories && selectedCategory.subCategories.length > 0) {
                setSubCategories(selectedCategory.subCategories)
            } else {
                setSubCategories([])
                setFormData(prev => ({ ...prev, subcategory: '' }))
            }
        } else {
            setSubCategories([])
        }
    }, [formData.category, navigationData])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        setResult(null)

        try {
            const response = await fetch('/api/submissions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            })

            const data: SubmissionResponse = await response.json()
            setResult(data)

            if (data.success) {
                // 清空表单与识别态：残留 aiEnhance 会让旧图标/查重提示挂在新输入上，
                // 残留 lastAutoUrlRef 会让再次输入同一网址时防抖不触发（识别被吞）。
                setFormData({
                    title: '',
                    url: '',
                    description: '',
                    category: '',
                    subcategory: '',
                    submitterNote: ''
                })
                setAiEnhance(null)
                setSubCategories([])
                lastAutoUrlRef.current = ''
                latestUrlRef.current = ''
                if (autoTimerRef.current) {
                    clearTimeout(autoTimerRef.current)
                    autoTimerRef.current = null
                }
            }
        } catch {
            setResult({
                success: false,
                message: '网络错误，请稍后重试'
            })
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <Card className="w-full max-w-2xl mx-auto border border-border/70 rounded-2xl shadow-xs glass-surface subtle-mesh overflow-hidden">
            <CardHeader className="space-y-1.5 p-4 sm:p-6 pb-4 sm:pb-6 border-b border-border/50 bg-muted/15">
                <div className="flex items-start sm:items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs shrink-0">
                        <Send className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <CardTitle className="text-xl sm:text-2xl font-bold truncate">推荐与收录新站点</CardTitle>
                        <CardDescription className="text-xs sm:text-sm mt-0.5 leading-relaxed">
                            分享优质网站或开源工具，与全网开发者共同构建更强大的生产力矩阵
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-6 pt-4 sm:pt-6">
                {result && (
                    <Alert
                        className={`mb-6 rounded-xl ${result.success
                                ? 'border-emerald-500/40 bg-emerald-500/10'
                                : 'border-destructive/40 bg-destructive/15'
                            }`}
                    >
                        {result.success ? (
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                            <XCircle className="h-4 w-4 text-destructive-text" />
                        )}
                        <AlertDescription className={result.success ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive-text'}>
                            {result.message}
                            {result.issueUrl && (
                                <a
                                    href={safeHref(result.issueUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-2 underline font-semibold hover:no-underline"
                                >
                                    查看处理看板 →
                                </a>
                            )}
                        </AlertDescription>
                    </Alert>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* 网站名称 */}
                    <div className="space-y-2">
                        <Label htmlFor="title" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>网站名称</span>
                            <span className="text-destructive-text">*</span>
                        </Label>
                        <Input
                            id="title"
                            placeholder="例如：Cursor 或 Linear"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            required
                            className="h-10 text-base sm:text-sm rounded-xl border-border/70 bg-background/80"
                        />
                    </div>

                    {/* 网站地址 */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="url" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>网站地址 (URL)</span>
                                <span className="text-destructive-text">*</span>
                            </Label>
                            <span className="text-[11px] text-muted-foreground">输入网址后可一键 AI 自动填表</span>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                id="url"
                                type="url"
                                placeholder="https://example.com"
                                value={formData.url}
                                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                                required
                                className="h-10 text-base sm:text-sm rounded-xl border-border/70 bg-background/80 font-mono flex-1"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!formData.url.trim() || isAiPrefilling}
                                onClick={handleAiPrefill}
                                className="h-10 px-3.5 rounded-xl border-primary/40 text-primary hover:bg-primary/10 gap-1.5 text-xs font-semibold shrink-0"
                            >
                                {isAiPrefilling ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        <span>AI 正在识别网页...</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="h-3.5 w-3.5" />
                                        <span>✨ AI 识别网址自动填写</span>
                                    </>
                                )}
                            </Button>
                        </div>

                        {/* 自动识别增强态：图标预览 / 查重预告 / 低置信度提示 */}
                        {aiEnhance?.duplicateSiteId && aiEnhance.checkedUrl === formData.url.trim() && (
                            <Alert className="border-amber-500/40 bg-amber-500/10">
                                <XCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                                <AlertDescription className="text-xs">
                                    该网址已被本站收录（站点 ID：<code>{aiEnhance.duplicateSiteId.slice(0, 8)}</code>），投稿将无法重复提交。
                                </AlertDescription>
                            </Alert>
                        )}
                        {(aiEnhance?.checkedUrl === formData.url.trim() && aiEnhance?.icon) || (isAiPrefilling && formData.url.trim()) ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {aiEnhance?.icon ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- 外链图标预览用 img，next/image 不支持任意远端域
                                    <img
                                        src={aiEnhance.icon}
                                        alt="站点图标预览"
                                        width={20}
                                        height={20}
                                        className="h-5 w-5 rounded border border-border/60 object-contain bg-background"
                                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                                    />
                                ) : (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                                <span>{isAiPrefilling ? '正在采集站点元数据并分析分类...' : '已采集站点图标与元数据'}</span>
                            </div>
                        ) : null}
                    </div>

                    {/* 网站描述 */}
                    <div className="space-y-2">
                        <Label htmlFor="description" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>一句话核心介绍</span>
                            <span className="text-destructive-text">*</span>
                        </Label>
                        <Textarea
                            id="description"
                            placeholder="简要概括该站点的核心技术亮点或实用功能..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            required
                            rows={3}
                            className="text-base sm:text-sm rounded-xl border-border/70 bg-background/80 resize-none"
                        />
                    </div>

                    {/* 分类选择 */}
                    {/* AI 备选分类：置信度低或有并列可能时给一键切换的候选 */}
                    {aiEnhance && aiEnhance.candidates.length > 0 && (
                        <div className="space-y-1.5 p-3 rounded-xl border border-primary/25 bg-primary/5">
                            <p className="text-xs text-muted-foreground">
                                {aiEnhance.confidence < 0.55
                                    ? 'AI 对分类把握不足，可从备选一键切换：'
                                    : 'AI 备选分类（可一键切换）：'}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {(formData.category || formData.subcategory
                                    ? [{ category: formData.category, subcategory: formData.subcategory, reason: '当前选择' }, ...aiEnhance.candidates]
                                    : aiEnhance.candidates
                                ).map((cand, i) => {
                                    const cat = navigationData.navigationItems.find((it) => it.id === cand.category)
                                    const sub = cat?.subCategories?.find((s) => s.id === cand.subcategory)
                                    const active = formData.category === cand.category && (formData.subcategory || '') === (cand.subcategory || '')
                                    return (
                                        <button
                                            key={`${cand.category}-${cand.subcategory}-${i}`}
                                            type="button"
                                            onClick={() => setFormData((prev) => ({ ...prev, category: cand.category, subcategory: cand.subcategory || '' }))}
                                            className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${active
                                                ? 'border-primary bg-primary/15 text-primary font-semibold'
                                                : 'border-border/70 bg-background/70 text-foreground hover:border-primary/50 hover:bg-primary/5'
                                                }`}
                                        >
                                            {cat?.title || cand.category}
                                            {sub ? ` / ${sub.title}` : ''}
                                            {cand.reason ? <span className="ml-1 text-muted-foreground">· {cand.reason}</span> : null}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold text-foreground">
                                选择主分类 <span className="text-destructive-text">*</span>
                            </Label>
                            <Select
                                value={formData.category}
                                onValueChange={(value) => setFormData({ ...formData, category: value, subcategory: '' })}
                                required
                            >
                                <SelectTrigger aria-label="选择主分类" className="h-10 text-base sm:text-sm rounded-xl border-border/70 bg-background/80">
                                    <SelectValue placeholder="选择所属分类" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-border/70 shadow-lg">
                                    {navigationData.navigationItems
                                        .filter(item => item.enabled !== false)
                                        .map((item: NavigationItem) => (
                                            <SelectItem key={item.id} value={item.id} className="text-xs sm:text-sm">
                                                {item.title}
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {subCategories.length > 0 && (
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold text-foreground">
                                    选择二级子类目
                                </Label>
                                <Select
                                    value={formData.subcategory}
                                    onValueChange={(value) => setFormData({ ...formData, subcategory: value })}
                                >
                                    <SelectTrigger aria-label="选择二级子类目" className="h-10 text-base sm:text-sm rounded-xl border-border/70 bg-background/80">
                                        <SelectValue placeholder="选择子分类（可选）" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-border/70 shadow-lg">
                                        {subCategories
                                            .filter(sub => sub.enabled !== false)
                                            .map((sub: NavigationCategory) => (
                                                <SelectItem key={sub.id} value={sub.id} className="text-xs sm:text-sm">
                                                    {sub.title}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>

                    {/* 投稿者备注 */}
                    <div className="space-y-2">
                        <Label htmlFor="note" className="text-xs font-semibold text-muted-foreground">
                            补充备注或平替标签（可选）
                        </Label>
                        <Textarea
                            id="note"
                            placeholder="如：GitHub 开源地址、同类平替竞品等信息..."
                            value={formData.submitterNote}
                            onChange={(e) => setFormData({ ...formData, submitterNote: e.target.value })}
                            rows={2}
                            className="text-base sm:text-sm rounded-xl border-border/70 bg-background/80 resize-none"
                        />
                    </div>

                    {/* 提交按钮 */}
                    <Button
                        type="submit"
                        disabled={isSubmitting || Boolean(aiEnhance?.duplicateSiteId && aiEnhance.checkedUrl === formData.url.trim())}
                        className="w-full h-11 text-sm font-semibold rounded-xl shadow-xs transition-all duration-200"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                正在自动化校验与提交中...
                            </>
                        ) : (
                            <>
                                <Send className="mr-2 h-4 w-4" />
                                提交推荐收录
                            </>
                        )}
                    </Button>

                    <p className="text-xs text-muted-foreground text-center">
                        提交后将自动校验连通性与健康状态，审核通过后即刻同步至全网索引库
                    </p>
                </form>
            </CardContent>
        </Card>
    )
}
