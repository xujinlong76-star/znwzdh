/**
 * REST API 鉴权。
 *
 * 背景：`api_tokens` 表在 schema 里一直存在，但 REST 层从未接线——
 * 管理面（站点 CRUD / 类目管理 / 任务入队 / 存储写入）在公网部署时是裸奔的。
 * 本模块补上这条边界，与 packages/mcp 的 scope 模型对齐（read < write < admin）。
 *
 * 三条设计约束：
 *  1. **默认关闭**（`NAVHUB_AUTH_REQUIRED` 未设时为开放模式）——
 *     个人/NAS 部署零配置可用，公开站显式开启。这是「不破坏存量部署」的硬要求。
 *  2. **只保护管理面**，不碰终端用户功能：搜索、事件上报、收藏夹、投稿、榜单
 *     这些本来就是匿名可用的产品能力（投稿另有 5 次/小时/IP 的限流）。
 *     全局强制会让导航站失去访客，属误伤。
 *  3. **库里只存 sha256**，明文只在创建时返回一次；比对用 timingSafeEqual 防时序攻击。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

export type ApiScope = "read" | "write" | "admin";

/** 路由级分级：在 ApiScope 之上多一个 public（匿名可用，不参与鉴权） */
export type RouteScope = "public" | ApiScope;

/** 一次请求的调用身份；开放模式下为匿名内部身份（沿用原有 actor 语义） */
export interface AuthIdentity {
  /** 审计用 actor：token 名或 "api"（开放模式） */
  actor: string;
  kind: "token" | "static" | "anonymous";
  tokenId: string | null;
  scopes: ApiScope[];
}

/** sha256 十六进制——api_tokens.token_hash 列的存储形态 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** 生成明文 token：`nh_` 前缀便于识别与泄露扫描，24 字节随机（192 位熵） */
export function generateToken(): string {
  return "nh_" + randomBytes(24).toString("base64url");
}

/**
 * 明文前缀：列表页用来区分"哪条凭据是哪条"，取代把哈希或完整明文暴露出去。
 *
 * 取 12 个字符 = `nh_` + 9 个 base64url 字符 ≈ 54 位。相对 192 位总熵，
 * 泄露这 54 位没有任何枚举价值（剩余 138 位仍需爆破），但足以让人在
 * 客户端的 ~/.config 里一眼认出对应的是哪一条。
 */
export function tokenPrefixOf(raw: string): string {
  return raw.slice(0, 12);
}

/** 解析 "read,write" 形式的 scope 串；非法值静默丢弃（不放大权限） */
export function parseScopes(raw: string | null | undefined): ApiScope[] {
  if (!raw) return [];
  const out: ApiScope[] = [];
  for (const s of raw.split(",").map((x) => x.trim().toLowerCase())) {
    if (s === "read" || s === "write" || s === "admin") out.push(s);
  }
  return [...new Set(out)];
}

/** admin ⊇ write ⊇ read：持 admin 视同持全部，持 write 视同持 read */
export function scopeSatisfies(scopes: ApiScope[], required: ApiScope): boolean {
  const rank: Record<ApiScope, number> = { read: 1, write: 2, admin: 3 };
  const have = scopes.reduce((m, s) => Math.max(m, rank[s]), 0);
  return have >= rank[required];
}

/** 常量时间比对（长度不同直接失败，避免经由长度泄露信息） */
export function secureEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 从 Authorization 头取出 Bearer 值；没有或格式不符返回 null */
export function bearerOf(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

declare module "fastify" {
  interface FastifyRequest {
    /** 鉴权结果；buildAuthHook 挂载，未启用鉴权时为匿名身份 */
    auth: AuthIdentity;
  }
}

/** 开放模式的默认身份：沿用历史 actor="api" 的审计语义 */
export const ANONYMOUS_IDENTITY: AuthIdentity = {
  actor: "api",
  kind: "anonymous",
  tokenId: null,
  scopes: ["read", "write", "admin"],
};
