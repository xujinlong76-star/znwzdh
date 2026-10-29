/**
 * `cascadeProblems` 与 `readerJobCoverageProblems` 的单元自检（级联红：一次根因只留一处红）。
 *
 * 为什么单独测纯函数而不只靠真实 ci.yml 派生夹具：级联判定的三个分支
 * （生产者自我排除 / 注释剥离 / `if-no-files-found` 豁免）在 HEAD 的 ci.yml 上
 * 全都只走一条路，「现状绿」证明不了另两条真的存在。合成片段可以逐个钉。
 *
 * 覆盖面那条同理：HEAD 的 ci.yml 里「有 error 上传的作业」恰好全登记了，
 * 现状绿证明不了「漏登记」真会被拦——所以这里用合成作业把正反两面各钉一次。
 *
 * 真实接线（test-sqlite / test-e2e / test-web 三处守卫确实在）由
 * scripts/check-ci-gate.test.ts 负责，这里不重复。
 */
import { describe, expect, it } from "vitest";
import { cascadeProblems, readerJobCoverageProblems } from "./ci-workflow.mjs";

/** 一个「跑测试并产出 junit」的作业，末尾挂着读产物的收尾步骤 */
function job(consumerIf: string | null, extra = ""): string {
  const guard = consumerIf ? `        if: ${consumerIf}\n` : "";
  return `  test-x:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000
      - name: 单元/接口测试
        id: vitest
        run: pnpm test --reporter=junit --outputFile.junit=junit-x-1.xml
      - name: 红灯光谱（Step Summary）
${guard}        run: node scripts/junit-summary.mjs junit-x-1.xml
${extra}`;
}

const RULE = { anchor: "vitest", products: [/junit-summary\.mjs/, /junit-x-/] };

