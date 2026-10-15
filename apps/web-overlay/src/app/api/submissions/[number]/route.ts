import { NextRequest, NextResponse } from 'next/server'
import { auth, getServerGithubToken } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { SUBMISSION_LABELS, parseSubmissionFromIssueBody } from '@/types/submission'
import { getFileContent, commitFile } from '@/lib/github'

export const runtime = 'edge'



const GITHUB_API = 'https://api.github.com'
const GITHUB_OWNER = process.env.GITHUB_OWNER!
const GITHUB_REPO = process.env.GITHUB_REPO!
const GITHUB_PAT = process.env.GITHUB_PAT!

const HUB_BASE = (
    process.env.NAVHUB_STORAGE_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:8787'
).replace(/\/$/, '')

function hasGithubChannel(): boolean {
    return Boolean(GITHUB_OWNER && GITHUB_REPO && GITHUB_PAT)
}

interface RouteParams {
    params: Promise<{ number: string }>
}

// 审核投稿 (PATCH) - 通过或拒绝
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        // 验证登录
        const session = await auth()
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: '请先登录' },
                { status: 401 }
            )
        }

        const { number } = await params
        const issueNumber = number
        const { action, reason } = await request.json()

        if (!action || !['approve', 'reject'].includes(action)) {
            return NextResponse.json(
                { success: false, message: '无效的操作' },
                { status: 400 }
            )
        }

        // NavHub 部署（无 GitHub 配置）走中枢直接审核。
        // 注意：:number 是前端算的 hash number，不是真实 site id ——
        // 中枢 /api/submissions/:number 会自己反查回 site id；
        // 此前直接拿 number 调 /api/sites/:id 必然 404（审核按钮静默失效）。
        if (!hasGithubChannel()) {
            const patchRes = await fetch(`${HUB_BASE}/api/submissions/${encodeURIComponent(issueNumber)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ action, reason }),
            })
            const body = await patchRes.json().catch(() => ({} as Record<string, unknown>))
            if (!patchRes.ok) {
                return NextResponse.json(
                    { success: false, message: (body as { message?: string }).message || '操作失败' },
                    { status: patchRes.status }
                )
            }
            return NextResponse.json(body)
        }

        // 获取 Issue 详情
        const issueResponse = await fetch(
            `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
            {
                headers: {
                    'Authorization': `Bearer ${GITHUB_PAT}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        )

        if (!issueResponse.ok) {
            return NextResponse.json(
                { success: false, message: 'Issue 不存在' },
                { status: 404 }
            )
        }

        const issue = await issueResponse.json()
        const submissionData = parseSubmissionFromIssueBody(issue.body)

        if (!submissionData) {
            return NextResponse.json(
                { success: false, message: '无法解析投稿数据' },
                { status: 400 }
            )
        }

        if (action === 'approve') {
            // 管理员校验：口径与 admin-guard 一致（未登录 401 / 非白名单 403）
            const admin = await requireAdmin()
            if (!admin.ok) {
                return NextResponse.json(
                    { success: false, message: admin.status === 403 ? '无管理员权限' : '请先登录' },
                    { status: admin.status ?? 401 }
                )
            }
            // 服务端 token 保管：accessToken 不再下发到 session（防 XSS 窃取 repo scope），
            // 按用户 sub 从服务端内存取，取不到说明需要重新登录（JWT 回调未命中/进程重启）。
            const serverToken = getServerGithubToken((session.user as unknown as { id?: string })?.id)
            if (!serverToken) {
                return NextResponse.json(
                    { success: false, message: '缺少服务端访问令牌，请重新登录' },
                    { status: 401 }
                )
            }

            const filePath = 'src/navsphere/content/navigation.json'

            // 1. 使用 getFileContent 获取当前导航数据
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const navigationData: any = await getFileContent(filePath)

            if (!navigationData || !navigationData.navigationItems) {
                return NextResponse.json(
                    { success: false, message: '无法读取导航数据文件' },
                    { status: 500 }
                )
            }

            // 2. 查找目标分类并添加新项
            const categoryId = submissionData.category
            const subcategoryId = submissionData.subcategory

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let targetCategory = navigationData.navigationItems.find(
                (item: any) => item.id === categoryId || item.title === categoryId
            )

            if (!targetCategory) {
                targetCategory = navigationData.navigationItems[0]
            }

            const newItem = {
                id: `${Date.now()}`,
                title: submissionData.title,
                href: submissionData.url,
                description: submissionData.description,
                icon: '/assets/images/default-website-icon.png',
                enabled: true
            }

            if (subcategoryId && targetCategory.subCategories) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const targetSubCategory = targetCategory.subCategories.find(
                    (sub: any) => sub.id === subcategoryId || sub.title === subcategoryId
                )
                if (targetSubCategory) {
                    if (!targetSubCategory.items) {
                        targetSubCategory.items = []
                    }
                    targetSubCategory.items.push(newItem)
                } else {
                    if (!targetCategory.items) {
                        targetCategory.items = []
                    }
                    targetCategory.items.push(newItem)
                }
            } else {
                if (!targetCategory.items) {
                    targetCategory.items = []
                }
                targetCategory.items.push(newItem)
            }

            // 3. 使用 commitFile 将更新后的数据提交回 GitHub（使用管理员的 OAuth token）
            try {
                await commitFile(
                    filePath,
                    JSON.stringify(navigationData, null, 2),
                    `✅ Add submission: ${submissionData.title}`,
                    serverToken
                )
            } catch (commitError) {
                console.error('GitHub file commit error:', commitError)
                const errMsg = commitError instanceof Error ? commitError.message : String(commitError)
                return NextResponse.json(
                    { success: false, message: `更新导航文件失败: ${errMsg}` },
                    { status: 500 }
                )
            }

            // 更新 Issue 标签
            await updateIssueLabels(issueNumber, SUBMISSION_LABELS.APPROVED, SUBMISSION_LABELS.PENDING)

            // 添加评论
            await addIssueComment(
                issueNumber,
                `✅ **投稿已通过**\n\n该网站已成功添加到导航列表。\n\n审核人: @${session.user.name || 'admin'}`
            )

            // 关闭 Issue
            await closeIssue(issueNumber)

            return NextResponse.json({
                success: true,
                message: '投稿已通过，网站已添加到导航列表'
            })

        } else {
            // 拒绝投稿
            await updateIssueLabels(issueNumber, SUBMISSION_LABELS.REJECTED, SUBMISSION_LABELS.PENDING)

            await addIssueComment(
                issueNumber,
                `❌ **投稿已拒绝**\n\n${reason ? `拒绝原因: ${reason}` : '感谢您的投稿，但该网站暂不符合我们的收录标准。'}\n\n审核人: @${session.user.name || 'admin'}`
            )

            await closeIssue(issueNumber)

            return NextResponse.json({
                success: true,
                message: '投稿已拒绝'
            })
        }

    } catch (error) {
        console.error('Review submission error:', error)
        const errorMsg = error instanceof Error ? error.message : String(error)
        return NextResponse.json(
            { success: false, message: `审核失败: ${errorMsg}` },
            { status: 500 }
        )
    }
}

// 辅助函数：更新 Issue 标签
async function updateIssueLabels(issueNumber: string, addLabel: string, removeLabel: string) {
    // 先获取当前标签
    const issueResponse = await fetch(
        `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
        {
            headers: {
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        }
    )

    const issue = await issueResponse.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentLabels = issue.labels.map((l: any) => l.name)

    // 移除旧标签，添加新标签
    const newLabels = currentLabels
        .filter((l: string) => l !== removeLabel)
        .concat(addLabel)

    await fetch(
        `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({ labels: newLabels })
        }
    )
}

// 辅助函数：添加评论
async function addIssueComment(issueNumber: string, body: string) {
    await fetch(
        `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({ body })
        }
    )
}

// 辅助函数：关闭 Issue
async function closeIssue(issueNumber: string) {
    await fetch(
        `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({ state: 'closed' })
        }
    )
}
