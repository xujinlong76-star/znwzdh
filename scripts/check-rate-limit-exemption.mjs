#!/usr/bin/env node
/**
 * 限流豁免的集成覆盖（零依赖，Node >= 20）
 *
 * 为什么需要它：`apps/api/src/internal-traffic.ts` + `hub.ts` 的这套豁免，
 * 单测只证明「函数会认这个头」，不证明「收录页真的因此不再是降级壳」。
 * 而后者正是 2026-10-23 那次实测的因果链（docs/seo/ISR-ROUTES.md 5.9/5.10）：
 * 中枢全局按 IP 限流 → 我方 SSR 取数拿到 429 → 详情页判 `failed` →
 * 渲染成带 `noindex, follow` 的壳 → **这份壳被 ISR 缓存** → 收录面成片不可索引。
 * 本地 A/B 是手动跑的，跑一次就过期；这个脚本把它变成每次 CI 都跑的断言。
 *
 * 用法（CI 里在预览站上跑，见 .github/workflows/ci.yml 的「限流豁免」步骤）：
 *   NAVHUB_INTERNAL_TOKEN=… node scripts/check-rate-limit-exemption.mjs \
 *     --api-base=http://127.0.0.1:8787 --web-base=http://localhost:3000
 *   # 只调形状不逼再生：--revalidate-grace=0；CI 默认 grace=75（> revalidate=60）settle=5
 *
 * 四个阶段，每一个都对应一条「如果不成立就没法相信绿灯」的前提：
 *  1. **空转守卫**：不带凭据猛打中枢，必须真的出现 429。
 *     额度没被打穿时后面所有「没被限流」都不说明豁免有用 —— 所以这里直接红灯，
 *     而不是让整套检查变成一条永远不会响的守卫。
 *  2. **豁免生效**：同样次数带上 `x-navhub-internal-token`，必须 0 次 429。
 *  3. **收录面形状**：经 web 抓 N 个 `/site/{id}`，每个都要 200 + 有 `<h1>` +
 *     不含 `noindex`，且其中至少 `--min-miss` 个是 `x-nextjs-cache` 非 HIT。
 *  3b. **真·重渲染复探**（首趟全 HIT 时自动进入）：等 `--revalidate-grace` 秒过掉
 *     ISR 窗口，先把按 IP 的公开额度重新打满，再复探同一批页 —— 一趟里同步产出（MISS）
 *     算证据；只给 STALE 的等 `--revalidate-settle` 秒看它有没有回到 HIT。
 *     这一步的存在理由：CI 刻意不重启 web，磁盘两层缓存清了也可能被进程内缓存兜住，
 *     而「过期后一直给旧快照」正是 SSR 取数被 429 挡住时 Next 的保旧行为
 *     —— 只有把额度维持在耗尽状态，这一阶段才真的在考豁免。
 *  4. **边界**：浏览器侧的 `/api/hub/*` 代理必须**照样**被限流。
 *     代理要是把这个头附带上了，等于把全站访客标成内部流量，按 IP 的限流形同虚设
 *     —— 这条红线只靠单测钉住太薄，这里用真实代理路径再钉一次。
 *
 * 退出码：0 全绿；1 任一阶段不成立；2 前置条件缺失（没配 token、站点起不来）。
 * 不打印 token 本身（只打印长度），日志里拿不到凭据。
 */

import { argvParse, countRegenerated, hammer, probePage, probeSet, sleep, summarizeStatuses } from './lib/rate-limit-check.mjs';

const HEADER = 'x-navhub-internal-token';

