/**
 * CRDT 视频断点接力 op（Batch 3 第 9 项，方案 A）：
 * UPSERT_VIDEO_PROGRESS / DELETE_VIDEO_PROGRESS 的 reduce / compact / LWW /
 * 未来时间戳丢弃 / 压缩后不复活。
 *
 * 口径：
 * - LWW 以 payload.updatedAt 为准（不是 op.timestamp），缺失时退回 op.timestamp；
 * - 未来时间戳脏数据（updatedAt > now + 5min）丢弃，沿用 resurface.ts
 *   「晚于 now 的时间戳一律忽略」口径；
 * - 看完（progressPercent >= 95%）不发删除、记录照常保留，只是卡上不显示，
 *   因此规约层不过滤 95%+ 的断点；
 * - 压缩时 payload.updatedAt 保留原始值、只把 op.timestamp 抬到 maxTs，
 *   否则压缩体会误胜另一设备上 updatedAt 介于原值与 maxTs 之间的真实新断点。
 */
import { describe, expect, it } from "vitest";
import {
  compactOperationLog,
  createCRDTOperation,
  mergeOperationLogs,
  reduceOperationsToState,
  type CRDTOperation,
  type VideoProgress,
} from "../src/crdt-sync.ts";
import { SyncCrdtOperationsInput } from "../src/mcp-schemas.ts";

const NOW = 1_800_000_000_000;

function progressPayload(overrides: Partial<VideoProgress> = {}): Record<string, unknown> {
  return {
    timestampSec: 754,
    durationSec: 1800,
    progressPercent: 42,
    title: "测试视频",
    author: "作者",
    platform: "bilibili",
    updatedAt: 1000,
    deviceId: "client_abc",
    ...overrides,
  };
}

function upsert(
  videoId: string,
  payloadOverrides: Partial<VideoProgress> = {},
  clientId = "c1",
  opTimestamp = 1000,
): CRDTOperation {
  return createCRDTOperation(
    "UPSERT_VIDEO_PROGRESS",
    videoId,
    progressPayload(payloadOverrides),
    clientId,
    opTimestamp,
  );
}

function del(
  videoId: string,
  updatedAt = 1000,
  clientId = "c1",
  opTimestamp = 1000,
): CRDTOperation {
  return createCRDTOperation(
    "DELETE_VIDEO_PROGRESS",
    videoId,
    { updatedAt },
    clientId,
    opTimestamp,
  );
}

describe("UPSERT_VIDEO_PROGRESS reduce", () => {
  it("存入断点：字段完整；空日志的 videoProgress 为 {}", () => {
    expect(reduceOperationsToState([], undefined, NOW).videoProgress).toEqual({});
    const state = reduceOperationsToState(
      [upsert("v1", { updatedAt: 1000 })],
      undefined,
      NOW,
    );
    expect(state.videoProgress["v1"]).toMatchObject({
      videoId: "v1",
      title: "测试视频",
      author: "作者",
      platform: "bilibili",
      timestampSec: 754,
      durationSec: 1800,
      progressPercent: 42,
      updatedAt: 1000,
      deviceId: "client_abc",
    });
  });

  it("看完 >=95% 不删除：记录照常保留（只由卡片决定不显示）", () => {
    const state = reduceOperationsToState(
      [upsert("v1", { progressPercent: 97, timestampSec: 1750, updatedAt: 1000 })],
      undefined,
      NOW,
    );
    expect(state.videoProgress["v1"]!.progressPercent).toBe(97);
  });

  it("无效 payload 被丢弃且不占 LWW 水位；平台非法归 other；deviceId 缺失退回 clientId", () => {
    const state = reduceOperationsToState(
      [
        // 无标题：丢弃，且不得挡住随后有效的旧 op
        upsert("v1", { title: "", updatedAt: 5000 }, "c1", 5000),
        upsert("v1", { title: "有效", updatedAt: 1000 }, "c1", 1000),
        // 负秒数：丢弃
        upsert("v2", { timestampSec: -5, updatedAt: 1000 }, "c1", 1000),
        // 平台非法 → other；deviceId 缺失 → op.clientId；deviceLabel 缺失 → 不写字段
        createCRDTOperation(
          "UPSERT_VIDEO_PROGRESS",
          "v3",
          { ...progressPayload({ updatedAt: 1000 }), platform: "niconico", deviceId: undefined },
          "c9",
          1000,
        ),
      ],
      undefined,
      NOW,
    );
    expect(state.videoProgress["v1"]!.title).toBe("有效");
    expect(state.videoProgress["v2"]).toBeUndefined();
    expect(state.videoProgress["v3"]).toMatchObject({ platform: "other", deviceId: "c9" });
    expect("deviceLabel" in state.videoProgress["v3"]!).toBe(false);
  });
});

