/**
 * `scripts/lib/commit-scope.mjs` 的回归。
 *
 * 钉的是 2026-10-30 那次错位：`6dbadb83` 的 message 写 `feat(tooling)`，
 * 实际装入的却是并行会话的 `ci-defused` 文件集（HEAD 竞态下索引串了）。
 *
 * 四件事要钉住：真错位要报、同域不报、判不了要放行（宁可漏报不可误杀）、
 * 测试镜像跟着源走（测试目录对 test/e2e 放行）。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { checkCommitScope, evaluateScopeOverride, fileMatchesScope, SCOPE_DIRS } from "./commit-scope.mjs";

describe("主题域 ↔ 文件域：真错位要报", () => {
  it("写 tooling 却装了 ci.yml 与 docs ⇒ 报（正是 6dbadb83 的形态）", () => {
    const r = checkCommitScope(
      "feat(tooling): 事实源判据扩到目录级",
      ["scripts/check-source-truth.mjs", ".github/workflows/ci.yml", "docs/GATES-OPERATIONS.md"],
    );
    expect(r.ok).toBe(false);
    expect(r.outsiders).toContain(".github/workflows/ci.yml");
    expect(r.outsiders).toContain("docs/GATES-OPERATIONS.md");
  });

  it("写 web 却装了 packages/core ⇒ 报", () => {
    const r = checkCommitScope("fix(web): 播放器", ["apps/web-overlay/src/a.tsx", "packages/core/src/x.ts"]);
    expect(r.ok).toBe(false);
    expect(r.outsiders).toEqual(["packages/core/src/x.ts"]);
  });
});

describe("主题域 ↔ 文件域：同域不报", () => {
  it("多 scope 取并集 ⇒ 不报", () => {
    const r = checkCommitScope(
      "feat(api,store): LLM 单价簿",
      ["apps/api/src/x.ts", "packages/store/src/y.ts"],
    );
    expect(r.ok).toBe(true);
    expect(r.outsiders ?? []).toHaveLength(0);
  });

  it("test 镜像跟源走 ⇒ 不报（apps/web/test 是 overlay 测试的镜像）", () => {
    const r = checkCommitScope("fix(web): 离线缓存", [
      "apps/web-overlay/src/lib/offline-video-cache.ts",
      "apps/web/test/offline.test.ts",
    ]);
    expect(r.ok).toBe(true);
  });

  it("deliverables 对 docs 放行 ⇒ 不报", () => {
    const r = checkCommitScope("docs(docs): 取证入库", ["deliverables/ai4c/README.md", "docs/X.md"]);
    expect(r.ok).toBe(true);
  });
});

describe("主题域 ↔ 文件域：判不了就放行", () => {
  it("subject 无 type(scope) 形式 ⇒ 放行", () => {
    expect(checkCommitScope("修一个错别字", ["apps/api/src/a.ts"]).ok).toBe(true);
  });

  it("subject 无 scope ⇒ 放行", () => {
    expect(checkCommitScope("feat: 新功能", ["apps/api/src/a.ts"]).ok).toBe(true);
  });

  it("scope 不在映射表 ⇒ 放行（映射表覆盖不全时不能误杀）", () => {
    expect(checkCommitScope("feat(infra): 调整", ["deploy/x.yml"]).ok).toBe(true);
  });
});

describe("主题域 ↔ 文件域：映射表形状", () => {
  it("常用 scope 都在表里", () => {
    for (const s of ["api", "web", "core", "store", "ai", "tooling", "ci", "docs"]) {
      expect(SCOPE_DIRS[s], s).toBeDefined();
    }
  });

  it("fileMatchesScope 对未知 scope 返回 null（判不了）", () => {
    expect(fileMatchesScope("a/b.ts", "nope")).toBeNull();
  });
});

describe("跨域放行：理由必须非空且留痕", () => {
  it("不跨域 ⇒ 放行，且不需要理由", () => {
    const v = evaluateScopeOverride({ scopeOk: true, override: "", message: "" });
    expect(v.allow).toBe(true);
    expect(v.reason).toBeNull();
  });

  it("跨域且没给理由 ⇒ 挡下（needReason）", () => {
    const v = evaluateScopeOverride({ scopeOk: false, override: "", message: "x" });
    expect(v.allow).toBe(false);
    expect(v.needReason).toBe(true);
  });

  it("只写 1 / true / yes 不算理由", () => {
    for (const r of ["1", "true", "TRUE", "yes", "on"]) {
      const v = evaluateScopeOverride({ scopeOk: false, override: r, message: r });
      expect(v.needReason, r).toBe(true);
    }
  });

  it("理由太短不算（至少 8 字符）", () => {
    const v = evaluateScopeOverride({ scopeOk: false, override: "因为", message: "因为" });
    expect(v.needReason).toBe(true);
  });

  it("有理由但没写进提交说明 ⇒ 挡下（needInMessage）", () => {
    const v = evaluateScopeOverride({
      scopeOk: false,
      override: "这是同一处改动的两个域",
      message: "feat(tooling): 改了点东西",
    });
    expect(v.allow).toBe(false);
    expect(v.needInMessage).toBe(true);
    expect(v.reason).toBe("这是同一处改动的两个域");
  });

  it("理由写进了提交说明 ⇒ 放行", () => {
    const msg = "feat(tooling): 改了点东西" + String.fromCharCode(10) + "跨域原因：这是同一处改动的两个域";
    const v = evaluateScopeOverride({
      scopeOk: false,
      override: "这是同一处改动的两个域",
      message: msg,
    });
    expect(v.allow).toBe(true);
    expect(v.reason).toBe("这是同一处改动的两个域");
  });
});
