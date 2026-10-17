'use client'

/**
 * 根级错误边界（root layout / providers 抛错时兜底）。
 *
 * 之前没有这个文件：一旦 `layout.tsx` 或全局 providers 抛错，用户看到的是
 * Next 内置的**无样式**兜底页（"Application error: a client-side exception has
 * occurred..."），整站观感瞬间崩塌，也没有任何出口。
 *
 * 约束与取舍：
 *  - 本文件替换根布局，必须自己渲染 `<html>` / `<body>`；
 *  - 样式一律内联（根布局里的全局样式此时不可靠），并使用 light/dark 都能看的配色；
 *  - 不用 Next 的 Link 组件（应用本身已出错），返回主页走整页跳转；
 *  - 文案同样走 `lib/error-report.ts`，与 error.tsx 保持一致的解释口径。
 */

import { crashReportText, describeCrash } from '@/lib/error-report'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const crash = describeCrash(error, error?.digest)

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0f14',
          color: '#e6edf3',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
          padding: '24px',
        }}
      >
        <main
          id="main-content"
          style={{
            width: '100%',
            maxWidth: '30rem',
            border: '1px solid rgba(248,113,113,0.35)',
            background: 'rgba(248,113,113,0.06)',
            borderRadius: '20px',
            padding: '32px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '40px', lineHeight: 1 }} aria-hidden="true">
            ⚠️
          </div>
          <p
            style={{
              display: 'inline-block',
              margin: '16px 0 8px',
              padding: '2px 10px',
              borderRadius: '999px',
              border: '1px solid rgba(248,113,113,0.4)',
              background: 'rgba(248,113,113,0.12)',
              color: '#fca5a5',
              fontSize: '11px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: '0.04em',
            }}
          >
            {crash.badge}
          </p>
          <h1 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 700 }}>{crash.title}</h1>
          <p style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.7, color: '#9fb0c0' }}>
            {crash.hint}
          </p>

          {crash.digest && (
            <p style={{ margin: '0 0 16px', fontSize: '12px', color: '#9fb0c0' }}>
              错误编号{' '}
              <code
                style={{
                  padding: '2px 6px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {crash.digest}
              </code>
            </p>
          )}

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {crash.retryable && (
              <button
                onClick={() => reset()}
                style={{
                  cursor: 'pointer',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#e6edf3',
                  color: '#0b0f14',
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                重新加载
              </button>
            )}
            <button
              onClick={() => {
                // 根布局已出错，客户端路由状态不可信：整页跳到主页更可靠
                window.location.assign('/')
              }}
              style={{
                cursor: 'pointer',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'transparent',
                color: '#e6edf3',
                padding: '8px 16px',
                fontSize: '13px',
              }}
            >
              返回主页
            </button>
          </div>

          {(crash.detail || crash.digest) && (
            <details style={{ marginTop: '20px', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', fontSize: '12px', color: '#9fb0c0' }}>
                错误详情（反馈时复制给站长）
              </summary>
              <pre
                style={{
                  margin: '8px 0 0',
                  padding: '10px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontSize: '11px',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: '#9fb0c0',
                  maxHeight: '10rem',
                  overflowY: 'auto',
                }}
              >
                {crashReportText(crash)}
              </pre>
            </details>
          )}
        </main>
      </body>
    </html>
  )
}
