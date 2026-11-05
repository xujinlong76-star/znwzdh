import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { computeTagLongTailStats } from "../src/index.ts";

/** 每个 describe 独立建库：in-memory SQLite 不会跨 case 累积数据。 */
function useFreshRepo() {
  let db: Db;
  let repo: Repository;
  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });
  afterAll(async () => {
    await db.close();
  });
  return () => repo;
}

describe("标签长尾治理统计 computeTagLongTailStats", () => {
  describe("空库", () => {
    const getRepo = useFreshRepo();
    it("total=0 且比例不除零（返回 0）", async () => {
      const stats = await computeTagLongTailStats(getRepo());
      expect(stats.total).toBe(0);
      expect(stats.usedByOne).toBe(0);
      expect(stats.usedByLteTwo).toBe(0);
      expect(stats.usedByGteFive).toBe(0);
      expect(stats.ratioByOne).toBe(0);
      expect(stats.ratioByLteTwo).toBe(0);
    });
  });

  describe("最小化种子标签集", () => {
    const getRepo = useFreshRepo();
    it("断言长尾阈值与比例", async () => {
      const repo = getRepo();
      const cat = await repo.createCategory({ title: "长尾测试分类" });

      // 建站时通过 tags 自动建标签并计入存活站点引用（与 catalog / TAG_LINK_MIN 同口径）。
      // 计数口径 = 存活且 active 的站点数。
      const seed = async (url: string, tags: string[], n: number) => {
        for (let i = 0; i < n; i++) {
          await repo.createSite({
            url: `${url}-${i}`,
            title: `site-${url}-${i}`,
            categoryId: cat.id,
            tags,
            status: "active",
          });
        }
      };

      // A: 5 站 -> >=5（主标签候选）
      await seed("a", ["Alpha"], 5);
      // B / C: 各 2 站 -> <=2 但非 1
      await seed("b", ["Bravo"], 2);
      await seed("c", ["Charlie"], 2);
      // D / E / F: 各 1 站 -> 仅 1 站使用
      await seed("d", ["Delta"], 1);
      await seed("e", ["Echo"], 1);
      await seed("f", ["Foxtrot"], 1);

      const stats = await computeTagLongTailStats(repo);
      expect(stats.total).toBe(6);
      expect(stats.usedByGteFive).toBe(1); // Alpha
      expect(stats.usedByOne).toBe(3); // Delta / Echo / Foxtrot
      expect(stats.usedByLteTwo).toBe(5); // Bravo + Charlie + Delta + Echo + Foxtrot
      // 比例精确：3/6 与 5/6
      expect(stats.ratioByOne).toBeCloseTo(3 / 6, 12);
      expect(stats.ratioByLteTwo).toBeCloseTo(5 / 6, 12);
    });
  });

  describe("阈值边界（与 deep-scan 报告同口径）", () => {
    const getRepo = useFreshRepo();
    it(">=5 / <=2 / ===1 边界精确命中", async () => {
      const repo = getRepo();
      const cat = await repo.createCategory({ title: "阈值边界分类" });
      // count=2 算 <=2 但不算 1；count=5 算 >=5 边界；count=4 两头都不算
      await repo.createSite({ url: "edge-2-1", title: "e2a", categoryId: cat.id, tags: ["EdgeTwo"], status: "active" });
      await repo.createSite({ url: "edge-2-2", title: "e2b", categoryId: cat.id, tags: ["EdgeTwo"], status: "active" });
      await repo.createSite({ url: "edge-5-1", title: "e5a", categoryId: cat.id, tags: ["EdgeFive"], status: "active" });
      await repo.createSite({ url: "edge-5-2", title: "e5b", categoryId: cat.id, tags: ["EdgeFive"], status: "active" });
      await repo.createSite({ url: "edge-5-3", title: "e5c", categoryId: cat.id, tags: ["EdgeFive"], status: "active" });
      await repo.createSite({ url: "edge-5-4", title: "e5d", categoryId: cat.id, tags: ["EdgeFive"], status: "active" });
      await repo.createSite({ url: "edge-5-5", title: "e5e", categoryId: cat.id, tags: ["EdgeFive"], status: "active" });
      await repo.createSite({ url: "edge-4-1", title: "e4a", categoryId: cat.id, tags: ["EdgeFour"], status: "active" });
      await repo.createSite({ url: "edge-4-2", title: "e4b", categoryId: cat.id, tags: ["EdgeFour"], status: "active" });
      await repo.createSite({ url: "edge-4-3", title: "e4c", categoryId: cat.id, tags: ["EdgeFour"], status: "active" });
      await repo.createSite({ url: "edge-4-4", title: "e4d", categoryId: cat.id, tags: ["EdgeFour"], status: "active" });

      const stats = await computeTagLongTailStats(repo);
      expect(stats.total).toBe(3);
      expect(stats.usedByOne).toBe(0);
      expect(stats.usedByLteTwo).toBe(1); // 仅 EdgeTwo
      expect(stats.usedByGteFive).toBe(1); // 仅 EdgeFive
    });
  });
});
