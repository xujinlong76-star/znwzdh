/**
 * 口令哈希与会话令牌原语。
 *
 * 为什么放 core 而不是 api：注册、找回密码、next-auth 凭证登录三条链路
 * 都要用同一套哈希口径；放 core 才能让前后端（含 web-overlay 的 BFF）共用。
 *
 * 算法依据 OWASP Password Storage Cheat Sheet：
 *  - 首选 Argon2id；Node 内置 crypto 没有 argon2，退而求其次用 **scrypt**；
 *  - scrypt 最低可接受参数 N=2^13, r=8, p=10；这里取 N=2^14, r=8, p=1（16 MiB，
 *    单次哈希仍在百毫秒级，且 memory-hard 抗 GPU 爆破）；
 *  - 每个口令独立随机盐，杜绝彩虹表；比较用 timingSafeEqual 防时序泄露。
 *
 * 存储格式（可自描述，便于将来换算法/升参数）：
 *   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 */
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * scrypt 的 Promise 封装。
 *
 * 不用 promisify：crypto.scrypt 是重载函数，promisify 的推断在部分 TS 版本下
 * 会丢掉 options 重载（表现为「No overload matches」）。手写包装最稳。
 */
function scryptAsync(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export const SCRYPT_DEFAULTS = {
  N: 16_384, // 2^14
  r: 8,
  p: 1,
  keylen: 64,
  /** scrypt 需要约 128 * N * r 字节的内存上限；留 2 倍余量，否则 Node 会抛 ERR_OOM */
  maxmem: 128 * 16_384 * 8 * 2,
} as const;

export interface PasswordPolicy {
  /** 最小长度 */
  minLength: number;
  /** 最大长度（字节，scrypt 无硬上限但限制 DoS） */
  maxBytes: number;
}

/**
 * 默认口令强度策略。
 *
 * 刻意**不**做复杂度正则（大小写/数字/符号必须齐全）——OWASP 明确反对这种
 * 「看似安全实则把用户推向密码管理器外泄」的策略；长度 + 熵检查更实在。
 * 校验在字节层做（Buffer.byteLength），中文口令不会被按字符数误判。
 */
export const PASSWORD_POLICY: PasswordPolicy = { minLength: 8, maxBytes: 128 };

/** 校验口令是否满足策略；返回 null = 通过，否则返回可读原因 */
export function validatePassword(password: string, policy: PasswordPolicy = PASSWORD_POLICY): string | null {
  if (typeof password !== "string" || password.length < policy.minLength) {
    return `密码至少 ${policy.minLength} 个字符`;
  }
  if (Buffer.byteLength(password, "utf8") > policy.maxBytes) {
    return `密码过长（最多 ${policy.maxBytes} 字节）`;
  }
  return null;
}

/** 生成自描述的 scrypt 哈希串 */
export async function hashPassword(
  password: string,
  params: Partial<typeof SCRYPT_DEFAULTS> = {},
): Promise<string> {
  const p = { ...SCRYPT_DEFAULTS, ...params };
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, p.keylen, { N: p.N, r: p.r, p: p.p, maxmem: p.maxmem });
  return [
    "scrypt",
    String(p.N),
    String(p.r),
    String(p.p),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * 校验口令。任何解析失败都返回 false（不抛）——
 * 旧格式/损坏数据不应让登录接口 500，而应表现为「密码错误」。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  // noUncheckedIndexedAccess：parts[4]/parts[5] 可能是 undefined，必须先收窄再进 Buffer.from
  const saltRaw = parts[4];
  const expectedRaw = parts[5];
  if (typeof saltRaw !== "string" || typeof expectedRaw !== "string") return false;
  const salt = Buffer.from(saltRaw, "base64");
  const expected = Buffer.from(expectedRaw, "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const derived = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * 生成密码学安全的随机令牌（URL 安全 base64）。
 * 用于邮箱验证链接 / 密码重置链接的主体。
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * 生成纯数字一次性验证码（邮箱验证用）。
 * 用 crypto.randomInt 而非 Math.random：后者可被预测，等于把验证码交给攻击者。
 */
export function generateNumericCode(digits = 6): string {
  let out = "";
  for (let i = 0; i < digits; i++) {
    out += String(randomInt(0, 10));
  }
  return out;
}

/**
 * 一次性令牌的哈希。
 *
 * 邮箱验证码 / 重置链接**绝不落库明文**：库里存 sha256，校验时对输入做同样哈希再比。
 * 这样即使库泄露，攻击者也无法直接用库里的值去重置别人密码。
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
