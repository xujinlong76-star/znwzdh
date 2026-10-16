/**
 * API Token 管理（签发/轮换/吊销）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateToken, hashToken, parseScopes, tokenPrefixOf } from "../auth.ts";

import type { AppContext } from "../context.ts";

export const tokenRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ API Token 管理 ------------------------ */
  /**
   * token 是鉴权体系的入口，因此创建/列出/删除全部要求 admin。
   * 明文只在创建响应里返回一次，库里只有 sha256 —— 之后无法再取回。
   *
   * 首次启用鉴权的引导路径：
   *   NAVHUB_AUTH_REQUIRED=true NAVHUB_BOOTSTRAP_TOKEN=<自定义串> 启动
   *   → 用该串作为 Bearer 调 POST /api/tokens 建正式 token
   *   → 删除 NAVHUB_BOOTSTRAP_TOKEN 重启
   */
  /**
   * 有效期策略：
   *   - maxLifetimeDays（NAVHUB_TOKEN_MAX_LIFETIME_DAYS，默认 365，0=不限制）：
   *     显式 expiresAt 距离现在的最远天数；
   *   - allowPermanentTokens（NAVHUB_TOKEN_ALLOW_PERMANENT，默认 false）：
   *     是否允许"永不过期"凭据。
   *
   * expiresAt 的三种输入分开对待——过去它们都塌缩成"永久有效"，
   * 策略只拦显式传值的人，省略字段就绕过：
   *   - undefined（省略）：一律落策略上限（now + maxLifetimeDays）；
   *     仅当上限=0（显式关闭限制）时才为 null。"永不过期"是显式选择，不是默认结果
   *   - null（显式请求永久）：仅 allowPermanentTokens 放行，否则 400
   *   - number：必须未来且不超上限
   */
  const maxLifetimeMs = ctx.config.tokenPolicy.maxLifetimeDays > 0
    ? ctx.config.tokenPolicy.maxLifetimeDays * 86_400_000
    : 0;
  const allowPermanent = ctx.config.tokenPolicy.allowPermanentTokens;

  /**
   * 审计容错写入：审计失败绝不能吞掉主操作的结果。
   *
   * 轮换场景最致命：rotateApiToken 已让旧明文失效，若此时 audit 抛错把
   * 响应变成 500，客户端既拿不到新明文、旧明文又已失效——凭据彻底报废。
   * 创建同理：明文已随响应发出，不能因审计失败把 201 吞成 500。
   * 因此审计只降级为错误日志，主流程照常返回。
   */
  const auditSafely = async (entry: Parameters<typeof ctx.repo.audit>[0]): Promise<void> => {
    try {
      await ctx.repo.audit(entry);
    } catch (err) {
      console.error("[navhub] 审计写入失败（主操作结果不受影响）:", err);
    }
  };

  /**
   * 同名冲突检测：未吊销凭据中名称精确匹配即拒绝。
   *
   * 精确匹配（不做大小写折叠）——名称是给人看的标识，大小写不同即不同凭据，
   * 避免"以为撞名其实没有"的困惑；已吊销 / 已删除的不占用名称
   * （吊销是留痕，名字理应可复用；彻底 DELETE 后名字自然释放）。
   */
  const findActiveNameClash = async (name: string, exceptId?: string) =>
    (await ctx.repo.listApiTokens()).find((t) => t.revokedAt === null && t.name === name && t.id !== exceptId);

  const resolveExpiry = (v: number | null | undefined): { expiresAt: number | null; error: string | null } => {
    if (v === undefined) {
      return { expiresAt: maxLifetimeMs === 0 ? null : Date.now() + maxLifetimeMs, error: null };
    }
    if (v === null) {
      return allowPermanent
        ? { expiresAt: null, error: null }
        : { expiresAt: null, error: "本实例禁止签发长期（永不过期）凭据：请传 expiresAt，或设置 NAVHUB_TOKEN_ALLOW_PERMANENT=true 放行" };
    }
    if (v <= Date.now()) return { expiresAt: null, error: "expiresAt 必须是未来的时间戳" };
    // 增加 60 秒容差缓冲，防止前后端微小网络时延或时钟偏差导致 365 天等边界值被误判超限
    if (maxLifetimeMs > 0 && v - Date.now() > maxLifetimeMs + 60_000) {
      return { expiresAt: null, error: "expiresAt 超出最长有效期（" + ctx.config.tokenPolicy.maxLifetimeDays + " 天）；确需更长请调 NAVHUB_TOKEN_MAX_LIFETIME_DAYS" };
    }
    return { expiresAt: v, error: null };
  };

  app.post("/api/tokens", { config: { scope: "admin" } }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      /** 逗号分隔：read / write / admin；默认只读 */
      scopes: z.string().default("read"),
      /** 过期时间（毫秒时间戳）；省略落策略上限，显式 null = 请求永久（受 NAVHUB_TOKEN_ALLOW_PERMANENT 管辖） */
      expiresAt: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const scopes = parseScopes(body.data.scopes);
    if (scopes.length === 0) { reply.code(400); return { error: "scopes 至少要有一个有效值（read / write / admin）" }; }
    const expiry = resolveExpiry(body.data.expiresAt);
    if (expiry.error) { reply.code(400); return { error: expiry.error }; }

    // 并存数量闸门：防止脚本失控签发成百上千条凭据，让"吊销"变成不可能完成的工作
    const maxActive = ctx.config.tokenPolicy.maxActiveTokens;
    if (maxActive > 0) {
      const active = (await ctx.repo.listApiTokens()).filter((t) => t.revokedAt === null).length;
      if (active >= maxActive) {
        reply.code(409);
        return { error: "未吊销的凭据已达上限（" + maxActive + " 条）；请先吊销不用的，或调 NAVHUB_TOKEN_MAX_ACTIVE" };
      }
    }

    // 同名冲突：精确匹配未吊销凭据。没有这层拦截时，重复创建同名 token 会
    // 全部成功，列表里多条同名记录无法区分是谁，吊销时也难以定位。
    const clash = await findActiveNameClash(body.data.name);
    if (clash) {
      reply.code(409);
      return { error: "已存在同名凭据「" + body.data.name + "」；请换个名称，或先吊销 / 删除旧凭据" };
    }

    const raw = generateToken();
    const record = await ctx.repo.createApiToken({
      name: body.data.name,
      tokenHash: hashToken(raw),
      scopes: scopes.join(","),
      expiresAt: expiry.expiresAt,
      tokenPrefix: tokenPrefixOf(raw),
    });
    await auditSafely({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.create", target: record.id, diff: { name: record.name, scopes, expiresAt: expiry.expiresAt } });
    reply.code(201);
    // 明文只在这里出现一次
    return { token: raw, ...record, note: "请立即保存：明文只显示这一次，库里只存 sha256。" };
  });

  app.get("/api/tokens", { config: { scope: "admin" } }, async () => ctx.repo.listApiTokens());

  /**
   * 更新 token 的 name / scopes / expiresAt（不改明文）。
   * 这是"凭据管理"缺失的一环：以前只能增删查，改个名字都得删了重建。
   */
  app.patch("/api/tokens/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().min(1).max(64).optional(),
      scopes: z.string().optional(),
      expiresAt: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    if (body.data.scopes !== undefined && parseScopes(body.data.scopes).length === 0) {
      reply.code(400); return { error: "scopes 至少要有一个有效值（read / write / admin）" };
    }
    // 省略 expiresAt = 保留原有效期（编辑名称不该顺带改期）；
    // 显式传值（含 null）才过策略
    let patchedExpiry: number | null | undefined;
    if (body.data.expiresAt !== undefined) {
      const expiry = resolveExpiry(body.data.expiresAt);
      if (expiry.error) { reply.code(400); return { error: expiry.error }; }
      patchedExpiry = expiry.expiresAt;
    }

    // 改名撞名检测（排除自身）：与创建一致，未吊销凭据间名称必须唯一
    if (body.data.name !== undefined) {
      const clash = await findActiveNameClash(body.data.name, id);
      if (clash) {
        reply.code(409);
        return { error: "已存在同名凭据「" + body.data.name + "」；请换个名称，或先吊销 / 删除旧凭据" };
      }
    }

    const record = await ctx.repo.updateApiToken(id, {
      name: body.data.name,
      scopes: body.data.scopes,
      expiresAt: patchedExpiry,
    });
    if (!record) { reply.code(404); return { error: "token 不存在" }; }
    await auditSafely({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.update", target: id, diff: { name: record.name, scopes: record.scopes } });
    return record;
  });

  /**
   * 轮换：为同一 token 换新明文（旧明文立即失效），保留 name 与 scopes。
   * 用于密钥泄露后的紧急轮换，或定期轮换。
   */
  app.post("/api/tokens/:id/rotate", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      /** 可选：轮换时顺带更新有效期 */
      expiresAt: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    // 同 PATCH：省略保留原有效期，显式传值（含 null）才过策略
    let rotatedExpiry: number | null | undefined;
    if (body.data.expiresAt !== undefined) {
      const expiry = resolveExpiry(body.data.expiresAt);
      if (expiry.error) { reply.code(400); return { error: expiry.error }; }
      rotatedExpiry = expiry.expiresAt;
    }

    const raw = generateToken();
    const record = await ctx.repo.rotateApiToken(id, hashToken(raw), rotatedExpiry, tokenPrefixOf(raw));
    if (!record) { reply.code(404); return { error: "token 不存在" }; }
    // 审计容错：此刻旧明文已失效，若 audit 抛错吞掉响应，新明文也随之丢失
    await auditSafely({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.rotate", target: id, diff: { name: record.name, scopes: record.scopes } });
    // 明文只在这里出现一次
    return { token: raw, ...record, note: "轮换成功：旧明文已立即失效，请保存新明文。" };
  });

  /**
   * 软吊销：立刻失效，但保留记录。
   *
   * 与 DELETE 的分工：
   *   revoke = 停用并留痕（审计日志里的 target 仍对应得到这条凭据）——日常应该用这个
   *   delete = 彻底抹除（合规 / 数据清除场景）
   * 以前只有 delete，等于"想停用就必须先销毁证据"。
   */
  app.post("/api/tokens/:id/revoke", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await ctx.repo.revokeApiToken(id);
    if (!record) { reply.code(404); return { error: "token 不存在" }; }
    await auditSafely({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.revoke", target: id, diff: { name: record.name } });
    return record;
  });

  app.delete("/api/tokens/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await ctx.repo.deleteApiToken(id);
    if (!deleted) { reply.code(404); return { error: "token 不存在" }; }
    await auditSafely({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.delete", target: id });
    reply.code(204);
    return null;
  });
};
