import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { createHash } from "node:crypto";

/**
 * 会话吊销整体兜底（P0-2）：
 * - revokeAllSessions 逐行吊销 + 写 revoked_users，返回吊销数；
 * - 有行只看行状态（重置后新登录的会话不被旧的整体吊销标记误杀）；
 * - 无行时靠 revoked_users + issuedAt 时间比对；issuedAt 缺失时 fail-closed。
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

  it("有行只看行状态：重置后新登录的会话不被旧标记误杀", async () => {
    const u = nextUser();
    await register(sidHash("p02-b1"), u);
    await repo.revokeAllSessions(u);
    await register(sidHash("p02-b2"), u);
    expect(await repo.isSessionRevoked(sidHash("p02-b1"), u)).toBe(true);
    expect(await repo.isSessionRevoked(sidHash("p02-b2"), u)).toBe(false);
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
});
