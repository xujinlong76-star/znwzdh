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
 * 这里守四件事：
 *   1. `copyText()` 把每种失败都如实回报（不抛异常、不假装成功）；
 *   2. 全仓不允许再出现「没人接住的 clipboard 写入」；
 *   3. 各个复制入口只有在 `result.ok` 时才显示成功；
 *   4. 只有白名单里的文件可以直接碰 `navigator.clipboard`（见文末
 *      RAW_CLIPBOARD_ALLOWLIST），其余一律走 `copyText`。
 *
 * 第 4 条是补上的：第 2 条只要求「有人接住」，于是下面几种写法都能溜过去，
 * 而它们在失败时对用户**毫无表示**：
 *   - 微工具卡片：失败分支是 `() => {}`；便签：失败分支只是重设了一遍保存状态；
 *   - 工具箱抽屉：`await` 了但**没有 catch**，8 个复制按钮失败即静默（外加未处理的拒绝）；
 *   - 管理端资源页：`navigator.clipboard.writeText(url).then(...).catch(...)` ——
 *     API 缺失时取 `.writeText` 抛的是**同步** TypeError，`.catch` 根本接不到。
 * 这三类现在都走 `copyText`，并把失败原因显示给用户。
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

/**
 * 剥掉注释但保留行列位置。文档注释里会正当地提到 `navigator.clipboard`
 * （比如说明为什么要封装它），那些不该被当成「直接使用了 API」。
 */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
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
    // P1-2 拆分：三处复制入口随 handler 整体迁入 home-diy-backup-dialog.tsx
    { file: "src/components/home-diy-backup-dialog.tsx", label: "DIY 备份弹窗（3 处）" },
    // 2026-10-21 起站点详情交互体在客户端岛（服务端壳只做软 404 判定）
    { file: "src/components/site-detail-view.tsx", label: "站点详情页复制链接" },
    { file: "src/components/architecture-recipe-card.tsx", label: "架构配方卡" },
    { file: "src/components/speculative-intent-card.tsx", label: "推测意图卡" },
  ];

  it.each(cases)("$label 走统一的 copyText，且不再直接摸 navigator.clipboard", ({ file }) => {
    const src = overlaySource(file);
    expect(src).toContain("copyText(");
    expect(src).not.toContain("navigator.clipboard");
  });

  it("站点详情页：只有 ok 才显示「已复制」，失败时给失败态", () => {
    const src = overlaySource("src/components/site-detail-view.tsx");
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

  it("DIY 备份弹窗：三处复制都在成功提示之前先处理失败", () => {
    const src = overlaySource("src/components/home-diy-backup-dialog.tsx");
    expect(src).toContain("copyFailureToast(result)");
    expect((src.match(/if \(!result\.ok\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((src.match(/await copyText\(/g) || []).length).toBeGreaterThanOrEqual(3);
    // 成功文案必须排在失败处理之后（先判断、再报喜）
    // 生成分享链接现在返回 { ok, url | reason }，所以拷的是 out.url；
    // 「先判断失败、再报喜」这条顺序不变
    const guardAt = src.indexOf("const result = await copyText(out.url)");
    const successAt = src.indexOf("已复制免登专属分享链接");
    expect(guardAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(guardAt);
    expect(src.slice(guardAt, successAt)).toContain("if (!result.ok)");
  });
});

/**
 * 允许直接触碰 `navigator.clipboard` 的文件。其余地方一律走 `copyText`。
 * 每条都要给出「为什么这里可以直接用」的证据：证据消失时测试必须失败，
 * 而不是继续放行。
 *
 * 合并说明：tokens / batch-operation-dock / error 三个历史白名单条目
 * 已统一改走 `copyText`（execCommand 兜底已收进封装层），因此白名单
 * 只剩封装层本身。
 */
const RAW_CLIPBOARD_ALLOWLIST: Array<{ file: string; evidence: string[]; why: string }> = [
  {
    file: "src/lib/clipboard.ts",
    evidence: ["export async function copyText(", "export function clipboardSupported()"],
    why: "封装层本身：把「环境不支持 / 空内容 / 被拒」翻译成 CopyResult 的唯一地方。",
  },
];

describe("全仓：只有白名单里的文件可以直接碰 navigator.clipboard", () => {
  const files = listSources(join(ROOT, "src"));
  const rawUsers = files.filter((rel) => /navigator\.clipboard/.test(stripComments(overlaySource(rel))));

  it("扫描确实覆盖了整仓源码，且确实看到有文件在用（否则空集合会假装通过）", () => {
    expect(files.length).toBeGreaterThan(60);
    // 统一走 copyText 后，直接使用 Clipboard API 的只剩封装层本身。
    expect(rawUsers.length).toBeGreaterThanOrEqual(1);
  });

  it("不在白名单里的文件一律走 copyText（新写的复制入口不许再自己摸剪贴板）", () => {
    const unexplained = rawUsers.filter((rel) => !RAW_CLIPBOARD_ALLOWLIST.some((e) => e.file === rel));
    expect(
      unexplained,
      "这些文件在直接用 navigator.clipboard，请改用 lib/clipboard.ts 的 copyText：\n" + unexplained.join("\n"),
    ).toEqual([]);
  });

  it("白名单没有过期（每条仍对应一个真实在用 navigator.clipboard 的文件）", () => {
    const stale = RAW_CLIPBOARD_ALLOWLIST.filter((e) => !rawUsers.includes(e.file)).map((e) => e.file);
    expect(stale, "这些文件已经不再需要白名单了：" + stale.join(", ")).toEqual([]);
  });

  it("白名单里的理由必须有证据（否则就是一纸空文）", () => {
    const broken: string[] = [];
    for (const entry of RAW_CLIPBOARD_ALLOWLIST) {
      const text = overlaySource(entry.file);
      for (const snippet of entry.evidence) {
        if (!text.includes(snippet)) broken.push(`${entry.file} 缺少证据：${snippet}`);
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });
});

describe("这次补上的三处静默失败", () => {
  const widgets = [
    { file: "src/components/quick-tools-drawer.tsx", label: "开发者工具箱抽屉（8 个按钮，原来没有 catch）" },
    { file: "src/components/modular/modules/notes-widget.tsx", label: "便签微件（原来失败分支只重设保存状态）" },
    { file: "src/components/modular/modules/quick-tools-widget.tsx", label: "极速工具卡片（原来失败分支是空函数）" },
  ];

  it.each(widgets)("$label：改走 copyText，且失败会说清原因", ({ file }) => {
    const code = stripComments(overlaySource(file));
    expect(code).toContain("await copyText(");
    expect(code).not.toContain("navigator.clipboard");
    expect(code).toContain("setCopyError(result.reason)");
    // 失败必须显示出来，而不只是存进 state
    const src = overlaySource(file);
    expect(src).toContain("复制失败");
    expect(src).toContain('role="status"');
    // 回归保护：不许再出现「空失败处理器」或纯 `.then(成功)` 的单参写法
    expect(src).not.toMatch(/\.then\(\s*\(\s*\)\s*=>\s*\{\s*\}/);
    expect(src).not.toMatch(/=>\s*\{\s*\}\s*,?\s*\)/);
  });

  it("失败态一旦显示，就不能同时显示「已复制」", () => {
    for (const { file } of widgets) {
      const code = stripComments(overlaySource(file));
      const failure = code.indexOf("setCopyError(result.reason)");
      expect(failure, file).toBeGreaterThan(-1);
      // 失败分支里必须先把 copied 清掉
      expect(code.slice(Math.max(0, failure - 200), failure), file).toContain("setCopied(");
    }
  });

  it("管理端资源复制：不再直接摸 API（缺 API 时那个 TypeError 连 .catch 都接不到）", () => {
    const code = stripComments(overlaySource("src/app/admin/resources/page.tsx"));
    expect(code).toContain("await copyText(url)");
    expect(code).not.toContain("navigator.clipboard");
    expect(code).toContain("copyFailureToast(result)");
  });

  it("插件详情徽章弹窗：复制确认落在按钮自身，不只依赖可能被丢弃的 toast", () => {
    const code = stripComments(overlaySource("src/app/marketplace/[slug]/plugin-detail-view.tsx"));
    const atLeastTwo = (re: RegExp) => {
      const count = code.match(re)?.length ?? 0;
      expect(count, `${re} 出现 ${count} 次`).toBeGreaterThanOrEqual(2);
    };
    // 两个按钮都要把 copyText 的结果写入本地反馈
    atLeastTwo(/reportCopy\(result\)/g);
    atLeastTwo(/copyFeedback\.state === 'copied'/g);
    atLeastTwo(/copyFeedback\.state === 'failed'/g);
    // 失败原因必须可见，且用 role="status" 让辅助技术播报
    atLeastTwo(/role="status"/g);
    atLeastTwo(/copyFeedback\.reason/g);
  });
});
