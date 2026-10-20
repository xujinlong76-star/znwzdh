import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 一键推仓脚本的静态安全守卫。
 *
 * 这些脚本是手工运维入口，不参与应用运行时；但历史上会无条件 `git add -A`
 * 并删除/重建 origin，在多会话 WIP 仓库里容易把别人的改动或远端配置一起卷走。
 * 这里锁住默认行为：只暂存已跟踪修改、改绑远端需显式逃生阀、不 force-push。
 */
describe("push-to-github 脚本安全默认值", () => {
  const sh = readFileSync(new URL("./push-to-github.sh", import.meta.url), "utf8");
  const bat = readFileSync(new URL("./push-to-github.bat", import.meta.url), "utf8");

  for (const [name, source] of [
    ["sh", sh],
    ["bat", bat],
  ] as const) {
    it(`${name}: 默认只暂存已跟踪文件，全量暂存需显式开启`, () => {
      expect(source).toContain("git add -u");
      expect(source).toContain("NAVHUB_PUSH_ALL");
    });

    it(`${name}: 不删除/重建 origin，不 force-push`, () => {
      expect(source).not.toContain("git remote remove origin");
      expect(source).not.toMatch(/git\s+push[^\n]*--force/);
    });

    it(`${name}: 空提交与提交失败不被误判为成功`, () => {
      expect(source).toContain("git diff --cached --quiet");
    });
  }

  it("bat: 改绑远端比较需要延迟展开", () => {
    expect(bat).toContain("EnableDelayedExpansion");
    expect(bat).toContain("NAVHUB_PUSH_REPO_FORCE");
  });

  it("sh: 改绑远端需要显式逃生阀", () => {
    expect(sh).toContain("NAVHUB_PUSH_REPO_FORCE");
  });
});
