import { Metadata } from 'next/types'
import { Container } from '@/components/ui/container'
import { SubmissionForm } from '@/components/submission-form'
import { getFileContent } from '@/lib/github'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/registry/new-york/ui/button'
import type { NavigationData } from '@/types/navigation'
import { Footer } from '@/components/footer'

/**
 * NavHub 改动：
 *  1. 数据改为从中枢异步读取（原为 import 构建期静态 JSON），
 *     因此投稿表单里的类目下拉反映的是数据库中的真实类目。
 *  2. 页面标题只写页面名，站点名由根 layout 的 title.template 统一追加（单一来源）。
 */
const NAVIGATION_PATH = 'src/navsphere/content/navigation.json'

export const dynamic = 'force-dynamic'

async function getData() {
    // 注意：这里只需要导航数据。站点名由根 layout 的 title.template 统一追加，
    // 所以子页面标题里**不要**再拼站点名，否则会出现"X - NavHub 导航 - NavHub 导航"。
    const navigationData = await getFileContent<NavigationData>(NAVIGATION_PATH)
    return { navigationData }
}

export const metadata: Metadata = {
    title: '网站投稿',
    description: '投稿优质网站，分享好资源',
}

export default async function SubmitPage() {
    const { navigationData } = await getData()

    return (
        <Container as="main" id="main-content">
            <div className="py-6 sm:py-10 space-y-6 max-w-3xl mx-auto">
                {/* 顶部面包屑与标题展板 */}
                <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-7 shadow-xs">
                    <div className="flex items-center gap-2 mb-3">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            <span>返回首页</span>
                        </Link>
                        <span className="text-border">/</span>
                        <span className="text-xs text-primary font-medium">社区收录提案</span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                        投稿收录优质网站
                    </h1>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                        发掘并推荐卓越的开发者工具、AI 实验项目或设计灵感站点，审核通过后即刻向全站推送。
                    </p>
                </div>

                {/* 投稿表单 */}
                <SubmissionForm navigationData={navigationData} />

                {/* 投稿说明 */}
                <div className="p-6 rounded-2xl border border-border/60 bg-muted/20 space-y-3.5 text-xs shadow-2xs">
                    <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                        <span>📋</span>
                        <span>投稿与审核规范</span>
                    </h3>
                    <ul className="space-y-2 text-muted-foreground leading-relaxed">
                        <li className="flex gap-2">
                            <span className="text-primary font-bold">•</span>
                            <span>请确保提交的网站内容合法、健康、有清晰的工程或实用价值</span>
                        </li>
                        <li className="flex gap-2">
                            <span className="text-primary font-bold">•</span>
                            <span>网站地址请填写完整的 URL（须包含 <code>https://</code> 协议前缀）</span>
                        </li>
                        <li className="flex gap-2">
                            <span className="text-primary font-bold">•</span>
                            <span>网站描述请简洁突出核心特色，避免堆砌无关营销词</span>
                        </li>
                        <li className="flex gap-2">
                            <span className="text-primary font-bold">•</span>
                            <span>投稿提交后将通过自动化审计及 GitHub Issues 同步跟踪流转</span>
                        </li>
                    </ul>
                </div>
            </div>
            <Footer />
        </Container>
    )
}
