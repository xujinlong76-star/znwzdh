/**
 * 终端用户身份的 HMAC 签名校验（可选启用）。
 *
 * 问题：身份标示（`userId` / `anonId`）一直是**纯字符串**——Header、Query、Body
 * 任选一处传值即可自称任何身份。开启 `NAVHUB_AUTH_REQUIRED` 只是把门抬到
 * 「必须持票」，票内并不绑定身份，于是任何持票人可读写任意用户的收藏 / 历史 / 画像。
 * 默认开放模式（`authRequired=false`）下更是完全无门槛。
 *
 * 方案：配置 `NAVHUB_IDENTITY_SECRET`（防伪造，只在前端与中枢之间共享）后，
 * 凡带身份标示的请求都必须携带
 *   `x-navhub-identity-signature = HMAC-SHA256(secret, identity)`（hex，v1）
 * 由前端 `/api/hub/*` 代理在转发前计算（见 apps/web-overlay/src/lib/identity-signature.ts）。
 *
 * 为什么用 HMAC 而不是改 token 模型：不动库内 token 结构、不要求改造签发流程与
 * 存量部署——不配置本项时行为与历史版本**完全一致**（零回归），可灰度开启。
 *
 * 注意签名对象是**中枢最终解析出的那个 identity 字符串**（`identityOf` 里已
 * `slice(0, 64)`），不是原始 URL 片段；代理侧必须用同一优先级与同一截断规则，
 * 否则会出现「签名了但校验不过」。
 *
 * ------------------------------------------------------------------ *
 * v2：重放防护
 * ------------------------------------------------------------------ *
 * v1 的签名是**恒定值**：HMAC(secret, identity) 只与身份有关。抓到一次请求头
 * （扩展、共享设备、日志、代理）就能在任意时长内反复重放，冒充该身份且无痕迹。
 *
 * v2 把时间戳与随机 nonce 纳入签名：
 *   `x-navhub-identity-signature-v2 = HMAC-SHA256(secret, JSON([identity, ts, nonce]))`
 * 其中 `ts` 是 Unix 秒（`x-navhub-identity-ts`），`nonce` 是 16-64 位随机串
 * （`x-navhub-identity-nonce`）。校验三件事：时间窗（默认 ±300s）、nonce 未用过、
 * MAC 匹配。nonce 让同一秒内的两次合法请求签名不同，因此缓存可以按**签名**去重，
 * 既不会误伤并发请求，又能精确拦住逐字节重放。
 *
 * 兼容窗口：BFF 同时发 v1 与 v2 三件套（旧中枢只认 v1）。中枢**只要看到 v2 头就
 * 只验 v2**（失败不回退，防止把 v2 降级成 v1 绕过重放防护）；完全不带 v2 头时，
 * 非严格模式（默认）接受 v1，严格模式（`NAVHUB_IDENTITY_SIGNATURE_STRICT=1`）
 * 直接 401。全部代理升级后打开严格模式即可关闭 v1 回退。
 *
 * 局限（如实记录）：非严格模式下，攻击者可以**主动剥掉** v2 头退到 v1；重放防护
 * 只有在中枢与代理都升级、且严格模式开启后才完整生效。这正是需要灰度窗口的原因。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** 允许的时钟偏移（秒）：前后各 300s，覆盖常见的 NTP 漂移与代理慢链路 */
export const IDENTITY_SIGNATURE_WINDOW_SECONDS = 300;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/* ------------------------------------------------------------------ *
 * v1：恒定签名（保留，兼容旧代理）
 * ------------------------------------------------------------------ */

/** 计算身份签名（小写 hex） */
export function signIdentity(secret: string, identity: string): string {
  return createHmac("sha256", secret).update(identity, "utf8").digest("hex");
}

/**
 * 校验身份签名。
 *
 * 恒定时间比较（`timingSafeEqual`），长度不等直接 false（该函数对不等长会抛）。
 * 大小写不敏感：hex 常见有大写写法。
 */
export function verifyIdentitySignature(
  secret: string,
  identity: string,
  provided: string | undefined,
): boolean {
  if (!secret || !identity) return false;
  return macEquals(signIdentity(secret, identity), provided);
}

/* ------------------------------------------------------------------ *
 * v2：时间戳 + nonce
 * ------------------------------------------------------------------ */

/**
 * v2 待签载荷。
 *
 * 用 JSON 数组而不是 `identity|ts|nonce` 拼接：identity 本身可能含分隔符
 * （`github:123`），拼接会让「不同三元组得到同一载荷」，JSON 序列化消除了歧义。
 * **代理侧必须逐字节复刻这个函数**（apps/web-overlay/src/lib/identity-signature.ts）。
 */
export function identitySignaturePayload(identity: string, ts: number, nonce: string): string {
  return JSON.stringify([identity, ts, nonce]);
}

/** 计算 v2 签名（小写 hex） */
export function signIdentityV2(secret: string, identity: string, ts: number, nonce: string): string {
  return createHmac("sha256", secret).update(identitySignaturePayload(identity, ts, nonce), "utf8").digest("hex");
}

