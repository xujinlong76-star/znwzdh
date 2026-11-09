/**
 * `@navhub/core` 原子文件存储的**宿主实现**（node:fs/promises）。
 *
 * core 本身零 IO（接口见 packages/core/src/file-store.ts），落盘能力由宿主注入。
 * 本模块**导入即自注册**：任何会用到体检缓存 / 体检队列的入口只要
 * `import "./fs-file-store.ts"`（或经其它模块间接导入）一次即可，无需各处显式
 * 调用 setFileStore。
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setFileStore, type AtomicFileStore } from "@navhub/core";

export const fsFileStore: AtomicFileStore = {
  read(path: string): Promise<string> {
    return readFile(path, "utf8");
  },
  async writeAtomic(path: string, data: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    // 原子替换：先写同目录临时文件再改名。同目录 rename 不会跨设备，失败只可能是
    // 权限/占用；失败时清理临时文件，避免留下半个 JSON（本机曾因磁盘满写坏源文件）。
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, data, "utf8");
    try {
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  },
};

setFileStore(fsFileStore);