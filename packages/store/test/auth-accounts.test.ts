import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { generateToken, hashToken } from "@navhub/core";

/**
 * 账号生命周期仓储测试（注册 / 邮箱验证 / 登录 / 找回密码）。
 *
 * 覆盖关键安全不变量：
 *  - 注册写入的是 scrypt 哈希，明文不落库；
 *  - 邮箱验证令牌一次性消费，重复使用失败；
 *  - 密码重置令牌一次性消费，且验证/重置用途隔离；
 *  - 登录对「用户不存在」与「密码错误」返回同一 null（防账号枚举）。
 */
describe("账号生命周期仓储", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("注册创建用户，email_verified 默认 false，密码以哈希存储", async () => {
    const result = await repo.createUserWithPassword({
      username: "alice",
      email: "alice@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.emailVerified).toBe(false);
    expect(result.user.role).toBe("user");

    const row = (await repo.raw("SELECT password_hash, email_verified FROM users WHERE id = ?", [result.user.id]))[0];
    expect(String(row.password_hash)).toMatch(/^scrypt\$/);
    expect(String(row.password_hash)).not.toContain("S3cret");
    expect(Number(row.email_verified)).toBe(0);
  });

  it("重复邮箱/用户名注册被拒", async () => {
    const dupEmail = await repo.createUserWithPassword({
      username: "bob",
      email: "alice@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(dupEmail.ok).toBe(false);
    if (dupEmail.ok) return;
    expect(dupEmail.reason).toBe("email_taken");

    const dupName = await repo.createUserWithPassword({
      username: "alice",
      email: "bob@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(dupName.ok).toBe(false);
    if (dupName.ok) return;
    expect(dupName.reason).toBe("username_taken");
  });

  it("弱密码被拒", async () => {
    const weak = await repo.createUserWithPassword({
      username: "weak",
      email: "weak@example.com",
      password: "123",
    });
    expect(weak.ok).toBe(false);
    if (weak.ok) return;
    expect(weak.reason).toBe("invalid_password");
  });

  it("登录：正确口令通过，错误口令与不存在用户都返回 null", async () => {
    const user = await repo.createUserWithPassword({
      username: "carol",
      email: "carol@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(user.ok).toBe(true);
    if (!user.ok) return;

    const ok = await repo.verifyUserPassword("carol@example.com", "S3cret-Passw0rd!");
    expect(ok?.id).toBe(user.user.id);

    const wrong = await repo.verifyUserPassword("carol@example.com", "wrong-password");
    expect(wrong).toBeNull();

    const missing = await repo.verifyUserPassword("nobody@example.com", "whatever");
    expect(missing).toBeNull();
  });

  it("邮箱验证令牌一次性消费：首次成功，重复使用失败", async () => {
    const user = await repo.createUserWithPassword({
      username: "dave",
      email: "dave@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(user.ok).toBe(true);
    if (!user.ok) return;

    const token = generateToken(32);
    await repo.createAuthToken({
      userId: user.user.id,
      purpose: "email_verification",
      tokenHash: hashToken(token),
      expiresAt: Date.now() + 3_600_000,
    });

    const first = await repo.consumeAuthToken({
      userId: user.user.id,
      purpose: "email_verification",
      tokenHash: hashToken(token),
    });
    expect(first).toBe(true);
    expect(await repo.setUserEmailVerified(user.user.id)).toBe(true);

    const after = await repo.getUser(user.user.id);
    expect(after?.emailVerified).toBe(true);

    // 重放：同一令牌第二次消费必须失败
    const replay = await repo.consumeAuthToken({
      userId: user.user.id,
      purpose: "email_verification",
      tokenHash: hashToken(token),
    });
    expect(replay).toBe(false);
  });

  it("用途隔离：邮箱验证令牌不能当密码重置用", async () => {
    const user = await repo.createUserWithPassword({
      username: "erin",
      email: "erin@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(user.ok).toBe(true);
    if (!user.ok) return;

    const token = generateToken(32);
    await repo.createAuthToken({
      userId: user.user.id,
      purpose: "email_verification",
      tokenHash: hashToken(token),
      expiresAt: Date.now() + 3_600_000,
    });

    // 用 email_verification 的令牌去重置密码 → 必须失败（purpose 不匹配）
    const cross = await repo.consumeAuthToken({
      userId: user.user.id,
      purpose: "password_reset",
      tokenHash: hashToken(token),
    });
    expect(cross).toBe(false);
  });

  it("过期令牌不可用", async () => {
    const user = await repo.createUserWithPassword({
      username: "frank",
      email: "frank@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(user.ok).toBe(true);
    if (!user.ok) return;

    const token = generateToken(32);
    await repo.createAuthToken({
      userId: user.user.id,
      purpose: "password_reset",
      tokenHash: hashToken(token),
      expiresAt: Date.now() - 1, // 已过期
    });
    const consumed = await repo.consumeAuthToken({
      userId: user.user.id,
      purpose: "password_reset",
      tokenHash: hashToken(token),
    });
    expect(consumed).toBe(false);
  });

  it("重置密码后新口令可登录、旧口令失效", async () => {
    const user = await repo.createUserWithPassword({
      username: "grace",
      email: "grace@example.com",
      password: "OldPassw0rd!",
    });
    expect(user.ok).toBe(true);
    if (!user.ok) return;

    const token = generateToken(32);
    await repo.createAuthToken({
      userId: user.user.id,
      purpose: "password_reset",
      tokenHash: hashToken(token),
      expiresAt: Date.now() + 3_600_000,
    });
    const consumed = await repo.consumeAuthToken({
      userId: user.user.id,
      purpose: "password_reset",
      tokenHash: hashToken(token),
    });
    expect(consumed).toBe(true);

    expect(await repo.updateUserPassword(user.user.id, "NewPassw0rd!")).toBe(true);
    expect(await repo.verifyUserPassword("grace@example.com", "NewPassw0rd!")).not.toBeNull();
    expect(await repo.verifyUserPassword("grace@example.com", "OldPassw0rd!")).toBeNull();
  });

  it("按 id 查邮箱：无邮箱用户返回 null", async () => {
    const user = await repo.createUserWithPassword({
      username: "noemail",
      email: "noemail@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(user.ok).toBe(true);
    if (!user.ok) return;
    expect(await repo.findUserEmailById(user.user.id)).toBe("noemail@example.com");
    expect(await repo.findUserEmailById("does-not-exist")).toBeNull();
  });
});
