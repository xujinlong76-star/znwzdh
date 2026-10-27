/**
 * 授权判定的纯函数层（零 IO，可被 REST / MCP / 前端复用）。
 *
 * 为什么单独抽出来：`apps/api/src/auth.ts` 的 `scopeSatisfies` 只回答
 * 「这枚令牌够不够某个等级」，它无法表达「同一个 write 等级，在用户域可用、
 * 在实例域不可用」。个人令牌（api_tokens.owner_identity 非空）正是这种形状：
 *
 *   - 用户域写面（收藏/历史/画像/金库/工作区/CRDT）——路由 scope 是 public，
 *     真正的闸门是 `userDomainWriteAllowed`，个人 write 令牌应当放行；
 *   - 实例域写面（站点/类目/标签/合集/任务/插件治理）——路由 scope 是 write，
 *     个人令牌**不得**借同一个 write 等级越权。
 *
 * 把这条规则写成纯函数而不是散落在路由里：路由会新增，规则只有一份；
 * 单测可以枚举「路径 × 令牌类型 × 要求等级」的矩阵，漏判即红。
 */
import { isPersonalUserWritePath } from "./route-policy.ts";

export { PERSONAL_TOKEN_WRITE_ROUTES } from "./route-policy.ts";

/** 路由要求的等级（与 apps/api 的 RouteScope 对齐，public 不进入判定） */
export type AuthzRequirement = "read" | "write" | "admin";

export interface InstanceWriteContext {
  /** 令牌是否绑定到某个终端用户（api_tokens.owner_identity 非空） */
  ownerScoped: boolean;
  /** 路由声明的等级 */
  required: AuthzRequirement;
  /** 原始请求路径（含 query 也无妨，只取 pathname 部分） */
  path: string;
}

export interface AuthzDecision {
  allowed: boolean;
  /** 拒绝原因，用于审计与错误文案；allowed=true 时为 null */
  reason: "personal_token_instance_write" | null;
}

/** 去掉 query / hash，只保留 pathname；非法输入返回空串（调用方按拒绝处理） */
export function pathnameOf(url: string): string {
  if (typeof url !== "string" || url.length === 0) return "";
  const cut = url.search(/[?#]/);
  const path = cut === -1 ? url : url.slice(0, cut);
  // 只接受以 / 开头的站内路径；绝对 URL 或畸形输入一律视为不可信
  return path.startsWith("/") ? path : "";
}

/**
 * 个人令牌的 write 是否允许落在该路径上。
 * 注意：用户域路由多为 public scope，不会走到这里；本函数只处理
 * 「声明为 write 级、但语义属于用户域」的少数路由。
 */
export function isPersonalWritePath(url: string): boolean {
  const path = pathnameOf(url);
  if (!path) return false;
  return isPersonalUserWritePath(path);
}

/**
 * 实例写面的唯一判定入口。
 *
 * 规则只有一条：**个人令牌不得通过 write 等级触达实例域**。
 * read/admin 不在此处收窄——admin 本来就是实例级凭据，read 没有写副作用。
 *
 * 「哪条 write 路由算用户域」不在这里猜：由 route-policy 的登记表决定，
 * 未登记的一律按实例域处理（默认拒绝）。所以新增写路由不需要在这里改代码，
 * 也不会因为忘记登记而被个人令牌越权触达。
 */
export function evaluateInstanceWrite(ctx: InstanceWriteContext): AuthzDecision {
  if (ctx.required !== "write") return { allowed: true, reason: null };
  if (!ctx.ownerScoped) return { allowed: true, reason: null };
  if (isPersonalWritePath(ctx.path)) return { allowed: true, reason: null };
  return { allowed: false, reason: "personal_token_instance_write" };
}
