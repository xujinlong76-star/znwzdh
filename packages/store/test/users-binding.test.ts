import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { dedupeUserEmails } from "../src/migrate.ts";

/**
 * M4 身份模型收口的回归。
 *
 * 旧行为：`upsertOauthUser` 在 username 未命中时按 **email** 兜底绑定，
 * 而 OAuth 的 email 是「用户声称」的、可伪造可重复 —— 任何人用同邮箱的 OAuth
 * 账号登录就能 UPDATE 既有账号那一行，等于直接接管对方数据。
 *
 * 新语义：
 *  - 只按 provider id（provider:providerId）与 username 精确匹配；
 *  - email 永不参与身份匹配；
 *  - users.email 加部分唯一索引（NULL 与空串不参与），存量重复先由
 *    dedupeUserEmails 清空再建索引。
 */
describe("OAuth 身份绑定：不再按 email 静默绑定", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("① 同 username 二次 sync：同一行，email/avatar 被更新（合法重登）", async () => {
    const first = await repo.upsertOauthUser({
      id: "github:1001",
      username: "alice",
      email: "alice@example.com",
      avatar: "https://old.png",
    });
    expect(first.id).toBe("github:1001");

    const second = await repo.upsertOauthUser({
      username: "alice",
      email: "alice@example.com",
      avatar: "https://new.png",
    });
    expect(second.id).toBe(first.id);
    expect(second.avatar).toBe("https://new.png");
    expect(second.email).toBe("alice@example.com");

    const rows = await repo.raw("SELECT COUNT(*) AS c FROM users WHERE username = ?", ["alice"]);
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it("② 不同 username + 相同 email：必须落成两条用户行（核心断言）", async () => {
    await repo.upsertOauthUser({ id: "github:2001", username: "bob", email: "shared@example.com" });
    // 攻击面：另一个 OAuth 账号声称与 bob 相同的邮箱
    const impostor = await repo.upsertOauthUser({
      id: "github:2002",
      username: "bob-impostor",
      email: "shared@example.com",
    });

    expect(impostor.id).toBe("github:2002");
    expect(impostor.id).not.toBe("github:2001");

    const rows = await repo.raw(
      "SELECT id, email FROM users WHERE username IN (?,?) ORDER BY username ASC",
      ["bob", "bob-impostor"],
    );
    expect(rows.length).toBe(2);
    // bob 保住了自己的 email；冒充者不得覆盖它
    const owner = rows.find((r) => r.id === "github:2001")!;
    expect(owner.email).toBe("shared@example.com");
    const other = rows.find((r) => r.id === "github:2002")!;
    // email 撞唯一约束时降级为不写入（登录不能因为重复邮箱而 500）
    expect(other.email).toBeNull();
  });

  it("③ users.email 部分唯一索引生效：直接插入重复 email 抛错", async () => {
    await expect(
      repo.run(
        "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
        ["dup-1", "dup-one", "", "user", "dup@example.com", "github", Date.now()],
      ),
    ).resolves.toBeUndefined();

    await expect(
      repo.run(
        "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
        ["dup-2", "dup-two", "", "user", "dup@example.com", "github", Date.now()],
      ),
    ).rejects.toThrow();
  });

  it("④ 空 email / NULL 不参与唯一约束：可共存", async () => {
    await expect(
      repo.run(
        "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
        ["empty-1", "empty-one", "", "user", "", "github", Date.now()],
      ),
    ).resolves.toBeUndefined();
    await expect(
      repo.run(
        "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
        ["empty-2", "empty-two", "", "user", "", "github", Date.now()],
      ),
    ).resolves.toBeUndefined();
    await expect(
      repo.run(
        "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
        ["null-1", "null-one", "", "user", null, "github", Date.now()],
      ),
    ).resolves.toBeUndefined();
    await expect(
      repo.run(
        "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
        ["null-2", "null-two", "", "user", null, "github", Date.now()],
      ),
    ).resolves.toBeUndefined();
  });
});

describe("dedupeUserEmails：为部分唯一索引清路", () => {
  it("保留 created_at 最早的一行，其余置 NULL，并返回清空行数", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    try {
      const repo = new Repository(db);
      // 模拟旧库：索引尚未建（否则根本插不进重复值）
      db.sqlite!.exec("DROP INDEX IF EXISTS users_email_unique_idx");
      const insert = (id: string, username: string, email: string | null, createdAt: number) =>
        repo.run(
          "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
          [id, username, "", "user", email, "github", createdAt],
        );
      await insert("old", "u-old", "same@example.com", 1000);
      await insert("tie-b", "u-tie-b", "same@example.com", 2000);
      await insert("tie-a", "u-tie-a", "same@example.com", 2000); // 与 tie-b 同时，按 id 字典序
      await insert("solo", "u-solo", "solo@example.com", 500);
      await insert("blank-1", "u-b1", "", 600);
      await insert("blank-2", "u-b2", "", 700); // 空串不算重复

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cleared = await dedupeUserEmails(db);
      warn.mockRestore();

      expect(cleared).toBe(2);
      const rows = await repo.raw("SELECT id, email FROM users WHERE id IN (?,?,?,?) ORDER BY id ASC", [
        "old",
        "tie-a",
        "tie-b",
        "solo",
      ]);
      expect(rows.find((r) => r.id === "old")!.email).toBe("same@example.com");
      expect(rows.find((r) => r.id === "tie-a")!.email).toBeNull();
      expect(rows.find((r) => r.id === "tie-b")!.email).toBeNull();
      expect(rows.find((r) => r.id === "solo")!.email).toBe("solo@example.com");

      // 幂等：再跑一次没有新的重复可清
      expect(await dedupeUserEmails(db)).toBe(0);
    } finally {
      await db.close();
    }
  });
});
