#!/usr/bin/env node
/**
 * CI 一次性预览库的门禁夹具：给「标签族」造出一个能进 sitemap 的标签。
 *
 * 为什么需要它：`/tags/[slug]` 进 sitemap 的门槛是 MIN_SITES_FOR_TAG_INDEX=10
 * （apps/web-overlay/src/lib/seo/thresholds.ts），而种子库里最大的标签只有 5 个活跃站点
 * ——实测 `GET /api/tags` 返回 `[{slug:"大模型",count:5}, ...]`。
 * 于是 `--live` 白名单 9 族里标签族永远打「sitemap 里没有 /tags/* 样本，跳过」，
 * 这条路由的 ISR 形态（revalidate、canonical、og、JSON-LD）在 CI 里是永久盲区。
 *
 * 只在 CI 的一次性库里生效：必须显式给 NAVHUB_ISR_FIXTURE_DB=1 才动手，
 * 否则直接退出码 2 —— 防止有人对着生产/开发库误跑。
 * 站点数取 15（种子有 57 个活跃站点）：门槛从 10 往上调到 15 以内都不用改这个脚本。
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const GUARD = String(process.env.NAVHUB_ISR_FIXTURE_DB ?? '').trim();
if (GUARD !== '1') {
  console.error('✖ 这个脚本只给 CI 的一次性预览库用：需要显式设置 NAVHUB_ISR_FIXTURE_DB=1');
  console.error('  （它往 tags / site_tags 里写数据，对着开发库或生产库跑都是污染。）');
  process.exit(2);
}

const dbPath = resolve(process.env.NAVHUB_SQLITE_PATH || './data/navhub.db');
const TAG_NAME = '门禁自检';
const TAG_SLUG = 'gate-selfcheck';
const LINK_TARGET = 15;

const db = new DatabaseSync(dbPath);
try {
  const existing = db.prepare('select id from tags where slug = ?').all(TAG_SLUG);
  let tagId = existing[0]?.id;
  if (!tagId) {
    tagId = randomUUID();
    db.prepare('insert into tags (id, name, slug, group_name, color, description, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(
      tagId,
      TAG_NAME,
      TAG_SLUG,
      'system',
      null,
      null,
      Date.now(),
    );
  }

  const linked = new Set(
    db.prepare('select site_id from site_tags where tag_id = ?').all(tagId).map((r) => r.site_id),
  );
  const candidates = db
    .prepare("select id from sites where status = 'active' and deleted_at is null order by id limit ?")
    .all(LINK_TARGET * 2)
    .map((r) => r.id);

  const insert = db.prepare('insert or ignore into site_tags (site_id, tag_id) values (?, ?)');
  let added = 0;
  for (const siteId of candidates) {
    if (linked.size + added >= LINK_TARGET) break;
    if (linked.has(siteId)) continue;
    insert.run(siteId, tagId);
    added += 1;
  }

  const count = db
    .prepare(
      "select count(*) c from site_tags st join sites s on s.id = st.site_id and s.status = 'active' and s.deleted_at is null where st.tag_id = ?",
    )
    .all(tagId)[0].c;

  console.log(
    JSON.stringify({
      db: dbPath,
      tag: { id: tagId, slug: TAG_SLUG, name: TAG_NAME },
      linksAdded: added,
      activeCount: count,
      target: LINK_TARGET,
    }),
  );
  if (count < LINK_TARGET) {
    console.error(`✖ 夹具标签的活跃站点只有 ${count}，低于目标 ${LINK_TARGET}（活跃站点不足？）`);
    process.exit(1);
  }
} finally {
  db.close();
}
