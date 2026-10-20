/**
 * 生产启动安全校验。
 *
 * 为什么不直接改 config.ts：
 *  - 配置装配与身份签名分属两个边界；这里只做「入口拒绝启动」，
 *    便于被 main.ts / 嵌入式 buildServer / 测试分别复用。
 *  - 校验函数接收最小结构，避免把 AppConfig 的全部字段拖进单元测试。
 */

export interface IdentitySecurityConfig {
  authRequired: boolean;
  identitySecret: string | null;
}

/** 身份签名密钥最短长度。HMAC-SHA256 的密钥空间不应低于会话密钥基线。 */
export const MIN_IDENTITY_SECRET_LENGTH = 32;

/**
 * 生产环境开启鉴权时，必须配置足够强的身份签名密钥。
 *
 * 背景：userId/anonId 是请求里的纯字符串。没有签名密钥时，任何持票人都能
 * 自称其他 userId，工作空间、收藏、画像等按身份隔离的数据会退化成 IDOR。
 * 开放模式（authRequired=false）历史行为保持不变，但生产公网部署仍受
 * config.ts 的 AUTH_REQUIRED 公网校验约束。
 *
 * @param config 仅需 authRequired / identitySecret
 * @param isProduction 显式传入便于测试；默认读取 NODE_ENV
 */
export function assertIdentitySecurity(
  config: IdentitySecurityConfig,
  isProduction = (process.env.NODE_ENV ?? "") === "production"
): void {
  if (!isProduction || !config.authRequired) return;

  if (!config.identitySecret) {
    throw new Error(
      "生产环境开启鉴权（NAVHUB_AUTH_REQUIRED=true）时必须设置 NAVHUB_IDENTITY_SECRET" +
        `（至少 ${MIN_IDENTITY_SECRET_LENGTH} 字符），否则已登录用户可伪造 userId/anonId。` +
        " Web 代理与中枢需配置同一密钥。"
    );
  }

  if (config.identitySecret.trim().length < MIN_IDENTITY_SECRET_LENGTH) {
    throw new Error(
      `NAVHUB_IDENTITY_SECRET 长度不足：至少需要 ${MIN_IDENTITY_SECRET_LENGTH} 个非空白字符，` +
        "否则身份签名可被离线暴力破解。"
    );
  }
}
