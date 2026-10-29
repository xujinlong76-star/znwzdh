import { describe, expect, it } from "vitest";
import { buildFtsQuery, buildPgTsQuery } from "../src/cjk.ts";

/**
 * 方言查询构造器（P0-4）。
 *
 * 关键差异（曾经把 standard 模式的全文通道整条打死）：
 *   FTS5     → `"term"*`，连接符 `OR`
 *   tsquery  → `'term':*`，连接符 `|`
 * 直接把 FTS5 串喂给 to_tsquery 会抛语法错误，而 fts-pg 的 catch 会吞成零命中。
 */
describe("buildPgTsQuery：PostgreSQL tsquery 语法", () => {
  it("中文二元组用单引号词元，不用双引号", () => {
    const q = buildPgTsQuery("启动");
    expect(q).toBe("'启动'");
    expect(q).not.toContain('"');
  });

  it("长中文拆成相邻二元组，用 | 连接", () => {
    const q = buildPgTsQuery("启动脚本");
    expect(q).toBe("'启动' | '动脚' | '脚本'");
  });

  it("拉丁词用 :* 前缀，而不是尾星号", () => {
    const q = buildPgTsQuery("copilot");
    expect(q).toBe("'copilot':*");
    expect(q).not.toContain('"');
    expect(q).not.toContain("*'");
  });

  it("中英混合：中文二元组 + 英文前缀，统一用 | 连接", () => {
    const q = buildPgTsQuery("AI 代码补全");
    expect(q).toContain("'代码'");
    expect(q).toContain("'AI':*");
    expect(q).toContain(" | ");
    expect(q).not.toContain(" OR ");
  });

  it("纯标点/空白返回 null，让调用方直接跳过 FTS 通道", () => {
    expect(buildPgTsQuery("！！！")).toBeNull();
    expect(buildPgTsQuery("   ")).toBeNull();
    expect(buildPgTsQuery("a")).toBeNull(); // 单字母拉丁词不构造前缀（避免全表命中）
  });

  it("与 FTS5 构造器产出不同语法（防止有人再把两者合并）", () => {
    const sqlite = buildFtsQuery("copilot");
    const pg = buildPgTsQuery("copilot");
    expect(sqlite).toBe('"copilot"*');
    expect(pg).toBe("'copilot':*");
    expect(sqlite).not.toBe(pg);
  });
});
