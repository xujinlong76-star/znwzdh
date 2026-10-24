/**
 * 云端金库埋点的服务端契约（首页 DIY 面，2026-10-25 run44）。
 *
 * 为什么钉在服务端：EVENT_KINDS 白名单就是事件字典的唯一真相源 ——
 * 客户端联合类型写错了会在编译期拦住，但「隐私口径」只能在这里钉：
 *   1. 四个 vault kind 必须被接受（不接收就等于这条链路仍然零埋点）；
 *   2. outcome 是有界枚举、code 有长度上限 —— 放开成自由字符串，
 *      早晚有人把密文片段或分类名塞进 reason 里；
 *   3. telemetryEnabled=false 时事件照记、身份必须落 NULL。
 *      这一条是整份埋点承诺里唯一用户可见的部分，漂了就是撒谎。
 * run45 起同一份契约也覆盖 settings_handoff（登录后偏好交接）：白名单是唯一真相源，
 * 少登记一个 kind，对应那条链路的所有埋点就会被 400 静默丢掉。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const ID = "anon-vaulttelemetry-001";
const H = { "x-navhub-anon-id": ID };

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-vault-telemetry-"));
  ctx = await createContext(
    loadConfig({ mode: "lite", sqlitePath: join(dir, "telemetry.db"), corsOrigins: ["*"] }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows SQLite 句柄延迟释放
  }
});

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/events", headers: H, payload });

/** 取最近一条该 kind 的事件原始行 */
async function lastEvent(kind: string): Promise<{ meta: string | null; identity: string | null }> {
  const rows = await ctx.repo.raw(
    "SELECT meta, identity FROM events WHERE kind = ? ORDER BY id DESC LIMIT 1",
    [kind],
  );
  expect(rows.length).toBe(1);
  return { meta: (rows[0] as { meta: string | null }).meta, identity: (rows[0] as { identity: string | null }).identity };
}

describe("vault_* 事件被白名单接受", () => {
  it.each([
    ["vault_status", "empty", "no_vault"],
    ["vault_sync", "success", undefined],
    ["vault_sync", "conflict", "vault_cleared"],
    ["vault_pull", "failed", "decrypt_failed"],
    ["vault_delete", "absent", undefined],
  ] as const)("%s / %s / %s → 200 且 meta 带 outcome 与 code", async (kind, outcome, code) => {
    const res = await post({ kind, outcome, ...(code ? { code } : {}) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = await lastEvent(kind);
    const meta = JSON.parse(String(row.meta));
    expect(meta.outcome).toBe(outcome);
    if (code) expect(meta.code).toBe(code);
    // 身份来自 header，不是客户端自报的 body 字段
    expect(String(row.identity)).toContain(ID);
  });

  it("meta 只允许 identity/outcome/code/slug —— 内容字段无处落脚", async () => {
    await post({ kind: "vault_sync", outcome: "failed", code: "hub_error" });
    const meta = JSON.parse(String((await lastEvent("vault_sync")).meta));
    expect(Object.keys(meta).sort()).toEqual(["code", "identity", "outcome"]);
  });

  // run45：登录后「本机偏好 → 云端」交接沿用同一份白名单。客户端判定完全依赖
  // 这里是否登记该 kind —— 没登记就是每条交接都被 400 静默丢掉，客户端测不出来。
  it("settings_handoff 也在白名单内（success / failed 两种结局都收）", async () => {
    for (const [outcome, code] of [["success", undefined], ["failed", "hub_error"]] as const) {
      const res = await post({ kind: "settings_handoff", outcome, ...(code ? { code } : {}) });
      expect(res.statusCode).toBe(200);
      const meta = JSON.parse(String((await lastEvent("settings_handoff")).meta));
      expect(meta.outcome).toBe(outcome);
      expect(Object.keys(meta).sort()).toEqual(code ? ["code", "identity", "outcome"] : ["identity", "outcome"]);
    }
  });
});

describe("违约即拒（schema 就是产品契约）", () => {
  it("未登记的 kind 仍然 400：新事件名必须两侧一起加", async () => {
    const res = await post({ kind: "vault_reset", outcome: "success" });
    expect(res.statusCode).toBe(400);
  });

  it("outcome 不在词表内 → 400（不接受自由字符串）", async () => {
    const res = await post({ kind: "vault_sync", outcome: "好像成功了" });
    expect(res.statusCode).toBe(400);
  });

  it("code 超过 32 字符 → 400：长度上限就是「这里不装内容」的护栏", async () => {
    const res = await post({ kind: "vault_pull", outcome: "failed", code: "x".repeat(33) });
    expect(res.statusCode).toBe(400);
  });
});

describe("telemetryEnabled=false 的隐私口径", () => {
  it("事件照记，但身份必须为 NULL 且 meta 里不留 identity", async () => {
    await ctx.repo.updateUserSettings(ID, { telemetryEnabled: false });
    const res = await post({ kind: "vault_delete", outcome: "deleted" });
    expect(res.statusCode).toBe(200);

    const row = await lastEvent("vault_delete");
    expect(row.identity).toBeNull();
    const meta = JSON.parse(String(row.meta));
    expect(meta.outcome).toBe("deleted");
    expect(meta.identity).toBeUndefined();
  });
});
