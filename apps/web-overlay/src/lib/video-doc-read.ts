/**
 * 内容文档的**可降级读取**。
 *
 * 为什么需要这一层：`readStorageFresh()` 是「绕过 Data Cache 直连中枢」的读法，
 * 它把适配器异常原样抛出（这是对的 —— 采集写盘必须知道中枢失败）。
 * 但用它来喂一个**只读看板**就会出问题：中枢一次抖动 / 一次 401，
 * 看板就 500，而其实进程内的 `getFileContent()` 还能给出上一份可用数据。
 *
 * 典型错误写法（真实踩过）：
 *
 *     const data = (await readStorageFresh(p)) ?? (await getFileContent(p))
 *
 * `??` 只处理「返回 null」，**接不住抛出的异常** —— 所以降级分支永远不会执行。
 *
 * 这里把两条读链路按「新鲜优先、失败降级、都失败才认输」串起来，
 * 并把每一步的错误原文留在 `errors` 里：看板显示的是缓存数据时，
 * 运维要能看到「为什么用了缓存」，而不是看到一个看起来正常的数字。
 */

export type ReadSource = "fresh" | "cached" | "none";

export interface ResilientReadResult<T> {
  data: T | null;
  /** 数据实际来自哪一层；`none` 表示两层都失败 */
  source: ReadSource;
  /** 失败链路的错误原文（成功时为空数组） */
  errors: string[];
}

export interface ResilientReaders<T> {
  /** 新鲜读（绕过缓存，失败会抛） */
  fresh: () => Promise<T | null | undefined>;
  /** 缓存读（通常有本地回退，失败也可能抛） */
  cached: () => Promise<T | null | undefined>;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function readDocResilient<T>(readers: ResilientReaders<T>): Promise<ResilientReadResult<T>> {
  const errors: string[] = [];

  try {
    const fresh = await readers.fresh();
    if (fresh !== null && fresh !== undefined) {
      return { data: fresh, source: "fresh", errors };
    }
  } catch (err) {
    errors.push("fresh: " + messageOf(err));
  }

  try {
    const cached = await readers.cached();
    if (cached !== null && cached !== undefined) {
      return { data: cached, source: "cached", errors };
    }
  } catch (err) {
    errors.push("cached: " + messageOf(err));
  }

  return { data: null, source: "none", errors };
}