function macEquals(expectedHex: string, provided: string | undefined): boolean {
  const given = (provided ?? "").trim().toLowerCase();
  if (!given) return false;
  const expected = Buffer.from(expectedHex, "utf8");
  const actual = Buffer.from(given, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * 进程内重放缓存（按签名去重）。
 *
 * 为什么按签名而不是按 nonce：一次合并请求会同时带 identity 与 anon 两组签名，
 * 若两组共用 ts/nonce，按 nonce 去重会把第二次校验误判成重放。签名天然区分。
 *
 * 有界：超过上限时按插入顺序淘汰最旧条目。极端洪泛下可能挤掉仍在窗口内的
 * 条目（攻击者需先持有有效签名才能写缓存，代价远高于收益），换来的是内存有界。
 */
export class IdentityReplayGuard {
  private readonly seen = new Map<string, number>();
  // 不能用 TypeScript 参数属性（constructor(private readonly x)）：中枢由
  // `node apps/api/src/main.ts` 直接跑，Node 的 strip-only 模式遇到参数属性会
  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX，整进程起不来（CI 的 ISR/E2E 作业同源）。
  private readonly maxEntries: number;

  constructor(maxEntries = 20_000) {
    this.maxEntries = maxEntries;
  }

  /** 首次出现返回 true（放行）；已见过返回 false（判定为重放） */
  accept(key: string, nowMs: number, ttlMs: number): boolean {
    this.prune(nowMs);
    if (this.seen.has(key)) return false;
    this.seen.set(key, nowMs + ttlMs);
    if (this.seen.size > this.maxEntries) {
      let overflow = this.seen.size - this.maxEntries;
      for (const k of this.seen.keys()) {
        if (overflow-- <= 0) break;
        this.seen.delete(k);
      }
    }
    return true;
  }

  get size(): number {
    return this.seen.size;
  }

  /** 过期时间随插入时间单调递增，遇到第一个未过期的即可停 */
  private prune(nowMs: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt > nowMs) break;
      this.seen.delete(key);
    }
  }
}

/** 进程级默认缓存（与 secret 无关：签名已经包含身份） */
export const defaultIdentityReplayGuard = new IdentityReplayGuard();

/* ------------------------------------------------------------------ *
 * 请求头校验（三个调用点共用）
 * ------------------------------------------------------------------ */

export type IdentitySignatureFailure =
  | "missing"
  | "malformed"
  | "stale"
  | "replay"
  | "v2-invalid"
  | "legacy-invalid"
  | "legacy-disabled";

export interface IdentitySignatureVerdict {
  ok: boolean;
  mode?: "v2" | "legacy";
  reason?: IdentitySignatureFailure;
}

export interface VerifyIdentityHeadersInput {
  secret: string;
  identity: string;
  /** Fastify 的 req.headers（键已小写）；也接受普通对象 */
  headers: Record<string, unknown>;
  /** 头前缀：默认 `x-navhub-identity`；合并请求的匿名签名用 `x-navhub-anon` */
  prefix?: string;
  /** true = 不再接受仅 v1 的请求（关闭兼容窗口） */
  strict?: boolean;
  guard?: IdentityReplayGuard;
  nowMs?: number;
  windowSeconds?: number;
}

/**
 * 校验一组身份签名头（v2 优先，v1 兜底）。
 *
 * 有 v2 头就只验 v2：签名/时间/重放任一失败都拒绝，**不回退 v1**——否则
 * 攻击者只要把 v2 头改坏就能退回可重放的老路径。
 */
export function verifyIdentityHeaders(input: VerifyIdentityHeadersInput): IdentitySignatureVerdict {
  const { secret, identity, headers } = input;
  if (!secret || !identity) return { ok: false, reason: "missing" };

  const prefix = input.prefix ?? "x-navhub-identity";
  const read = (suffix: string): string | undefined => {
    const key = prefix + suffix;
    const value = headers[key] ?? headers[key.toLowerCase()];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return undefined;
  };

  const v2 = read("-signature-v2");
  if (v2 !== undefined && v2.trim() !== "") {
    const tsRaw = read("-ts");
    const nonce = read("-nonce");
    if (!tsRaw || !nonce) return { ok: false, reason: "malformed" };

    const ts = Number(tsRaw);
    if (!Number.isInteger(ts) || ts <= 0) return { ok: false, reason: "malformed" };
    if (!NONCE_PATTERN.test(nonce)) return { ok: false, reason: "malformed" };

    const nowMs = input.nowMs ?? Date.now();
    const windowSeconds = input.windowSeconds ?? IDENTITY_SIGNATURE_WINDOW_SECONDS;
    // 双方都用「秒向下取整」比较：ts 只有秒精度，用毫秒浮点比较会让窗口
    // 边缘被亚秒截断（ts=floor(now) 的签名会提前不到 1s 失效）
    if (Math.abs(Math.floor(nowMs / 1000) - ts) > windowSeconds) return { ok: false, reason: "stale" };

    if (!macEquals(signIdentityV2(secret, identity, ts, nonce), v2)) {
      return { ok: false, reason: "v2-invalid" };
    }

    const guard = input.guard ?? defaultIdentityReplayGuard;
    // TTL 取两倍窗口：从最早可接受的 ts 到彻底过期，签名最多还能被重放这么久
    if (!guard.accept(v2.trim().toLowerCase(), nowMs, windowSeconds * 2 * 1000)) {
      return { ok: false, reason: "replay" };
    }
    return { ok: true, mode: "v2" };
  }

  if (input.strict) return { ok: false, reason: "legacy-disabled" };
  if (verifyIdentitySignature(secret, identity, read("-signature"))) {
    return { ok: true, mode: "legacy" };
  }
  return { ok: false, reason: "legacy-invalid" };
}
