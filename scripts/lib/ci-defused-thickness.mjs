/**
 * 撤防账的「厚度」对账：那一轮写出的账，和登记表期望的道数是不是同一件事。
 *
 * 存在的理由：撤防账只说「跑过 N 道 / 没跑成 M 道」，N+M 由**写侧自己报**。
 * 写侧漏登记一道门禁时，账会自洽地变薄（N+M 仍等于它报的总数），
 * 读侧看不出异常，本地 `check-ci-gate.mjs` 又只在推的那台机器上跑 ⇒
 * 「这道门禁到底判没判」在跨机器口径上重新变成空白。这里把期望道数钉在登记表上，
 * 逐作业实例比对，并把「账自身对不上」这一类一起接住。
 *
 * 判据是**纯函数**：登记表由调用方传进来（CLI 传 `DEFUSED_GATES`），
 * 这样同一份判据既能在线上读数上跑，也能在夹具里跑，不绑目录。
 */

/** 只有真读到账的行才谈厚度：没账 / 接线外是另一条通道（由 --defused 的分档负责说清） */
export function readableDefusedRows(rows) {
  return (rows ?? []).filter((row) => Boolean(row?.found) && !row?.error && !row?.broken);
}

/**
 * @param {object[]} rows parseDefusedTrace 的行（逐作业实例，矩阵分片各算一条）
 * @param {{registry?: object[], comparable?: boolean}} input
 *   registry：登记表条目（`{ job, gates: [] }`），CLI 传 DEFUSED_GATES
 *   comparable：这一轮的 ci.yml 是否就是本地这份登记表对应的那一版。
 *     false 时发现照样算出来，但只作为「口径提示」给调用方看，不参与判红——
 *     历史轮的薄账多半是当时还没登记（实测：run 40983034925 的 test-sqlite 报 2 道，
 *     而 `backend-lint` 是 2026-10-30 才登记的），把它说成缺陷是假告。
 * @returns {{findings: object[], counted: object[], comparable: boolean}}
 */
export function thicknessFindings(rows, input = {}) {
  const registry = input.registry ?? [];
  const comparable = input.comparable !== false;
  const expected = new Map(registry.map((entry) => [entry.job, (entry.gates ?? []).length]));
  const findings = [];

  for (const row of readableDefusedRows(rows)) {
    const job = row.job;
    if (!expected.has(job)) continue;
    const want = expected.get(job);
    const reported = Number(row.gateTotal ?? 0);
    const ran = Number(row.ran ?? 0);
    const defused = Number(row.defused ?? 0);
    const label = row.name && row.name !== job ? `${job}（${row.name}）` : job;

    if (reported !== want) {
      const delta = want - reported;
      findings.push({
        job,
        name: row.name ?? job,
        kind: delta > 0 ? "thin" : "fat",
        expected: want,
        reported,
        delta: Math.abs(delta),
        message:
          delta > 0
            ? `${label} 的账比登记表薄 ${delta} 道：写侧报 ${reported} 道、登记表认 ${want} 道 ⇒ ` +
              `掉的那道在 ci.yml 与 DEFUSED_GATES 的差集里，本地核：node scripts/check-ci-gate.mjs`
            : `${label} 的账比登记表厚 ${-delta} 道：写侧报 ${reported} 道、登记表只认 ${want} 道 ⇒ ` +
              `新门禁进了 ci.yml 没进登记表，本地核：node scripts/check-ci-gate.mjs`,
      });
    }
    if (ran + defused !== reported) {
      findings.push({
        job,
        name: row.name ?? job,
        kind: "unbalanced",
        expected: want,
        reported,
        ran,
        defused,
        message:
          `${label} 的账自身对不上：跑过 ${ran} + 没跑成 ${defused} ≠ 报的 ${reported} 道 ⇒ ` +
          "那一行的 id 列表被截断，或 runner 改写了 ::notice:: 的形状（读到的数不可信）",
      });
    }
  }

  return { findings, counted: comparable ? findings : [], comparable };
}

/**
 * 一行说明（文本档用）：判红时发现和口径提示是两种话，不能混着写。
 * @returns {string[]}
 */
export function renderThickness(outcome) {
  const lines = [];
  if (outcome.findings.length === 0) return lines;
  if (outcome.comparable) {
    for (const f of outcome.findings) lines.push("账厚度不符 · " + f.message);
  } else {
    for (const f of outcome.findings) {
      lines.push(`[口径] ${f.message}——本轮的 ci.yml 与本地登记表不是同一版，只提示不判红`);
    }
  }
  return lines;
}
