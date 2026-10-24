import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 设置的 per-field 合并语义（T10 收口）：
 * 服务端 updateUserSettings 是「partial patch 逐字段 ?? current」，不同设备
 * 并发改**不同字段**都保留；只有同字段并发才是 LWW（本来就合理）。
 * 此前研究误判为「preferences_json 全量覆盖互相覆盖」——这里用测试钉住真实语义，
 * 防止未来有人把合并改成整行覆盖（那才会真的制造多端互覆盖）。
 */
describe("updateUserSettings：partial patch 逐字段合并", () => {
  let db: Db;
  let repo: Repository;
  const user = "github:u-settings-merge";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("设备 A 改搜索引擎、设备 B 改历史保留：互不覆盖", async () => {
    // 设备 A：只改搜索引擎
    const afterA = await repo.updateUserSettings(user, { defaultSearchEngine: "bing" });
    expect(afterA.defaultSearchEngine).toBe("bing");
    // 设备 B（基于旧快照认知）：只改保留期
    const afterB = await repo.updateUserSettings(user, { historyRetentionDays: 30 });
    expect(afterB.historyRetentionDays).toBe(30);
    // A 的修改没有被 B 的写入抹掉
    expect(afterB.defaultSearchEngine).toBe("bing");

    // 反向再来一轮：B 先改密度，A 改开关
    await repo.updateUserSettings(user, { cardDensity: "compact" });
    const afterA2 = await repo.updateUserSettings(user, { personalizationEnabled: false });
    expect(afterA2.personalizationEnabled).toBe(false);
    expect(afterA2.cardDensity).toBe("compact");
  });

  it("布尔字段显式写 false 不会被误判为「未传」而丢失", async () => {
    const after = await repo.updateUserSettings(user, { searchHistoryEnabled: false });
    expect(after.searchHistoryEnabled).toBe(false);
    // 另一字段的 patch 不会把上面显式的 false 翻回 true
    const again = await repo.updateUserSettings(user, { telemetryEnabled: false });
    expect(again.searchHistoryEnabled).toBe(false);
    expect(again.telemetryEnabled).toBe(false);
  });
});
