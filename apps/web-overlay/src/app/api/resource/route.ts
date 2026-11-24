import { NextResponse } from 'next/server'
import { safeFetch } from '@/lib/ssrf-guard'
import { verifyAdminSession } from '@/lib/auth'
import { findResourceReferences } from '@/lib/resource-references';
import { commitFile, getFileContent } from '@/lib/github'
import type { ResourceMetadata } from '@/types/resource-metadata'
import { uint8ArrayToBase64 } from '@/lib/buffer-utils'

export const runtime = 'nodejs'

const MAX_IMAGE_BASE64_LEN = 7 * 1024 * 1024 // ~5MB binary
const SAFE_DATA_IMAGE_HEADER_RE = /^data:image\/(png|jpeg|jpg|gif|webp|x-icon|vnd\.microsoft\.icon|avif);base64$/i

function isSafeImageBytes(bytes: Uint8Array): boolean {
    if (bytes.length === 0) return false
    const headText = new TextDecoder('utf-8', { fatal: false })
        .decode(bytes.subarray(0, Math.min(bytes.length, 256)))
        .trimStart()
    return !/^<\s*(\?xml|!doctype|svg|html|script)/i.test(headText)
}

function sanitizeRepoPathSegment(input: unknown, fallback: string): string {
    if (typeof input !== 'string') return fallback
    const cleaned = input
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .map((seg) => seg.replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
        .join('/')
    return cleaned || fallback
}

function sanitizeFilePrefix(input: unknown, fallback: string): string {
    if (typeof input !== 'string') return fallback
    const cleaned = input.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
    return cleaned || fallback
}

export async function GET() {
    try {
        const authCheck = await verifyAdminSession()
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status })
        }

        const data = await getFileContent('src/navsphere/content/resource-metadata.json') as ResourceMetadata
        if (!data?.metadata || !Array.isArray(data.metadata)) {
            throw new Error('Invalid data structure');
        }
        return NextResponse.json(data)
    } catch (error) {
        console.error('Failed to fetch resource metadata:', error)
        return NextResponse.json({ error: 'Failed to fetch resource metadata' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const authCheck = await verifyAdminSession();
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status });
        }

        const { image, folder = 'assets', prefix = 'img' } = await request.json();
        if (typeof image !== 'string' || !image.includes(',')) {
            return NextResponse.json({ error: '无效的图片数据格式' }, { status: 400 });
        }
        const [dataHeader = '', base64Data = ''] = image.split(',', 2);
        if (!SAFE_DATA_IMAGE_HEADER_RE.test(dataHeader.trim())) {
            return NextResponse.json({ error: '仅支持上传 PNG/JPEG/GIF/WebP/ICO/AVIF 位图格式（禁止 SVG）' }, { status: 415 });
        }
        if (!base64Data || base64Data.length > MAX_IMAGE_BASE64_LEN) {
            return NextResponse.json({ error: '图片内容为空或超出 5MB 大小限制' }, { status: 413 });
        }

        const safeFolder = sanitizeRepoPathSegment(folder, 'assets');
        const safePrefix = sanitizeFilePrefix(prefix, 'img');
        const binaryData = new Uint8Array(Buffer.from(base64Data, 'base64'));
        if (!isSafeImageBytes(binaryData)) {
            return NextResponse.json({ error: '检测到非法文本或 SVG/HTML 负载，已拒绝上传' }, { status: 415 });
        }

        const token = authCheck.githubToken || process.env.GITHUB_PAT || '';
        if (!token) {
            return NextResponse.json({ error: '未配置 GitHub 仓库访问 Token，无法上传资源' }, { status: 400 });
        }

        // 获取上传结果，包含路径和 commit hash
        const { path: imageUrl, commitHash } = await uploadImageToGitHub(binaryData, token, safeFolder, safePrefix);

        // Handle metadata
        const metadata = await getFileContent('src/navsphere/content/resource-metadata.json') as ResourceMetadata;
        metadata.metadata.unshift({
            commit: commitHash,  // 使用实际的 commit hash
            hash: commitHash,    // 使用相同的 hash 作为资源标识
            path: imageUrl
        });

        await commitFile(
            'src/navsphere/content/resource-metadata.json',
            JSON.stringify(metadata, null, 2),
            'Update resource metadata',
            authCheck.githubToken || undefined
        );

        return NextResponse.json({ success: true, imageUrl });
    } catch (error) {
        console.error('Failed to save resource metadata:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to save resource metadata' },
            { status: 500 }
        );
    }
}