describe("LWW 与未来时间戳丢弃", () => {
  it("同视频取 updatedAt 更晚者，与数组顺序无关；旧写不胜新写", () => {
    const newerFirst = reduceOperationsToState(
      [upsert("v1", { timestampSec: 900, updatedAt: 2000 }), upsert("v1", { timestampSec: 100, updatedAt: 1000 })],
      undefined,
      NOW,
    );
    expect(newerFirst.videoProgress["v1"]!.timestampSec).toBe(900);
    const olderFirst = reduceOperationsToState(
      [upsert("v1", { timestampSec: 100, updatedAt: 1000 }), upsert("v1", { timestampSec: 900, updatedAt: 2000 })],
      undefined,
      NOW,
    );
    expect(olderFirst.videoProgress["v1"]!.timestampSec).toBe(900);
  });

  it("updatedAt 相同时后到的 op 胜出（与既有 isMoreRecent 的 >= 口径一致）", () => {
    const state = reduceOperationsToState(
      [upsert("v1", { timestampSec: 100, updatedAt: 1000 }), upsert("v1", { timestampSec: 200, updatedAt: 1000 })],
      undefined,
      NOW,
    );
    expect(state.videoProgress["v1"]!.timestampSec).toBe(200);
  });

  it("未来时间戳脏数据丢弃：updatedAt > now + 5min 不写入、不占水位", () => {
    const state = reduceOperationsToState(
      [
        upsert("v1", { timestampSec: 999, updatedAt: NOW + 5 * 60 * 1000 + 1 }),
        upsert("v1", { timestampSec: 100, updatedAt: 1000 }),
      ],
      undefined,
      NOW,
    );
    // 未来 op 若占了水位，有效旧 op 会被挡住；此处必须仍为 100 秒那条
    expect(state.videoProgress["v1"]!.timestampSec).toBe(100);
  });

  it("边界：updatedAt == now + 5min 恰好保留（丢弃条件是严格大于）", () => {
    const state = reduceOperationsToState(
      [upsert("v1", { updatedAt: NOW + 5 * 60 * 1000 })],
      undefined,
      NOW,
    );
    expect(state.videoProgress["v1"]).toBeDefined();
  });

  it("initialState 里的新断点不被旧 op 覆盖", () => {
    const state = reduceOperationsToState(
      [upsert("v1", { timestampSec: 100, updatedAt: 1000 })],
      {
        videoProgress: {
          v1: {
            videoId: "v1",
            title: "新",
            platform: "bilibili",
            timestampSec: 900,
            durationSec: 1800,
            progressPercent: 50,
            updatedAt: 5000,
            deviceId: "c2",
          },
        },
      },
      NOW,
    );
    expect(state.videoProgress["v1"]!.timestampSec).toBe(900);
  });
});

describe("DELETE_VIDEO_PROGRESS", () => {
  it("删除清除断点；旧删除删不掉新断点；新 upsert 能在删除后恢复", () => {
    const deleted = reduceOperationsToState(
      [upsert("v1", { updatedAt: 1000 }), del("v1", 2000)],
      undefined,
      NOW,
    );
    expect(deleted.videoProgress["v1"]).toBeUndefined();

    const staleDelete = reduceOperationsToState(
      [upsert("v1", { updatedAt: 2000 }), del("v1", 1000)],
      undefined,
      NOW,
    );
    expect(staleDelete.videoProgress["v1"]).toBeDefined();

    const revived = reduceOperationsToState(
      [upsert("v1", { timestampSec: 100, updatedAt: 1000 }), del("v1", 2000), upsert("v1", { timestampSec: 300, updatedAt: 3000 })],
      undefined,
      NOW,
    );
    expect(revived.videoProgress["v1"]!.timestampSec).toBe(300);
  });

  it("未来时间戳的删除被丢弃：断点保留", () => {
    const state = reduceOperationsToState(
      [upsert("v1", { updatedAt: 1000 }), del("v1", NOW + 10 * 60 * 1000)],
      undefined,
      NOW,
    );
    expect(state.videoProgress["v1"]).toBeDefined();
  });
});

