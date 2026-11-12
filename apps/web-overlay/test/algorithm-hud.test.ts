import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALGORITHM_HUD_STORAGE_KEY,
  formatAlgorithmHudValue,
  getTopAlgorithmHudChannel,
  parseAlgorithmHudStoredValue,
} from "../src/lib/algorithm-hud";
const HERE = dirname(fileURLToPath(import.meta.url));
function readOverlay(rel: string): string {
  return readFileSync(resolve(HERE, "..", "src", rel), "utf8");
}

describe("W1-4 HUD: persistence", () => {
  it("default off, malformed off", () => {
    expect(ALGORITHM_HUD_STORAGE_KEY).toBe("navhub.algorithm-hud.v1");
    expect(parseAlgorithmHudStoredValue(null)).toBe(false);
    expect(parseAlgorithmHudStoredValue("not json")).toBe(false);
    expect(parseAlgorithmHudStoredValue('{"enabled":false}')).toBe(false);
    expect(parseAlgorithmHudStoredValue('{"enabled":"true"}')).toBe(false);
    expect(parseAlgorithmHudStoredValue('{"enabled":true}')).toBe(true);
  });
});
describe("W1-4 HUD: top channel", () => {
  it("picks max value, EXACT 1.75", () => {
    const top = getTopAlgorithmHudChannel({
      exact: { rank: 0, value: 1.75 },
      semantic: { rank: 1, value: 0.5 },
    });
    expect(top?.channel).toBe("exact");
    expect(top?.text).toBe("EXACT 1.75");
    expect(top?.label).toBe("精确");
    expect(getTopAlgorithmHudChannel({})).toBeNull();
    expect(getTopAlgorithmHudChannel(null)).toBeNull();
    expect(
      getTopAlgorithmHudChannel({ unknown: { rank: 0, value: 9 } }),
    ).toBeNull();
  });
  it("RRF small values keep 3 decimals", () => {
    const top = getTopAlgorithmHudChannel({
      exact: { rank: 0, value: 0.0233 },
      fts: { rank: 0, value: 0.016 },
    });
    expect(top?.text).toBe("EXACT 0.023");
  });
});

describe("W1-4 HUD: personal gate", () => {
  const hits = {
    personal: { rank: 0, value: 0.9 },
    semantic: { rank: 1, value: 0.5 },
  };
  it("personal off falls back to semantic", () => {
    expect(
      getTopAlgorithmHudChannel(hits, { personalizationEnabled: false })
        ?.channel,
    ).toBe("semantic");
    expect(getTopAlgorithmHudChannel(hits)?.channel).toBe("personal");
    expect(
      getTopAlgorithmHudChannel(
        { personal: { rank: 0, value: 0.9 } },
        { personalizationEnabled: false },
      ),
    ).toBeNull();
  });
});

describe("W1-4 HUD: format", () => {
  it("1.75 stays, 0.0233 keeps 3 decimals", () => {
    expect(formatAlgorithmHudValue(1.75)).toBe("1.75");
    expect(formatAlgorithmHudValue(0.0233)).toBe("0.023");
    expect(formatAlgorithmHudValue(Number.NaN)).toBeNull();
  });
});

describe("W1-4 HUD: acceptance", () => {
  it("badge in 3 places, no card badge", () => {
    expect(readOverlay("components/algorithm-hud-badge.tsx")).toContain(
      "algorithm-hud-badge",
    );
    expect(readOverlay("app/search/search-results.tsx")).toContain(
      "AlgorithmHudBadge",
    );
    expect(readOverlay("components/search-palette.tsx")).toContain(
      "AlgorithmHudBadge",
    );
    expect(readOverlay("components/search/spotlight-modal.tsx")).toContain(
      "AlgorithmHudBadge",
    );
    expect(readOverlay("components/navigation-card.tsx")).not.toContain(
      "AlgorithmHudBadge",
    );
  });
  it("lab hero has toggle, no false claims", () => {
    const lab = readOverlay("components/algorithm-lab.tsx");
    expect(lab).toContain("algorithm-hud-toggle");
    expect(lab).toContain("仅本地展示，不上报");
    expect(lab).not.toContain("已关闭上报");
    expect(lab).not.toContain("权重应用至全站");
    expect(readOverlay("lib/algorithm-hud.ts")).not.toContain("entropy");
  });
});
