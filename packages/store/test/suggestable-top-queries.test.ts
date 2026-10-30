/**
 * 可推荐热榜（run129 · search gap[0]「自家 UI 反哺热榜」服务端半件）。
 *
 * 缺陷（本机库 13:21:55 只读实测，180 天窗口前 30 合计 171 行）：
 *   榜首 `react vs vue` 26 行但只有 **1 个身份**，`{"name":"navhub"}` 21 行同样 1 个身份，
 *   而 `代码` 24 行来自 **16 个身份**。旧 `topQueries` 只按行数排，于是「一个人的面板把
 *   示例 chip 反复写了 26 次」被读成「26 个人在搜它」，再回灌成建议位 → 自我强化闭环。
 *   同期 events 里 search 196 行、有身份 29 行、有 meta 0 行（§3 铁律：只读连接取证）。
 *
 * 本测试锁住四件事：
 *   1. 人数（去重身份）优先于行数，且「至少 2 人 / 至少 2 行」才允许进建议位；
 *   2. 匿名重复不得被当成多人（identity 为 NULL 的全部行合成一个人）；
 *   3. 形状闸与大小写/空白归一（`github`+`GitHub` 合成一条，不外显两条）；
 *   4. 读取上界 before：本次请求自己写的行不得进本次榜单。
 * 并且显式钉住 `topQueries` 口径不变——管理后台（stats.ts:68/:231）看的是真实次数分布，
 * 两处故意不同口径，不能互相「修好」。
 */
import { describe, expect, it } from "vitest";
import { openDb } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SUGGEST_MIN_EVENTS, SUGGEST_MIN_IDENTITIES, suggestQueryRejection } from "../src/repository/analytics.ts";

async function freshRepo(): Promise<Repository> {
  const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  return new Repository(db);
}

