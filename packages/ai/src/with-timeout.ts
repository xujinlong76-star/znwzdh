/**
 * 给任意 Promise 加超时兜底，并保证**任一方落地后清掉定时器**。
 *
 * 为什么需要这个小工具：`Promise.race([task, new Promise((_, reject) => setTimeout(...))])`
 * 是最常见的超时写法，但任务先成功时那个 `setTimeout` 没人清 —— 它会在整个
 * timeout 窗口内持有闭包，并且在 Node 里**拖住事件循环**（进程迟迟不退出、
 * 测试偶发 hang）。这里把「清理」和「超时」绑在一起，避免每个调用点各写一遍、
 * 各漏一遍。
 */
export async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
