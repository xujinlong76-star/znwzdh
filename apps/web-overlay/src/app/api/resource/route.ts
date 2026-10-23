import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { commitFile, getFileContent } from '@/lib/github'
import type { ResourceMetadata } from '@/types/resource-metadata'
import { uint8ArrayToBase64 } from '@/lib/buffer-utils'

export const runtime = 'nodejs'

const MAX_IMAGE_BASE64_LEN = 7 * 1024 * 1024 // ~5MB binary

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
        const base64Data = image.split(",")[1] || '';
        if (!base64Data || base64Data.length > MAX_IMAGE_BASE64_LEN) {
            return NextResponse.json({ error: '图片内容为空或超出 5MB 大小限制' }, { status: 413 });
        }

        const safeFolder = sanitizeRepoPathSegment(folder, 'assets');
        const safePrefix = sanitizeFilePrefix(prefix, 'img');
        const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

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
    const response = await fetch(currentFileUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
            message: `Upload ${githubPath}`,
            content: base64String,
            branch: branch,
        }),
    });
    if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to upload image to GitHub:', errorData);
        throw new Error(`Failed to upload image to GitHub: ${errorData.message || 'Unknown error'}`);
    }

    const responseData = await response.json();
    const commitHash = responseData.commit.sha;

    return { path, commitHash };
}

export async function DELETE(request: Request) {
    try {
        const authCheck = await verifyAdminSession();
        if (!authCheck.ok) {
            return new Response(authCheck.error, { status: authCheck.status });
        }

        const { resourceHashes } = await request.json();

        if (!Array.isArray(resourceHashes) || resourceHashes.length === 0) {
            return NextResponse.json({ error: 'Invalid resource hashes' }, { status: 400 });
        }

        // 获取当前的资源元数据
        const metadata = await getFileContent('src/navsphere/content/resource-metadata.json') as ResourceMetadata;

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
