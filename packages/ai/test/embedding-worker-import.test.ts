/**
 * embedding-worker.ts 主线程导入安全：该模块是 Worker 线程入口，
 * 但在主线程 import 时 parentPort 为 null，不应注册任何处理器、不应抛错。
 * （Worker 内 loadModel / 消息处理分支无法在主线程 v8 覆盖率里统计，
 *  不在此处强行模拟；本用例只钉住「主线程可安全导入」这一契约。）
 */
import { describe, expect, it } from "vitest";
import "../src/embedding-worker.ts";

describe("embedding-worker 主线程导入", () => {
  it("导入不抛错", () => {
    expect(true).toBe(true);
  });
});
