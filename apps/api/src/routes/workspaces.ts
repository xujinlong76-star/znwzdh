/**
 * 多租户团队空间与细粒度 RBAC 权限体系路由 (Workspaces & RBAC)
 *
 * 支持个人空间（Personal）与多团队空间（Team）隔离；
 * 提供 Owner、Maintainer、Member、Viewer 四级权限判定与成员管理。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { AppContext } from "../context.ts";
import { identityTrusted, requestIdentityOf, resolveCanonicalIdentity, notFound, unauthorized, forbidden } from "./shared.ts";
import {
  checkWorkspacePermission,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from "@navhub/core";

const DEFAULT_WORKSPACES: Workspace[] = [
  {
    id: "ws-personal",
    name: "个人私有空间",
    slug: "personal",
    description: "您的专属私密导航空间，仅本人可见",
    type: "personal",
    role: "owner",
    icon: "user",
    memberCount: 1,
    isDefault: true,
    createdAt: 1760000000000,
    updatedAt: 1760000000000,
  },
  {
    id: "ws-team-shared",
    name: "全员团队公共空间",
    slug: "team-shared",
    description: "团队成员共享的企业知识与站点导航中心",
    type: "team",
    role: "maintainer",
    icon: "users",
    memberCount: 5,
    isDefault: false,
    createdAt: 1760000000000,
    updatedAt: 1760000000000,
  },
];

const DEFAULT_MEMBERS: WorkspaceMember[] = [
  {
    userId: "usr-admin",
    username: "Admin (系统管理员)",
    role: "owner",
    joinedAt: 1760000000000,
    email: "admin@navhub.internal",
  },
  {
    userId: "usr-maintainer",
    username: "TechLead (架构组)",
    role: "maintainer",
    joinedAt: 1760100000000,
    email: "lead@navhub.internal",
  },
  {
    userId: "usr-member-1",
    username: "ProductOps (产品运维)",
    role: "member",
    joinedAt: 1760200000000,
    email: "ops@navhub.internal",
  },
  {
    userId: "usr-member-2",
    username: "FrontendDev (前端研发)",
    role: "member",
    joinedAt: 1760300000000,
    email: "fe@navhub.internal",
  },
  {
    userId: "usr-viewer-1",
    username: "SecurityAuditor (安全审计员)",
    role: "viewer",
    joinedAt: 1760400000000,
    email: "audit@navhub.internal",
  },
];

function parseWorkspaceList(payload: string | null | undefined): Workspace[] {
  if (!payload) return [];
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Workspace => {
      if (!item || typeof item !== "object") return false;
      const value = item as Partial<Workspace>;
      return typeof value.id === "string" && typeof value.name === "string";
    });
  } catch {
    return [];
  }
}

async function loadCustomWorkspaces(ctx: AppContext, identity: string): Promise<Workspace[]> {
  const stored = await ctx.repo.getWorkspaceBlob("workspaces:" + identity);
  return parseWorkspaceList(stored?.payload);
}

/**
 * 成员名册的存储键必须带上调用方身份，不能只带空间 id。
 *
 * 旧键 `ws_members:<wsId>` 是全库单行共享的，而 `resolveWorkspaceRole` 对两个预设
 * 空间（`ws-personal`、`ws-team-shared`）无条件发给每个调用方 owner / maintainer——
 * 于是任何登录用户都能改写「别人的个人私有空间」的名册，同名键最后写入者胜出，
 * 读侧再把这份被污染的名单回给所有空间相同的人。自定义空间的 id 随机、且只有创建者
 * 能解析出角色，本来没有这个口；把名册按调用方隔离后，共享写入面整体消失。
 *
 * 代价：历史上通过旧键写进去的名册不再可见（那些行本来就是任意用户越权写出来的），
 * 读不到时回落到 DEFAULT_MEMBERS。
 */
function membersKey(identity: string, wsId: string): string {
  return `ws_members:${identity}:${wsId}`;
}

