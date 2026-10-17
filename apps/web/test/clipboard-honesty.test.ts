/**
 * 复制到剪贴板必须**确认真的成功**，否则不许说「已复制」。
 *
 * 改动前有三种「凭空报喜」的写法：
 *
 *     void navigator.clipboard.writeText(url)   // 失败无人接住
 *     toast({ title: '🔗 已复制免登专属分享链接！' })
 *
 * 而剪贴板写入在真实环境里经常失败：非 HTTPS/localhost 时 `navigator.clipboard`
 * 根本不存在（取 `.writeText` 直接抛 TypeError），页面失去焦点或权限被拒时 Promise
 * 会 reject。用户看到「已复制」，粘出来是空的。
 *
 * 这里守三件事：
 *   1. `copyText()` 把每种失败都如实回报（不抛异常、不假装成功）；
 *   2. 全仓不允许再出现「没人接住的 clipboard 写入」；
 *   3. 各个复制入口只有在 `result.ok` 时才显示成功。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIPBOARD_DENIED,
  CLIPBOARD_EMPTY,
  CLIPBOARD_UNSUPPORTED,
  clipboardSupported,
  copyFailureToast,
  copyText,
} from "../src/lib/clipboard";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();

function overlaySource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyText：每种失败都如实回报", () => {
  it("空内容不算成功（空字符串也不该宣告「已复制」）", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => undefined } });
    const result = await copyText("");
    expect(result).toEqual({ ok: false, reason: CLIPBOARD_EMPTY });
  });

  it("环境根本没有剪贴板 API（非安全上下文/老浏览器）：说清是环境问题", async () => {
    vi.stubGlobal("navigator", {});
    expect(clipboardSupported()).toBe(false);
    const result = await copyText("x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(CLIPBOARD_UNSUPPORTED);
  });

  it("navigator 完全不存在也不炸", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(clipboardSupported()).toBe(false);
    const result = await copyText("x");
    expect(result).toEqual({ ok: false, reason: CLIPBOARD_UNSUPPORTED });
  });

  it("写入成功 → ok", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const result = await copyText("已复制的内容");
    expect(result).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("已复制的内容");
  });

  it("写入被拒（Promise reject）→ 明确失败，不抛给调用方", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new DOMException("NotAllowedError");
        },
      },
    });
    const result = await copyText("x");
    expect(result).toEqual({ ok: false, reason: CLIPBOARD_DENIED });
  });

  it("写入同步抛错（有些实现直接 throw）也归为失败", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => {
          throw new Error("boom");
        },
      },
    });
    const result = await copyText("x");
    expect(result).toEqual({ ok: false, reason: CLIPBOARD_DENIED });
  });

  it("失败提示统一措辞，并给出「手动复制」的退路", () => {
    const note = copyFailureToast({ ok: false, reason: CLIPBOARD_DENIED });
    expect(note.title).toBe("复制失败");
    expect(note.description).toContain(CLIPBOARD_DENIED);
    expect(note.description).toContain("Ctrl/Cmd+C");
  });
});

/** 找出「没人接住的 writeText」：语句里既没有 await，后面也没有 .then( */
function unawaitedClipboardWrites(): string[] {
  const offenders: string[] = [];
  for (const rel of listSources(join(ROOT, "src"))) {
    if (rel.endsWith("lib/clipboard.ts")) continue; // 封装层本身就是要 await 的地方
    const src = overlaySource(rel);
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/\.writeText\(/.test(line)) return;
      // 连同后两行一起看（`.then(` 常写在下一行）
      const window = lines.slice(i, i + 3).join(" ");
      if (/\bawait\b/.test(line) || /\.then\(/.test(window)) return;
      offenders.push(`${rel}:${i + 1} :: ${line.trim()}`);
    });
  }
  return offenders;
}

describe("全仓：clipboard 写入不许无人接住", () => {
  it("扫描确实看到了 writeText 调用（否则空数组会假装通过）", () => {
    const withWrites = listSources(join(ROOT, "src")).filter((rel) => /\.writeText\(/.test(overlaySource(rel)));
    expect(withWrites.length).toBeGreaterThan(2);
  });

  it("没有 `void navigator.clipboard.writeText(...)` 这类写法", () => {
    expect(unawaitedClipboardWrites()).toEqual([]);
  });
});

describe("各复制入口只在真的成功后才显示成功", () => {
  const cases: Array<{ file: string; label: string }> = [
    { file: "src/components/home-diy-toolbar.tsx", label: "DIY 工具栏（3 处）" },
    { file: "src/app/site/[id]/page.tsx", label: "站点详情页复制链接" },
    { file: "src/components/architecture-recipe-card.tsx", label: "架构配方卡" },
    { file: "src/components/speculative-intent-card.tsx", label: "推测意图卡" },
  ];

  it.each(cases)("$label 走统一的 copyText，且不再直接摸 navigator.clipboard", ({ file }) => {
    const src = overlaySource(file);
    expect(src).toContain("copyText(");
    expect(src).not.toContain("navigator.clipboard");
  });

  it("站点详情页：只有 ok 才显示「已复制」，失败时给失败态", () => {
    const src = overlaySource("src/app/site/[id]/page.tsx");
    expect(src).toContain("await copyText(site.url)");
    expect(src).toContain("setCopyState(result.ok ? 'copied' : 'failed')");
    expect(src).toContain("复制失败，请手动选中链接复制");
  });

  it("架构配方卡 / 推测意图卡：失败态有独立文案，不会显示「已复制」", () => {
    for (const file of ["src/components/architecture-recipe-card.tsx", "src/components/speculative-intent-card.tsx"]) {
      const src = overlaySource(file);
      expect(src, file).toContain("copyState === 'failed'");
      expect(src, file).toContain("'复制失败'");
      expect(src, file).toContain("copyState === 'copied'");
    }
  });

  it("DIY 工具栏：三处复制都在成功提示之前先处理失败", () => {
    const src = overlaySource("src/components/home-diy-toolbar.tsx");
    expect(src).toContain("copyFailureToast(result)");
    expect((src.match(/if \(!result\.ok\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((src.match(/await copyText\(/g) || []).length).toBeGreaterThanOrEqual(3);
    // 成功文案必须排在失败处理之后（先判断、再报喜）
    const guardAt = src.indexOf("const result = await copyText(url)");
    const successAt = src.indexOf("已复制免登专属分享链接");
    expect(guardAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(guardAt);
    expect(src.slice(guardAt, successAt)).toContain("if (!result.ok)");
  });
});
