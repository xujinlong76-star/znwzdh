/**
 * 个人数据工具的归属守卫（run42）。
 *
 * 真实缺陷（2026-10-25 只读取证）：`sync_crdt_operations` 把落库键 `crdt:<userId>` 直接取自
 * 工具入参，函数内唯一的权限检查是 requireScope("write") —— 于是任何持 write 令牌的身份
 * （自 cbe4674 起个人令牌也能带 write）都能覆盖任意用户的排版行，而这张表就是云端金库
 * 使用的 user_vault_sync；同文件还调无条件 saveUserVault，绕开行级 version 的前置条件。
 *
 * 本文件锁住四件事，防止以后又被"图省事"改回去：
 *   1. 身份只从 tc.ownerIdentity 取，且复用 handlers/shared.ts 的同一份实现（不允许长第二份）；
 *   2. 个人数据的写入必须走带版本前置条件的 saveUserVaultIfUnchanged，不得退回 saveUserVault；
 *   3. 重试耗尽后不得用无条件覆盖兜底；
 *   4. schema 里 userId 必须是可选（保留只为给旧客户端一句人话拒绝），且新增 expectedVersion。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const stateSync = src("../src/handlers/state-sync.ts");
const userCenter = src("../src/handlers/user-center.ts");
const shared = src("../src/handlers/shared.ts");
const schemas = src("../../core/src/mcp-schemas.ts");

describe("sync_crdt_operations 的身份归属与版本前置条件", () => {
  it("身份取自 tc.ownerIdentity，落库键不再由入参决定", () => {
    expect(stateSync).toContain("requireOwnerIdentity(tc)");
    expect(stateSync).toContain('const crdtKey = "crdt:" + owner;');
    expect(stateSync).not.toContain('const crdtKey = "crdt:" + input.userId;');
    // 越权调用必须被显式拒绝，而不是静默写到别人名下
    expect(stateSync).toContain('"identity-mismatch"');
  });

  it("审计 target 用归属人，不用调用方传的参数", () => {
    expect(stateSync).toContain("target: owner,");
    expect(stateSync).not.toContain("target: input.userId,");
  });

  it("写入走带前置条件的 saveUserVaultIfUnchanged，全文件不得再出现无条件 saveUserVault", () => {
    expect(stateSync).toContain("ctx.repo.saveUserVaultIfUnchanged(");
    expect(stateSync).not.toMatch(/ctx\.repo\.saveUserVault\(/);
  });

  it("跨端一致性：与 web 侧 /api/crdt/sync 同用 version 前置条件（不是先读后写）", () => {
    expect(stateSync).toContain("existing?.version ?? 0");
  });

  it("归属校验只有一份实现：user-center 与 state-sync 都走 shared.ts", () => {
    expect(shared).toContain("export function requireOwnerIdentity(");
    expect(userCenter).toContain("requireOwnerIdentity(tc)");
    expect(userCenter).not.toContain("function requireOwner(");
  });
});

describe("SyncCrdtOperationsInput 契约", () => {
  const block = schemas.slice(
    schemas.indexOf("export const SyncCrdtOperationsInput"),
    schemas.indexOf("});", schemas.indexOf("export const SyncCrdtOperationsInput")) + 3,
  );

  it("userId 已改为可选并标注废弃（保留只为给旧客户端一句人话拒绝）", () => {
    expect(block).toContain("userId: z.string().optional()");
    expect(block).toContain("已废弃");
  });

  it("新增 expectedVersion 供客户端声明它看到的版本", () => {
    expect(block).toContain("expectedVersion: z.number().int().min(0).optional()");
  });
});
