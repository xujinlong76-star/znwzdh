/**
 * speculative-intent/compute.ts + regex.ts + encoding.ts 覆盖。
 *
 * 这三个文件此前没有任何测试引用：算术/颜色/UUID/字节换算、
 * 正则沙箱、Base64/URL/JSON/哈希指纹检测全部没有回归保护。
 */
import { describe, expect, it } from "vitest";
import {
  tryParseByteSize,
  tryParseColor,
  tryParseMath,
  tryParseUuidOrUlid,
} from "../src/speculative-intent/compute.ts";
import { tryParseRegex } from "../src/speculative-intent/regex.ts";
import {
  tryDetectHash,
  tryParseBase64,
  tryParseJson,
  tryParseUrlEncoding,
} from "../src/speculative-intent/encoding.ts";

describe("tryParseMath", () => {
  it("四则/幂/取模/括号/小数", () => {
    expect(tryParseMath("1+2*3")?.copyValue).toBe("7");
    expect(tryParseMath("(1+2)*3")?.copyValue).toBe("9");
    expect(tryParseMath("2^10")?.copyValue).toBe("1024");
    expect(tryParseMath("10%3")?.copyValue).toBe("1");
    expect(tryParseMath("10/4")?.copyValue).toBe("2.5");
    expect(tryParseMath("1/3")?.copyValue).toBe("0.3333");
    expect(tryParseMath(" 2 + 2 ")?.previewValue).toBe("4");
    expect(tryParseMath("2^0.5")?.copyValue).toBe("1.4142");
  });

  it("日期、版本号、纯数字、非法字符、超长、除零一律返回 null", () => {
    expect(tryParseMath("2026-02-30")).toBeNull();
    expect(tryParseMath("2026/02/30")).toBeNull();
    expect(tryParseMath("1.2.3")).toBeNull();
    expect(tryParseMath("42")).toBeNull();
    expect(tryParseMath("abc+1")).toBeNull();
    expect(tryParseMath("1/0")).toBeNull();
    expect(tryParseMath("1+".repeat(150))).toBeNull();
    expect(tryParseMath("(1+2")).toBeNull();
    expect(tryParseMath("")).toBeNull();
  });
});

describe("tryParseColor", () => {
  it("HEX：# 前缀 6 位 / 3 位展开 / 裸 6 位 / 8 位带 alpha", () => {
    expect(tryParseColor("#ff0000")?.copyValue).toBe("#FF0000");
    expect(tryParseColor("#ff0000")?.details.RGB).toBe("rgb(255, 0, 0)");
    expect(tryParseColor("#f00")?.copyValue).toBe("#FF0000");
    expect(tryParseColor("aabbcc")?.copyValue).toBe("#AABBCC");
    const alpha = tryParseColor("#ff000080");
    expect(alpha?.copyValue).toBe("#FF000080");
    expect(alpha?.details.Alpha).toBe("80");
    expect(alpha?.subtitle).toContain("alpha 80");
  });

  it("裸 3 位 hex 不触发（误触发太多）", () => {
    expect(tryParseColor("abc")).toBeNull();
    expect(tryParseColor("fff")).toBeNull();
  });

  it("RGB / RGBA：越界钳制到 255", () => {
    expect(tryParseColor("rgb(255, 0, 0)")?.copyValue).toBe("#FF0000");
    expect(tryParseColor("rgba(0, 128, 255, 0.5)")?.copyValue).toBe("#0080FF");
    expect(tryParseColor("rgb(300, 0, 0)")?.copyValue).toBe("#FF0000");
    expect(tryParseColor("rgb(1,2)")?.type).toBeUndefined();
  });

  it("非颜色输入返回 null", () => {
    expect(tryParseColor("hello")).toBeNull();
    expect(tryParseColor("#gggggg")).toBeNull();
  });
});

