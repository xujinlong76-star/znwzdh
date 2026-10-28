import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'DevOps & 云原生架构实战视频教程'
  const author = searchParams.get('author') || '技术专家'
  const time = searchParams.get('time') || '00:00'
  const tag = searchParams.get('tag') || 'Cloud Native'

  const escapeXml = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  const safeTitle = escapeXml(title.slice(0, 50))
  const safeAuthor = escapeXml(author.slice(0, 30))
  const safeTime = escapeXml(time)
  const safeTag = escapeXml(tag)

  const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#09090b" />
      <stop offset="50%" stop-color="#18181b" />
      <stop offset="100%" stop-color="#022c22" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="40" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)" />

  <!-- Ambient Light Circle -->
  <circle cx="1050" cy="150" r="220" fill="#10b981" opacity="0.15" filter="url(#glow)" />
  <circle cx="150" cy="500" r="180" fill="#06b6d4" opacity="0.12" filter="url(#glow)" />

  <!-- Card Border -->
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="none" stroke="#27272a" stroke-width="2" />

  <!-- Tag Pill -->
  <g transform="translate(80, 80)">
    <rect width="180" height="40" rx="20" fill="#10b981" opacity="0.15" />
    <rect width="180" height="40" rx="20" fill="none" stroke="#10b981" stroke-width="1.5" />
    <text x="90" y="25" fill="#34d399" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="bold" text-anchor="middle">
      ${safeTag}
    </text>
  </g>

  <!-- Time Anchor Badge -->
  <g transform="translate(280, 80)">
    <rect width="140" height="40" rx="20" fill="#27272a" opacity="0.8" />
    <text x="70" y="25" fill="#e4e4e7" font-family="monospace" font-size="16" font-weight="bold" text-anchor="middle">
      ⏱ ${safeTime}
    </text>
  </g>

  <!-- Title -->
  <text x="80" y="240" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="bold" width="1040">
    <tspan x="80" dy="0">${safeTitle}</tspan>
  </text>

  <!-- Subtitle Quote -->
  <text x="80" y="340" fill="#a1a1aa" font-family="system-ui, -apple-system, sans-serif" font-size="24">
    云原生技术精选实战 · 生产高可用架构与避坑指南
  </text>

  <!-- Footer Branding -->
  <g transform="translate(80, 480)">
    <!-- Play Icon -->
    <circle cx="30" cy="30" r="28" fill="url(#accent)" />
    <polygon points="24,18 42,30 24,42" fill="#09090b" />

    <text x="76" y="26" fill="#f4f4f5" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="bold">
      ${safeAuthor}
    </text>
    <text x="76" y="48" fill="#71717a" font-family="system-ui, -apple-system, sans-serif" font-size="14">
      DevOps Platform · 实时同步自习室
    </text>
  </g>

  <!-- Live Link -->
  <text x="1080" y="520" fill="#10b981" font-family="monospace" font-size="18" text-anchor="end">
    https://devops.hub/videos
  </text>
</svg>
`

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
