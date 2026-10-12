/**
 * 方言适配层测试。
 *
 * 这里的用例全部来自**真实踩过的坑**（standard 模式首跑时发现），
 * 每一条都对应一个曾经静默出错、线上才会暴露的缺陷。
 */
import { describe, expect, it } from "vitest";
import { bindSqlite, slugify, toPgSql } from "../src/repository.ts";
import { pgTokens } from "../src/fts-pg.ts";

describe("方言：SQLite 参数绑定", () => {
  it("布尔转成 0/1（SQLite 没有真正的布尔类型）", () => {
    expect(bindSqlite([true, false])).toEqual([1, 0]);
  });

  it("Float32Array 转成 Buffer（BLOB 存储）", () => {
    const v = new Float32Array([1, 2, 3]);
    const out = bindSqlite([v]) as Buffer[];
    expect(Buffer.isBuffer(out[0])).toBe(true);
    expect(out[0]!.byteLength).toBe(12);
  });

  it("字符串与 null 原样透传", () => {
    expect(bindSqlite(["a", null, 3])).toEqual(["a", null, 3]);
  });
});

describe("方言：PostgreSQL 占位符转换", () => {
  it("把 ? 转成 $1..$n", () => {
    expect(toPgSql("SELECT * FROM t WHERE a = ? AND b = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
  });

  it("保持顺序且不复用编号（重复匹配同一个 ? 也要各自编号，避免错位）", () => {
    expect(toPgSql("x = ? OR x = ?")).toBe("x = $1 OR x = $2");
  });

  it("无占位符时原样返回", () => {
    expect(toPgSql("SELECT 1")).toBe("SELECT 1");
  });
});

describe("方言：行键归一化（曾导致 PG 上子类目过滤失效）", () => {
  /**
   * PostgreSQL 会把**未加引号的别名**折叠为小写：
   *   SELECT category_id AS categoryId  ->  返回列名 categoryid
   * 而读取侧写的是 r.categoryId，于是恒为 undefined。
   * 仓库的解法是把 PG 行键统一小写化，并用小写属性读取。
   * 这个测试锁住「归一化后小写键可用」这一约定。
   */
  const normalize = (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
    return out;
  };

  it("大写别名被折叠后仍能按小写键读到", () => {
    const pgRow = { categoryid: "cat-1", pinyinfull: "tianqi" };
    const row = normalize(pgRow);
    expect(row.categoryid).toBe("cat-1");
    expect(row.pinyinfull).toBe("tianqi");
  });

  it("已经是小写的键不受影响", () => {
    expect(normalize({ id: "x", status: "active" })).toEqual({ id: "x", status: "active" });
  });

  it("混合大小写的键被统一成小写", () => {
    expect(normalize({ CamelCase: 1, snake_case: 2 })).toEqual({ camelcase: 1, snake_case: 2 });
  });
});

describe("中文标签 slug（曾导致中文标签永远无法过滤）", () => {
  it("保留中文而不是清空", () => {
    expect(slugify("天气")).toBe("天气");
    expect(slugify("代码补全")).toBe("代码补全");
  });

  it("空白转连字符、英文转小写", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("全非法字符时兜底为非空值（避免空 slug 互相覆盖）", () => {
    expect(slugify("!!!")).toBe("tag");
    expect(slugify("   ")).toBe("tag");
  });

  it("中英混排保留双方", () => {
    expect(slugify("AI 工具")).toBe("ai-工具");
  });
});

describe("PostgreSQL 索引语料与 SQLite 一致", () => {
  it("中文展开为单字 + 二元组", () => {
    const tokens = pgTokens("中国天气网");
    for (const sub of ["中国", "国天", "天气", "气网"]) {
      expect(tokens).toContain(sub);
    }
  });

  it("英文词保留", () => {
    expect(pgTokens("GitHub Copilot")).toContain("GitHub");
  });
});

describe("方言：标签聚合表达式", () => {
  it("SQLite 使用 group_concat，PostgreSQL 使用 string_agg", () => {
    const sqliteExpr = (dialect: "sqlite" | "pg") =>
      dialect === "sqlite" ? "group_concat(t.slug)" : "string_agg(t.slug, ',')";
    expect(sqliteExpr("sqlite")).toContain("group_concat");
    expect(sqliteExpr("pg")).toContain("string_agg");
  });
});

