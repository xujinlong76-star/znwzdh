import { describe, expect, it } from "vitest";
import {
  JOB_PAYLOAD_KINDS,
  JobPayloadSchemas,
  RunJobInput,
  validateJobPayload,
} from "@navhub/core";
import { JOB_KINDS } from "../src/jobs.ts";

const MINIMAL_PAYLOADS: Record<(typeof JOB_KINDS)[number], Record<string, unknown>> = {
  health_check: {},
  refetch_metadata: { siteId: "site-1" },
  recompute_rank: {},
  reindex: {},
  site_self_healing: { siteId: "site-1" },
  token_audit: {},
  purge_trash: {},
  taxonomy_audit: {},
  data_retention: {},
  plugin_governance: {},
  user_data_audit: {},
  backup_restore: { stagingPath: "backups/restore-plan.json" },
};

describe("任务 payload 契约", () => {
  it("Runner、REST/MCP 枚举与按类 schema 一一对应", () => {
    expect([...JOB_PAYLOAD_KINDS].sort()).toEqual([...JOB_KINDS].sort());
    for (const kind of JOB_KINDS) {
      expect(RunJobInput.safeParse({ kind, payload: MINIMAL_PAYLOADS[kind] }).success).toBe(true);
      expect(JobPayloadSchemas[kind]).toBeTruthy();
      expect(validateJobPayload(kind, MINIMAL_PAYLOADS[kind])).toEqual({
        ok: true,
        payload: MINIMAL_PAYLOADS[kind],
      });
    }
  });

  it("缺必填参数时 fail-closed", () => {
    for (const kind of ["refetch_metadata", "site_self_healing", "backup_restore"] as const) {
      const result = validateJobPayload(kind, {});
      expect(result.ok).toBe(false);
    }
  });

  it("危险任务的拼错字段不会静默回退到默认参数", () => {
    for (const [kind, payload] of [
      ["purge_trash", { olderThan: 1 }],
      ["data_retention", { applz: true }],
      ["backup_restore", { stagingPath: "plan.json", force: true }],
    ] as const) {
      const result = validateJobPayload(kind, payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("未知任务类型返回结构化错误", () => {
    const result = validateJobPayload("not-a-job", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toEqual(["kind"]);
  });
});
