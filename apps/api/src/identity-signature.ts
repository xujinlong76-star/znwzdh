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
 *   `x-navhub-identity-signature = HMAC-SHA256(secret, identity)`（hex）
 * 由前端 `/api/hub/*` 代理在转发前计算（见 apps/web-overlay/src/lib/identity-signature.ts）。
 *
 * 为什么用 HMAC 而不是改 token 模型：不动库内 token 结构、不要求改造签发流程与
 * 存量部署——不配置本项时行为与历史版本**完全一致**（零回归），可灰度开启。
 *
 * 注意签名对象是**中枢最终解析出的那个 identity 字符串**（`identityOf` 里已
 * `slice(0, 64)`），不是原始 URL 片段；代理侧必须用同一优先级与同一截断规则，
 * 否则会出现「签名了但校验不过」。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

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
  const given = (provided ?? "").trim().toLowerCase();
  if (!given) return false;

  const expected = Buffer.from(signIdentity(secret, identity), "utf8");
  const actual = Buffer.from(given, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
