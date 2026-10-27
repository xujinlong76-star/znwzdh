/**
 * 授权策略表：路由 × 方法 × 令牌类型（零 IO，纯函数）。
 *
 * 背景：写权限的判定此前散在三处，各自只能看到一半事实——
 *   1. 路由注册时的 `config.scope`（public/read/write/admin）；
 *   2. `auth.ts` 的 `scopeSatisfies`（一维等级，admin ⊇ write ⊇ read）；
 *   3. 处理器里的 `userDomainWriteAllowed`（用户域写闸门）。
 * 结果是「个人令牌能不能写这条路由」既不在路由声明里，也不在鉴权钩子里，
 * 而是 `authz.ts` 里一份**前缀白名单** + 每个人对 scope 语义的记忆。
 *
 * 这里把判定收敛成一张可枚举的策略表：
 *   - `classifyRoute`：单一路由 -> 写类别（read / compute / user-write / instance-write）；
 *   - `personalTokenMayWrite`：个人令牌（api_tokens.owner_identity 非空）能否触达；
 *   - 两条特例清单必须显式登记，且测试会枚举真实路由表核对（漏登记即红）。
 *
 * 默认方向是**拒绝**：声明为 write/admin 且没登记为例外的写路由，一律算实例域，
 * 个人令牌不可触达。新增写路由不需要「记得加一条开关」——它默认就进不了个人令牌，
 * 只有显式登记为 user-write 才放行。
 */

/** 路由声明的等级（与 apps/api 的 RouteScope 同值域） */
export type RouteScopeName = "public" | "read" | "write" | "admin";

/**
 * 路由的写类别：
 *   read          安全方法，无副作用
 *   compute       非安全方法但无业务写入（检索、AI 生成、校验、快照缓存、遥测上报）
 *   user-write    只改调用者自己的数据（收藏/历史/画像/金库/工作区/投稿/插件安装…）
 *   instance-write 改共享实例数据（站点/类目/标签/合集/任务/存储/令牌/插件治理…）
 */
export type MutationClass = "read" | "compute" | "user-write" | "instance-write";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 声明为 write 级、但语义属于用户域的路由。
 *
 * 这是**唯一**允许个人令牌越过 write 门槛的形态：路由等级受历史实现所限标成
 * write，实际操作对象是调用者自己提交的内容（`/api/submissions/:number` 的
 * PATCH 是作者改自己的投稿）。新增条目必须同时评估：这条路由的写对象真的是
 * 「调用者自己的数据」吗？如果是新路由，正确做法是把 scope 设成 public 并配
 * `userDomainWriteAllowed`，而不是往这里加行。
 */
export const PERSONAL_TOKEN_WRITE_ROUTES: readonly string[] = ["PATCH /api/submissions/:number"];

/**
 * 声明为 public、但实际会改**共享实例数据**的路由（匿名写面审计账本）。
 *
 * 与 `PERSONAL_TOKEN_WRITE_ROUTES` 不是一类东西：账本里的路由匿名即可调用，
 * 个人令牌在这里既不获得多也不失去什么（能匿名做的，持票也能做）。
 * 登记它们的目的是把「未登录也能写共享表」这件事从隐含语义变成可枚举、可审计的事实——
 * 每一条都必须写明为什么匿名写入是产品设计的一部分，以及它自己的限制在哪。
 *
 * 新增条目只在「同样的写匿名也必须能做」时成立；其余情况应改为需要身份
 * （处理器里 `userDomainWriteAllowed` / `identityAllowed`）。
 */
export const PUBLIC_INSTANCE_WRITE_ROUTES: readonly { route: string; why: string }[] = [
  { route: "POST /api/events", why: "匿名流量事件（点击/检索漏斗）就是统计口径本身，要求登录会让数据只覆盖登录用户" },
  { route: "POST /api/vitals", why: "Web Vitals 遥测；recordEvent 失败静默，不阻塞页面" },
  { route: "POST /api/errors", why: "客户端错误上报：来源页崩溃时往往还没有可用的身份" },
  { route: "POST /api/shortlinks", why: "分享短链由匿名访客创建；目标限站内 /marketplace/，30 次/小时" },
  { route: "POST /api/users/sync", why: "OAuth 登录同步 users 表；identityAllowed + 可选身份签名是本路由自己的闸门" },
  { route: "POST /api/sites/:id/archive", why: "按站点生成离线快照并落库；外部抓取走 guardedFetch（SSRF 守卫），20 次/分钟" },
  { route: "POST /api/mcp", why: "开放模式执行进程级工具表（含写工具）；鉴权模式由 identityAllowed 先行 401，256KB / 60 次每分钟" },
];

