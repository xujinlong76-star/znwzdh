/**
 * ssrf-ports.ts 覆盖：禁用端口并集事实源、端口归一化、差异报告。
 * （apps/web 的漂移测试覆盖的是「本表与两侧实现一致」，此处补齐
 *  本表自身三个导出函数的单元覆盖。）
 */
import { describe, expect, it } from "vitest";
import {
  BLOCKED_PORTS_UNION,
  diffPortSets,
  isBlockedPortUnion,
  KNOWN_PORT_DRIFT,
  normalizePort,
} from "../src/ssrf-ports.ts";

describe("BLOCKED_PORTS_UNION / KNOWN_PORT_DRIFT", () => {
  it("并集共 49 个端口，升序、无重复、已冻结", () => {
    expect(BLOCKED_PORTS_UNION).toHaveLength(49);
    expect([...BLOCKED_PORTS_UNION].sort((a, b) => a - b)).toEqual([...BLOCKED_PORTS_UNION]);
    expect(new Set(BLOCKED_PORTS_UNION).size).toBe(49);
    expect(Object.isFrozen(BLOCKED_PORTS_UNION)).toBe(true);
  });

  it("包含典型高危端口，不含常规 Web 端口", () => {
    for (const p of [21, 22, 23, 25, 445, 1433, 3306, 5432, 6379, 27017]) {
      expect(BLOCKED_PORTS_UNION).toContain(p);
    }
    for (const p of [80, 443, 8080, 8443]) {
      expect(BLOCKED_PORTS_UNION).not.toContain(p);
    }
  });

  it("已知漂移清单当前已归零（两侧都等于并集）", () => {
    expect(KNOWN_PORT_DRIFT.aiOnly).toEqual([]);
    expect(KNOWN_PORT_DRIFT.webOnly).toEqual([]);
  });
});

describe("normalizePort", () => {
  it("number / 数字字符串 / 带空白字符串均归一化", () => {
    expect(normalizePort(80)).toBe(80);
    expect(normalizePort("8080")).toBe(8080);
    expect(normalizePort(" 443 ")).toBe(443);
  });

  it("空值与越界/非整数返回 null", () => {
    expect(normalizePort(null)).toBeNull();
    expect(normalizePort(undefined)).toBeNull();
    expect(normalizePort("")).toBeNull();
    expect(normalizePort(0)).toBeNull();
    expect(normalizePort(-1)).toBeNull();
    expect(normalizePort(65536)).toBeNull();
    expect(normalizePort(1.5)).toBeNull();
    expect(normalizePort("abc")).toBeNull();
    expect(normalizePort("80.5")).toBeNull();
    expect(normalizePort("  ")).toBeNull();
  });

  it("边界 1 与 65535 合法", () => {
    expect(normalizePort(1)).toBe(1);
    expect(normalizePort(65535)).toBe(65535);
  });
});

describe("isBlockedPortUnion", () => {
  it("并集内端口（number 或 string）返回 true", () => {
    expect(isBlockedPortUnion(22)).toBe(true);
    expect(isBlockedPortUnion("3306")).toBe(true);
    expect(isBlockedPortUnion(" 5432 ")).toBe(true);
  });

  it("并集外端口与非法输入返回 false", () => {
    expect(isBlockedPortUnion(80)).toBe(false);
    expect(isBlockedPortUnion(443)).toBe(false);
    expect(isBlockedPortUnion(null)).toBe(false);
    expect(isBlockedPortUnion("abc")).toBe(false);
    expect(isBlockedPortUnion(0)).toBe(false);
  });
});

describe("diffPortSets", () => {
  it("算出仅 A、仅 B 与并集，均升序", () => {
    expect(diffPortSets([22, 80], [80, 443])).toEqual({
      aiOnly: [22],
      webOnly: [443],
      union: [22, 80, 443],
    });
  });

  it("字符串端口与非法条目被归一化/过滤；空集与相同集合", () => {
    expect(diffPortSets(["22", "abc", 0], ["22"])).toEqual({ aiOnly: [], webOnly: [], union: [22] });
    expect(diffPortSets([], [])).toEqual({ aiOnly: [], webOnly: [], union: [] });
    expect(diffPortSets([80, 443], [443, 80])).toEqual({ aiOnly: [], webOnly: [], union: [80, 443] });
  });
});
