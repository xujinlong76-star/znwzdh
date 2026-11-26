import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { schema } from "../src/schema.ts";
import { createHash } from "node:crypto";

/**
 * 会话吊销整体兜底（P0-2）：
 * - revokeAllSessions 逐行吊销 + 写 revoked_users，返回吊销数；
 * - 有行同时核对行状态与 revoked_users（防迟到登记绕过整体吊销）；
 * - revoked_users 按 issuedAt 时间比对；issuedAt 缺失时 fail-closed。
 */
describe("会话吊销整体兜底（P0-2）", () => {
  let db: Db;
  let repo: Repository;
  let n = 0;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  const sidHash = (sid: string) => createHash("sha256").update(sid).digest("hex");
  const nextUser = () => "credentials:p02-user-" + ++n;
  const register = (token: string, userId: string) =>
    repo.upsertSessionActivity({ token, userId, userAgent: "test", expiresAt: Date.now() + 86_400_000 });
  const revokedBeforeOf = async (userId: string) => {
    const rows = await repo.raw("SELECT revoked_before FROM revoked_users WHERE user_id = ?", [userId]);
    return rows.length ? Number(rows[0].revoked_before) : null;
  };

  it("schema 导出包含 revoked_users，迁移工具可发现整体吊销表", () => {
    expect(schema.revokedUsers).toBeDefined();
  });

  it("revokeAllSessions 返回吊销数并写 revoked_users 行", async () => {
    const u = nextUser();
    await register(sidHash("p02-a1"), u);
    await register(sidHash("p02-a2"), u);
    const count = await repo.revokeAllSessions(u);
    expect(count).toBe(2);
    expect(await repo.isSessionRevoked(sidHash("p02-a1"), u)).toBe(true);
    expect(await repo.isSessionRevoked(sidHash("p02-a2"), u)).toBe(true);
    const rb = await revokedBeforeOf(u);
    expect(typeof rb).toBe("number");
    expect(rb).toBeGreaterThan(0);
  });

  it("有行同时核对墓碑：重置后带新 issuedAt 的会话不被旧标记误杀", async () => {
    const u = nextUser();
    await register(sidHash("p02-b1"), u);
    await repo.revokeAllSessions(u);
    const point = await revokedBeforeOf(u);
    await register(sidHash("p02-b2"), u);
    expect(await repo.isSessionRevoked(sidHash("p02-b1"), u)).toBe(true);
    expect(await repo.isSessionRevoked(sidHash("p02-b2"), u)).toBe(true);
    expect(await repo.isSessionRevoked(sidHash("p02-b2"), u, (point as number) + 1)).toBe(false);
  });

  it("整体吊销后的迟到登记不能复活旧 OAuth 会话", async () => {
    const u = nextUser();
    await repo.revokeAllSessions(u);
    const token = sidHash("p02-late-oauth-registration");
    await register(token, u);
    expect(await repo.isSessionRevoked(token, u)).toBe(true);
  });

  it("无行 + revoked_users：issuedAt 在吊销点之后放行，之前吊销，缺失 fail-closed", async () => {
    const u = nextUser();
    await repo.revokeAllSessions(u);
    const rb = await revokedBeforeOf(u);
    expect(rb).not.toBeNull();
    const point = rb as number;
    expect(await repo.isSessionRevoked(sidHash("p02-c1"), u, point + 1000)).toBe(false);
    expect(await repo.isSessionRevoked(sidHash("p02-c2"), u, point - 1000)).toBe(true);
    expect(await repo.isSessionRevoked(sidHash("p02-c3"), u)).toBe(true);
  });

  it("无行 + 无 revoked_users → 不吊销；无 userId 时保持 false", async () => {
    const u = nextUser();
    expect(await repo.isSessionRevoked(sidHash("p02-d1"), u)).toBe(false);
    expect(await repo.isSessionRevoked(sidHash("p02-d2"))).toBe(false);
  });

  it("legacy OAuth 认领后，按 users.id 吊销 raw / credentials / provider 全部会话", async () => {
    const created = await repo.createUserWithPassword({
      username: "legacy-oauth-reset",
      email: "legacy-oauth-reset@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rawId = created.user.id;
    await repo.upsertOauthUser({
      id: "github:legacy-oauth-reset-provider",
      username: "legacy-oauth-reset",
      email: "legacy-oauth-reset@example.com",
    });

    const identities = [rawId, "credentials:" + rawId, "github:legacy-oauth-reset-provider"];
    const tokens = identities.map((identity, index) => {
      const token = sidHash(`legacy-alias-session-${index}`);
      return { identity, token };
    });
    for (const { identity, token } of tokens) {
      await register(token, identity);
    }

    const listed = await repo.listSessionDevicesForUser(rawId);
    expect(new Set(listed.map((device) => device.token))).toEqual(new Set(tokens.map(({ token }) => token)));
    expect(new Set((await repo.listSessionDevicesForUser(identities[2])).map((device) => device.token)))
      .toEqual(new Set(tokens.map(({ token }) => token)));

    // 从另一别名入口踢出 raw UUID 会话，仍只能命中同一用户。
    expect(await repo.revokeSessionDeviceForUser(identities[2], tokens[0].token)).toBe(true);
    expect(await repo.revokeSessionDeviceForUser(identities[2], tokens[0].token)).toBe(false);
    expect(await repo.isSessionRevoked(tokens[0].token, identities[0])).toBe(true);
    expect(await repo.listSessionDevicesForUser(rawId)).toHaveLength(2);

    expect(await repo.revokeAllSessionsForUser(rawId)).toBe(2);
    for (const { identity, token } of tokens) {
      expect(await repo.isSessionRevoked(token, identity)).toBe(true);
      expect(await revokedBeforeOf(identity)).not.toBeNull();
    }
  });

  it("无行会话的 revoked_users 兜底跨 raw / credentials / provider 别名", async () => {
    const created = await repo.createUserWithPassword({
      username: "legacy-oauth-tombstone",
      email: "legacy-oauth-tombstone@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rawId = created.user.id;
    const provider = "github:legacy-oauth-tombstone-provider";
    await repo.upsertOauthUser({
      id: provider,
      username: "legacy-oauth-tombstone",
      email: "legacy-oauth-tombstone@example.com",
    });

    // 只写 credentials 别名的墓碑，模拟历史重置/吊销路径。
    await repo.revokeAllSessions("credentials:" + rawId);
    const point = await revokedBeforeOf("credentials:" + rawId);
    expect(point).not.toBeNull();
    const token = sidHash("legacy-tombstone-unregistered");
    expect(await repo.isSessionRevoked(token, rawId, (point as number) - 1)).toBe(true);
    expect(await repo.isSessionRevoked(token, "credentials:" + rawId)).toBe(true);
    expect(await repo.isSessionRevoked(token, provider, (point as number) - 1)).toBe(true);
    expect(await repo.isSessionRevoked(token, provider, (point as number) + 1)).toBe(false);
  });

  it("口令版本不匹配时即使会话行存在或 issuedAt 很新也视为吊销", async () => {
    const created = await repo.createUserWithPassword({
      username: "password-version-session",
      email: "password-version-session@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const identity = "credentials:" + created.user.id;
    const token = sidHash("password-version-session-row");
    await register(token, identity);

    expect(await repo.isSessionRevoked(token, identity, Date.now() + 60_000, 0)).toBe(false);
    expect(await repo.isSessionRevoked(token, identity, Date.now() + 60_000, 1)).toBe(true);
    expect(await repo.isSessionRevoked(sidHash("password-version-unregistered"), identity, Date.now() + 60_000, 1)).toBe(true);
    expect(await repo.isSessionRevoked(token, undefined, undefined, 0)).toBe(true);
  });
});