/** `METHOD /path` 形式的策略键（与 RESPONSE_SCHEMA_BINDINGS 同一套写法） */
export function routeKey(method: string, path: string): string {
  return method.toUpperCase() + " " + path;
}

/**
 * 路径模板匹配：`:name` 段匹配任意非空单段，其余按字面量比较。
 *
 * 不用前缀匹配（历史实现是 `path.startsWith(prefix)`）：`/api/submissions/`
 * 前缀会连带放行未来新增的 `/api/submissions/export`，而按段匹配只放行
 * 真的形如 `/api/submissions/:number` 的路径。
 */
export function matchesRoutePath(pattern: string, pathname: string): boolean {
  const p = pattern.split("/");
  const s = pathname.split("/");
  if (p.length !== s.length) return false;
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(":")) {
      if (!s[i]) return false;
      continue;
    }
    if (seg !== s[i]) return false;
  }
  return true;
}

function pathOfRoute(key: string): string {
  const idx = key.indexOf(" ");
  return idx === -1 ? key : key.slice(idx + 1);
}

/** `METHOD /pattern` 键 vs 实际（方法, 路径）——方法相等且路径按段匹配 */
function routeMatches(key: string, method: string, path: string): boolean {
  const [keyMethod, pattern] = key.split(" ", 2) as [string, string];
  return keyMethod === method && matchesRoutePath(pattern, path);
}

/**
 * 个人令牌的 write 是否允许落在该路径上。
 *
 * 只对**写**这一格有意义：用户域路由的 scope 多为 public，走不到这里；
 * 本函数回答的是「声明为 write 的少数用户域路由」这一格。
 */
export function isPersonalUserWritePath(pathname: string): boolean {
  if (!pathname.startsWith("/")) return false;
  return PERSONAL_TOKEN_WRITE_ROUTES.some((key) => matchesRoutePath(pathOfRoute(key), pathname));
}

export interface RoutePolicyInput {
  method: string;
  /** 路由模板（含 `:param`）或真实请求 pathname，两者都可 */
  path: string;
  declaredScope: RouteScopeName;
}

export interface RoutePolicyDecision {
  mutationClass: MutationClass;
  /** 个人令牌（ownerScoped）能否触达这条路由 */
  personalTokenAllowed: boolean;
  /** 判定依据，用于审计与失败信息（不是给人看的文案，是给排查用的锚点） */
  basis: "safe-method" | "personal-write-registered" | "public-instance-registered" | "public-scope" | "read-scope-compute" | "instance-default";
}

/**
 * 单条路由的授权分类。
 *
 * 顺序即优先级，两条特例清单必须排在 scope 默认规则之前：
 *   - `PUBLIC_INSTANCE_WRITE_ROUTES` 先于 public 默认，否则匿名写面会被默认规则吃掉；
 *   - `PERSONAL_TOKEN_WRITE_ROUTES` 先于 write 默认，否则投稿作者会被 403。
 */
export function classifyRoute(input: RoutePolicyInput): RoutePolicyDecision {
  const method = input.method.toUpperCase();
  const path = input.path;
  if (SAFE_METHODS.has(method)) {
    return { mutationClass: "read", personalTokenAllowed: true, basis: "safe-method" };
  }
  // 两条例外都绑定声明的等级：若有人把账本路由提到 write/admin，
  // 说明这是重新定性（更严），例外必须失效，否则等于用旧账本绕过新等级。
  if (input.declaredScope === "public" && PUBLIC_INSTANCE_WRITE_ROUTES.some((entry) => routeMatches(entry.route, method, path))) {
    // 匿名同权：个人令牌不比匿名多，也不比匿名少（scope 门槛本就不在这条路由上）
    return { mutationClass: "instance-write", personalTokenAllowed: true, basis: "public-instance-registered" };
  }
  if (input.declaredScope === "write" && PERSONAL_TOKEN_WRITE_ROUTES.some((entry) => routeMatches(entry, method, path))) {
    return { mutationClass: "user-write", personalTokenAllowed: true, basis: "personal-write-registered" };
  }
  if (input.declaredScope === "public") {
    return { mutationClass: "user-write", personalTokenAllowed: true, basis: "public-scope" };
  }
  // read 级的非安全方法：POST 当查询/计算用（AI 生成、校验、快照缓存），无业务写入
  if (input.declaredScope === "read") {
    return { mutationClass: "compute", personalTokenAllowed: true, basis: "read-scope-compute" };
  }
  return { mutationClass: "instance-write", personalTokenAllowed: false, basis: "instance-default" };
}

export function personalTokenMayWrite(input: RoutePolicyInput): boolean {
  return classifyRoute(input).personalTokenAllowed;
}
