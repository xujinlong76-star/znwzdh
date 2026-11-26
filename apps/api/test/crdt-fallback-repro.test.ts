/**
 * U-414 复现（R12）：CRDT 同步重试耗尽后的无条件覆盖会丢掉最后到达的 op。
 *
 * 忠实复现的含义：受害写（victim POST /api/crdt/sync）的每一轮
 * read → merge → CAS 窗口都被另一位写者打断——
 *   第 1 轮读后 W1 落地 → CAS(期望 v0) 冲突；
 *   第 2 轮读后 W2 落地 → CAS(期望 v1) 冲突；
 *   第 3 轮读后 W3 落地 → CAS(期望 v2) 冲突；
 *   第 3 次 CAS 失败后、服务端作答之前 W_last 落地（“最后到达的 op”）：
 *   未修复时兜底 saveUserVault 无条件覆盖，W3 与 W_last 丢失；
 *   修复后服务端回 409、不再写，W_last 安然保留。
 *
 * 另一位写者用 ctx.repo.saveUserVault 直接写（无条件写 = 另一 tab/扩展
 * 自己 CAS 成功后的一次落地）；窗口的注入点是受害请求处理链上的
 * ctx.repo.getUserVault（读后写）与 ctx.repo.saveUserVault（兜底写前写），
 * 读/写/落库的先后顺序与真实并发完全一致，只是把“恰好同时到达”
 * 变成了确定性的先后到达。
 *
 * 在未修复的代码上：本测试 FAIL（W3 / W_last 不在最终日志里，
 * 而 POST 却回 200 ok:true）——这就是复现。
 * 修复后：同一场景应回 409（带当前版本），W3 / W_last 全部保留，
 * 客户端重拉重合流再推即可补上 victim op。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const ID = "anon_crdt_fallback_repro";
const H = { "x-anon-id": ID };
const KEY = "crdt:" + ID;

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-crdt-fallback-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

function pinOp(id: string, entityId: string, clientId: string, timestamp: number) {
  return { id, type: "SET_CATEGORY_PIN", entityId, payload: { isPinned: true }, timestamp, clientId };
}

async function readOpIds(headers: Record<string, string> = H): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: "/api/crdt/sync", headers });
  expect(res.statusCode).toBe(200);
  const json = res.json();
  return (json.operations as Array<{ id: string }>).map((o) => o.id);
}

describe("U-414 CRDT 兜底无条件覆盖复现", () => {
  it("3 轮重试窗口各被打断一次 + 兜底前最后到达的 op：不得丢失", async () => {
    const victimOp = pinOp("op_victim", "cat_victim", "client_victim", 1000);
    const w1 = pinOp("op_w1", "cat_w1", "client_other", 1010);
    const w2 = pinOp("op_w2", "cat_w2", "client_other", 1020);
    const w3 = pinOp("op_w3", "cat_w3", "client_other", 1030);
    const wLast = pinOp("op_w_last", "cat_w_last", "client_other", 1040);
    const windowOps = [w1, w2, w3];

    const origGet = ctx.repo.getUserVault.bind(ctx.repo);
    const origSave = ctx.repo.saveUserVault.bind(ctx.repo);
    const origCas = ctx.repo.saveUserVaultIfUnchanged.bind(ctx.repo);
    const landed: Array<ReturnType<typeof pinOp>> = [];

    // 另一位写者：把自己的 op 并进已有日志后无条件落地（模拟另一 tab 一次成功的写）。
    async function landInterloper(op: ReturnType<typeof pinOp>) {
      landed.push(op);
      const payload = JSON.stringify({
        version: 1,
        operations: [...landed],
        state: {},
        updatedAt: Date.now(),
      });
      landing++;
      let saved: { version: number };
      try {
        saved = await origSave(KEY, payload);
      } finally {
        landing--;
      }
      const check = await origGet(KEY);
      console.log("[U-414 repro] land", op.id, "-> saveVersion=", saved.version, "re-read version=", check?.version, "ops=", JSON.parse(check?.payload ?? "{}").operations?.map((o: { id: string }) => o.id));
    }

    let armed = true;
    let readCount = 0;
    let lastArrived = false;
    // 重入 guard：landInterloper 的 saveUserVault 内部（vault.ts:32）会调 repo.getUserVault
    // 做写后校验——那次读发生在一次 interloper 写内部（landing>0），不是受害请求的
    // 循环读，必须跳过；否则 w1 的写会递归触发 w2、w3 的写（实测 run4/run5）。
    // 受害循环的直接读发生在 landing===0 时。
    let landing = 0;
    let seq = 0;
    (ctx.repo as unknown as Record<string, unknown>).getUserVault = async (userId: string) => {
      const rec = await origGet(userId);
      // 只拦截受害请求的循环读：读到旧快照后、CAS 之前，另一位写者落地。
      // landing>0 的读是 interloper 自己写路径内的校验读（见上），不算受害窗口。
      if (armed && userId === KEY && landing === 0 && readCount < 3) {
        readCount++;
        console.log("[U-414 repro] #" + (++seq) + " loop read -> version=", rec?.version ?? null, "landing w" + readCount);
        await landInterloper(windowOps[readCount - 1]);
      }
      return rec;
    };
    (ctx.repo as unknown as Record<string, unknown>).saveUserVault = async (userId: string, payload: string) => {
      saveCalls++;
      console.log("[U-414 repro] saveUserVault called", userId, "readCount=", readCount);
      // 兜底写（仅未修复代码会走到）：兜底落库之前，最后到达的 op 先落地。
      // 修复后此分支永不触发（saveCalls 必须为 0）；CAS 钩子已先一步落了 W_last，
      // 这里的 lastArrived 守卫保证不重复落。
      if (armed && userId === KEY && readCount === 3 && !lastArrived) {
        lastArrived = true;
        await landInterloper(wLast);
      }
      return origSave(userId, payload);
    };
    let casCount = 0;
    let saveCalls = 0;
    (ctx.repo as unknown as Record<string, unknown>).saveUserVaultIfUnchanged = async (userId: string, payload: string, expectedVersion: number) => {
      const res = await origCas(userId, payload, expectedVersion);
      console.log("[U-414 repro] CAS", userId, "expected=", expectedVersion, "->", JSON.stringify(res));
      // 第 3 次 CAS 失败后、服务端作答之前：最后到达的 op 落地。
      // 未修复时随后兜底写会把它覆盖掉；修复后 409 作答前重读到的 currentVersion 已包含它。
      if (armed && userId === KEY && !res.ok) {
        casCount++;
        if (casCount === 3 && !lastArrived) {
          lastArrived = true;
          await landInterloper(wLast);
        }
      }
      return res;
    };

    let postRes: Awaited<ReturnType<typeof app.inject>>;
    try {
      postRes = await app.inject({
        method: "POST",
        url: "/api/crdt/sync",
        headers: H,
        payload: { operations: [victimOp] },
      });
    } finally {
      armed = false;
      (ctx.repo as unknown as Record<string, unknown>).getUserVault = origGet;
      (ctx.repo as unknown as Record<string, unknown>).saveUserVault = origSave;
      (ctx.repo as unknown as Record<string, unknown>).saveUserVaultIfUnchanged = origCas;
    }

    // determinism 自检：3 次读 + 3 次 CAS 冲突 + 兜底前 1 次到达都确实发生了
    console.log("[U-414 repro] POST status=", postRes.statusCode, "body=", postRes.body.slice(0, 400));
    console.log("[U-414 repro] readCount=", readCount, "casCount=", casCount, "saveCalls=", saveCalls, "lastArrived=", lastArrived, "landed=", JSON.stringify(landed.map((o) => o.id)));
    expect(readCount).toBe(3);
    expect(casCount).toBe(3);
    expect(lastArrived).toBe(true);
    expect(landed.map((o) => o.id)).toEqual(["op_w1", "op_w2", "op_w3", "op_w_last"]);

    // 未修复时：200 ok:true 但 W3 / W_last 已丢。修复后：409（带当前版本），一个 op 都不丢。
    const finalIds = await readOpIds();
    console.log("[U-414 repro] final ops=", JSON.stringify(finalIds));
    if (postRes.statusCode === 200) {
      // 兜底路径：必须丢了东西才算复现成功——断言丢的 op 在场即 FAIL（复现成立）。
      expect(saveCalls).toBeGreaterThan(0);
      expect(finalIds).toContain("op_w3");
      expect(finalIds).toContain("op_w_last");
    } else {
      expect(postRes.statusCode).toBe(409);
      const body = postRes.json();
      expect(body.code).toBe("version_conflict");
      expect(body.retryable).toBe(true);
      expect(body.currentVersion).toBe(4);
      // 修复后：兜底写一次都没发生，四个后来 op 全在；victim op 由客户端重推补上。
      expect(saveCalls).toBe(0);
      expect(finalIds).toContain("op_w1");
      expect(finalIds).toContain("op_w2");
      expect(finalIds).toContain("op_w3");
      expect(finalIds).toContain("op_w_last");
      const retry = await app.inject({
        method: "POST",
        url: "/api/crdt/sync",
        headers: H,
        payload: { operations: [victimOp] },
      });
      expect(retry.statusCode).toBe(200);
      expect(await readOpIds()).toContain("op_victim");
      expect(await readOpIds()).toContain("op_w_last");
    }
  });

  it("4 路并发写同一身份：409 重拉重推后一个 op 都不丢", async () => {
    // 与复现用例隔离身份：各自的日志互不干扰。
    const H2 = { "x-anon-id": "anon_crdt_fallback_conc" };
    // 每个客户端一个 op；409 时按新契约重拉（GET）再重推，最多 5 次。
    async function pushWithRetry(op: ReturnType<typeof pinOp>): Promise<number> {
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/crdt/sync",
          headers: H2,
          payload: { operations: [op] },
        });
        if (res.statusCode === 200) return 200;
        expect(res.statusCode).toBe(409);
        expect(typeof res.json().currentVersion).toBe("number");
        const refetch = await app.inject({ method: "GET", url: "/api/crdt/sync", headers: H2 });
        expect(refetch.statusCode).toBe(200);
      }
      throw new Error("pushWithRetry exhausted for " + op.id);
    }

    const ops = [1, 2, 3, 4].map((n) =>
      pinOp("op_conc_" + n, "cat_conc_" + n, "client_conc_" + n, 2000 + n),
    );
    const statuses = await Promise.all(ops.map((op) => pushWithRetry(op)));
    expect(statuses).toEqual([200, 200, 200, 200]);
    const finalIds = await readOpIds(H2);
    for (const op of ops) expect(finalIds).toContain(op.id);
    expect(finalIds).toHaveLength(4);
  });
});
