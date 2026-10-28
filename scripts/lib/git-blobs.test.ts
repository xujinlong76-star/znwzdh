/**
 * `scripts/lib/git-blobs.mjs` 的单测。
 *
 * 这个模块是「读提交」类闸门的共用底座，它有两种坏法：
 *   - 字节数当字符数用 → 含中文的文件被切错（本仓库每个源码文件都有中文），
 *     轻则解析报错，重则内容对不上却报「一致」；
 *   - ref 不存在时逐个路径报 missing → 被上层算成「全都漂移」。
 * 所以这里既比对 `git show` 的权威输出，也钉住无效 ref 的行为。
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readBlobs, refExists } from "./git-blobs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** 选一个确定入库、且正文里一定有中文的文件路径 */
const MULTIBYTE = "scripts/core-mirrors.json";

describe("readBlobs", () => {
  it("读出的内容与 git show 逐字符相同（中文不能被切坏）", () => {
    const expected = execFileSync("git", ["show", `HEAD:${MULTIBYTE}`], { cwd: ROOT, encoding: "utf8" });
    const contents = readBlobs("HEAD", [MULTIBYTE], { cwd: ROOT });
    expect([...contents.keys()]).toEqual([MULTIBYTE]);
    expect(contents.get(MULTIBYTE)).toBe(expected);
    expect(JSON.parse(expected)._comment).toContain("镜像");
  });

  it("多文件一次进程读完，顺序与请求一致", () => {
    const paths = [MULTIBYTE, "scripts/lib/core-mirror.mjs"];
    const contents = readBlobs("HEAD", paths, { cwd: ROOT });
    expect([...contents.keys()]).toEqual(paths);
  });

  it("不存在的路径从结果里缺席，而不是抛错或塞进空串", () => {
    const contents = readBlobs("HEAD", [MULTIBYTE, "scripts/不存在的文件.ts"], { cwd: ROOT });
    expect(contents.has("scripts/不存在的文件.ts")).toBe(false);
    expect(contents.has(MULTIBYTE)).toBe(true);
  });

  it("空请求不启动 git 进程", () => {
    expect(readBlobs("HEAD", [], { cwd: ROOT }).size).toBe(0);
  });

  it("重复路径只读一次", () => {
    const contents = readBlobs("HEAD", [MULTIBYTE, MULTIBYTE], { cwd: ROOT });
    expect(contents.size).toBe(1);
  });
});

describe("refExists", () => {
  it("HEAD 与真实 sha 前缀都算存在", () => {
    expect(refExists("HEAD", { cwd: ROOT })).toBe(true);
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(refExists(sha.slice(0, 8), { cwd: ROOT })).toBe(true);
  });

  it("无效 ref 返回 false，让上层拒绝给结论", () => {
    expect(refExists("definitely-not-a-ref-9f3a", { cwd: ROOT })).toBe(false);
  });
});