async function main() {
  const opts = argvParse(process.argv.slice(2));
  const token = (process.env[opts.tokenEnv] ?? '').trim();
  if (!token) {
    console.error(`✖ 环境变量 ${opts.tokenEnv} 未配置 —— 没有凭据就无法验证豁免，拒绝「静默通过」`);
    return 2;
  }
  console.log(`· 中枢 ${opts.apiBase} / 前端 ${opts.webBase}，凭据长度 ${token.length}（值不进日志）`);

  const failures = [];
  const publicPath = `${opts.apiBase}/api/sites?page=1&pageSize=1`;
  const exemptHeaders = { [HEADER]: token };

  // ---- 阶段 1：空转守卫 ----
  const pub = await hammer(publicPath, { count: opts.hammer, headers: {} });
  console.log(
    `· 阶段 1 不带凭据 ${opts.hammer} 次 → ${summarizeStatuses(pub.statuses)}；429 首次出现在第 ${pub.first429At ?? '从未'} 次`,
  );
  if (!pub.first429At) {
    failures.push(
      `阶段 1 不成立：${opts.hammer} 次公开请求一次 429 都没有 —— 中枢额度比这更大（或限流没开），` +
        `那么阶段 2 的「带上凭据就没 429」是空转证据。把 --public-hammer 提到额度以上（CI 用 --public-hammer=60 + NAVHUB_RATE_LIMIT_MAX=40）`,
    );
  }

  // ---- 阶段 2：豁免真的吃掉了额度 ----
  const ex = await hammer(publicPath, { count: opts.hammer, headers: exemptHeaders });
  console.log(`· 阶段 2 带凭据 ${opts.hammer} 次 → ${summarizeStatuses(ex.statuses)}`);
  if (ex.status429) {
    failures.push(
      `阶段 2 不成立：带 ${HEADER} 仍有 ${ex.status429} 次 429 —— 豁免没生效（两侧 ${opts.tokenEnv} 不一致？中枢没重启？allowList 被摘掉？）`,
    );
  }
  if (ex.otherNon2xx) {
    failures.push(
      `阶段 2 附带异常：带凭据出现 ${ex.otherNon2xx} 次非 2xx（除 429）—— 豁免路径本身不该改变响应语义`,
    );
  }

  // ---- 阶段 3：收录页在小额度下仍然是「能收录的页」 ----
  const pages = await probePage(opts);
  console.log(
    `· 阶段 3 经 web 抓 ${pages.total} 个 /site/* → 200=${pages.ok200} 壳=${pages.shells} 非200=${pages.badStatus} 重渲染(非 HIT)=${pages.miss}`,
  );
  if (pages.error) {
    failures.push(`阶段 3 没跑到：${opts.webBase}/sitemap.xml 取不到（${pages.error}）`);
  } else if (pages.sitemapPaths === 0) {
    failures.push(`阶段 3 没跑到：${opts.webBase}/sitemap.xml 里没有 /site/* 条目（中枢失联或 seed 空）`);
  } else {
    // 重渲染证据不够时先跑 3b（它可能新产出壳），再统一判形状 —— 顺序反了就会
    // 把「3b 复探才现形的壳」漏报成「这一轮没壳」。
    if (pages.miss < opts.minMiss) {
      if (opts.graceSec <= 0) {
        failures.push(
          `阶段 3 证据不足：${pages.total} 页里只有 ${pages.miss} 页走了真·重渲染（非 x-nextjs-cache: HIT），低于下限 ${opts.minMiss}，` +
            `且 --revalidate-grace=0 关掉了复探 ⇒ 这一条不可判（不谎报为通过）。` +
            `全 HIT 的来源只剩两个：正在运行的 next-server 进程内缓存，或同一轮 job 更早的步骤已在 revalidate 有效期内渲染过同一批页`,
        );
      } else {
        // ---- 阶段 3b：等过 revalidate 窗口、把公开额度重新打满，再逼一次真·重渲染 ----
        // 只清磁盘两层缓存不够：CI 刻意不重启 web，进程内缓存照样给 HIT。
        // 让这一页「不得不再生成」的唯一在界手段就是让它的缓存过期，
        // 并在再生发生的那一刻把按 IP 的公开额度维持在耗尽状态。
        const paths = pages.sample ?? [];
        console.log(
          `– 阶段 3b 首趟只有 ${pages.miss}/${opts.minMiss} 页重渲染：等 ${opts.graceSec}s 过 revalidate 窗口，` +
            `再把公开额度打满 ${opts.hammer} 次后复探 ${paths.length} 页`,
        );
        await sleep(opts.graceSec * 1000);
        const exhaust = await hammer(publicPath, { count: opts.hammer, headers: {} });
        console.log(
          `· 阶段 3b 复探前打满公开额度 → ${summarizeStatuses(exhaust.statuses)}（429 首次在第 ${exhaust.first429At ?? '从未'} 次）`,
        );
        const first = await probeSet(opts, paths);
        const staleOnly = first.filter((r) => /^STALE$/i.test(r.cacheState)).map((r) => r.path);
        let second = [];
        if (staleOnly.length) {
          await sleep(opts.settleSec * 1000);
          second = await probeSet(opts, staleOnly);
        }
        const regen = countRegenerated(first, second);
        pages.shells += regen.shells;
        pages.miss += regen.ok;
        console.log(
          `· 阶段 3b 复探 → 触发再生=${regen.ok + regen.keptStale} 同步/后台成功=${regen.ok} 过期后仍在给旧快照=${regen.keptStale} 壳=${regen.shells}`,
        );
        if (pages.miss < opts.minMiss) {
          failures.push(
            regen.keptStale > 0
              ? `阶段 3/3b 证据不足：复探逼出 ${regen.ok + regen.keptStale} 页过期，但只有 ${regen.ok} 页真的再生成成功（下限 ${opts.minMiss}）—— ` +
                  `${regen.keptStale} 页在额度已被公开请求打满的那一刻没能再生、继续给旧快照。` +
                  `Next 的行为是「后台再生失败则保留旧数据」，所以这一条红在 SSR 取数被 429 挡住的失败形状上，不是取证本身没执行：` +
                  `查 web 的 lib/server/hub.ts 是否真的带上 ${opts.tokenEnv}（以及 ${opts.tokenEnv} 两侧是否一致）`
              : `阶段 3/3b 证据不足：等 ${opts.graceSec}s 后复探 ${paths.length} 页仍全 HIT（成功再生 ${regen.ok}，下限 ${opts.minMiss}）—— ` +
                  `revalidate 窗口没起作用，说明这一轮读的既不是磁盘缓存也不是到期快照：` +
                  `收录页的 revalidate 被改大了？还是这些页根本没走 ISR（generateStaticParams/构建期预渲染变了形状？）`,
          );
        }
      }
    }
    if (pages.shells) {
      failures.push(
        `阶段 3 不成立：${pages.shells} 页是降级壳（200 但自己声明 noindex，或 200 但正文没有 <h1>）—— 就是 5.9 那条链的产物形状：SSR 取数失败被缓存成壳。` +
          `先查中枢健康与 ${opts.tokenEnv} 是否两侧一致，再怀疑渲染代码`,
      );
    }
    if (pages.badStatus) {
      failures.push(`阶段 3 不成立：${pages.badStatus} 页不是 200（${pages.badStatusList.join(' | ')}）`);
    }
  }

  // ---- 阶段 4：浏览器侧代理不得被标成内部流量 ----
  if (!pub.first429At) {
    console.log('– 阶段 4 跳过：阶段 1 没能打穿额度，「代理有没有被豁免」在这种额度下不可判（不谎报为通过）');
  } else {
    const proxied = await hammer(`${opts.webBase}/api/hub/sites?page=1&pageSize=1`, {
      count: opts.hammer,
      headers: {},
    });
    console.log(`· 阶段 4 /api/hub 代理 ${opts.hammer} 次（不带凭据）→ ${summarizeStatuses(proxied.statuses)}`);
    if (!proxied.first429At) {
      failures.push(
        `阶段 4 不成立：浏览器侧 /api/hub/* 代理猛打 ${opts.hammer} 次一次 429 都没有（同一时刻直连中枢会被挡）—— ` +
          `要么代理自己附带了 ${HEADER}（把全站访客标成内部流量），要么豁免判据放宽到了 IP 段。这是安全边界，不是性能问题`,
      );
    }
  }

  if (failures.length) {
    console.error(`\n✖ 限流豁免集成检查未通过（${failures.length} 项）：`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(
    `\n✓ 限流豁免集成检查通过：公开额度会被打穿、带凭据不被打穿、${pages.total} 个收录页在受限中枢下全部可索引（${pages.miss} 页现渲染）、浏览器侧代理照样受限`,
  );
  return 0;
}

main().then((code) => process.exit(code));
