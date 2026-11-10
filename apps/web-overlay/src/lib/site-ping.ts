/**
 * 客户端实时站点连通性与测速探针 (Client-side Real-time Site Reachability & Latency Prober)
 *
 * 解决用户核心痛点：
 * 导航站点的服务端巡检是在远端服务器/云主机上进行的，无法反映用户本机网络环境（如教育网、公司内网、本地 DNS、跨国 CDN 等）。
 * 本探针在用户本地浏览器直接发起轻量无副作用的连接测试，给出毫秒级延迟与连通性判断。
 */

export interface PingResult {
  reachable: boolean
  latencyMs?: number
  quality: 'fast' | 'normal' | 'slow' | 'unreachable'
  label: string
  testedAt: number
  error?: string
}

/**
 * 测速与连通性探针
 */
export async function probeSiteLatency(
  targetUrl: string,
  timeoutMs = 4500,
): Promise<PingResult> {
  const testedAt = Date.now()

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return {
      reachable: false,
      quality: 'unreachable',
      label: '非法网址',
      testedAt,
      error: 'URL 格式错误',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startTime = performance.now()

  try {
    // 采用 no-cors 模式发起探针请求：
    // 不受 CORS 限制即可完成 DNS 解析 + TCP 握手 + TLS 握手 + HTTP 响应头传输
    await fetch(targetUrl, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })

    clearTimeout(timer)
    const latencyMs = Math.max(1, Math.round(performance.now() - startTime))

    let quality: PingResult['quality'] = 'normal'
    let label = `${latencyMs}ms 正常`

    if (latencyMs < 180) {
      quality = 'fast'
      label = `⚡ ${latencyMs}ms 极速`
    } else if (latencyMs > 600) {
      quality = 'slow'
      label = `⏱️ ${latencyMs}ms 较慢`
    }

    return {
      reachable: true,
      latencyMs,
      quality,
      label,
      testedAt,
    }
  } catch (err: unknown) {
    clearTimeout(timer)
    // unknown 收窄：抛出值不一定是 Error（可能是字符串/null），属性访问必须先判定
    const errName = err instanceof Error ? err.name : undefined
    const errMsg = err instanceof Error ? err.message : typeof err === "string" ? err : ""
    const isTimeout = errName === 'AbortError' || errMsg.includes('aborted')
    return {
      reachable: false,
      quality: 'unreachable',
      label: isTimeout ? '⚠️ 连接超时' : '⚠️ 网络不可达',
      testedAt,
      error: isTimeout ? `超过 ${timeoutMs}ms 未响应` : 'DNS 无法解析或连接被拒绝',
    }
  }
}
