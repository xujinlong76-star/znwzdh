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
  /**
   * 生产开放模式显式承认「身份未签名」。
   * 默认 false：生产环境缺少 identitySecret 即拒绝启动；仅 authRequired=false 时可豁免。
   */
  allowUnsignedIdentity?: boolean;
}

/** 身份签名密钥最短长度。HMAC-SHA256 的密钥空间不应低于会话密钥基线。 */
export const MIN_IDENTITY_SECRET_LENGTH = 32;

/**
 * 生产环境不信任未签名身份：缺少密钥时必须显式承认，否则拒绝启动。
 *
 * 背景：userId/anonId 是请求里的纯字符串。没有签名密钥时，任何请求都能
 * 自称其他 userId，工作空间、收藏、画像等按身份隔离的数据会退化成 IDOR。
 * 鉴权开启时密钥是硬要求；开放模式此前是隐式放行，现在改为
 * `NAVHUB_ALLOW_UNSIGNED_IDENTITY=1` 显式 opt-out（内网 / NAS 的合法退路）。
 *
 * @param config 仅需 authRequired / identitySecret / allowUnsignedIdentity
 * @param isProduction 显式传入便于测试；默认读取 NODE_ENV
 */
export function assertIdentitySecurity(
  config: IdentitySecurityConfig,
  isProduction = (process.env.NODE_ENV ?? "") === "production"
): void {
  if (!isProduction) return;

  if (config.identitySecret) {
    if (config.identitySecret.trim().length < MIN_IDENTITY_SECRET_LENGTH) {
      throw new Error(
        `NAVHUB_IDENTITY_SECRET 长度不足：至少需要 ${MIN_IDENTITY_SECRET_LENGTH} 个非空白字符，` +
          "否则身份签名可被离线暴力破解。"
      );
    }
    return;
  }

  if (config.authRequired) {
    throw new Error(
      "生产环境开启鉴权（NAVHUB_AUTH_REQUIRED=true）时必须设置 NAVHUB_IDENTITY_SECRET" +
        `（至少 ${MIN_IDENTITY_SECRET_LENGTH} 字符），否则已登录用户可伪造 userId/anonId。` +
        " Web 代理与中枢需配置同一密钥。"
    );
  }

  if (!config.allowUnsignedIdentity) {
    throw new Error(
      "生产环境未配置 NAVHUB_IDENTITY_SECRET：带 userId/anonId 的请求可自称任意身份（IDOR）。" +
        "请二选一：① 设 NAVHUB_AUTH_REQUIRED=true 并配置至少 " +
        `${MIN_IDENTITY_SECRET_LENGTH} 字符的 NAVHUB_IDENTITY_SECRET（推荐）；` +
        "② 确为内网 / NAS 开放模式，显式设 NAVHUB_ALLOW_UNSIGNED_IDENTITY=1 承认该风险后重启。"
    );
  }

  console.warn(
    "[navhub] 警告：生产环境显式允许无签名身份（NAVHUB_ALLOW_UNSIGNED_IDENTITY=1）——" +
      "任何请求都可以自称任意 userId/anonId，请勿用于公网部署。"
  );
}
