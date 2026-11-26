import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConfigParity } from "./check-web-config-parity.mjs";

const roots: string[] = [];

function makeRoot(tsconfig: string): string {
  const root = mkdtempSync(join(tmpdir(), "navhub-config-parity-"));
  roots.push(root);
  for (const app of ["web", "web-overlay"]) {
    const dir = join(root, "apps", app);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "next.config.js"), "module.exports = {};\n");
    writeFileSync(join(dir, "package.json"), '{"name":"same"}\n');
    writeFileSync(join(dir, "tsconfig.json"), tsconfig);
  }
  return root;
}

function writeWeb(root: string, name: string, content: string): void {
  writeFileSync(join(root, "apps", "web", name), content);
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("checkConfigParity", () => {
  it("忽略 Next 注入 tsconfig include 的 .next* 类型目录", () => {
    const root = makeRoot('{\n  "include": ["**/*.ts", ".next/types/**/*.ts"]\n}\n');
    writeWeb(root, "tsconfig.json", '{\n  "include": [".next-e2e/types/**/*.ts", "**/*.ts", ".next-e2e/dev/types/**/*.ts",],\n}\n');
    expect(checkConfigParity(root).find((row) => row.file === "tsconfig.json")?.status).toBe("equal");
  });

  it("仍拒绝 compilerOptions 的真实漂移", () => {
    const root = makeRoot('{"compilerOptions":{"strict":true},"include":["**/*.ts"]}\n');
    writeWeb(root, "tsconfig.json", '{"compilerOptions":{"strict":false},"include":["**/*.ts"]}\n');
    expect(checkConfigParity(root).find((row) => row.file === "tsconfig.json")?.status).toBe("drift");
  });

  it("仍拒绝 next.config.js 的真实漂移", () => {
    const root = makeRoot('{"include":["**/*.ts"]}\n');
    writeWeb(root, "next.config.js", "module.exports = { ignoreBuildErrors: true };\n");
    expect(checkConfigParity(root).find((row) => row.file === "next.config.js")?.status).toBe("drift");
  });
});
