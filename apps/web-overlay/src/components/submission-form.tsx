'use client'

import { useState, useEffect } from 'react'
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
import { Loader2, CheckCircle, XCircle, Send, Globe, FileText, Tag } from 'lucide-react'
import type { NavigationData, NavigationItem, NavigationCategory } from '@/types/navigation'
import type { SubmissionData, SubmissionResponse } from '@/types/submission'

interface SubmissionFormProps {
    navigationData: NavigationData
}

export function SubmissionForm({ navigationData }: SubmissionFormProps) {
    const [formData, setFormData] = useState<SubmissionData>({
        title: '',
        url: '',
        description: '',
        category: '',
        subcategory: '',
        submitterNote: ''
    })

    const [subCategories, setSubCategories] = useState<NavigationCategory[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [result, setResult] = useState<SubmissionResponse | null>(null)

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
                // 清空表单
                setFormData({
                    title: '',
                    url: '',
                    description: '',
                    category: '',
                    subcategory: '',
                    submitterNote: ''
                })
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
            <CardHeader className="space-y-1.5 pb-6 border-b border-border/50 bg-muted/15">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
                        <Send className="h-5 w-5" />
                    </div>
                    <div>
                        <CardTitle className="text-xl sm:text-2xl font-bold">推荐与收录新站点</CardTitle>
                        <CardDescription className="text-xs sm:text-sm mt-0.5">
                            分享优质网站或开源工具，与全网开发者共同构建更强大的生产力矩阵
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="pt-6">
                {result && (
                    <Alert
                        className={`mb-6 rounded-xl ${result.success
                                ? 'border-emerald-500/40 bg-emerald-500/10'
                                : 'border-destructive/40 bg-destructive/10'
                            }`}
                    >
                        {result.success ? (
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        <AlertDescription className={result.success ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'}>
                            {result.message}
                            {result.issueUrl && (
                                <a
                                    href={result.issueUrl}
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
                            <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            id="title"
                            placeholder="例如：Cursor 或 Linear"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            required
                            className="h-10 text-xs sm:text-sm rounded-xl border-border/70 bg-background/80"
                        />
                    </div>

                    {/* 网站地址 */}
                    <div className="space-y-2">
                        <Label htmlFor="url" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>网站地址 (URL)</span>
                            <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            id="url"
                            type="url"
                            placeholder="https://example.com"
                            value={formData.url}
                            onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                            required
                            className="h-10 text-xs sm:text-sm rounded-xl border-border/70 bg-background/80 font-mono"
                        />
                    </div>

                    {/* 网站描述 */}
                    <div className="space-y-2">
                        <Label htmlFor="description" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>一句话核心介绍</span>
                            <span className="text-destructive">*</span>
                        </Label>
                        <Textarea
                            id="description"
                            placeholder="简要概括该站点的核心技术亮点或实用功能..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            required
                            rows={3}
                            className="text-xs sm:text-sm rounded-xl border-border/70 bg-background/80 resize-none"
                        />
                    </div>

                    {/* 分类选择 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold text-foreground">
                                选择主分类 <span className="text-destructive">*</span>
                            </Label>
                            <Select
                                value={formData.category}
                                onValueChange={(value) => setFormData({ ...formData, category: value, subcategory: '' })}
                                required
                            >
                                <SelectTrigger aria-label="选择主分类" className="h-10 text-xs sm:text-sm rounded-xl border-border/70 bg-background/80">
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
                                    <SelectTrigger aria-label="选择二级子类目" className="h-10 text-xs sm:text-sm rounded-xl border-border/70 bg-background/80">
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
                            className="text-xs sm:text-sm rounded-xl border-border/70 bg-background/80 resize-none"
                        />
                    </div>

                    {/* 提交按钮 */}
                    <Button
                        type="submit"
                        disabled={isSubmitting}
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
