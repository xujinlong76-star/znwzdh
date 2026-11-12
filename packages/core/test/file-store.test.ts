/**
 * file-store.ts 覆盖：注入缝的未注入抛错、注入、覆盖。
 * 注意：fileStore 是模块级单例；本文件内用例按顺序执行，
 * 先断言未注入态，再注入内存实现。
 */
import { describe, expect, it } from "vitest";
import { fileStore, hasFileStore, setFileStore, type AtomicFileStore } from "../src/file-store.ts";

function memoryStore(): { store: AtomicFileStore; files: Map<string, string> } {
  const files = new Map<string, string>();
  const store: AtomicFileStore = {
    read: async (path) => {
      const v = files.get(path);
      if (v === undefined) throw new Error("ENOENT: " + path);
      return v;
    },
    writeAtomic: async (path, data) => {
      files.set(path, data);
    },
  };
  return { store, files };
}

describe("file-store 注入缝", () => {
  it("未注入时 hasFileStore 为 false，fileStore() 显式抛错", () => {
    expect(hasFileStore()).toBe(false);
    expect(() => fileStore()).toThrow("未注入");
  });

  it("注入后 hasFileStore 为 true，fileStore() 返回同一实现", async () => {
    const { store, files } = memoryStore();
    setFileStore(store);
    expect(hasFileStore()).toBe(true);
    expect(fileStore()).toBe(store);
    await fileStore().writeAtomic("/tmp/x.txt", "hello");
    expect(files.get("/tmp/x.txt")).toBe("hello");
    await expect(fileStore().read("/tmp/x.txt")).resolves.toBe("hello");
    await expect(fileStore().read("/tmp/missing.txt")).rejects.toThrow("ENOENT");
  });

  it("后注入覆盖先注入", async () => {
    const first = memoryStore();
    const second = memoryStore();
    setFileStore(first.store);
    setFileStore(second.store);
    expect(fileStore()).toBe(second.store);
    await fileStore().writeAtomic("/a", "second");
    expect(second.files.get("/a")).toBe("second");
    expect(first.files.has("/a")).toBe(false);
  });
});
