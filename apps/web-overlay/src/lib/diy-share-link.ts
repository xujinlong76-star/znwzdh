/**
 * `#diy=` 免登分享链接的编码。
 *
 * 为什么单独抽成一个纯模块：编码失败的原因（循环引用、BigInt、落单的代理项）
 * 都必须能复现、能断言；而调用它的 useCallback 在 node 环境跑不起来
 * （仓库的 vitest 没有 jsdom，也没装 @testing-library/react）。
 * 抽出来之后成功与失败两条路都能拿真实输入测。
 *
 * 关键约定：失败**不返回空串**。空串会被调用方当成「没什么可分享的」，
 * 于是静默吞掉 —— 原来的 `if (!url) return` 就是这个后果：用户点了分享，
 * 界面毫无反应，只能以为按钮坏了。
 */

/** 分享链接的页面基准（只取编码需要的两段，便于纯函数测试） */
export interface ShareLinkBase {
  origin: string
  pathname: string
}

export type ShareLinkOutcome = { ok: true; url: string } | { ok: false; reason: string }

/** 与导入侧（applyHomeDiyShareHash）的 4KB 上限对齐 */
export const SHARE_LINK_MAX_BYTES = 4096

/**
 * 把配置负载编码成 `<origin><pathname>#diy=<base64>`。
 *
 * 两种失败都返回原因，交给调用方展示：
 *   - 序列化/编码抛错（循环引用、BigInt、落单代理项）；
 *   - 编码结果超过 4KB —— 导入侧会直接丢弃，与其让好友打开链接后一脸茫然，
 *     不如在**生成**这一侧就说清楚「太长，请改用复制配置」。
 */
export function encodeShareLink(payload: unknown, base: ShareLinkBase): ShareLinkOutcome {
  if (!base || typeof base.origin !== 'string' || typeof base.pathname !== 'string') {
    return { ok: false, reason: '当前页面地址不完整，没法生成分享链接' }
  }

  let json: string
  try {
    json = JSON.stringify(payload)
  } catch (error) {
    return { ok: false, reason: describeShareLinkFailure(error) }
  }
  if (typeof json !== 'string') {
    // JSON.stringify(undefined) / 函数 → undefined，不是字符串
    return {
      ok: false,
      reason: describeShareLinkFailure(new TypeError('payload is not serializable')),
    }
  }

  let b64: string
  try {
    b64 = btoa(encodeURIComponent(json))
  } catch (error) {
    return { ok: false, reason: describeShareLinkFailure(error) }
  }

  if (b64.length > SHARE_LINK_MAX_BYTES) {
    return {
      ok: false,
      reason: '排版内容太长，超过分享链接 4KB 上限，请改用「复制配置」',
    }
  }

  return { ok: true, url: `${base.origin}${base.pathname}#diy=${b64}` }
}

/** 失败原因 → 一句能给用户看的话（不暴露堆栈） */
export function describeShareLinkFailure(error: unknown): string {
  return error instanceof TypeError
    ? '排版配置里有无法序列化的内容（比如循环引用），没法生成分享链接，请改用「复制配置」'
    : '排版配置没能编码成分享链接，请改用「复制配置」'
}
