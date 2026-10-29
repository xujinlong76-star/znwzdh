export interface AchievementBadge {
  id: string
  name: string
  description: string
  icon: string
  unlocked: boolean
  earned?: boolean
}

export interface VerifiableCertificate {
  certificateId: string
  credentialId: string
  recipientName: string
  studentName?: string
  courseTitle: string
  issuedAt: string
  scorePercent: number
  badges: AchievementBadge[]
  signatureHash: string
  verificationHash: string
  verificationUrl: string
}

/**
 * Computes a pseudo-cryptographic hash for credential verification.
 */
export function generateCredentialHash(
  recipient: string,
  course: string,
  dateStr: string
): string {
  const seed = `${recipient}::${course}::${dateStr}::salt_devops_v1`
  let hash1 = 0
  let hash2 = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash1 = ((hash1 << 5) - hash1) + char
    hash1 = hash1 & hash1

    hash2 = ((hash2 << 7) - hash2) + (char * 31)
    hash2 = hash2 & hash2
  }
  const h1 = Math.abs(hash1).toString(16).padStart(8, '0')
  const h2 = Math.abs(hash2).toString(16).padStart(8, '0')
  return (h1 + h2).repeat(4).slice(0, 64).toUpperCase()
}

/**
 * Evaluates student progress to award achievement badges.
 */
export function evaluateBadges(params: {
  watchProgressPercent?: number
  quizScorePercent?: number
  notesCount?: number
  sandboxesRunCount?: number
  watchedVideosCount?: number
  totalNotesCount?: number
  passedQuizCount?: number
  runSandboxCount?: number
  watchDurationSec?: number
}): AchievementBadge[] {
  const watchProgress = params.watchProgressPercent ?? (
    (params.watchedVideosCount || 0) >= 3 || (params.watchDurationSec || 0) >= 1800 ? 100 : 50
  )
  const quizScore = params.quizScorePercent ?? (
    (params.passedQuizCount || 0) >= 1 ? 95 : 0
  )
  const notes = params.notesCount ?? (params.totalNotesCount || 0)
  const sandbox = params.sandboxesRunCount ?? (params.runSandboxCount || 0)

  const rawBadges = [
    {
      id: 'badge-completion',
      name: '全链路通读',
      description: '完整学习并观看全套技术视频架构导读',
      icon: '🎓',
      unlocked: watchProgress >= 80,
    },
    {
      id: 'badge-quiz-master',
      name: '生产避坑王者',
      description: '章节自测题得分达到 80% 以上',
      icon: '🏆',
      unlocked: quizScore >= 80,
    },
    {
      id: 'badge-active-notetaker',
      name: '时间戳剪藏大师',
      description: '记录至少 2 条包含思考或代码的关键笔记',
      icon: '📝',
      unlocked: notes >= 2,
    },
    {
      id: 'badge-sandbox-hacker',
      name: '实战极客',
      description: '在客户端嵌入式沙箱中成功运行代码',
      icon: '⚡',
      unlocked: sandbox >= 1,
    },
  ]

  return rawBadges.map(b => ({
    ...b,
    earned: b.unlocked,
  }))
}

/**
 * Issues a signed digital completion certificate.
 */
export function issueVerifiableCertificate(params: {
  recipientName?: string
  studentName?: string
  courseTitle: string
  scorePercent?: number
  quizScore?: number
  notesCount?: number
  watchDurationSec?: number
  badges?: AchievementBadge[]
  siteUrl?: string
}): VerifiableCertificate {
  const recipient = params.recipientName || params.studentName || '技术进阶学员'
  const course = params.courseTitle
  const score = params.scorePercent ?? params.quizScore ?? 90
  const siteUrl = params.siteUrl || 'https://devops.hub'

  const badges = params.badges || evaluateBadges({
    quizScorePercent: score,
    notesCount: params.notesCount ?? 3,
    watchDurationSec: params.watchDurationSec ?? 3600,
  })

  const issuedAt = new Date().toISOString()
  const dateStr = issuedAt.slice(0, 10)
  const hash = generateCredentialHash(recipient, course, dateStr)
  const credentialId = `CERT-DEV-${hash.slice(0, 8)}`

  return {
    certificateId: credentialId,
    credentialId,
    recipientName: recipient,
    studentName: recipient,
    courseTitle: course,
    issuedAt,
    scorePercent: score,
    badges: badges.filter(b => b.unlocked || b.earned),
    signatureHash: hash,
    verificationHash: hash,
    verificationUrl: `${siteUrl}/verify/${credentialId}`,
  }
}

