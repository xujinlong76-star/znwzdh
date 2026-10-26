/**
 * 登录失败的分类：**「你密码不对」和「服务坏了」必须分开说**。
 *
 * 真实缺陷（app/auth/signin/page.tsx）：
 *
 *  1. `signIn()` 只要返回 `error` 就写成「密码或 Token 凭证错误」。但 next-auth 在
 *     **服务端配置错误**时返回的是 `Configuration`，HTTP 层则是 500 —— 这两类与用户
 *     的输入毫无关系。用户于是反复重打密码、试 Token，而问题在服务端（例如缺少
 *     AUTH_SECRET）。这正是本项目其它页面已经修过的同一类错误：把故障说成事实。
 *  2. 兜底分支是
 *
 *         } else {
 *           setIsLoading(false)
 *         }
 *
 *     —— **一个字都不说**。点下去、转圈停止、什么也没发生：用户既不知道失败，
 *     也不知道该做什么（这是最糟的一种降级）。
 *
 * 判定抽成纯函数：UI 只负责把 message 渲染出来，两个入口（表单提交 / URL 回跳的
 * error 参数）共用同一套文案，不会各自漂移。
 */

/** next-auth `signIn()` 的返回形状（只取我们关心的几个字段） */
export interface SignInResultLike {
  error?: string | null
  ok?: boolean
  status?: number
}

export interface SignInFailureNotice {
  /** 面向用户的一句话，可直接渲染 */
  message: string
  /**
   * 是否应该把问题指向「用户的输入」。
   * true  = 凭证不对/被拒（用户需要改输入）
   * false = 服务端或网络的问题（用户改输入没用，应该重试或找管理员）
   */
  userInput: boolean
  /** 值不值得再试一次 */
  retryable: boolean
}

/** 网络层根本连不上时用这个（`signIn` 抛异常，而不是返回结果） */
export const NETWORK_FAILURE_STATUS = 0

export const PASSWORD_MISMATCH =
  "管理员账号密码或 Token 不匹配。请重新输入（默认口令 admin123，或留空直接快捷进入）。";

export const ACCESS_DENIED =
  "该账号不在管理员白名单 (NAVHUB_ADMIN_IDS) 中，因此无法访问后台。请换用白名单内的账号。";

export const OAUTH_BROKEN =
  "GitHub 授权登录未能完成（可能是 OAuth 应用配置或回调地址不对）。可以改用管理密码登录。";

const SERVER_BROKEN_HINT = "这不是你的密码问题";

/** 收到了「失败」但没有原因时的兜底 —— 不猜是密码错 */
const UNKNOWN_FAILURE =
  "登录失败，但没有收到具体原因（服务端可能未按预期返回）。请重试一次；若持续出现，请检查后台认证配置。";

/**
 * 一次 signIn 结果是否真的成功。
 *
 * next-auth v5 的坑：凭证校验失败时 HTTP 仍是 200（`res.ok === true`），失败
 * 只体现在 `res.error`（如 `CredentialsSignin`）。只判 `ok` 会把失败当成功，
 * 跳去受保护路由再被代理弹回登录页——错误提示就此丢失，用户只看到「点了没反应」。
 */
export function isSignInSuccess(result?: SignInResultLike | null): boolean {
  return Boolean(result?.ok && !result.error)
}

/**
 * 把一次失败的登录请求翻译成一句「用户据此能行动」的话。
 *
 * 判定顺序刻意如此：先排除「根本不是用户输入的问题」（网络 / 5xx / Configuration），
 * 再谈凭证，最后才是兜底。
 */
export function describeSignInFailure(result?: SignInResultLike | null): SignInFailureNotice {
  // ① 什么都没返回：网络中断、被拦截、服务没响应 —— 不能当成密码错误
  if (!result) {
    return {
      message: "登录请求没有返回任何结果（网络中断或服务未响应）。请重试一次。",
      userInput: false,
      retryable: true,
    };
  }

  const status = typeof result.status === "number" ? result.status : null;
  const error = typeof result.error === "string" ? result.error : "";

  // ② 网络不可达（页面在 catch 里用 status=0 表示）
  if (status === NETWORK_FAILURE_STATUS) {
    return {
      message: "无法连接登录服务（网络不可达或服务未启动）。请检查网络后重试。",
      userInput: false,
      retryable: true,
    };
  }

  // ③ 服务端坏了：5xx / next-auth 的 Configuration / 回调阶段炸了
  const serverBroken =
    (status !== null && status >= 500) ||
    error === "Configuration" ||
    error === "Callback" ||
    error === "OAuthCreateAccount";
  if (serverBroken) {
    const code = status !== null && status >= 500 ? `HTTP ${status}` : error || "未知";
    return {
      message: `登录服务端未正确配置或暂时不可用（${code}）。${SERVER_BROKEN_HINT}，请联系管理员检查认证配置（如 AUTH_SECRET）。`,
      userInput: false,
      retryable: true,
    };
  }

  // ④ 被白名单拒绝：与密码无关，换账号才能解决，重试没意义
  if (error === "AccessDenied" || status === 403) {
    return { message: ACCESS_DENIED, userInput: true, retryable: false };
  }

  // ⑤ OAuth 相关：本地密码登录仍然可用，所以给一条备选路径
  if (error === "OAuthSignin" || error === "OAuthCallback" || error === "OAuthCallbackError") {
    return { message: OAUTH_BROKEN, userInput: false, retryable: true };
  }

  // ⑥ 凭证不对（401 / CredentialsSignin）—— 这才是「密码问题」
  if (error === "CredentialsSignin" || status === 401) {
    return { message: PASSWORD_MISMATCH, userInput: true, retryable: true };
  }

  // ⑦ 收到失败但没有任何原因码：**不猜**是密码错，也不静默
  if (!error) {
    return { message: UNKNOWN_FAILURE, userInput: false, retryable: true };
  }

  // ⑧ 其它未知错误码：带上原始码，别把它伪装成已知原因
  return {
    message: `登录失败（${error}）。请重试；若持续出现，请检查后台认证配置。`,
    userInput: false,
    retryable: true,
  };
}