describe("compactOperationLog 视频分支", () => {
  it("每视频只留最新一条；压缩前后规约结果一致", () => {
    const ops = [
      upsert("v1", { timestampSec: 100, updatedAt: 1000 }, "c1", 1000),
      upsert("v1", { timestampSec: 500, updatedAt: 2000 }, "c1", 2000),
      upsert("v2", { timestampSec: 50, updatedAt: 1500 }, "c2", 1500),
      del("v2", 2500, "c2", 2500),
      upsert("v1", { timestampSec: 100, updatedAt: 1000 }, "c1", 1000), // 重复旧 op
    ];
    const compacted = compactOperationLog(ops);
    const videoOps = compacted.filter((o) => o.type === "UPSERT_VIDEO_PROGRESS");
    expect(videoOps).toHaveLength(1);
    expect(videoOps[0]!.entityId).toBe("v1");
    expect((videoOps[0]!.payload as VideoProgress).timestampSec).toBe(500);
    // v2 已被删除：压缩后不留任何痕迹
    expect(compacted.some((o) => o.entityId === "v2")).toBe(false);
    expect(reduceOperationsToState(compacted, undefined, NOW)).toEqual(
      reduceOperationsToState(ops, undefined, NOW),
    );
  });

  it("压缩后旧 op 不能复活：与未压缩副本合流时仍以最新断点为准", () => {
    const ops = [
      upsert("v1", { timestampSec: 100, updatedAt: 1000 }, "c1", 1000),
      upsert("v1", { timestampSec: 500, updatedAt: 2000 }, "c1", 2000),
    ];
    const compacted = compactOperationLog(ops);
    // 另一设备手里还有旧日志副本：合流后旧断点不得复活
    const merged = mergeOperationLogs(compacted, ops);
    const state = reduceOperationsToState(merged, undefined, NOW);
    expect(state.videoProgress["v1"]!.timestampSec).toBe(500);
    expect(state.videoProgress["v1"]!.updatedAt).toBe(2000);
  });

  it("压缩保留 maxTs 作 op.timestamp，但 payload.updatedAt 不抬高：另一设备上介于两者之间的真实新断点仍能胜出", () => {
    const ops = [
      upsert("v1", { timestampSec: 500, updatedAt: 2000 }, "c1", 2000),
      // 一条无关排版 op 把 maxTs 抬到 9000
      createCRDTOperation("SET_CATEGORY_PIN", "c1", { isPinned: true }, "c1", 9000),
    ];
    const compacted = compactOperationLog(ops);
    const videoOp = compacted.find((o) => o.type === "UPSERT_VIDEO_PROGRESS")!;
    expect(videoOp.timestamp).toBe(9000);
    expect((videoOp.payload as VideoProgress).updatedAt).toBe(2000);
    // 另一设备有一条压缩时没见过的断点 updatedAt=3000（介于 2000 与 9000 之间）
    const unseen = upsert("v1", { timestampSec: 700, updatedAt: 3000 }, "c2", 3000);
    const state = reduceOperationsToState(mergeOperationLogs(compacted, [unseen]), undefined, NOW);
    expect(state.videoProgress["v1"]!.timestampSec).toBe(700);
    expect(state.videoProgress["v1"]!.updatedAt).toBe(3000);
  });
});

describe("MCP SyncCrdtOperationsInput 覆盖新 op", () => {
  it("接受 UPSERT_VIDEO_PROGRESS / DELETE_VIDEO_PROGRESS，拒绝未知类型", () => {
    const base = {
      id: "op_1_c1_x",
      entityId: "v1",
      payload: progressPayload(),
      timestamp: 1000,
      clientId: "c1",
    };
    expect(
      SyncCrdtOperationsInput.safeParse({
        operations: [{ ...base, type: "UPSERT_VIDEO_PROGRESS" }],
      }).success,
    ).toBe(true);
    expect(
      SyncCrdtOperationsInput.safeParse({
        operations: [{ ...base, type: "DELETE_VIDEO_PROGRESS", payload: { updatedAt: 2000 } }],
      }).success,
    ).toBe(true);
    expect(
      SyncCrdtOperationsInput.safeParse({
        operations: [{ ...base, type: "UPSERT_VIDEO_SCENE" }],
      }).success,
    ).toBe(false);
  });
});
