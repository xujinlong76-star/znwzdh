import { NextResponse } from 'next/server';
import { sanitizeForwardedFor } from '@/lib/hub-proxy';
import { buildPinnedHubUrl, guardedFetch, hubGuardOptions, SsrfBlockedError } from '@/lib/ssrf-guard';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const baseUrl =
    process.env.NAVHUB_STORAGE_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://127.0.0.1:8787';

  const queryString = searchParams.toString();

  const headers: Record<string, string> = { Accept: 'application/json' };
  const xff = sanitizeForwardedFor(request.headers.get('x-forwarded-for'));
  if (xff) headers['x-forwarded-for'] = xff;

  try {
    // SSRF 2026-11-25：查询串（用户可控）只进 URL 的 search 部分，host 钉死到
    // baseUrl 的 hostname；出站走 guardedFetch，重定向逐跳复验 host+端口，
    // 不再字符串拼接 + 默认跟随重定向的裸 fetch。
    const targetUrl = buildPinnedHubUrl(
      baseUrl,
      ['search'],
      queryString ? `?${queryString}` : '',
    ).toString();
    const { response: res } = await guardedFetch(
      targetUrl,
      { ...hubGuardOptions(baseUrl), timeoutMs: 10_000, maxBytes: 16 * 1024 * 1024 },
      {
        headers,
        cache: 'no-store',
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'Search failed', status: res.status }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    // SSRF 2026-11-25：重定向逃离钉死的 host，403 明说，不写成 502 上游故障。
    if (error instanceof SsrfBlockedError) {
      return NextResponse.json({ error: '上游重定向目标不在允许范围内' }, { status: 403 });
    }
    // 安全：不把后端错误细节（堆栈/内网地址/ECONNREFUSED）回显给客户端，仅服务端日志留存
    console.error('[api/search] backend unreachable:', error);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}
