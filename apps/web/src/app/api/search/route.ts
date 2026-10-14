import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const baseUrl =
    process.env.NAVHUB_STORAGE_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://127.0.0.1:8787';

  const queryString = searchParams.toString();
  const targetUrl = `${baseUrl.replace(/\/$/, '')}/api/search${queryString ? `?${queryString}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Search failed', status: res.status }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Backend unreachable', details: String(error) }, { status: 502 });
  }
}
