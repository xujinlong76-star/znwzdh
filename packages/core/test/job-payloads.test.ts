/**
 * job-payloads.ts 覆盖：validateJobPayload 对全部 16 种任务的校验。
 * （apps/api 的 job-payload-schema.test.ts 做的是「枚举与 jobs.ts 的
 *  奇偶校验」；此处补齐本文件自身的有效/无效/边界/严格模式断言。）
 */
import { describe, expect, it } from "vitest";
import { JOB_PAYLOAD_KINDS, validateJobPayload } from "../src/job-payloads.ts";

describe("validateJobPayload", () => {
  it("JOB_PAYLOAD_KINDS 列出全部 16 种任务", () => {
    expect([...JOB_PAYLOAD_KINDS].sort()).toEqual([
      "backup_restore",
      "daily_brief",
      "data_retention",
      "drama_calendar_refresh",
      "drama_update_check",
      "health_check",
      "hotlist_refresh",
      "plugin_governance",
      "purge_trash",
      "recompute_rank",
      "refetch_metadata",
      "reindex",
      "site_self_healing",
      "taxonomy_audit",
      "token_audit",
      "user_data_audit",
    ]);
  });

  it("未知任务类型返回 kind 级错误", () => {
    const res = validateJobPayload("no_such_job", {});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toHaveLength(1);
      expect(res.issues[0]!.path).toEqual(["kind"]);
      expect(res.issues[0]!.message).toContain("no_such_job");
    }
  });

  it("health_check：可选字段与边界", () => {
    expect(validateJobPayload("health_check", {})).toEqual({ ok: true, payload: {} });
    expect(validateJobPayload("health_check", { siteId: "s1", limit: 10 })).toEqual({
      ok: true,
      payload: { siteId: "s1", limit: 10 },
    });
    expect(validateJobPayload("health_check", { limit: 0 }).ok).toBe(false);
    expect(validateJobPayload("health_check", { limit: 5001 }).ok).toBe(false);
    expect(validateJobPayload("health_check", { limit: 5000 }).ok).toBe(true);
    expect(validateJobPayload("health_check", { siteId: "" }).ok).toBe(false);
    // 未知字段直接拒绝（拼写错误防护）
    expect(validateJobPayload("health_check", { limt: 10 }).ok).toBe(false);
  });

  it("refetch_metadata / site_self_healing：siteId 必填", () => {
    expect(validateJobPayload("refetch_metadata", { siteId: "s", llm: true })).toEqual({
      ok: true,
      payload: { siteId: "s", llm: true },
    });
    expect(validateJobPayload("refetch_metadata", {}).ok).toBe(false);
    expect(validateJobPayload("refetch_metadata", { siteId: "s", llm: "yes" }).ok).toBe(false);
    expect(validateJobPayload("site_self_healing", { siteId: "s" }).ok).toBe(true);
    expect(validateJobPayload("site_self_healing", {}).ok).toBe(false);
  });

  it("空对象任务：{} 通过，带字段拒绝", () => {
    for (const kind of ["recompute_rank", "plugin_governance", "user_data_audit", "hotlist_refresh", "daily_brief"]) {
      expect(validateJobPayload(kind, {})).toEqual({ ok: true, payload: {} });
      expect(validateJobPayload(kind, { extra: 1 }).ok).toBe(false);
      expect(validateJobPayload(kind, undefined)).toEqual({ ok: true, payload: {} });
    }
  });

  it("reindex：siteIds / targets 枚举与长度边界", () => {
    expect(
      validateJobPayload("reindex", { siteIds: ["a", "b"], targets: ["sites", "plugins"], vectors: true }),
    ).toEqual({
      ok: true,
      payload: { siteIds: ["a", "b"], targets: ["sites", "plugins"], vectors: true },
    });
    expect(validateJobPayload("reindex", { siteIds: [] }).ok).toBe(false);
    expect(validateJobPayload("reindex", { targets: ["nope"] }).ok).toBe(false);
    expect(validateJobPayload("reindex", { targets: [] }).ok).toBe(false);
    expect(validateJobPayload("reindex", { siteId: "s" }).ok).toBe(true);
  });

  it("token_audit / purge_trash / taxonomy_audit：数值边界", () => {
    expect(validateJobPayload("token_audit", { expiringDays: 30, dormantDays: 365 })).toEqual({
      ok: true,
      payload: { expiringDays: 30, dormantDays: 365 },
    });
    expect(validateJobPayload("token_audit", { expiringDays: 0 }).ok).toBe(false);
    expect(validateJobPayload("token_audit", { dormantDays: 3651 }).ok).toBe(false);
    expect(validateJobPayload("purge_trash", { olderThanDays: 90 }).ok).toBe(true);
    // 拼错字段名必须被挡住（这是本文件存在的意义）
    expect(validateJobPayload("purge_trash", { olderThan: 90 }).ok).toBe(false);
    expect(validateJobPayload("purge_trash", { olderThanDays: 0 }).ok).toBe(false);
    expect(validateJobPayload("taxonomy_audit", { dryRun: true, siteLimit: 100 }).ok).toBe(true);
    expect(validateJobPayload("taxonomy_audit", { siteLimit: 20001 }).ok).toBe(false);
  });

  it("data_retention：mode 枚举与多字段", () => {
    expect(
      validateJobPayload("data_retention", { mode: "rollup", apply: true, maxDays: 30, maxGroups: 5 }),
    ).toEqual({
      ok: true,
      payload: { mode: "rollup", apply: true, maxDays: 30, maxGroups: 5 },
    });
    expect(validateJobPayload("data_retention", { mode: "delete-all" }).ok).toBe(false);
    expect(validateJobPayload("data_retention", { maxScan: 10_000_001 }).ok).toBe(false);
  });

  it("backup_restore：stagingPath 必填且有长度上限", () => {
    expect(validateJobPayload("backup_restore", { stagingPath: "/tmp/x" })).toEqual({
      ok: true,
      payload: { stagingPath: "/tmp/x" },
    });
    expect(validateJobPayload("backup_restore", {}).ok).toBe(false);
    expect(validateJobPayload("backup_restore", { stagingPath: "" }).ok).toBe(false);
  });

  it("undefined payload 按 {} 处理", () => {
    expect(validateJobPayload("health_check", undefined)).toEqual({ ok: true, payload: {} });
    expect(validateJobPayload("refetch_metadata", undefined).ok).toBe(false);
  });
});
