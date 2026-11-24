'use client'

/**
 * 仿冒比对页（拦截页，W2）。
 *
 * 路由 /verify，参数 ?brand=<规范域名>&domain=<用户点的域名>。
 * 内容全部来自公开事实：品牌名、规范域名、来源链接来自
 * `verified-brands.ts`（50 家、核查日期 2026-11-24）；注册时间与证书
 * 时间在核实数据里没有，本页只写“未公开/未查到”，不编；安全状态只
 * 转述 GET /api/safe-browsing?url=... 返回的原样结论，无数据写
 * “未查到”，本页不写自封的安全结论。
 *
 * 硬线：
 * - 绝不自动跳转：不用路由跳转、不写刷新跳转、不写定时跳转。
 * - 两个出口始终可见：主按钮「回官网」（https:// + 规范域名），
 *   次按钮「自行继续」（用户点的域名，target _blank rel noopener，
 *   旁边一句“你将离开本站，前往未经核实的域名”）。
 * - 不记录用户点了什么：不写库、不写浏览器本地存储、不发统计。
 * 版式参考 app/compare/page.tsx（Container + Footer + Button）。
 */

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import {
  VERIFIED_BRANDS_CHECKED_AT,
  diffDomains,
  parseVerifyParams,
  type DiffSegment,
} from './domain-diff'

type SafeBrowsingState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'done'; conclusion: string }

