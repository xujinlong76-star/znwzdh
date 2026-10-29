import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { auth } from '@/lib/auth'
import { canonicalUserId } from '@/lib/me-identity'
import { hubIdentitySecret, identitySignatureHeaders } from '@/lib/identity-signature'
import { sanitizeForwardedFor } from '@/lib/hub-proxy'
import {
    SubmissionData,
    SubmissionIssue,
    SUBMISSION_LABELS,
    generateIssueBody,
    parseSubmissionFromIssueBody
} from '@/types/submission'

export const runtime = 'nodejs'


const GITHUB_API = 'https://api.github.com'
const GITHUB_OWNER = process.env.GITHUB_OWNER!
const GITHUB_REPO = process.env.GITHUB_REPO!
const GITHUB_PAT = process.env.GITHUB_PAT!

/** NavHub 中枢地址（投稿回退通道用） */
const HUB_BASE = (
    process.env.NAVHUB_STORAGE_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:8787'
).replace(/\/$/, '')

/**
 * 服务端调用中枢管理/读取接口的委托凭据：
 * 当中枢开启 NAVHUB_AUTH_REQUIRED=true 时，GET /api/submissions 需要至少 read 权限，
 * 必须携带服务端管理凭据，否则后台投稿管理页在中枢回退通道下会 401 死锁。
 */
function hubServiceToken(): string | undefined {
    return (
        process.env.NAVHUB_ADMIN_TOKEN ||
        process.env.NAVHUB_BOOTSTRAP_TOKEN ||
        process.env.NAVHUB_STORAGE_TOKEN ||
        process.env.NAVHUB_SESSION_SECRET ||
        process.env.AUTH_SECRET ||
        undefined
    )
}

/**
 * 是否配置了 GitHub 投稿通道。
 * NavHub 默认部署（STORAGE_ADAPTER=http）没有 GitHub 配置，
 * 上游的「建 Issue」流程会直接失败——因此提供中枢回退：
 * 投稿落库为 status=pending 的站点，走 /api/sites?status=pending 审核。
 */
function hasGithubChannel(): boolean {
    return Boolean(GITHUB_OWNER && GITHUB_REPO && GITHUB_PAT)
}

/** 中枢回退：落库为待审核站点（透传清洗后的 X-Forwarded-For 避免全站访客共用同一限流桶） */
async function submitToHub(data: SubmissionData, request: NextRequest): Promise<NextResponse> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    }
    const xff = sanitizeForwardedFor(request.headers.get('x-forwarded-for'))
    if (xff) {
        headers['x-forwarded-for'] = xff
    }
    const session = await auth()
    const identity = canonicalUserId(session?.user)
    const secret = hubIdentitySecret()
    // 无签名密钥时按匿名投稿，不借用管理凭据或客户端自称身份。
    if (identity && secret) {
        const signedIdentity = identity.slice(0, 64)
        headers['x-navhub-user-id'] = signedIdentity
        Object.assign(headers, await identitySignatureHeaders(secret, signedIdentity))
    }

    const res = await fetch(HUB_BASE + '/api/submissions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            title: data.title,
            url: data.url,
            description: data.description,
            categoryId: data.category,
            subCategoryId: data.subcategory || null,
            submitterNote: data.submitterNote || null,
        }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.status === 409) {
        return NextResponse.json({ success: false, message: '该网址已存在' }, { status: 409 })
    }
    if (!res.ok) {
        return NextResponse.json(
            { success: false, message: body.message || '提交失败，请稍后重试' },
            { status: res.status }
        )
    }
    return NextResponse.json({
        success: true,
        message: '投稿已提交，等待审核',
        siteId: body.siteId,
    })
}

/** 中枢回退：获取待审核/已审核投稿并转成 SubmissionIssue 形状。
 * 走中枢的 GET /api/submissions（返回与 GitHub 通道同形状 success+submissions，
 * 且只含 source=submission 的站点、number 由中枢按与本端一致的 hash 规则算出）。 */
