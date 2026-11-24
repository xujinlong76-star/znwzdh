import { NextResponse } from 'next/server';
import { sanitizeForwardedFor } from '@/lib/hub-proxy';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const baseUrl =
    process.env.NAVHUB_STORAGE_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://127.0.0.1:8787';

  const queryString = searchParams.toString();
  const targetUrl = `${baseUrl.replace(/\/$/, '')}/api/search${queryString ? `?${queryString}` : ''}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  const xff = sanitizeForwardedFor(request.headers.get('x-forwarded-for'));
  if (xff) headers['x-forwarded-for'] = xff;

  try {
    const res = await fetch(targetUrl, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Search failed', status: res.status }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    // 安全：不把后端错误细节（堆栈/内网地址/ECONNREFUSED）回显给客户端，仅服务端日志留存
    console.error('[api/search] backend unreachable:', error);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}
