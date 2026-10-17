/**
 * 资源库（`/admin/resources`）：**引用检查失败 ≠ 没有引用**。
 *
 * 改前（`admin/resources/page.tsx`）：
 *
 *     const checkResourceReferences = async (resourcePaths: string[]) => {
 *       try { … return data.references }
 *       catch (error) { console.error(…); return {} }        // ← 失败返回空对象
 *     }
 *
 * 而 `handleBatchDelete` 拿这个结果直接开删除确认框：
 *
 *     const references = await checkResourceReferences(resourcePaths);
 *     setResourceReferences(references);
 *     setIsDeleteDialogOpen(true);
 *
 * 确认框里只有在 `references` 有内容时才显示黄色警告（“以下资源正在被使用中”）。
 * 于是**检查失败时**：没有警告、没有任何提示，界面呈现为「这些资源没人引用，
 * 删吧」—— 一次失败的检查变成了误删正在使用中资源的通行证，而删除不可撤销。
 *
 * 现在：查不到就返回 `null`（未知），确认框**不开**，并明确告诉用户为什么
 * 取消；真的查过且确实没有引用时，才显示绿色的「已检查引用关系」。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
const RESOURCES = "src/app/admin/resources/page.tsx";

function raw(): string {
  return readFileSync(join(ROOT, RESOURCES), "utf8");
}

/** 剥注释但保留行列位置（注释里正当地写着「以前这里 return {}」这样的反例） */
function code(): string {
  const noBlock = raw().replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

describe("引用检查失败必须是「未知」，不是「没有引用」", () => {
  it("失败分支返回 null，不再返回空对象冒充「查过了」", () => {
    const src = code();
    expect(src).toContain("| null> =>");
    expect(src).toContain("return null;");
    // 「return {}」就是那个把失败伪装成干净的旧写法，全文件不许再有
    expect(src).not.toContain("return {};");
  });

  it("响应里没有 references 字段也按未知处理", () => {
    // data.references 缺失时 ?? null，不能悄悄变成 undefined 再被当成空集合
    expect(code()).toContain("return data.references ?? null;");
  });
});

describe("危险操作 fail-closed：查不到就不开删除确认框", () => {
  it("有显式的失败闸门，且排在打开确认框之前", () => {
    const src = code();
    const guardAt = src.indexOf("if (!references)");
    const openAt = src.indexOf("setIsDeleteDialogOpen(true)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(openAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(openAt);
  });

  it("失败时告诉用户「已取消删除」并给出去向，而不是静默", () => {
    const src = code();
    const guardAt = src.indexOf("if (!references)");
    const guardBlock = src.slice(guardAt, src.indexOf("setIsDeleteDialogOpen(true)"));
    expect(guardBlock).toContain("引用检查失败");
    expect(guardBlock).toContain("已取消删除");
    expect(guardBlock).toContain("variant: \"destructive\"");
    // 必须提前 return，不能只弹个 toast 然后继续往下开确认框
    expect(guardBlock).toContain("return;");
    // 失败文案不许暗示「可以删」
    expect(guardBlock).not.toContain("可以安全删除");
    expect(guardBlock).not.toContain("成功");
  });
});

describe("确认框里两种结果都说明白", () => {
  it("有引用 → 黄色警告；确实没有 → 绿色「已检查」，二者是互斥分支", () => {
    const src = code();
    const warnAt = src.indexOf("以下资源正在被使用中");
    const cleanAt = src.indexOf("已检查引用关系：没有内容引用这些资源。");
    expect(warnAt).toBeGreaterThan(-1);
    expect(cleanAt).toBeGreaterThan(warnAt);
    // 中间必须有一个「否则」分支，而不是「没有引用就什么都不显示」
    const between = src.slice(warnAt, cleanAt);
    expect(between).toContain(") : (");
  });
});

describe("守卫不是空跑", () => {
  it("确实读到了真实页面源码", () => {
    const src = raw();
    expect(src.length).toBeGreaterThan(25000);
    expect(src).toContain("checkResourceReferences");
    expect(src).toContain("Toaster");
  });
});