async function getSubmissionsFromHub(status: string): Promise<NextResponse> {
    try {
        const url = new URL(`${HUB_BASE}/api/submissions`)
        url.searchParams.set('status', status)
        const token = hubServiceToken()
        const headers: Record<string, string> = { Accept: 'application/json' }
        if (token) {
            headers['Authorization'] = `Bearer ${token}`
        }
        const res = await fetch(url.toString(), {
            headers,
            cache: 'no-store',
        })
        if (!res.ok) {
            return NextResponse.json({ success: false, message: '获取投稿列表失败' }, { status: res.status })
        }
        const body = await res.json().catch(() => ({ success: false }))
        if (!body.success || !Array.isArray(body.submissions)) {
            return NextResponse.json({ success: false, message: '获取投稿列表失败' }, { status: 502 })
        }
        return NextResponse.json({ success: true, submissions: body.submissions })
    } catch {
        return NextResponse.json({ success: false, message: '获取投稿列表失败' }, { status: 502 })
    }
}

// 创建投稿 (POST)
export async function POST(request: NextRequest) {
    try {
        const data: SubmissionData = await request.json()

        // 验证必填字段
        if (!data.title || !data.url || !data.description || !data.category) {
            return NextResponse.json(
                { success: false, message: '请填写完整的投稿信息' },
                { status: 400 }
            )
        }

        // 验证 URL 格式（仅允许 http/https 协议，阻断 javascript:/data: 等伪协议）
        try {
            const parsedUrl = new URL(data.url)
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                return NextResponse.json(
                    { success: false, message: '仅支持 HTTP 或 HTTPS 网站地址' },
                    { status: 400 }
                )
            }
        } catch {
            return NextResponse.json(
                { success: false, message: '请输入有效的网站地址' },
                { status: 400 }
            )
        }

        // NavHub 部署（无 GitHub 配置）走中枢落库
        if (!hasGithubChannel()) {
            return await submitToHub(data, request)
        }

        // 创建 GitHub Issue
        const response = await fetch(`${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({
                title: `[投稿] ${data.title}`,
                body: generateIssueBody(data),
                labels: [SUBMISSION_LABELS.SUBMISSION, SUBMISSION_LABELS.PENDING]
            })
        })

        if (!response.ok) {
            const error = await response.json()
            console.error('GitHub API Error:', error)
            return NextResponse.json(
                { success: false, message: '提交失败，请稍后重试' },
                { status: 500 }
            )
        }

        const issue = await response.json()

        return NextResponse.json({
            success: true,
            message: '投稿成功！我们会尽快审核您的投稿',
            issueNumber: issue.number,
            issueUrl: issue.html_url
        })

    } catch (error) {
        console.error('Submission error:', error)
        return NextResponse.json(
            { success: false, message: '服务器错误，请稍后重试' },
            { status: 500 }
        )
    }
}

// 获取投稿列表 (GET) - 仅管理员使用
export async function GET(request: NextRequest) {
    try {
        // 后台投稿队列属管理面数据（含投稿人 URL 与说明）：此前完全没有鉴权
        const admin = await requireAdmin()
        if (!admin.ok) {
            return NextResponse.json(
                { success: false, message: admin.reason || 'Forbidden' },
                { status: admin.status ?? 403 }
            )
        }
        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status') || 'pending' // pending, approved, rejected, all

        // NavHub 部署（无 GitHub 配置）走中枢查询
        if (!hasGithubChannel()) {
            return await getSubmissionsFromHub(status)
        }

        // 构建标签过滤
        let labels = SUBMISSION_LABELS.SUBMISSION
        if (status === 'pending') {
            labels = `${SUBMISSION_LABELS.SUBMISSION},${SUBMISSION_LABELS.PENDING}`
        } else if (status === 'approved') {
            labels = `${SUBMISSION_LABELS.SUBMISSION},${SUBMISSION_LABELS.APPROVED}`
        } else if (status === 'rejected') {
            labels = `${SUBMISSION_LABELS.SUBMISSION},${SUBMISSION_LABELS.REJECTED}`
        }

        const response = await fetch(
            `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?labels=${labels}&state=all&per_page=100`,
            {
                headers: {
                    'Authorization': `Bearer ${GITHUB_PAT}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        )

        if (!response.ok) {
            throw new Error('Failed to fetch issues')
        }

        const issues = await response.json()

        // 解析投稿数据
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const submissions: SubmissionIssue[] = issues.map((issue: any) => ({
            id: issue.id,
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state,
            labels: issue.labels,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            html_url: issue.html_url,
            submissionData: parseSubmissionFromIssueBody(issue.body)
        }))

        return NextResponse.json({ success: true, submissions })

    } catch (error) {
        console.error('Get submissions error:', error)
        return NextResponse.json(
            { success: false, message: '获取投稿列表失败' },
            { status: 500 }
        )
    }
}
