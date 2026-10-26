/**
 * P1-2 拆分的源码守卫：备份弹窗与整理算法都必须「被引用且被渲染」，
 * 防止拆出去的代码重新腐化成死代码（这个仓库有过 batch-operation-dock
 * 写好了却全仓无人渲染的先例，见 batch-selection.test.ts 的注释）。
 *
 * 锁三件事：
 *   1. 工具栏渲染 <HomeDIYBackupDialog> 并注入 9 个依赖；
 *   2. 工具栏不再内联备份弹窗的 230 行（用载荷特征串做反向断言）；
 *   3. 整理算法走纯函数 computeLayoutTidyPlan，不再内联阈值判断。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY = resolve(HERE, "..", "..", "web-overlay");

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel);
  if (!existsSync(p)) throw new Error("overlay 缺少文件 " + rel);
  return readFileSync(p, "utf8");
}

describe("home-diy 拆分后的接线", () => {
  const toolbar = () => overlayFile("src/components/home-diy-toolbar.tsx");
  const dialog = () => overlayFile("src/components/home-diy-backup-dialog.tsx");

  it("工具栏渲染备份弹窗并注入全部 9 个依赖", () => {
    const s = toolbar();
    expect(s).toContain("<HomeDIYBackupDialog");
    for (const dep of [
      "exportPresetToUrlHash",
      "exportDIYConfig",
      "importDIYConfig",
      "exportEncryptedDIYConfig",
      "importEncryptedDIYConfig",
      "syncToCloudVault",
      "syncFromCloudVault",
      "checkCloudVaultStatus",
    ]) {
      expect(s, "缺少依赖注入 " + dep).toContain(dep + "={" + dep + "}");
    }
  });

  it("工具栏里不再内联备份弹窗的特征串（真的拆走了）", () => {
    const s = toolbar();
    expect(s).not.toContain("DIY 配置漫游与备份分享");
    expect(s).not.toContain("PBKDF2 (100,000 次哈希迭代)");
    expect(s).not.toContain("diy-vault-passphrase");
  });

  it("备份弹窗自带三模式与全部 handler", () => {
    const s = dialog();
    expect(s).toContain("明文 JSON 备份与迁移");
    expect(s).toContain("零知识 E2EE 金库加密");
    expect(s).toContain("山羊胡中枢云端金库同步");
    expect(s).toContain("const handleCloudUpload");
    expect(s).toContain("const handleDecryptImportSubmit");
    expect(s).toContain("export function HomeDIYBackupDialog");
  });

  it("整理算法走纯函数，工具栏不再内联阈值", () => {
    const s = toolbar();
    expect(s).toContain("computeLayoutTidyPlan(");
    expect(s).not.toContain("total > 25");
    expect(s).not.toContain("hiddenCategoryIds.includes(cat.id)");
  });

  it("工具栏规模守住拆分成果（≤900 行）", () => {
    const lines = toolbar().split("\n").length;
    expect(lines).toBeLessThanOrEqual(900);
  });
});
