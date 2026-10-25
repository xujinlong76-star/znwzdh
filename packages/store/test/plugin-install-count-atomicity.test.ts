/**
 * install_count 的并发正确性（run50 ③）。
 *
 * 缺陷形态：计数写在事务外，值来自函数开头读到的快照（install_count = 快照 + 1 /
 * 快照 - 1）。两个身份并发首装时都读到同一个 N，各自写回 N+1 —— 丢掉一次安装，
 * 且永久偏小；并发卸载则相反，永久偏大。sort=popular 与详情页「被安装 N 次」都吃这个数。
 *
 * 用例不靠真实调度（会 flaky）：在「读快照」与「写计数」之间确定性地插入一次
 * 已提交的并发写入，复现丢失更新。去掉实现的相对自增，T1/T2 必红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest, type PluginManifest } from "@navhub/core";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

let dir: string;
let db!: Db;
let repo!: Repository;

function themeManifest(name: string): PluginManifest {
  const res = validateAndCleanPluginManifest({
    manifestVersion: 1,
    kind: "theme",
    name,
    description: "并发计数测试主题",
    version: "1.0.0",
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%" } },
  });
  if (!res.ok) throw new Error("fixture 未通过契约校验：" + res.errors.join(" | "));
  return res.manifest;
}

async function publishedTheme(name: string) {
  return repo.createPlugin({ manifest: themeManifest(name), status: "published" });
}

async function countOf(id: string): Promise<number> {
  const rows = await repo.raw("SELECT install_count FROM plugins WHERE id = ?", [id]);
  return Number(rows[0]?.install_count ?? -1);
}

/**
 * 命中 sqlNeedle 的那次写入之前，先执行 competing（一次真实且已提交的并发写）。
 * fired 保证 competing 自身的计数写入直通，不再递归。
 */
function interceptCountWrite(sqlNeedle: string, competing: () => Promise<void>) {
  const original = repo.run.bind(repo);
  let fired = false;
  (repo as unknown as { run: (sql: string, params?: unknown[]) => Promise<void> }).run = async (
    sql: string,
    params: unknown[] = [],
  ) => {
    if (!fired && sql.includes(sqlNeedle)) {
      fired = true;
      await competing();
    }
    return original(sql, params);
  };
  return () => {
    (repo as unknown as { run: (sql: string, params?: unknown[]) => Promise<void> }).run = original;
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-install-count-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
  repo = new Repository(db);
});

afterAll(async () => {
  try {
    await db?.close();
  } catch {
    // 关闭异常不阻塞退出
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄延迟释放产生的短暂占用忽略
  }
});

describe("install_count 相对自增（丢失更新守卫）", () => {
  it("T1 并发首装：另一身份在「读快照」之后提交了 +1，本次不能把它覆盖掉", async () => {
    const plugin = await publishedTheme("并发首装");
    let bDone = false;
    const restore = interceptCountWrite("UPDATE plugins SET install_count", async () => {
      await repo.installPlugin(plugin.slug, "visitor-B");
      bDone = true;
    });
    try {
      const a = await repo.installPlugin(plugin.slug, "visitor-A");
      expect(a.alreadyInstalled).toBe(false);
      expect(bDone).toBe(true);
      // 两个身份各一次活跃安装：只能等于 2（快照写法会退回 1）
      expect(await countOf(plugin.id)).toBe(2);
      expect(a.plugin.installCount).toBe(2);
    } finally {
      restore();
    }
  });

  it("T2 并发卸载：另一身份在「读快照」之后提交了 -1，本次不能把它顶回去", async () => {
    const plugin = await publishedTheme("并发卸载");
    await repo.installPlugin(plugin.slug, "visitor-A");
    await repo.installPlugin(plugin.slug, "visitor-B");
    expect(await countOf(plugin.id)).toBe(2);

    let bGone = false;
    const restore = interceptCountWrite("UPDATE plugins SET install_count", async () => {
      await repo.uninstallPlugin(plugin.slug, "visitor-B");
      bGone = true;
    });
    try {
      const a = await repo.uninstallPlugin(plugin.slug, "visitor-A");
      expect(a.removed).toBe(true);
      expect(bGone).toBe(true);
      // 两个活跃安装都撤销：只能归 0（快照写法会停在 1，计数永久偏大）
      expect(await countOf(plugin.id)).toBe(0);
    } finally {
      restore();
    }
  });

  it("T3 装完再全卸：计数回到 0 且不会因重复卸载变负", async () => {
    const plugin = await publishedTheme("归零");
    await repo.installPlugin(plugin.slug, "visitor-A");
    await repo.installPlugin(plugin.slug, "visitor-B");
    expect(await countOf(plugin.id)).toBe(2);

    await repo.uninstallPlugin(plugin.slug, "visitor-A");
    await repo.uninstallPlugin(plugin.slug, "visitor-B");
    expect(await countOf(plugin.id)).toBe(0);

    // 幂等：重复卸载不再改写计数
    const again = await repo.uninstallPlugin(plugin.slug, "visitor-B");
    expect(again.removed).toBe(false);
    expect(await countOf(plugin.id)).toBe(0);

    // 重装走同一条相对自增：从 0 回到 1
    await repo.installPlugin(plugin.slug, "visitor-B");
    expect(await countOf(plugin.id)).toBe(1);
  });
});