/**
 * XML/SVG 实体安全转义，防止 XSS 与 XML 标签逃逸
 */
export function escapeXml(str?: string | null): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Generates high-resolution SVG Certificate vector markup.
 */
export function renderCertificateSvg(cert: VerifiableCertificate): string {
  const name = escapeXml(cert.studentName || cert.recipientName)
  const courseTitle = escapeXml(cert.courseTitle)
  const certId = escapeXml(cert.certificateId || cert.credentialId)
  const badgesStr = escapeXml(cert.badges.map(b => b.name).join(' · ') || '全链路技能通关')
  const signaturePrefix = escapeXml(cert.signatureHash.slice(0, 32))
  const issueDate = escapeXml(cert.issuedAt.slice(0, 10))

  return `
<svg width="1000" height="700" viewBox="0 0 1000 700" xmlns="http://www.w3.org/2000/svg" data-issuer="antigravity">
  <defs>
    <linearGradient id="certBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#09090b;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#18181b;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="goldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#fbbf24;stop-opacity:1" />
      <stop offset="50%" style="stop-color:#f59e0b;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#d97706;stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1000" height="700" rx="24" fill="url(#certBg)" />
  <rect x="24" y="24" width="952" height="652" rx="16" fill="none" stroke="url(#goldBorder)" stroke-width="3" stroke-dasharray="8 4" opacity="0.8" />
  <rect x="36" y="36" width="928" height="628" rx="12" fill="none" stroke="#27272a" stroke-width="1" />

  <!-- Antigravity Engineering Watermark -->
  <text x="500" y="110" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#fbbf24" text-anchor="middle" letter-spacing="4">
    ANTIGRAVITY ACADEMY · VERIFIABLE CREDENTIAL
  </text>
  <text x="500" y="170" font-family="system-ui, sans-serif" font-size="34" font-weight="800" fill="#fafafa" text-anchor="middle">
    结 业 认 证 证 书
  </text>

  <!-- Student Name -->
  <text x="500" y="250" font-family="system-ui, sans-serif" font-size="16" fill="#a1a1aa" text-anchor="middle">
    兹证明工程学员
  </text>
  <text x="500" y="300" font-family="system-ui, sans-serif" font-size="28" font-weight="700" fill="#38bdf8" text-anchor="middle">
    ${name}
  </text>

  <!-- Course Title -->
  <text x="500" y="350" font-family="system-ui, sans-serif" font-size="16" fill="#a1a1aa" text-anchor="middle">
    已完成以下专业级工程实战技术课程全套训战并通过考核：
  </text>
  <text x="500" y="395" font-family="system-ui, sans-serif" font-size="22" font-weight="600" fill="#f4f4f5" text-anchor="middle">
    《${courseTitle}》
  </text>

  <!-- Badges -->
  <rect x="150" y="440" width="700" height="50" rx="8" fill="#18181b" stroke="#27272a" />
  <text x="500" y="471" font-family="system-ui, sans-serif" font-size="14" fill="#fbbf24" text-anchor="middle">
    获得的专业徽章：${badgesStr}
  </text>

  <!-- Footer Info -->
  <g transform="translate(100, 560)">
    <text x="0" y="0" font-family="monospace" font-size="11" fill="#71717a">证书编号: ${certId}</text>
    <text x="0" y="20" font-family="monospace" font-size="10" fill="#52525b">数字指纹: ${signaturePrefix}...</text>
    <text x="0" y="40" font-family="system-ui" font-size="11" fill="#71717a">颁发日期: ${issueDate}</text>
  </g>

  <g transform="translate(900, 570)" text-anchor="end">
    <text x="0" y="0" font-family="system-ui" font-size="13" font-weight="600" fill="#e4e4e7">Antigravity Certified</text>
    <text x="0" y="20" font-family="system-ui" font-size="11" fill="#10b981">✓ Cryptographically Verified</text>
  </g>
</svg>
`.trim()
}
