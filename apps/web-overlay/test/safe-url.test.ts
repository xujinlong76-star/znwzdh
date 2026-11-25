import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, safeHref, safeSrc, toRawGithubUrl } from "@/lib/safe-url";

describe("safeHref：站内路径与外部 URL 边界", () => {
  it("保留站内绝对路径、锚点和相对路径", () => {
    expect(safeHref("/admin?x=1#top")).toBe("/admin?x=1#top");
    expect(safeHref("#top")).toBe("#top");
    expect(safeHref("./docs")).toBe("./docs");
    expect(safeHref("../docs")).toBe("../docs");
  });

  it("协议相对路径与反斜杠变体不得当站内路径", () => {
    expect(safeHref("//evil.example/path")).toBe("#");
    expect(safeHref("/\\evil.example/path")).toBe("#");
  });

  it("仅放行 http(s) 完整 URL，伪协议回退", () => {
    expect(safeHref("https://navhub.example/a")).toBe("https://navhub.example/a");
    expect(safeHref("http://navhub.example/a")).toBe("http://navhub.example/a");
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("控制字符：浏览器会先删掉再解析，所以校验的串必须就是它删完之后的串", () => {
    // "/\t/evil.example" 删掉 Tab 就是 "//evil.example"：协议相对路径，站外
    expect(safeHref("/\t/evil.example/path")).toBe("#");
    expect(safeHref("/\n/evil.example/path")).toBe("#");
    expect(safeHref("./\t/evil.example")).toBe("#");
    // 伪协议拆在控制字符里（new URL 会先把字符删掉，protocol 变成 javascript:）
    expect(safeHref("java\tscript:alert(1)")).toBe("#");
    expect(safeHref("java\nscript:alert(1)")).toBe("#");
    expect(isSafeHttpUrl("https://navhub.example/a\tb")).toBe(false);
  });

  it("userinfo 伪装：显示的域名与真正打开的域名不是同一个", () => {
    expect(safeHref("https://navhub.example@evil.example")).toBe("#");
    expect(safeHref("https://navhub.example:pw@evil.example/p")).toBe("#");
    expect(isSafeHttpUrl("https://navhub.example@evil.example")).toBe(false);
    // 正常带端口与查询的 URL 不受影响
    expect(safeHref("https://navhub.example:8443/a?b=1#c")).toBe("https://navhub.example:8443/a?b=1#c");
  });

  it("空值与自定义 fallback", () => {
    expect(safeHref(undefined)).toBe("#");
    expect(safeHref("", "/")).toBe("/");
    expect(safeHref("  /admin  ")).toBe("/admin");
    expect(safeSrc("//evil.example/a.png")).toBeUndefined();
    expect(safeSrc("https://navhub.example/a.png")).toBe("https://navhub.example/a.png");
  });
});

describe("toRawGithubUrl：blob 链接转 raw 链接只认 github.com 主机名", () => {
  it("标准 blob 链接正确转 raw，保留查询与锚点", () => {
    expect(toRawGithubUrl("https://github.com/o/r/blob/main/x.json")).toBe(
      "https://raw.githubusercontent.com/o/r/main/x.json",
    );
    expect(toRawGithubUrl("https://github.com/o/r/blob/main/x.json?x=1#top")).toBe(
      "https://raw.githubusercontent.com/o/r/main/x.json?x=1#top",
    );
  });

  it("非 blob 链接与非 github.com 主机返回 null（不改写）", () => {
    expect(toRawGithubUrl("https://github.com/o/r")).toBeNull();
    expect(toRawGithubUrl("https://raw.githubusercontent.com/o/r/main/x.json")).toBeNull();
    expect(toRawGithubUrl("https://example.com/a/b")).toBeNull();
    expect(toRawGithubUrl("not a url")).toBeNull();
    expect(toRawGithubUrl("")).toBeNull();
  });

  it("子串绕过不生效：github.com.evil.com 与查询串里的 github.com/ 都不转", () => {
    // 旧实现 includes("github.com/") 会把这两者都误判为 blob 链接并改写。
    expect(toRawGithubUrl("https://github.com.evil.com/o/r/blob/main/x.json")).toBeNull();
    expect(toRawGithubUrl("https://evil.com/?u=https://github.com/o/r/blob/main/x.json")).toBeNull();
    expect(toRawGithubUrl("https://evil.com/github.com/o/r/blob/main/x.json")).toBeNull();
  });

  it("主机名大小写与末尾点不影响判定", () => {
    expect(toRawGithubUrl("https://GitHub.COM/o/r/blob/main/x.json")).toBe(
      "https://raw.githubusercontent.com/o/r/main/x.json",
    );
  });
});
