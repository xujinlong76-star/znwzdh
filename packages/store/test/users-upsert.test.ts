import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * OAuth upsert 的绑定策略（T7-1）：username 兜底只允许认领「未绑定 provider 身份」
 * 的历史行；已绑定 github:<id> 等规范身份的行不可被同名冒领。
 */
describe("upsertOauthUser：username 兜底的认领边界", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("规范 id 命中已有行 → 原地更新（username 改名跟随 provider）", async () => {
    const first = await repo.upsertOauthUser({
      id: "github:1001",
      username: "alice",
      email: "alice@example.com",
    });
    expect(first.id).toBe("github:1001");

    // 同一 provider 身份改名后再登录：id 命中，username 语义上以 provider 为准
    const again = await repo.upsertOauthUser({
      id: "github:1001",
      username: "alice-new",
      email: "alice@example.com",
    });
    expect(again.id).toBe("github:1001");

    const rows = await repo.raw("SELECT * FROM users WHERE username IN ('alice','alice-new')");
    expect(rows).toHaveLength(1);
  });

  it("username 兜底可认领历史行（主键不含 provider 前缀）", async () => {
    // 旧版本写入的随机 UUID 行（未绑定 provider 身份）
    await repo.run(
      "INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('legacy-uuid-1', 'legacy-bob', '', 'user', 1)",
    );
    const claimed = await repo.upsertOauthUser({
      id: "github:2002",
      username: "legacy-bob",
      email: "bob@example.com",
    });
    // 认领既有行（不新建），email/avatar 按新资料补全
    expect(claimed.id).toBe("legacy-uuid-1");
    const rows = await repo.raw("SELECT * FROM users WHERE username = 'legacy-bob'");
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.email)).toBe("bob@example.com");
  });

  it("username 兜底不可冒领已绑定 provider 身份的行（改名抢注防护）", async () => {
    await repo.upsertOauthUser({
      id: "github:3003",
      username: "carol",
      email: "carol@example.com",
    });

    // 另一个 GitHub 账号抢注了 carol 的旧用户名：不得改写原行，
    // 而是新建一行并自动消歧用户名（tap 同名导入的同款后缀模式）
    const impostor = await repo.upsertOauthUser({
      id: "github:4004",
      username: "carol",
      email: "impostor@example.com",
    });
    expect(impostor.id).toBe("github:4004");
    expect(impostor.username).toBe("carol-4004");

    // carol 的原行未被改写：email 仍是本人的
    const carolRow = (await repo.raw("SELECT * FROM users WHERE id = 'github:3003'"))[0]!;
    expect(String(carolRow.email)).toBe("carol@example.com");
    expect(String(carolRow.username)).toBe("carol");
    // 同名不再并存：抢注者持有消歧后的名字
    const named = await repo.raw("SELECT id FROM users WHERE username = 'carol'");
    expect(named.map((r) => String(r.id))).toEqual(["github:3003"]);
  });
});