describe("cascadeProblems：判据是「产物生产者跑过没有」", () => {
  it("带 outcome 守卫 ⇒ 绿", () => {
    expect(cascadeProblems(job(" ${{ !cancelled() && steps.vitest.outcome != 'skipped' }}"), RULE)).toEqual([]);
  });

  it("更严的 == 'success' 也算挂了守卫：锚点失败时产物是半份，读了只再多判一次假红", () => {
    // test-web 的 check-isr-routes 用的就是这一型：`next build` 红的时候 `.next`
    // 不可信，让它跑等于给真根因再叠一层 ISR 红；而它必须**不等价于**没有条件，
    // 否则预算门禁红灯（build 是成功的）会把它整步 skipped——撤防不报错。
    expect(cascadeProblems(job(" ${{ !cancelled() && steps.vitest.outcome == 'success' }}"), RULE)).toEqual([]);
  });

  it("只有 `- run:` 没有 name 的消费者 ⇒ 红时用命令本身点名", () => {
    const unnamed =
      "  test-y:\n" +
      "    steps:\n" +
      "      - name: 前端构建\n" +
      "        id: web-build\n" +
      "        run: pnpm --filter navsphere build\n" +
      "      - run: node scripts/check-isr-routes.mjs\n";
    const problems = cascadeProblems(unnamed, { anchor: "web-build", products: [/check-isr-routes\.mjs/] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("node scripts/check-isr-routes.mjs");
  });

  it("只写 !cancelled() ⇒ 红，并点名消费者步骤", () => {
    const problems = cascadeProblems(job(" ${{ !cancelled() }}"), RULE);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("红灯光谱（Step Summary）");
    expect(problems[0]).toContain("一次根因多处红");
  });

  it("连 if 都没有 ⇒ 红（默认条件在生产者被跳过时同样被跳过，但守卫是显式契约）", () => {
    expect(cascadeProblems(job(null), RULE)).toHaveLength(1);
  });

  it("生产者步骤自己也写着产物名 ⇒ 不算消费者", () => {
    // vitest 那一步的 run 行本来就带 `--outputFile.junit=junit-x-1.xml`，
    // 命中 products 里的 /junit-x-/。不排除锚点，门禁就会要求测试步骤
    // 以「自己的 outcome」为条件——一个永远成立、也永远没意义的断言。
    const onlyProducer = job(" ${{ !cancelled() && steps.vitest.outcome != 'skipped' }}").replace(
      "      - name: 红灯光谱（Step Summary）\n",
      "",
    );
    expect(cascadeProblems(onlyProducer, RULE)).toEqual([]);
  });

  it("锚点步骤 id 消失 ⇒ 红：守卫挂在不存在的步骤上等于没有守卫", () => {
    const orphaned = job(" ${{ !cancelled() && steps.vitest.outcome != 'skipped' }}").replace(
      "        id: vitest\n",
      "",
    );
    const problems = cascadeProblems(orphaned, RULE);
    expect(problems[0]).toContain("级联判据挂在它上面");
    // 第二条不是重复报警：锚点一没，生产者就不再被自我排除，
    // 而它的 run 行本来就写着产物名 ⇒ 它自己变成「没挂守卫的消费者」。
    expect(problems).toHaveLength(2);
    expect(problems[1]).toContain("单元/接口测试");
  });

  it("注释里写着产物名的无关步骤 ⇒ 不误判成消费者", () => {
    const annotated = job(" ${{ !cancelled() && steps.vitest.outcome != 'skipped' }}",
      `      # 口径同 junit-summary.mjs 与 junit-x-1.xml：缺产物就是链路断了
      - name: 打包构建闸门
        run: pnpm build
`);
    expect(cascadeProblems(annotated, RULE)).toEqual([]);
  });
});

describe("cascadeProblems：豁免只看「这一步会不会把自己判红」", () => {
  /** 在 job() 之后追加一步上传产物；uploadIf=null 表示不写条件 */
  const withUpload = (ifNoFiles: string, uploadIf: string | null) =>
    job(" ${{ !cancelled() && steps.vitest.outcome != 'skipped' }}") +
    `      - uses: actions/upload-artifact@0000000000000000000000000000000000000000
${uploadIf ? `        if: \${{ ${uploadIf} }}\n` : ""}        with:
          name: junit-x-1
          path: junit-x-*.xml
          if-no-files-found: ${ifNoFiles}
`;

  it("ignore 的上传没守卫也不红：缺文件不会让它自己判红，不是级联源", () => {
    expect(cascadeProblems(withUpload("ignore", null), RULE)).toEqual([]);
  });

  it("同一步骤换成 error ⇒ 无守卫必红（junit 那几步正是从 warn 改成 error 的）", () => {
    const problems = cascadeProblems(withUpload("error", null), RULE);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("junit-x-1");
  });

  it("error + 守卫 ⇒ 绿：豁免是 if-no-files-found 决定的，不是「上传一律不管」", () => {
    expect(
      cascadeProblems(withUpload("error", "!cancelled() && steps.vitest.outcome != 'skipped'"), RULE),
    ).toEqual([]);
  });
});

describe("readerJobCoverageProblems：登记表漏作业必须当场红，而不是等事故", () => {
  /** 带一步上传的作业片段；`name`/`manualOnly` 由调用方拼成 jobs 元素 */
  const withUploadBlock = (ifNoFiles: string) =>
    job(" ${{ !cancelled() && steps.vitest.outcome != 'skipped' }}") +
    `      - uses: actions/upload-artifact@0000000000000000000000000000000000000000
        with:
          name: junit-x-1
          path: junit-x-*.xml
          if-no-files-found: ${ifNoFiles}
`;
  const asJobs = (name: string, block: string, manualOnly = false) => [{ name, block, manualOnly }];

  it("有 error 上传且已登记 ⇒ 绿", () => {
    expect(readerJobCoverageProblems(asJobs("test-x", withUploadBlock("error")), ["test-x"])).toEqual([]);
  });

  it("有 error 上传却没登记 ⇒ 红，点名作业并给出登记形状", () => {
    const problems = readerJobCoverageProblems(asJobs("test-x", withUploadBlock("error")), []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("test-x");
    expect(problems[0]).toContain("anchor");
  });

  it("ignore 的上传不要求登记：它缺文件不会自己判红，没什么可收敛的", () => {
    expect(readerJobCoverageProblems(asJobs("test-x", withUploadBlock("ignore")), [])).toEqual([]);
  });

  it("注释里写着 `if-no-files-found: error` 的作业 ⇒ 不误判成有自我判红上传", () => {
    // 真实 ci.yml 就有这个形状：test-web 用注释解释「为什么不能写 always()」，
    // 里面原样引用了那行配置。判据只看代码行，与 cascadeProblems 同一口径。
    const commented = asJobs("test-y", `  test-y:
    steps:
      # 原先是 if-no-files-found: error，2026-10-29 改成 ignore
      - name: 无关步骤
        run: pnpm build
`);
    expect(readerJobCoverageProblems(commented, [])).toEqual([]);
  });

  it("手动/定时作业豁免：它的多处红不阻塞合并，登记只增加摩擦", () => {
    expect(
      readerJobCoverageProblems(asJobs("seo-audit-prod", withUploadBlock("error"), true), []),
    ).toEqual([]);
  });
});
