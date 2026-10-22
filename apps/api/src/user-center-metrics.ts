/**
 * 用户中心领域指标（N10）。
 *
 * 为什么不用 `metrics.ts` 的 HTTP 计数：那个能回答「/api/me/favorites/sync 被调了多少次、
 * 平均多快」，但回答不了产品真正关心的三个问题——
 *   1. 同步**成功率**是多少（失败里有多少值得重试）？
 *   2. 匿名合并**成功率**是多少？
 *   3. 数据主权动作（导出 / 注销）有没有人在用？
 *
 * 这些是「有界基数」的领域计数，维度固定，不会出现 Prometheus 那种标签爆炸。
 * 刻意不引入 prom-client：仓库已经为 /metrics 拒绝过一次依赖，这里保持一致。
 *
 * 进程内计数，重启即清零——它回答的是「现在健康吗」，不是「历史累计」。
 * 历史累计看 audit_logs（user.export / user.delete / identity.merge 都已落库）。
 */
export interface UserCenterMetricSnapshot {
  startedAt: number;
  favoritesSync: {
    success: number;
    failure: number;
    /** 失败中「值得重试」的次数（5xx / 超时 / 登录过期） */
    failureRetryable: number;
    /** 本次同步提交的 ops 总数（观察「只推脏条目」是否真的省掉了请求） */
    opsSubmitted: number;
    /** 因超过单批上限被分片的次数 */
    sharded: number;
  };
  identityMerge: {
    success: number;
    alreadyMerged: number;
    failure: number;
  };
  dataSovereignty: {
    exportJson: number;
    exportBookmarks: number;
    deleteAccount: number;
    activityRead: number;
  };
}

const snapshot: UserCenterMetricSnapshot = {
  startedAt: Date.now(),
  favoritesSync: { success: 0, failure: 0, failureRetryable: 0, opsSubmitted: 0, sharded: 0 },
  identityMerge: { success: 0, alreadyMerged: 0, failure: 0 },
  dataSovereignty: { exportJson: 0, exportBookmarks: 0, deleteAccount: 0, activityRead: 0 },
};

export function recordUserCenterMetric(event: string, value = 1): void {
  switch (event) {
    case "favoritesSync.success":
      snapshot.favoritesSync.success += value;
      return;
    case "favoritesSync.failure":
      snapshot.favoritesSync.failure += value;
      return;
    case "favoritesSync.failureRetryable":
      snapshot.favoritesSync.failureRetryable += value;
      return;
    case "favoritesSync.opsSubmitted":
      snapshot.favoritesSync.opsSubmitted += value;
      return;
    case "favoritesSync.sharded":
      snapshot.favoritesSync.sharded += value;
      return;
    case "identityMerge.success":
      snapshot.identityMerge.success += value;
      return;
    case "identityMerge.alreadyMerged":
      snapshot.identityMerge.alreadyMerged += value;
      return;
    case "identityMerge.failure":
      snapshot.identityMerge.failure += value;
      return;
    case "dataSovereignty.exportJson":
      snapshot.dataSovereignty.exportJson += value;
      return;
    case "dataSovereignty.exportBookmarks":
      snapshot.dataSovereignty.exportBookmarks += value;
      return;
    case "dataSovereignty.deleteAccount":
      snapshot.dataSovereignty.deleteAccount += value;
      return;
    case "dataSovereignty.activityRead":
      snapshot.dataSovereignty.activityRead += value;
      return;
    default:
      // 未知事件名静默忽略：指标收集永远不能把业务请求搞失败
      return;
  }
}

export function getUserCenterMetrics(): UserCenterMetricSnapshot {
  // 返回浅拷贝，避免调用方拿到内部引用后误改
  return {
    startedAt: snapshot.startedAt,
    favoritesSync: { ...snapshot.favoritesSync },
    identityMerge: { ...snapshot.identityMerge },
    dataSovereignty: { ...snapshot.dataSovereignty },
  };
}
