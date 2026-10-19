/**
 * 代理侧：为终端用户身份附加 HMAC 签名。
 *
 * 对应中枢的 `apps/api/src/identity-signature.ts`。身份（`userId` / `anonId`）
 * 此前是纯字符串、可任意自称，中枢配置 `NAVHUB_IDENTITY_SECRET` 后会要求
 * `x-navhub-identity-signature = HMAC-SHA256(secret, identity)`；本模块负责在
 * 转发前算好这个头。
 *
 * 三条必须与中枢严格对齐的规则（对不上就会出现「签名了但校验不过」的 401）：
 *  1. 取值优先级：query.userId → query.anonId → JSON body.userId → body.anonId
 *     （中枢 `identityOf` 的顺序：Header → Query → Body；身份头不在代理的转发白名单里，
 *      所以中枢实际只会看到 Query/Body，这里按同一顺序取值即可）
 *  2. 截断规则：中枢取到后 `slice(0, 64)`
 *  3. 编码：HMAC-SHA256 输出小写 hex
 *
 * 未配置密钥时返回 null，代理不加任何头，中枢也不校验 —— 行为与历史版本一致。
 */

export function hubIdentitySecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.NAVHUB_IDENTITY_SECRET
  return secret && secret.length > 0 ? secret : null
}

/** 与中枢 identityOf 对齐地从请求中取出待签名身份（无身份返回 null） */
export function identityFromRequest(
  url: URL,
  rawBody?: string,
  headers?: Headers | Record<string, string | null | undefined>,
): string | null {
  // 与中枢 identityOf 同序：Header 优先，其次 Query，最后 Body
  const getHeader = (name: string): string | null => {
    if (!headers) return null
    if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name)
    const record = headers as Record<string, string | null | undefined>
    return record[name] ?? record[name.toLowerCase()] ?? null
  }
  const fromHeader =
    getHeader('x-navhub-user-id') ??
    getHeader('x-user-id') ??
    getHeader('x-navhub-anon-id') ??
    getHeader('x-anon-id')
  if (fromHeader) return fromHeader.slice(0, 64)

  const fromQuery = url.searchParams.get('userId') ?? url.searchParams.get('anonId')
  if (fromQuery) return fromQuery.slice(0, 64)

  if (!rawBody) return null
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown> | null
    const v = parsed?.userId ?? parsed?.anonId
    return typeof v === 'string' && v ? v.slice(0, 64) : null
  } catch {
    // 非 JSON body（表单/纯文本）：没有可签的身份
    return null
  }
}

/**
 * HMAC-SHA256(secret, identity) → 小写 hex。
 *
 * 用 Web Crypto 而不是 `node:crypto`：同样的代码在 Node 与 edge 运行时都能跑，
 * 不给「哪天这个路由被改成 edge」埋雷。
 */
export async function signIdentity(secret: string, identity: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(identity))
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('')
}
