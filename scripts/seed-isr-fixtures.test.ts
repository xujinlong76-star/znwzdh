/**
 * 门禁夹具标签脚本（scripts/seed-isr-fixtures.mjs）的回归。
 *
 * 这个脚本存在的理由：种子库最大的标签只挂 5 个站点，低于 MIN_SITES_FOR_TAG_INDEX，
 * `/tags/{slug}` 因此进不了 sitemap，`--live` 白名单里的标签族每轮只会打「跳过」——
 * 那是一族永久盲区。脚本负责把这一族变成真被抽查；它自己坏掉的话，CI 只剩
 * `--sitemap-min-tag=1` 一条红灯，归因还要从头猜。这里把四件事钉住：
 *   1. 没有 NAVHUB_ISR_FIXTURE_DB=1 时**零写入**并退出码 2（对着开发库/生产库误跑的代价是污染）；
 *   2. 有护栏时造出的标签确实跨过阈值（门槛读真实常量，不写死数字）；
 *   3. 重复跑不叠加（CI 之外手工复跑是常态）；
 *   4. 活跃站点不足时红灯，而不是静默造出一个进不了 sitemap 的标签。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../packages/store/src/driver.ts";
import { MIN_SITES_FOR_TAG_INDEX } from "../apps/web-overlay/src/lib/seo/thresholds.ts";

const SCRIPT = fileURLToPath(new URL("./seed-isr-fixtures.mjs", import.meta.url));
const SLUG = "gate-selfcheck";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-isr-fixture-seed-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** 建一个只灌了 N 个活跃站点的临时库（跑真实 schema，不手搓建表） */
async function dbWithSites(count: number): Promise<string> {
  const dbPath = join(tempDir(), "navhub.db");
  const db = await openDb({ dialect: "sqlite", sqlitePath: dbPath, skipOrphanCleanup: true });
  const now = Date.now();
  // sites.category_id 是 NOT NULL，先给一个叶子类目挂着
  db.sqlite
    .prepare(
      "INSERT INTO categories (id, anchor, parent_id, title, sort, source, created_at, updated_at) VALUES (?,?,?,?,0,'seed',?,?)",
    )
    .run("cat-fixture", "cat-fixture", null, "门禁夹具类目", now, now);
  const insert = db.sqlite.prepare(
    `INSERT INTO sites (id, url, title, category_id, sub_category_id, status, enabled, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?, 'active', 1, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i += 1) {
    insert.run(`site-${i}`, `https://e${i}.example.com`, `站点 ${i}`, "cat-fixture", null, now, now, null);
  }
  await db.close();
  return dbPath;
}

function runSeed(dbPath: string, withGuard: boolean) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      NAVHUB_SQLITE_PATH: dbPath,
      ...(withGuard ? { NAVHUB_ISR_FIXTURE_DB: "1" } : {}),
    },
  });
}

/** 夹具标签的行数与「挂在活跃站点上的」链接数：后者才是 sitemap 那道门槛看的数 */
function fixtureTagState(dbPath: string): { rows: number; activeLinks: number } {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = (db.prepare("select count(*) c from tags where slug = ?").all(SLUG)[0] as { c: number }).c;
    const activeLinks = (
      db
        .prepare(
          `select count(*) c from site_tags st
             join tags t on t.id = st.tag_id and t.slug = ?
             join sites s on s.id = st.site_id and s.status = 'active' and s.deleted_at is null`,
        )
        .all(SLUG)[0] as { c: number }
    ).c;
    return { rows: Number(rows), activeLinks: Number(activeLinks) };
  } finally {
    db.close();
  }
}

describe("seed-isr-fixtures.mjs 门禁夹具标签", () => {
  it("没有 NAVHUB_ISR_FIXTURE_DB=1 时退出码 2 且零写入", async () => {
    const dbPath = await dbWithSites(20);
    const r = runSeed(dbPath, false);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain("NAVHUB_ISR_FIXTURE_DB");
    // 拒绝必须发生在动手之前：标签一条都不该存在
    expect(fixtureTagState(dbPath)).toEqual({ rows: 0, activeLinks: 0 });
  });

  it("有护栏时跨过 MIN_SITES_FOR_TAG_INDEX（否则标签族照旧是盲区）", async () => {
    const dbPath = await dbWithSites(20);
    const r = runSeed(dbPath, true);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const state = fixtureTagState(dbPath);
    expect(state.activeLinks).toBeGreaterThanOrEqual(MIN_SITES_FOR_TAG_INDEX);
    expect(JSON.parse(r.stdout).tag.slug).toBe(SLUG);
  });

  it("重复跑不叠加（幂等）", async () => {
    const dbPath = await dbWithSites(20);
    const first = runSeed(dbPath, true);
    expect(first.status, first.stderr).toBe(0);
    const afterFirst = fixtureTagState(dbPath);

    const second = runSeed(dbPath, true);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout).linksAdded).toBe(0);
    expect(fixtureTagState(dbPath)).toEqual(afterFirst);
  });

  it("活跃站点不足时红灯（不许静默造出一个进不了 sitemap 的标签）", async () => {
    const dbPath = await dbWithSites(3);
    const r = runSeed(dbPath, true);
    expect(r.status, r.stdout).toBe(1);
    expect(r.stderr).toContain("低于目标");
  });
});