describe("tryParseUuidOrUlid", () => {
  it("UUID v4 识别与规范化", () => {
    const res = tryParseUuidOrUlid("550E8400-E29B-41D4-A716-446655440000");
    expect(res?.type).toBe("uuid");
    expect(res?.copyValue).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(res?.details["UUID 版本"]).toBe("v4");
    expect(res?.subtitle).toContain("UUID v4");
  });

  it("UUID v7 内嵌时间戳被提取", () => {
    const ts = 1700000000000;
    const hex = ts.toString(16).padStart(12, "0");
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
    const res = tryParseUuidOrUlid(uuid);
    expect(res?.details["UUID 版本"]).toBe("v7");
    expect(res?.details["内嵌时间戳"]).toContain(new Date(ts).toISOString());
    expect(res?.subtitle).toContain("UUID v7 (时序索引)");
  });

  it("ULID 识别与内嵌时间；非法字符/年份越界返回 null", () => {
    const res = tryParseUuidOrUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(res?.type).toBe("uuid");
    expect(res?.title).toContain("ULID");
    expect(res?.details["ULID"]).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(tryParseUuidOrUlid("01ARZ3NDEKTSV4RRFFQ69G5FIV")).toBeNull();
    expect(tryParseUuidOrUlid("00000000000000000000000000")).toBeNull();
    expect(tryParseUuidOrUlid("not-a-uuid")).toBeNull();
  });
});

describe("tryParseByteSize", () => {
  it("十进制与二进制单位换算", () => {
    expect(tryParseByteSize("16 GB")?.copyValue).toBe("16000000000");
    expect(tryParseByteSize("512 MiB")?.copyValue).toBe("536870912");
    expect(tryParseByteSize("1 KiB")?.copyValue).toBe("1024");
    expect(tryParseByteSize("1.5 KB")?.copyValue).toBe("1500");
    expect(tryParseByteSize("100 B")?.copyValue).toBe("100");
    expect(tryParseByteSize("2 tib")?.copyValue).toBe(String(2 * 1024 ** 4));
  });

  it("非法单位/负数返回 null", () => {
    expect(tryParseByteSize("10 XB")).toBeNull();
    expect(tryParseByteSize("-5 GB")).toBeNull();
    expect(tryParseByteSize("abc")).toBeNull();
    expect(tryParseByteSize("16")).toBeNull();
  });
});

describe("tryParseRegex", () => {
  it("隐式 /pattern/flags + 测试文本：命中与捕获组", () => {
    const res = tryParseRegex("/(\\w+)@(\\w+)/ test@example");
    expect(res?.title).toContain("匹配成功 (2 捕获组)");
    expect(res?.previewValue).toContain('✅ 匹配成功: "test@example"');
    expect(res?.previewValue).toContain('Group 1: "test"');
    expect(res?.previewValue).toContain('Group 2: "example"');
    expect(res?.copyValue).toBe("test@example");
  });

  it("命名组展示；未命中返回未命中结果", () => {
    const named = tryParseRegex("/(?<name>\\w+)/ hello");
    expect(named?.previewValue).toContain('name: "hello"');
    const miss = tryParseRegex("/xyz/ abc");
    expect(miss?.title).toBe("RegExp 未命中目标文本");
    expect(miss?.previewValue).toContain("❌ 未匹配到任何内容");
  });

  it("无测试文本时只做语法检查", () => {
    const res = tryParseRegex("/\\d+/g");
    expect(res?.title).toBe("RegExp 正则表达式语法有效");
    expect(res?.details["捕获组数"]).toBe("0");
    const grouped = tryParseRegex("/(a)(b)?/");
    expect(grouped?.details["捕获组数"]).toBe("2");
  });

  it("显式前缀：斜杠/引号/空格三种写法；非法正则报语法错误", () => {
    expect(tryParseRegex("regex: \\d+ abc123")?.title).toContain("匹配成功");
    expect(tryParseRegex('regex: "\\d+" abc123')?.title).toContain("匹配成功");
    expect(tryParseRegex("regex: \\d+")?.title).toBe("RegExp 正则表达式语法有效");
    const bad = tryParseRegex("regex: ([");
    expect(bad?.title).toBe("RegExp 正则表达式语法错误");
    expect(bad?.details["语法状态"]).toBe("❌ 语法错误");
  });

  it("隐式非法正则返回 null；URL 与 // 开头不误判；超长返回 null", () => {
    expect(tryParseRegex("/([/")).toBeNull();
    expect(tryParseRegex("https://example.com/a/b")).toBeNull();
    expect(tryParseRegex("//comment")).toBeNull();
    expect(tryParseRegex("/a/ " + "x".repeat(600))).toBeNull();
    expect(tryParseRegex("")).toBeNull();
  });

  it("嵌套量词 + 长文本触发 ReDoS 保护；短文本正常求值", () => {
    const blocked = tryParseRegex("/(a+)+/ " + "a".repeat(30));
    expect(blocked?.title).toBe("RegExp 回溯风险保护已触发");
    const ok = tryParseRegex("/(a+)+/ aaa");
    expect(ok?.title).toContain("匹配成功");
  });
});