/** 只取接口返回的原样结论字符串；取不到就当未查到，不自行推断。 */
function pickConclusion(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  for (const key of ['conclusion', 'verdict', 'result', 'summary'] as const) {
    const value = (payload as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

type CertificateState = {
  validFrom: string | null
  validTo: string | null
  issuer: string | null
} | null

/**
 * 只取接口返回的证书原值：certificate 是 { certificate, reason } 的
 * 查找结果，内层才是证书对象；直给证书对象时也认。有效期与签发者
 * 全无时当未查到，不编。
 */
function pickCertificate(payload: unknown): CertificateState {
  if (!payload || typeof payload !== 'object') return null
  const outer = (payload as Record<string, unknown>).certificate
  if (!outer || typeof outer !== 'object') return null
  const inner = (outer as Record<string, unknown>).certificate
  const cert = inner && typeof inner === 'object' ? inner : outer
  const record = cert as Record<string, unknown>
  const validFrom = typeof record.validFrom === 'string' ? record.validFrom : null
  const validTo = typeof record.validTo === 'string' ? record.validTo : null
  const issuer =
    typeof record.issuer === 'string' && record.issuer.trim()
      ? record.issuer
      : typeof record.issuerOrganization === 'string' && record.issuerOrganization.trim()
        ? record.issuerOrganization
        : null
  if (!validFrom && !validTo && !issuer) return null
  return { validFrom, validTo, issuer }
}

function SafeBrowsingBlock({ url, onCertificate }: { url: string; onCertificate: (cert: CertificateState) => void }) {
  const [state, setState] = useState<SafeBrowsingState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    fetch(`/api/safe-browsing?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setState({
            status: 'unavailable',
            reason: '安全查询接口未返回结果（接口可能尚未上线）。',
          })
          return
        }
        const payload = await res.json().catch(() => null)
        onCertificate(pickCertificate(payload))
        const conclusion = pickConclusion(payload)
        if (!conclusion) {
          setState({
            status: 'unavailable',
            reason: '接口未返回可转述的结论。',
          })
          return
        }
        setState({ status: 'done', conclusion })
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: 'unavailable',
            reason: '安全查询接口未返回结果。',
          })
        }
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [url, onCertificate])

  return (
    <section aria-label="安全状态" className="rounded-xl border border-border/70 bg-card p-5 space-y-2">
      <h2 className="text-sm font-semibold text-foreground">安全状态</h2>
      {state.status === 'loading' ? (
        <p className="text-sm leading-relaxed text-muted-foreground">正在向 Google Safe Browsing 查询…</p>
      ) : state.status === 'done' ? (
        <>
          <p className="text-sm leading-relaxed text-foreground">“{state.conclusion}”</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            来源：Google Safe Browsing（本站 /api/safe-browsing 接口返回的原样结论）。
          </p>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-foreground">未查到</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {state.reason}本页不据此作任何安全判断。
          </p>
        </>
      )}
    </section>
  )
}

function DomainLine({ label, segments }: { label: string; segments: DiffSegment[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base sm:text-lg font-mono break-all leading-relaxed text-foreground">
        {segments.map((seg, i) =>
          seg.same ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <mark
              key={i}
              className="rounded px-0.5 bg-amber-200 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100"
            >
              {seg.text}
            </mark>
          ),
        )}
      </p>
    </div>
  )
}

const PARAM_ERROR_TEXT: Record<string, string> = {
  'missing-brand':
    '缺少 brand 参数：请从品牌官方卡片进入本页，本页只核对已核实 50 家品牌的官网域名。',
  'unknown-brand':
    '这个品牌不在已核实的 50 家名单里，本页无法确认它的官网地址，也不会猜测一个给你。',
  'missing-domain': '缺少 domain 参数：没有要核对的域名，本页无法对照。',
}

function VerifyPageBody() {
  const searchParams = useSearchParams()
  const parsed = parseVerifyParams(searchParams.get('brand'), searchParams.get('domain'))
  // 证书信息来自同一份 /api/safe-browsing 返回，由 SafeBrowsingBlock 回报；
  // 域名注册时间没有任何数据源，始终写“未查到”。
  const [certificate, setCertificate] = useState<CertificateState>(null)

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 max-w-3xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">核对官网域名</h1>
          <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
            先对一下域名再决定去哪：下面是已核实的官网域名，和你点的域名逐字对照。
          </p>
        </header>

        {parsed.error ? (
          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">还不能开始核对</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {PARAM_ERROR_TEXT[parsed.error]}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              核查日期：{VERIFIED_BRANDS_CHECKED_AT}。本页只收已核实的 50 家品牌，不扩。
            </p>
          </div>
        ) : (
          <>
            <section
              aria-label="品牌与域名"
              className="rounded-xl border border-border/70 bg-card p-5 space-y-4"
            >
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">品牌</p>
                <p className="text-xl sm:text-2xl font-bold text-foreground">{parsed.brand.name}</p>
                {parsed.brand.note ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{parsed.brand.note}</p>
                ) : null}
              </div>
              <DomainLine label="官网域名" segments={diffDomains(parsed.brand.canonicalDomain, parsed.clickedDomain).canonical} />
              <DomainLine label="你点的域名" segments={diffDomains(parsed.brand.canonicalDomain, parsed.clickedDomain).clicked} />
              <p className="text-sm leading-relaxed text-foreground">
                {parsed.identical
                  ? '两个域名逐字一致。'
                  : `两个域名逐字对照：${diffDomains(parsed.brand.canonicalDomain, parsed.clickedDomain).differingLabels} 处标签不同，高亮处即差异。`}
              </p>
            </section>

            <section
              aria-label="注册时间与证书时间"
              className="rounded-xl border border-border/70 bg-card p-5 space-y-2"
            >
              <h2 className="text-sm font-semibold text-foreground">注册时间与证书时间</h2>
              {certificate ? (
                <p className="text-sm leading-relaxed text-foreground">
                  域名注册时间：未公开/未查到；证书有效期：
                  {certificate.validFrom && certificate.validTo
                    ? `${certificate.validFrom}–${certificate.validTo}`
                    : (certificate.validFrom ?? certificate.validTo ?? '未查到')}
                  ；签发者：{certificate.issuer ?? '未查到'}。
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-foreground">
                  域名注册时间：未公开/未查到；证书有效期：未公开/未查到。
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                已核实品牌数据（核查日期 {VERIFIED_BRANDS_CHECKED_AT}）未包含这两项，本页不编造；
                可自行通过域名注册商 WHOIS 与浏览器证书查看器核对。
              </p>
            </section>

            <SafeBrowsingBlock url={parsed.clickedUrl} onCertificate={setCertificate} />

            <p className="text-xs leading-relaxed text-muted-foreground">
              核查日期：{VERIFIED_BRANDS_CHECKED_AT}；官网来源：
              <a
                href={parsed.brand.source}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {parsed.brand.source}
              </a>
            </p>
          </>
        )}

        {/* 两个出口：始终可见。主按钮去官网，次按钮去用户点的域名（新标签页）。 */}
        <div className="sticky bottom-0 rounded-xl border border-border/70 bg-card/95 backdrop-blur p-4 space-y-2 shadow-sm">
          {parsed.error || !parsed.officialUrl ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              未确认品牌，无法确定官网地址，因此「回官网」暂不可用。
            </p>
          ) : null}
          <div className="flex flex-col sm:flex-row gap-2">
            {parsed.officialUrl ? (
              <Button asChild size="lg" className="flex-1">
                <a href={parsed.officialUrl}>回官网</a>
              </Button>
            ) : (
              <Button size="lg" className="flex-1" disabled aria-disabled="true">
                回官网
              </Button>
            )}
            {parsed.clickedUrl ? (
              <Button asChild size="lg" variant="outline" className="flex-1">
                <a href={parsed.clickedUrl} target="_blank" rel="noopener noreferrer">
                  自行继续
                </a>
              </Button>
            ) : (
              <Button size="lg" variant="outline" className="flex-1" disabled aria-disabled="true">
                自行继续
              </Button>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {parsed.clickedUrl
              ? '点「自行继续」，你将离开本站，前往未经核实的域名。'
              : '未提供要去的域名，因此「自行继续」暂不可用。'}
            <Link href="/" className="underline underline-offset-2">
              返回本站首页
            </Link>
          </p>
        </div>
      </div>
      <Footer />
    </Container>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground px-4 py-6">正在加载核对页…</p>}>
      <VerifyPageBody />
    </Suspense>
  )
}
