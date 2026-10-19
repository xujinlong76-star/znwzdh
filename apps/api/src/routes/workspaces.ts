/**
 * 多租户团队空间与细粒度 RBAC 权限体系路由 (Workspaces & RBAC)
 *
 * 支持个人空间（Personal）与多团队空间（Team）隔离；
 * 提供 Owner、Maintainer、Member、Viewer 四级权限判定与成员管理。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { identityAllowed, identityOf, unauthorized, forbidden } from "./shared.ts";
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

export const workspacesRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 获取用户当前可见的所有工作空间
   */
  app.get("/api/workspaces", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

    let customWorkspaces: Workspace[] = [];
    if (identity) {
      const stored = await ctx.repo.getUserVault("workspaces:" + identity);
      if (stored?.payload) {
        try {
          const parsed = JSON.parse(stored.payload);
          if (Array.isArray(parsed)) customWorkspaces = parsed;
        } catch {}
      }
    }

    const items = [...DEFAULT_WORKSPACES, ...customWorkspaces];
    return { ok: true, items };
  });

  /**
   * 创建新的团队空间
   */
  app.post("/api/workspaces", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

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
      id: `ws-${now}-${Math.random().toString(36).slice(2, 6)}`,
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

    if (identity) {
      const vaultKey = "workspaces:" + identity;
      const stored = await ctx.repo.getUserVault(vaultKey);
      let list: Workspace[] = [];
      if (stored?.payload) {
        try {
          const parsedList = JSON.parse(stored.payload);
          if (Array.isArray(parsedList)) list = parsedList;
        } catch {}
      }
      list.push(newWs);
      await ctx.repo.saveUserVault(vaultKey, JSON.stringify(list));
    }

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
    const identity = identityOf(req as never);
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

    const params = req.params as { id: string };
    const wsId = params.id;

    let members = [...DEFAULT_MEMBERS];
    const customKey = `ws_members:${wsId}`;
    const stored = await ctx.repo.getUserVault(customKey);
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
        canEditSites: checkWorkspacePermission("maintainer", "edit_sites"),
        canManageMembers: checkWorkspacePermission("maintainer", "manage_members"),
        canConfigureAi: checkWorkspacePermission("maintainer", "configure_ai"),
        canViewAudit: checkWorkspacePermission("maintainer", "view_audit"),
      },
    };
  });

  /**
   * 添加或更新工作空间成员角色 (RBAC)
   */
  app.post("/api/workspaces/:id/members", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

    const params = req.params as { id: string };
    const wsId = params.id;

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

    const customKey = `ws_members:${wsId}`;
    let members = [...DEFAULT_MEMBERS];
    const stored = await ctx.repo.getUserVault(customKey);
    if (stored?.payload) {
      try {
        const parsedList = JSON.parse(stored.payload);
        if (Array.isArray(parsedList)) members = parsedList;
      } catch {}
    }

    const targetUser = parsed.data.username.trim();
    const existingIdx = members.findIndex((m) => m.username.toLowerCase() === targetUser.toLowerCase());
    const now = Date.now();

    if (existingIdx >= 0) {
      members[existingIdx] = {
        ...members[existingIdx]!,
        role: parsed.data.role as WorkspaceRole,
        email: parsed.data.email ?? members[existingIdx]!.email,
      };
    } else {
      members.push({
        userId: `usr-${now}-${Math.random().toString(36).slice(2, 6)}`,
        username: targetUser,
        role: parsed.data.role as WorkspaceRole,
        email: parsed.data.email,
        joinedAt: now,
      });
    }

    await ctx.repo.saveUserVault(customKey, JSON.stringify(members));

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
    const identity = identityOf(req as never);
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

    const params = req.params as { id: string; userId: string };
    const { id: wsId, userId } = params;

    const customKey = `ws_members:${wsId}`;
    let members = [...DEFAULT_MEMBERS];
    const stored = await ctx.repo.getUserVault(customKey);
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
    await ctx.repo.saveUserVault(customKey, JSON.stringify(members));

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