describe("tryParseBase64", () => {
  it("隐式解码与显式 b64:/b64e: 编解码", () => {
    expect(tryParseBase64("aGVsbG8gd29ybGQ=")?.copyValue).toBe("hello world");
    expect(tryParseBase64("aGVsbG8gd29ybGQ")?.copyValue).toBe("hello world");
    expect(tryParseBase64("b64: aGVsbG8=")?.copyValue).toBe("hello");
    expect(tryParseBase64("b64e: hello")?.copyValue).toBe("aGVsbG8=");
    expect(tryParseBase64("base64e: 你好")?.copyValue).toBe(Buffer.from("你好").toString("base64"));
  });

  it("短串、纯数字、非法字符、解出不可打印内容时返回 null", () => {
    expect(tryParseBase64("abc")).toBeNull();
    expect(tryParseBase64("12345678")).toBeNull();
    expect(tryParseBase64("hello world!")).toBeNull();
    expect(tryParseBase64("b64:!!!")).toBeNull();
    expect(tryParseBase64("b64e:")).toBeNull();
    expect(tryParseBase64("")).toBeNull();
  });
});

describe("tryParseUrlEncoding", () => {
  it("urle: 编码；百分比解码", () => {
    expect(tryParseUrlEncoding("urle: hello world")?.copyValue).toBe("hello%20world");
    expect(tryParseUrlEncoding("hello%20world")?.copyValue).toBe("hello world");
    expect(tryParseUrlEncoding("%E4%BD%A0%E5%A5%BD")?.copyValue).toBe("你好");
  });

  it("空编码、无百分号、非法百分号序列返回 null", () => {
    expect(tryParseUrlEncoding("urle:")).toBeNull();
    expect(tryParseUrlEncoding("plain text")).toBeNull();
    expect(tryParseUrlEncoding("%ZZ")).toBeNull();
    expect(tryParseUrlEncoding("%E4%A")).toBeNull();
    // 孤立代理项会让 encodeURIComponent 抛 URIError，应返回 null 而不是抛错
    expect(tryParseUrlEncoding("urle: \uD800")).toBeNull();
  });
});

describe("tryParseJson", () => {
  it("对象与数组美化；长输出截断", () => {
    const res = tryParseJson('{"a":1,"b":2}');
    expect(res?.type).toBe("json_format");
    expect(res?.copyValue).toBe('{\n  "a": 1,\n  "b": 2\n}');
    expect(res?.subtitle).toContain("2 个属性键");
    expect(tryParseJson("[1,2,3]")?.subtitle).toContain("3 项数组");
    const long = tryParseJson(JSON.stringify({ k: "x".repeat(200) }));
    expect(long?.previewValue.endsWith("...")).toBe(true);
  });

  it("非 JSON、未闭合、非法 JSON、过短、超长返回 null", () => {
    expect(tryParseJson("abc")).toBeNull();
    expect(tryParseJson('{"a":1')).toBeNull();
    expect(tryParseJson('{"a":}')).toBeNull();
    expect(tryParseJson("{}")).toBeNull();
    expect(tryParseJson("x".repeat(10001))).toBeNull();
  });
});

describe("tryDetectHash", () => {
  it("按长度识别四种哈希指纹，大写被归一化为小写", () => {
    const md5 = "5D41402ABC4B2A76B9719D911017C592";
    expect(tryDetectHash(md5)?.title).toContain("MD5 (128-bit)");
    expect(tryDetectHash(md5)?.copyValue).toBe(md5.toLowerCase());
    expect(tryDetectHash("a".repeat(40))?.title).toContain("SHA-1 (160-bit)");
    expect(tryDetectHash("b".repeat(64))?.title).toContain("SHA-256 (256-bit)");
    expect(tryDetectHash("c".repeat(128))?.title).toContain("SHA-512 (512-bit)");
  });

  it("非十六进制或长度不符返回 null", () => {
    expect(tryDetectHash("z".repeat(32))).toBeNull();
    expect(tryDetectHash("a".repeat(31))).toBeNull();
    expect(tryDetectHash("a".repeat(33))).toBeNull();
    expect(tryDetectHash("hello")).toBeNull();
  });
});