// Function to upload image to GitHub
async function uploadImageToGitHub(binaryData: Uint8Array, token: string, folder: string, prefix: string): Promise<{ path: string, commitHash: string }> {
    const owner = process.env.GITHUB_OWNER!;
    const repo = process.env.GITHUB_REPO!;
    const branch = process.env.GITHUB_BRANCH || 'main'

    const cleanFolder = sanitizeRepoPathSegment(folder, 'assets');
    const cleanPrefix = sanitizeFilePrefix(prefix, 'img');
    const path = `/${cleanFolder}/${cleanPrefix}_${Date.now()}.png`;
    const githubPath = 'public' + path;

    // Convert Uint8Array to Base64
    const base64String = uint8ArrayToBase64(binaryData);
    const currentFileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${githubPath}?ref=${branch}`
    /**
     * 2026-11-21：改用统一出口 safeFetch + 严格域名白名单。
     *
     * 旧实现直接 fetch 这个拼出来的 URL——虽然 owner/repo/branch 都来自
     * 环境变量，但 CodeQL 仍按「字符串拼接进 fetch」判为 SSRF 污点流。
     * 加 allowedHosts 后，即便将来有人把 owner/repo 接到用户输入上，
     * 连接目标也锁死在 api.github.com，静态数据流层面污点被切断。
     */
    const response = await safeFetch(currentFileUrl, {
      method: 'PUT',
      allowedHosts: ['api.github.com'],
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Upload ${githubPath}`,
        content: base64String,
        branch: branch,
      }),
      timeoutMs: 15000,
      maxBytes: 2 * 1024 * 1024,
    });
    const bodyText = new TextDecoder().decode(response.body);
    if (!response.ok) {
        let errorData: { message?: string } = {};
        try { errorData = JSON.parse(bodyText) } catch { /* 非 JSON 响应，用原文 */ }
        console.error('Failed to upload image to GitHub:', errorData);
        throw new Error(`Failed to upload image to GitHub: ${errorData.message || bodyText.slice(0, 200) || 'Unknown error'}`);
    }

    const responseData = JSON.parse(bodyText);
    const commitHash = responseData.commit.sha;

    return { path, commitHash };
}

export async function DELETE(request: Request) {
    try {
        const authCheck = await verifyAdminSession();
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status });
        }

        // force: 删除确认对话框在展示引用警告后由管理员确认时置 true（知情强删）；
        // 直连 API 不带 force 则被引用的资源一律拒绝（防误删/滥用绕过前端预检）。
        const { resourceHashes, force } = await request.json() as { resourceHashes?: unknown; force?: unknown };

        if (!Array.isArray(resourceHashes) || resourceHashes.length === 0) {
            return NextResponse.json({ error: 'Invalid resource hashes' }, { status: 400 });
        }

        // 获取当前的资源元数据
        const metadata = await getFileContent('src/navsphere/content/resource-metadata.json') as ResourceMetadata;

        // 服务端强制引用检查（纵深防御）：此前只靠前端删除前预检（check-references），
        // 直连 DELETE 可绕过、删出悬空引用（导航项 icon/站点 logo 指向已删除资源）。
        // 被引用的 hash 一律拒绝删除，返回 409 + 引用清单；UI 无「强制删除」语义。
        const candidates = metadata.metadata.filter(item => resourceHashes.includes(item.hash));
        const pathByHash = new Map(candidates.map(item => [item.hash, item.path ?? '']));
        const pathsToCheck = [...new Set([...pathByHash.values()].filter(Boolean))];
        if (pathsToCheck.length > 0) {
            const navigationData = (await getFileContent('src/navsphere/content/navigation.json')) as import('@/types/navigation').NavigationData;
            const siteData = (await getFileContent('src/navsphere/content/site.json')) as import('@/types/site').SiteConfig;
            const references = findResourceReferences(navigationData, siteData, pathsToCheck);
            const blocked = candidates
                .map(item => ({
                    hash: item.hash,
                    path: pathByHash.get(item.hash) ?? '',
                    refs: references[pathByHash.get(item.hash) ?? ''] ?? [],
                }))
                .filter(entry => entry.refs.length > 0);
            if (blocked.length > 0 && force !== true) {
                return NextResponse.json(
                    {
                        error: '部分资源仍被引用，已取消删除（确认强删请传 force: true）',
                        blocked,
                    },
                    { status: 409 },
                );
            }
        }

        // 过滤掉要删除的资源
        const originalCount = metadata.metadata.length;
        metadata.metadata = metadata.metadata.filter(item => !resourceHashes.includes(item.hash));
        const deletedCount = originalCount - metadata.metadata.length;

        // 更新资源元数据文件
        await commitFile(
            'src/navsphere/content/resource-metadata.json',
            JSON.stringify(metadata, null, 2),
            `Delete ${deletedCount} resource(s)`,
            authCheck.githubToken || undefined
        );

        return NextResponse.json({
            success: true,
            deletedCount,
            message: `成功删除 ${deletedCount} 个资源`
        });
    } catch (error) {
        console.error('Failed to delete resources:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to delete resources' },
            { status: 500 }
        );
    }
}
