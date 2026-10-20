/**
 * 多租户团队空间与 RBAC 权限 API 测试
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-workspaces-api-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "workspaces.db"),
    embedding: { enabled: false, cacheDir: join(dir, "models") },
    fetch: {
      timeoutMs: 2000,
      maxBytes: 262144,
      maxRedirects: 2,
      allowPrivateNetworks: false,
      userAgent: "NavHubTest/0.1",
    },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("多租户工作空间与细粒度 RBAC 体系 API", () => {
  const H_USER = { "x-navhub-user-id": "usr-test-owner" };

  it("GET /api/workspaces 返回默认个人空间与团队公共空间", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: H_USER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(2);

    const personal = body.items.find((w: any) => w.type === "personal");
    expect(personal).toBeDefined();
    expect(personal.isDefault).toBe(true);
    expect(personal.role).toBe("owner");

    const team = body.items.find((w: any) => w.type === "team");
    expect(team).toBeDefined();
  });

  it("POST /api/workspaces 创建新团队空间并落库与审计", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: H_USER,
      payload: {
        name: "技术研发协同中心",
        slug: "tech-rnd",
        description: "研发团队专属架构演进与文档导航",
        type: "team",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.workspace.name).toBe("技术研发协同中心");
    expect(body.workspace.slug).toBe("tech-rnd");
    expect(body.workspace.role).toBe("owner");

    // 重新获取列表确认已持久化
    const listRes = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: H_USER,
    });
    const listBody = listRes.json();
    const created = listBody.items.find((w: any) => w.slug === "tech-rnd");
    expect(created).toBeDefined();
    expect(created.name).toBe("技术研发协同中心");
  });

  it("GET /api/workspaces/:id/members 返回成员列表与 RBAC 权限矩阵", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/ws-team-shared/members",
      headers: H_USER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.length).toBeGreaterThan(0);
    expect(body.permissions.canEditSites).toBe(true);
  });

  it("POST /api/workspaces/:id/members 添加/更新成员角色", async () => {
    const addRes = await app.inject({
      method: "POST",
      url: "/api/workspaces/ws-team-shared/members",
      headers: H_USER,
      payload: {
        username: "NewQAEngineer",
        role: "member",
        email: "qa@navhub.internal",
      },
    });
    expect(addRes.statusCode).toBe(200);
    const addBody = addRes.json();
    const added = addBody.members.find((m: any) => m.username === "NewQAEngineer");
    expect(added).toBeDefined();
    expect(added.role).toBe("member");

    // 更新角色为 maintainer
    const updateRes = await app.inject({
      method: "POST",
      url: "/api/workspaces/ws-team-shared/members",
      headers: H_USER,
      payload: {
        username: "NewQAEngineer",
        role: "maintainer",
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updateBody = updateRes.json();
    const updated = updateBody.members.find((m: any) => m.username === "NewQAEngineer");
    expect(updated.role).toBe("maintainer");
  });

  it("DELETE /api/workspaces/:id/members/:userId 移除空间成员（保护 owner）", async () => {
    // 保护 owner
    const removeOwnerRes = await app.inject({
      method: "DELETE",
      url: "/api/workspaces/ws-team-shared/members/usr-admin",
      headers: H_USER,
    });
    expect(removeOwnerRes.statusCode).toBe(400);

    // 移除普通成员
    const removeRes = await app.inject({
      method: "DELETE",
      url: "/api/workspaces/ws-team-shared/members/usr-member-2",
      headers: H_USER,
    });
    expect(removeRes.statusCode).toBe(200);
    const body = removeRes.json();
    const removed = body.members.find((m: any) => m.userId === "usr-member-2");
    expect(removed).toBeUndefined();
  });

  it("成员接口拒绝匿名与非空间成员（自定义空间 IDOR 防护）", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: H_USER,
      payload: { name: "Private Lab", slug: "private-lab", type: "team" },
    });
    expect(createRes.statusCode).toBe(201);
    const wsId = createRes.json().workspace.id as string;

    const anonymous = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/members`,
    });
    expect(anonymous.statusCode).toBe(401);

    const other = { "x-navhub-user-id": "usr-test-other" };
    const readOther = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/members`,
      headers: other,
    });
    expect(readOther.statusCode).toBe(404);

    const addOther = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/members`,
      headers: other,
      payload: { username: "Intruder", role: "owner" },
    });
    expect(addOther.statusCode).toBe(404);

    const removeOther = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/members/usr-member-1`,
      headers: other,
    });
    expect(removeOther.statusCode).toBe(404);
  });

  it("成员角色变更不能触碰 Owner，maintainer 不能授予 Owner", async () => {
    const demote = await app.inject({
      method: "POST",
      url: "/api/workspaces/ws-team-shared/members",
      headers: H_USER,
      payload: { username: "Admin (系统管理员)", role: "viewer" },
    });
    expect(demote.statusCode).toBe(403);

    const grant = await app.inject({
      method: "POST",
      url: "/api/workspaces/ws-team-shared/members",
      headers: H_USER,
      payload: { username: "NewOwner", role: "owner" },
    });
    expect(grant.statusCode).toBe(403);
  });
});
