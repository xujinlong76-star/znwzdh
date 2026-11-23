import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 考试关注同步端点（U-379）：与追剧清单同步同一套协议（批量 ops + 版本游标 + 墓碑）。
 * 断言的都是客户端可观察行为：ops 的应用、LWW 跳过、增量与墓碑下发、用户隔离、
 * 两端模拟（电脑推 → 手机拉）与登录合并（mergeIdentity 搬匿名行、防孤儿行）。
 * 一场考试一行，勾选节点以 JSON 数组存在 checked_json；examId 只校验形状。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-exams-api";
const OTHER = "github:u-exams-api-other";
const ANON = "anon-44444444-4444-4444-4444-444444444444";

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

type ExamItem = {
  examId: string;
  checked: string[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

type SyncBody = {
  ok: boolean;
  applied: number;
  version: number;
  items: ExamItem[];
};

function followOp(examId: string, checked: string[], at: number, extra: Record<string, unknown> = {}) {
  return { op: "follow", examId, checked, createdAt: at, at, ...extra };
}

async function sync(identity: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/me/exams/sync",
    headers: headersFor(identity),
    payload,
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-exams-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "exams.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/me/exams/sync", () => {
  let version = 0;

  it("无签名身份 -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/exams/sync",
      payload: { ops: [followOp("guokao", ["准考证打印"], Date.now())] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("批量 2 场 follow -> applied=2，全量返回且勾选组完整", async () => {
    const now = Date.now();
    const res = await sync(USER, {
      ops: [followOp("guokao", ["准考证打印"], now), followOp("kaoyan", [], now + 1)],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.ok).toBe(true);
    expect(body.applied).toBe(2);
    expect(body.items).toHaveLength(2);
    const guokao = body.items.find((i) => i.examId === "guokao");
    expect(guokao?.checked).toEqual(["准考证打印"]);
    expect(guokao?.deletedAt ?? null).toBeNull();
    expect(body.version).toBeGreaterThan(0);
    version = body.version;
  });

  it("用 version 当 since -> 只拿增量（此刻为空）", async () => {
    const res = await sync(USER, { ops: [], since: version });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(0);
    expect(body.items).toHaveLength(0);
    expect(body.version).toBe(version);
  });

  it("check 改勾选 -> 增量只回这一场，勾选组已更新", async () => {
    const at = Date.now() + 1000;
    const res = await sync(USER, {
      ops: [{ op: "check", examId: "guokao", checked: ["准考证打印", "公共科目笔试"], at }],
      since: version,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.examId).toBe("guokao");
    expect(body.items[0]?.checked).toEqual(["准考证打印", "公共科目笔试"]);
    version = body.version;
  });

  it("check 未关注的考试 -> 跳过（不凭空建关注）", async () => {
    const at = Date.now() + 1100;
    const res = await sync(USER, {
      ops: [{ op: "check", examId: "cet", checked: ["准考证打印"], at }],
      since: 0,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(0);
    expect(body.items.some((i) => i.examId === "cet")).toBe(false);
  });

  it("LWW：at 早于存量 updated_at 的 follow 被跳过，旧勾选不能盖新勾选", async () => {
    const stale = Date.now() - 60_000;
    const res = await sync(USER, {
      ops: [followOp("guokao", ["准考证打印"], stale, { createdAt: stale })],
      since: 0,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(0);
    const guokao = body.items.find((i) => i.examId === "guokao");
    expect(guokao?.checked).toEqual(["准考证打印", "公共科目笔试"]);
  });

  it("两端同时勾选以时间戳为准：后到的编辑获胜，先到的被覆盖", async () => {
    // 设备 A 在 t1 勾了「准考证打印」；设备 B 在 t2 > t1 勾了「公共科目笔试」——
    // B 后到，云端行级 LWW 取 B 的整组勾选；A 下次拉取即收敛到同一组。
    const t1 = Date.now() + 2000;
    const t2 = Date.now() + 3000;
    const a = await sync(USER, {
      ops: [{ op: "check", examId: "kaoyan", checked: ["准考证打印"], at: t1 }],
      since: 0,
    });
    expect((a.json() as SyncBody).applied).toBe(1);
    const b = await sync(USER, {
      ops: [{ op: "check", examId: "kaoyan", checked: ["公共科目笔试"], at: t2 }],
      since: 0,
    });
    const body = b.json() as SyncBody;
    expect(body.applied).toBe(1);
    expect(body.items.find((i) => i.examId === "kaoyan")?.checked).toEqual(["公共科目笔试"]);
    // 迟到的 A 再次提交 t1 的旧勾选：LWW 跳过，不复活旧组
    const late = await sync(USER, {
      ops: [{ op: "check", examId: "kaoyan", checked: ["准考证打印"], at: t1 }],
      since: 0,
    });
    expect((late.json() as SyncBody).applied).toBe(0);
    expect((late.json() as SyncBody).items.find((i) => i.examId === "kaoyan")?.checked).toEqual([
      "公共科目笔试",
    ]);
    version = body.version;
  });

  it("电脑关注 -> 手机可见：同一账号另一端 since=0 全量拉取看到电脑推的关注", async () => {
    const at = Date.now() + 4000;
    const push = await sync(USER, {
      ops: [followOp("shengkao", ["报名"], at)],
      since: version,
    });
    expect((push.json() as SyncBody).applied).toBe(1);
    // “手机”是同一账号、游标为 0 的全新会话：不带 ops 只拉取
    const pull = await sync(USER, { ops: [], since: 0 });
    const body = pull.json() as SyncBody;
    const alive = body.items.filter((i) => (i.deletedAt ?? null) === null);
    expect(alive.map((i) => i.examId).sort()).toEqual(["guokao", "kaoyan", "shengkao"]);
    expect(body.items.find((i) => i.examId === "shengkao")?.checked).toEqual(["报名"]);
    version = body.version;
  });

  it("unfollow -> 墓碑随增量下发；全量拉取不再包含该场", async () => {
    const at = Date.now() + 5000;
    const res = await sync(USER, { ops: [{ op: "unfollow", examId: "shengkao", at }], since: version });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.examId).toBe("shengkao");
    expect(body.items[0]?.deletedAt).toBe(at);
    version = body.version;

    const full = await sync(USER, { ops: [], since: 0 });
    const fullBody = full.json() as SyncBody;
    const alive = fullBody.items.filter((i) => (i.deletedAt ?? null) === null);
    expect(alive.map((i) => i.examId).sort()).toEqual(["guokao", "kaoyan"]);
  });

  it("unfollow 后再 follow 同一场 -> 复活且清墓碑、勾选组按新 op 写", async () => {
    const at = Date.now() + 6000;
    const res = await sync(USER, {
      ops: [followOp("shengkao", ["报名", "公共科目笔试"], at)],
      since: 0,
    });
    const body = res.json() as SyncBody;
    const item = body.items.find((i) => i.examId === "shengkao");
    expect(item?.deletedAt ?? null).toBeNull();
    expect(item?.checked).toEqual(["报名", "公共科目笔试"]);
  });

  it("用户隔离：另一个用户全量拉取看不到 USER 的关注", async () => {
    const res = await sync(OTHER, { ops: [], since: 0 });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.items).toHaveLength(0);
  });

  it("参数无效 -> 400（examId 形状非法 / 勾选超量）", async () => {
    const badId = await sync(USER, {
      ops: [followOp("GuoKao!", [], Date.now())],
    });
    expect(badId.statusCode).toBe(400);
    const tooMany = await sync(USER, {
      ops: [followOp("guokao", Array.from({ length: 33 }, (_, i) => "节点" + i), Date.now())],
    });
    expect(tooMany.statusCode).toBe(400);
  });
});

describe("登录合并：mergeIdentity 搬考试关注（U-379，防孤儿行）", () => {
  const TARGET = "github:u-exams-merge-target";
  const SOURCE = "anon-55555555-5555-5555-5555-555555555555";

  it("匿名行的关注与勾选整体搬入登录身份，源身份下无残留", async () => {
    const at = Date.now();
    await ctx.repo.applyExamFollowOps(SOURCE, [
      { op: "follow", examId: "guokao", checked: ["准考证打印"], createdAt: at, at },
      { op: "follow", examId: "cet", checked: [], createdAt: at, at },
    ]);
    const result = await ctx.repo.mergeIdentity(SOURCE, TARGET);
    expect(result.examFollowsMoved).toBe(2);
    expect(result.alreadyMerged).toBe(false);
    const targetRows = await ctx.repo.listExamFollows(TARGET);
    expect(targetRows.map((r) => r.examId).sort()).toEqual(["cet", "guokao"]);
    expect(targetRows.find((r) => r.examId === "guokao")?.checked).toEqual(["准考证打印"]);
    // 源身份：活行与墓碑都不留——登录后旧 anonId 再解析到目标身份也不会读到孤儿行
    const sourceRows = await ctx.repo.listExamFollowsSince(SOURCE, 0);
    expect(sourceRows.items).toHaveLength(0);
    const sourceRaw = await ctx.repo.raw("SELECT COUNT(*) AS c FROM exam_follows WHERE user_id = ?", [SOURCE]);
    expect(Number(sourceRaw[0]?.c ?? -1)).toBe(0);
  });

  it("合并幂等：第二次返回首次统计，不重复搬", async () => {
    const again = await ctx.repo.mergeIdentity(SOURCE, TARGET);
    expect(again.alreadyMerged).toBe(true);
    expect(again.examFollowsMoved).toBe(2);
    const targetRows = await ctx.repo.listExamFollows(TARGET);
    expect(targetRows).toHaveLength(2);
  });

  it("目标已有更新的行：目标获胜，源行丢弃不计数", async () => {
    const source2 = "anon-66666666-6666-6666-6666-666666666666";
    const target2 = "github:u-exams-merge-target2";
    const oldAt = Date.now() - 10_000;
    const newAt = Date.now();
    await ctx.repo.applyExamFollowOps(target2, [
      { op: "follow", examId: "guokao", checked: ["公共科目笔试"], createdAt: newAt, at: newAt },
    ]);
    await ctx.repo.applyExamFollowOps(source2, [
      { op: "follow", examId: "guokao", checked: ["准考证打印"], createdAt: oldAt, at: oldAt },
    ]);
    const result = await ctx.repo.mergeIdentity(source2, target2);
    expect(result.examFollowsMoved).toBe(0);
    const rows = await ctx.repo.listExamFollows(target2);
    expect(rows.find((r) => r.examId === "guokao")?.checked).toEqual(["公共科目笔试"]);
    const sourceRaw = await ctx.repo.raw("SELECT COUNT(*) AS c FROM exam_follows WHERE user_id = ?", [source2]);
    expect(Number(sourceRaw[0]?.c ?? -1)).toBe(0);
  });

  it("源行更新时覆盖目标行；源的取消关注墓碑不搬迁、不复活目标的关注", async () => {
    const source3 = "anon-77777777-7777-7777-7777-777777777777";
    const target3 = "github:u-exams-merge-target3";
    const oldAt = Date.now() - 10_000;
    const newAt = Date.now();
    await ctx.repo.applyExamFollowOps(target3, [
      { op: "follow", examId: "kaoyan", checked: [], createdAt: oldAt, at: oldAt },
      { op: "follow", examId: "cet", checked: ["准考证打印"], createdAt: oldAt, at: oldAt },
    ]);
    await ctx.repo.applyExamFollowOps(source3, [
      { op: "follow", examId: "kaoyan", checked: ["准考证打印", "公共科目笔试"], createdAt: newAt, at: newAt },
      { op: "unfollow", examId: "cet", at: newAt },
    ]);
    const result = await ctx.repo.mergeIdentity(source3, target3);
    expect(result.examFollowsMoved).toBe(1);
    const rows = await ctx.repo.listExamFollows(target3);
    expect(rows.find((r) => r.examId === "kaoyan")?.checked).toEqual(["准考证打印", "公共科目笔试"]);
    // 目标的 cet 关注仍在：源的墓碑没搬过来复活/删除它
    expect(rows.find((r) => r.examId === "cet")?.checked).toEqual(["准考证打印"]);
  });
});
