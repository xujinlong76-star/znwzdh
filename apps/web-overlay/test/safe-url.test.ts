import { describe, expect, it } from "vitest";
import { safeHref, safeSrc } from "@/lib/safe-url";

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

  it("空值与自定义 fallback", () => {
    expect(safeHref(undefined)).toBe("#");
    expect(safeHref("", "/")).toBe("/");
    expect(safeHref("  /admin  ")).toBe("/admin");
    expect(safeSrc("//evil.example/a.png")).toBeUndefined();
    expect(safeSrc("https://navhub.example/a.png")).toBe("https://navhub.example/a.png");
  });
});