/** 写 n 行 search 事件；identity 传 null 模拟归属前的遗留行与无身份脚本流量。 */
async function seed(repo: Repository, query: string, identity: string | null, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await repo.recordEvent("search", { query, identity: identity ?? undefined });
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("可推荐热榜 suggestableTopQueries", () => {
  it("人数优先：一人 6 行的刷量词进不了榜，两人 2 行的真实词居首", async () => {
    const repo = await freshRepo();
    await seed(repo, "示例 chip 词", "only-one", 6);
    await seed(repo, "真实需求词", "person-a");
    await seed(repo, "真实需求词", "person-b");
    const board = await repo.suggestableTopQueries(30, 10);
    expect(board.map((b) => b.query)).toEqual(["真实需求词"]);
    expect(board[0]).toMatchObject({ count: 2, identities: SUGGEST_MIN_IDENTITIES });
    // 对照：把刷量词拆给两个人，同一批行立刻达标——门槛测的是人数不是行数
    const repo2 = await freshRepo();
    await seed(repo2, "示例 chip 词", "person-a", 3);
    await seed(repo2, "示例 chip 词", "person-b", 3);
    await seed(repo2, "真实需求词", "person-a");
    await seed(repo2, "真实需求词", "person-b");
    const board2 = await repo2.suggestableTopQueries(30, 10);
    expect(board2.map((b) => b.query)).toEqual(["示例 chip 词", "真实需求词"]);
    expect(board2[0]!.count).toBeGreaterThan(board2[1]!.count);
  });

  it("匿名重复不得当成多人：identity 全为 NULL 的 9 行仍算 1 个人", async () => {
    const repo = await freshRepo();
    await seed(repo, "无身份刷量", null, 9);
    expect(await repo.suggestableTopQueries(30, 10)).toEqual([]);
    // 运维口径不变：topQueries 依然看到这 9 行，后台不失明
    expect(await repo.topQueries(30, 10)).toEqual([{ query: "无身份刷量", count: 9 }]);
  });

  it("行数门槛：SUGGEST_MIN_EVENTS 是真的在下限卡，不是只看人数", async () => {
    const repo = await freshRepo();
    expect(SUGGEST_MIN_EVENTS).toBe(2);
    await seed(repo, "两人两行", "person-a");
    await seed(repo, "两人两行", "person-b");
    await seed(repo, "一人一行", "person-c");
    const board = await repo.suggestableTopQueries(30, 10);
    expect(board.map((b) => b.query)).toEqual(["两人两行"]);
  });

  it("大小写与空白归一：github+GitHub 合成一条，人数取最大值而不是相加", async () => {
    const repo = await freshRepo();
    await seed(repo, "github", "person-a", 3);
    await seed(repo, "github", "person-b");
    await seed(repo, "GitHub", "person-c", 2);
    await seed(repo, "  GITHUB  ", "person-d");
    const board = await repo.suggestableTopQueries(30, 10);
    expect(board).toHaveLength(1);
    expect(board[0]!.query).toBe("github");
    expect(board[0]!.count).toBe(7);
    // 身份分散在 4 种写法里（github 2 人 / GitHub 1 人 / GITHUB 1 人），SQL 给不出并集
    // → 取各变体最大值 2；相加会虚报成 4 人，门槛就形同不存在
    expect(board[0]!.identities).toBe(2);
  });

  it("形状闸逐条有反例：本机库真实出现过的痕迹全淘汰，正常词与长站码保留", async () => {
    const repo = await freshRepo();
    const junk = [
      '{"name":"navhub"}',
      "_",
      "%",
      "zzzzzz",
      "#3b82f6",
      "2^10 * 8",
      "418",
      "semver: ^1.2.0 vs 1.4.0",
      "@b64 Hello",
      "https://example.com/a",
      "代",
      "x".repeat(41),
    ];
    for (const j of junk) {
      await seed(repo, j, "person-a", 4);
      await seed(repo, j, "person-b", 4);
    }
    for (const keep of ["12306", "天气预报", "react", "3.14"]) {
      await seed(repo, keep, "person-a", 2);
      await seed(repo, keep, "person-b", 2);
    }
    const seen = (await repo.suggestableTopQueries(30, 50)).map((b) => b.query);
    for (const j of junk) expect(seen, `垃圾形状漏网：${j}`).not.toContain(j.trim().replace(/\s+/g, " "));
    expect(seen).toEqual(expect.arrayContaining(["12306", "天气预报", "react", "3.14"]));
  });

  it("suggestQueryRejection 给每条拒绝一个理由（可解释，不是静默丢弃）", () => {
    expect(suggestQueryRejection("_%")).toContain("纯符号");
    expect(suggestQueryRejection("zzzzzz")).toContain("同一字符");
    expect(suggestQueryRejection("#3b82f6")).toContain("@ / # 开头");
    expect(suggestQueryRejection("418")).toContain("纯数字");
    expect(suggestQueryRejection("2^10 * 8")).toContain("标记/代码字符");
    expect(suggestQueryRejection("1 + 1")).toContain("算式");
    expect(suggestQueryRejection('{"a":1}')).not.toBeNull();
    expect(suggestQueryRejection("12306")).toBeNull();
    expect(suggestQueryRejection("3.14")).toBeNull();
    expect(suggestQueryRejection("react vs vue")).toBeNull();
    expect(suggestQueryRejection("天气")).toBeNull();
    expect(suggestQueryRejection("天")).toMatch(/少于 2 个字符/);
    expect(suggestQueryRejection("y".repeat(41))).toMatch(/超过 40 个字符/);
  });

  it("before 上界：本次请求自己写入的行不进本次榜单（写后读隔离）", async () => {
    const repo = await freshRepo();
    const firstWrite = Date.now();
    await seed(repo, "历史热词", "person-a", 2);
    await seed(repo, "历史热词", "person-b", 2);
    await wait(3);
    const snapshot = Date.now();
    await seed(repo, "历史热词", "person-c", 3);
    // 快照之后（含同毫秒）写入的行一律不可见：person-c 的 3 行被挡掉，只剩两人的 4 行
    const atSnapshot = await repo.suggestableTopQueries(30, 10, { before: snapshot });
    expect(atSnapshot).toHaveLength(1);
    expect(atSnapshot[0]).toMatchObject({ query: "历史热词", count: 4, identities: 2 });
    // 不设上界时看到全部 7 行 3 人（模拟下一次请求的视野）
    const later = await repo.suggestableTopQueries(30, 10, { before: Date.now() + 60_000 });
    expect(later[0]).toMatchObject({ count: 7, identities: 3 });
    // 上界早于全部数据 → 空榜（语义是「没有可信历史」，不是读失败）
    expect(await repo.suggestableTopQueries(30, 10, { before: firstWrite })).toEqual([]);
  });

  it("不传 before 时默认全窗口可见（后台与内部调用不受上界影响）", async () => {
    const repo = await freshRepo();
    await seed(repo, "默认口径词", "person-a", 2);
    await seed(repo, "默认口径词", "person-b", 2);
    const board = await repo.suggestableTopQueries(30, 10);
    expect(board[0]).toMatchObject({ query: "默认口径词", count: 4 });
  });

  it("limit 在门槛之后截断：不足 limit 时如实少给，不回填垃圾", async () => {
    const repo = await freshRepo();
    await seed(repo, "达标词甲", "person-a", 2);
    await seed(repo, "达标词甲", "person-b", 2);
    await seed(repo, "达标词乙", "person-a");
    await seed(repo, "达标词乙", "person-b");
    await seed(repo, "zzzzzz", "person-c", 2);
    await seed(repo, "zzzzzz", "person-d", 2);
    expect((await repo.suggestableTopQueries(30, 1)).map((b) => b.query)).toEqual(["达标词甲"]);
    expect((await repo.suggestableTopQueries(30, 5)).map((b) => b.query)).toEqual(["达标词甲", "达标词乙"]);
  });
});