/**
 * 解析当前身份在目标空间中的角色。
 *
 * 默认空间是演示/共享数据；自定义空间只存在于创建者的 vault 里，因此
 * 非创建者拿不到角色，成员接口必须返回 404，避免跨空间 IDOR。
 */
async function resolveWorkspaceRole(
  ctx: AppContext,
  identity: string,
  wsId: string,
): Promise<WorkspaceRole | null> {
  const preset = DEFAULT_WORKSPACES.find((workspace) => workspace.id === wsId);
  if (preset) return preset.role;

  const custom = await loadCustomWorkspaces(ctx, identity);
  return custom.find((workspace) => workspace.id === wsId)?.role ?? null;
}

export const workspacesRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 获取用户当前可见的所有工作空间
   */
  app.get("/api/workspaces", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    // 合并后旧 id 仍会发请求：工作区名册按 canonical 读写，避免出现「空名册」
    const identity = rawIdentity ? await resolveCanonicalIdentity(ctx, rawIdentity) : rawIdentity;

    let customWorkspaces: Workspace[] = [];
    if (identity) {
      customWorkspaces = await loadCustomWorkspaces(ctx, identity);
    }

    const items = [...DEFAULT_WORKSPACES, ...customWorkspaces];
    return { ok: true, items };
  });

  /**
   * 创建新的团队空间
   */
  app.post("/api/workspaces", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    if (!rawIdentity) return unauthorized(reply, "缺少 userId 或 anonId");
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);

    const schema = z.object({
      name: z.string().min(1).max(64),
      slug: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i).optional(),
      description: z.string().max(200).optional(),
      type: z.enum(["personal", "team"]).default("team"),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "参数无效", detail: parsed.error.issues };
    }

    const now = Date.now();
    const slug = parsed.data.slug || parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
    const newWs: Workspace = {
      id: `ws-${now}-${randomBytes(4).toString("hex")}`,
      name: parsed.data.name.trim(),
      slug,
      description: parsed.data.description?.trim(),
      type: parsed.data.type,
      role: "owner",
      icon: parsed.data.type === "personal" ? "user" : "users",
      memberCount: 1,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };

    const list = await loadCustomWorkspaces(ctx, identity);
    list.push(newWs);
    await ctx.repo.saveWorkspaceBlob("workspaces:" + identity, JSON.stringify(list));

    await ctx.repo.audit({
      actor: identity || "anonymous",
      actorKind: "user",
      action: "workspace:create",
      target: newWs.id,
      diff: { name: newWs.name, type: newWs.type },
      ip: req.ip,
    });

    reply.code(201);
    return { ok: true, workspace: newWs };
  });

  /**
   * 获取指定工作空间的成员列表与 RBAC 角色
   */
  app.get("/api/workspaces/:id/members", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    if (!rawIdentity) return unauthorized(reply, "缺少 userId 或 anonId");
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);

    const params = req.params as { id: string };
    const wsId = params.id;
    const role = await resolveWorkspaceRole(ctx, identity, wsId);
    if (!role) return notFound(reply, "工作空间不存在或无权访问");

    let members = [...DEFAULT_MEMBERS];
    const customKey = membersKey(identity, wsId);
    const stored = await ctx.repo.getWorkspaceBlob(customKey);
    if (stored?.payload) {
      try {
        const parsed = JSON.parse(stored.payload);
        if (Array.isArray(parsed)) members = parsed;
      } catch {}
    }

    return {
      ok: true,
      workspaceId: wsId,
      members,
      permissions: {
        canEditSites: checkWorkspacePermission(role, "edit_sites"),
        canManageMembers: checkWorkspacePermission(role, "manage_members"),
        canConfigureAi: checkWorkspacePermission(role, "configure_ai"),
        canViewAudit: checkWorkspacePermission(role, "view_audit"),
      },
    };
  });

  /**
   * 添加或更新工作空间成员角色 (RBAC)
   */
  app.post("/api/workspaces/:id/members", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    if (!rawIdentity) return unauthorized(reply, "缺少 userId 或 anonId");
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);

    const params = req.params as { id: string };
    const wsId = params.id;
    const actorRole = await resolveWorkspaceRole(ctx, identity, wsId);
    if (!actorRole) return notFound(reply, "工作空间不存在或无权访问");
    if (!checkWorkspacePermission(actorRole, "manage_members")) {
      return forbidden(reply, "无权管理该空间成员");
    }

    const schema = z.object({
      username: z.string().min(1).max(64),
      role: z.enum(["owner", "maintainer", "member", "viewer"]),
      email: z.string().email().optional(),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "参数无效", detail: parsed.error.issues };
    }

    const customKey = membersKey(identity, wsId);
    let members = [...DEFAULT_MEMBERS];
    const stored = await ctx.repo.getWorkspaceBlob(customKey);
    if (stored?.payload) {
      try {
        const parsedList = JSON.parse(stored.payload);
        if (Array.isArray(parsedList)) members = parsedList;
      } catch {}
    }

    const targetUser = parsed.data.username.trim();
    const existingIdx = members.findIndex((m) => m.username.toLowerCase() === targetUser.toLowerCase());
    const now = Date.now();

    if (existingIdx >= 0 && members[existingIdx]!.role === "owner") {
      return forbidden(reply, "Owner 角色不可通过成员接口变更");
    }
    if (parsed.data.role === "owner" && actorRole !== "owner") {
      return forbidden(reply, "仅 Owner 可授予 Owner 角色");
    }

    if (existingIdx >= 0) {
      members[existingIdx] = {
        ...members[existingIdx]!,
        role: parsed.data.role as WorkspaceRole,
        email: parsed.data.email ?? members[existingIdx]!.email,
      };
    } else {
      members.push({
        userId: `usr-${now}-${randomBytes(4).toString("hex")}`,
        username: targetUser,
        role: parsed.data.role as WorkspaceRole,
        email: parsed.data.email,
        joinedAt: now,
      });
    }

    await ctx.repo.saveWorkspaceBlob(customKey, JSON.stringify(members));

    await ctx.repo.audit({
      actor: identity || "anonymous",
      actorKind: "user",
      action: "workspace:member_update",
      target: wsId,
      diff: { username: targetUser, role: parsed.data.role },
      ip: req.ip,
    });

    return { ok: true, members };
  });

  /**
   * 移除空间成员
   */
  app.delete("/api/workspaces/:id/members/:userId", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    if (!rawIdentity) return unauthorized(reply, "缺少 userId 或 anonId");
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);

    const params = req.params as { id: string; userId: string };
    const { id: wsId, userId } = params;
    const actorRole = await resolveWorkspaceRole(ctx, identity, wsId);
    if (!actorRole) return notFound(reply, "工作空间不存在或无权访问");
    if (!checkWorkspacePermission(actorRole, "manage_members")) {
      return forbidden(reply, "无权管理该空间成员");
    }

    const customKey = membersKey(identity, wsId);
    let members = [...DEFAULT_MEMBERS];
    const stored = await ctx.repo.getWorkspaceBlob(customKey);
    if (stored?.payload) {
      try {
        const parsedList = JSON.parse(stored.payload);
        if (Array.isArray(parsedList)) members = parsedList;
      } catch {}
    }

    const targetMember = members.find((m) => m.userId === userId);
    if (targetMember?.role === "owner") {
      reply.code(400);
      return { error: "空间所有者 (Owner) 不可被移除" };
    }

    members = members.filter((m) => m.userId !== userId);
    await ctx.repo.saveWorkspaceBlob(customKey, JSON.stringify(members));

    await ctx.repo.audit({
      actor: identity || "anonymous",
      actorKind: "user",
      action: "workspace:member_remove",
      target: wsId,
      diff: { removedUserId: userId },
      ip: req.ip,
    });

    return { ok: true, members };
  });
};
