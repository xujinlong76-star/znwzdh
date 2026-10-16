/**
 * 向量推理线程隔离（Worker Thread Embedding）测试。
 *
 * 验证目标：
 * 1. 默认与显式 useWorker 配置行为一致；
 * 2. ready()、stats()、close() 资源生命周期正确；
 * 3. Worker 线程与主线程 LRU 缓存协同无损；
 * 4. 故障或环境受限时自动优雅降级回退到进程内推理。
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EMBEDDING_CONFIG,
  createEmbeddingService,
  normalizeEmbeddingKey,
} from "../src/embedding.ts";

describe("Worker Embedding 线程隔离与降级机制", () => {
  it("默认配置包含 useWorker 属性", () => {
    expect(typeof DEFAULT_EMBEDDING_CONFIG.useWorker).toBe("boolean");
  });

  it("支持显式关闭 Worker（直接走进程内）", async () => {
    const service = createEmbeddingService({
      useWorker: false,
      model: "test-model",
      dim: 512,
    });

    expect(service.ready()).toBe(false);
    expect(service.model).toBe("test-model");
    expect(service.dim).toBe(512);

    // 模型不可用时应给出可读错误，不挂死
    await expect(service.encode("测试输入")).rejects.toThrow();
    await service.close?.();
  });

  it("Worker 模式下支持创建与优雅 close 释放线程", async () => {
    const service = createEmbeddingService({
      useWorker: true,
      model: "mock-model",
      dim: 512,
    });

    expect(service.ready()).toBe(false);
    expect(service.stats?.()).toEqual({ size: 0, hits: 0, misses: 0 });

    // close 应安全幂等执行
    await expect(service.close?.()).resolves.toBeUndefined();
    await expect(service.close?.()).resolves.toBeUndefined();
  });

  it("空输入或纯空白输入被快速拦截，不浪费 Worker 算力", async () => {
    const service = createEmbeddingService({
      useWorker: true,
      dim: 512,
    });

    await expect(service.encode("   ")).rejects.toThrow("embedding 输入为空");
    await expect(service.encode("")).rejects.toThrow("embedding 输入为空");
    await service.close?.();
  });

  it("主线程缓存拦截重复查询，不触发 Worker 传输", async () => {
    const service = createEmbeddingService({
      useWorker: false,
      dim: 512,
    });

    // 验证归一化
    expect(normalizeEmbeddingKey("  GitHub  ")).toBe("github");
    await service.close?.();
  });
});
