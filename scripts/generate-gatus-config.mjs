#!/usr/bin/env node
/**
 * Gatus config.yaml 生成器（只借配置思想，不部署 Gatus 本体）。
 *
 * 方案来源：03-livelink-mapping §5。字段映射、条件模板、硬规则 1–6 全部按
 * 方案写死；生成器本身入库，产物 gatus-config.yaml 不入库（每次现生成现核对）。
 *
 * 用法：
 *   node scripts/generate-gatus-config.mjs [--input <navigation.json>]
 *       [--output <gatus-config.yaml>] [--slow-list <json>] [--loose-list <json>] [--json]
 *
 *   --input     导航 JSON，默认 apps/web-overlay/src/navsphere/content/navigation.json
 *   --output    产物路径，默认 ./gatus-config.yaml（产物不提交）
 *   --slow-list 可选 JSON：慢站清单，数组元素为 href 或 hostname。
 *               口径：sentinel 历史延迟 P95 > 8s 的站，timeout 单列 30s。
 *               不给文件时慢站清单为空（报告里写明数据缺失，不编数据）。
 *   --loose-list 可选 JSON：宽松组清单，数组元素为 href 或 hostname。
 *               口径：sentinel 历史近 30 天 401/403/429 占比 >= 50% 的站。
 *               不给文件时宽松组为空（报告里写明数据缺失，不编数据）。
 *   --json      只输出 JSON 报告（供 CI 采集）；默认输出人类可读报告。
 *
 * 写死的值（§5）：
 *   group 取大类 title；name 同组重名加“标题 (域名)”后缀，再重名加 #2/#3；
 *   url 原样；interval 1h；timeout 10s（慢站 30s）；
 *   UA 为 Chrome 126 真实浏览器串；alerts 初期 []；ui.default-sort-by 写 group；
 *   storage.type 不写；concurrency 固定 3。
 *   证书条件只加 https 站；域名条件全量加。
 *   YAML anchors：&defaults + <<: *defaults 压缩重复字段（严格组 https 为
 *   &defaults；http 严格组为 &defaults-http；宽松组为 &defaults-loose）。
 *   生成后校验再落盘：校验失败不落盘、不覆盖旧产物（退出码 2）。
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const INTERVAL = "1h";
export const TIMEOUT = "10s";
export const SLOW_TIMEOUT = "30s";
export const CONCURRENCY = 3;
export const SITE_TITLE = "山羊胡网";

export const STRICT_HTTPS_CONDITIONS = [
  "[STATUS] < 400",
  "[RESPONSE_TIME] < 10000",
  "[CERTIFICATE_EXPIRATION] > 240h",
  "[DOMAIN_EXPIRATION] > 720h",
];
export const STRICT_HTTP_CONDITIONS = [
  "[STATUS] < 400",
  "[RESPONSE_TIME] < 10000",
  "[DOMAIN_EXPIRATION] > 720h",
];
export const LOOSE_CONDITIONS = [
  "[STATUS] == any(200, 401, 403, 429)",
  "[RESPONSE_TIME] < 10000",
];

/** 条件语法：`[占位符] <比较符> <值>`，只允许方案给出的四种占位符。 */
const CONDITION_RE =
  /^\[(STATUS|RESPONSE_TIME|CERTIFICATE_EXPIRATION|DOMAIN_EXPIRATION)\] (==|!=|<=|>=|<|>) (any\([0-9, ]+\)|[0-9]+[a-z]*)$/;

export function hostnameOf(href) {
  return new URL(href).hostname.replace(/^www\./, "");
}

function isHttps(href) {
  return href.startsWith("https://");
}

/** 读可选清单文件（JSON 数组，元素为 href 或 hostname）；文件不存在时返回空集。 */
export function loadListFile(path) {
  if (!path) return new Set();
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`清单文件必须是 JSON 数组：${path}`);
  return new Set(raw.map((v) => String(v).trim()).filter(Boolean));
}

function matchesList(list, href) {
  if (list.size === 0) return false;
  if (list.has(href)) return true;
  try {
    return list.has(hostnameOf(href));
  } catch {
    return false;
  }
}

/**
 * 只读 navigation.json，产出端点模型（不写盘）。
 * 结构：navigationItems[]（大类）→ subCategories[] → items[]；同时兼容
 * 大类直挂 items[] 的形态。group 一律取大类 title。
 */
export function loadNavigation(inputPath) {
  const nav = JSON.parse(readFileSync(inputPath, "utf8"));
  const categories = nav.navigationItems;
  if (!Array.isArray(categories)) throw new Error(`导航 JSON 缺少 navigationItems 数组：${inputPath}`);
  const sites = [];
  for (const cat of categories) {
    const group = cat.title;
    if (typeof group !== "string" || group === "") throw new Error(`大类缺少 title：${JSON.stringify(cat.id)}`);
    const collect = (items) => {
      for (const item of items ?? []) sites.push({ group, ...item });
    };
    collect(cat.items);
    for (const sub of cat.subCategories ?? []) collect(sub.items);
  }
  return sites;
}

export function buildEndpoints(sites, { slowList = new Set(), looseList = new Set() } = {}) {
  const seenNames = new Map(); // group -> Set<name>
  const endpoints = [];
  for (const site of sites) {
    if (typeof site.title !== "string" || site.title === "") {
      throw new Error(`站点缺少 title：${JSON.stringify(site.id)}`);
    }
    if (typeof site.href !== "string" || site.href === "") {
      throw new Error(`站点缺少 href：${JSON.stringify(site.id)} (${site.title})`);
    }
    let url;
    try {
      url = new URL(site.href);
    } catch {
      throw new Error(`站点 href 不是合法 URL：${site.href} (${site.title})`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`站点 href 不是 http(s)：${site.href} (${site.title})`);
    }
    const https = url.protocol === "https:";
    const loose = matchesList(looseList, site.href);
    const slow = matchesList(slowList, site.href);
    const conditions = loose
      ? [...LOOSE_CONDITIONS]
      : https
        ? [...STRICT_HTTPS_CONDITIONS]
        : [...STRICT_HTTP_CONDITIONS];
    const groupNames = seenNames.get(site.group) ?? new Set();
    seenNames.set(site.group, groupNames);
    let name = site.title;
    if (groupNames.has(name)) {
      // 同组重名加“标题 (域名)”后缀；再重名加 #2/#3 顺序号。
      const suffixed = `${site.title} (${hostnameOf(site.href)})`;
      name = suffixed;
      let n = 2;
      while (groupNames.has(name)) {
        name = `${suffixed} #${n}`;
        n += 1;
      }
    }
    groupNames.add(name);
    endpoints.push({
      name,
      group: site.group,
      url: site.href,
      https,
      loose,
      slow,
      conditions,
      suffixed: name !== site.title,
    });
  }
  return endpoints;
}

function endpointClass(ep) {
  if (ep.loose) return "loose";
  return ep.https ? "strict-https" : "strict-http";
}

const CLASS_ANCHOR = {
  "strict-https": "defaults",
  "strict-http": "defaults-http",
  loose: "defaults-loose",
};

/** 校验端点模型：每端点必填非空、name 组内唯一、条件语法合规。失败即抛错。 */
export function validateEndpoints(endpoints) {
  if (endpoints.length === 0) throw new Error("端点为空：导航 JSON 里没有站点");
  const names = new Set();
  for (const ep of endpoints) {
    for (const field of ["name", "group", "url"]) {
      if (typeof ep[field] !== "string" || ep[field] === "") {
        throw new Error(`端点缺少 ${field}：${JSON.stringify(ep)}`);
      }
    }
    if (!Array.isArray(ep.conditions) || ep.conditions.length === 0) {
      throw new Error(`端点缺少 conditions：${ep.name}`);
    }
    for (const cond of ep.conditions) {
      if (!CONDITION_RE.test(cond)) throw new Error(`条件语法不合规：${ep.name} -> ${cond}`);
    }
    if (ep.https && !ep.conditions.includes("[CERTIFICATE_EXPIRATION] > 240h") && !ep.loose) {
      throw new Error(`https 站缺少证书条件：${ep.name}`);
    }
    if (!ep.loose && !ep.conditions.includes("[DOMAIN_EXPIRATION] > 720h")) {
      throw new Error(`非宽松组端点缺少域名条件：${ep.name}`);
    }
    const key = `${ep.group}\0${ep.name}`;
    if (names.has(key)) throw new Error(`组内 name 重复：${ep.group} / ${ep.name}`);
    names.add(key);
  }
}

/** YAML 双引号标量：JSON 转义与 YAML 双引号样式兼容，标题里的特殊字符全包住。 */
function q(value) {
  return JSON.stringify(value);
}

function indentLines(lines, spaces) {
  const pad = " ".repeat(spaces);
  return lines.map((line) => (line === "" ? line : pad + line));
}

/** 锚点源端点（带全部公共字段）的完整块；anchor 为 null 时不写锚。 */
function fullEndpointBlock(ep, anchor) {
  const lines = [];
  if (anchor) {
    // 锚必须独占一行：`- &defaults name: ...` 会把锚绑到 `name` 标量上，
    // merge 时报“expected a mapping … found scalar”（PyYAML 实测）。
    lines.push(`- &${anchor}`);
    lines.push(`  name: ${q(ep.name)}`);
  } else {
    lines.push(`- name: ${q(ep.name)}`);
  }
  lines.push(`  group: ${q(ep.group)}`);
  lines.push(`  url: ${q(ep.url)}`);
  lines.push(`  interval: ${INTERVAL}`);
  lines.push(`  client:`);
  lines.push(`    timeout: ${ep.slow ? SLOW_TIMEOUT : TIMEOUT}`);
  lines.push(`  headers:`);
  lines.push(`    User-Agent: ${q(USER_AGENT)}`);
  lines.push(`  conditions:`);
  for (const cond of ep.conditions) lines.push(`    - ${q(cond)}`);
  lines.push(`  alerts: []`);
  return lines;
}

/** 引用锚点的端点块：只写自有字段 + merge key；慢站显式覆盖 client。 */
function mergedEndpointBlock(ep, anchor) {
  const lines = [];
  lines.push(`- name: ${q(ep.name)}`);
  lines.push(`  group: ${q(ep.group)}`);
  lines.push(`  url: ${q(ep.url)}`);
  lines.push(`  <<: *${anchor}`);
  if (ep.slow) {
    lines.push(`  client:`);
    lines.push(`    timeout: ${SLOW_TIMEOUT}`);
  }
  return lines;
}

/**
 * 序列化为 Gatus config YAML。
 * 锚点规则：每类第一个非慢站端点挂锚（锚内 timeout 是 10s 默认值）；该类里
 * 锚点之前的慢站端点因锚尚未定义，写全字段不引用；锚点之后的端点用 merge。
 * 某类全是慢站时不挂锚（否则 merge 会把 30s 带给全组），该类全部写全字段。
 */
export function serializeConfig(endpoints) {
  const byClass = new Map();
  endpoints.forEach((ep, i) => {
    const cls = endpointClass(ep);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(i);
  });
  const anchorIndex = new Map(); // class -> endpoint index that carries the anchor
  for (const [cls, indices] of byClass) {
    const firstNonSlow = indices.find((i) => !endpoints[i].slow);
    if (firstNonSlow !== undefined) anchorIndex.set(cls, firstNonSlow);
  }
  const anchored = new Set();
  const lines = [];
  lines.push("# Gatus config.yaml —— 由 scripts/generate-gatus-config.mjs 生成，产物不入库。");
  lines.push("# 只借 Gatus 配置思想作巡检侧 spec 参考；本站不部署 Gatus 本体，探活仍走 sentinel。");
  lines.push(`# 站点数：${endpoints.length}；生成时导航 JSON 实际条数为准，不写死 367。`);
  lines.push(`endpoints:`);
  endpoints.forEach((ep, i) => {
    const cls = endpointClass(ep);
    const anchor = CLASS_ANCHOR[cls];
    if (anchorIndex.get(cls) === i) {
      lines.push(...fullEndpointBlock(ep, anchor));
      anchored.add(cls);
    } else if (anchored.has(cls)) {
      lines.push(...mergedEndpointBlock(ep, anchor));
    } else {
      lines.push(...fullEndpointBlock(ep, null));
    }
  });
  lines.push(`ui:`);
  lines.push(`  title: ${q(SITE_TITLE)}`);
  lines.push(`  default-sort-by: group`);
  lines.push(`concurrency: ${CONCURRENCY}`);
  return lines.join("\n") + "\n";
}

/**
 * 校验已生成的 YAML 文本（结构级，不依赖 YAML 库）：
 * 端点数与模型一致；每个端点块有 name/group/url；每个 merge 引用都指向
 * 之前已定义的锚；不含 storage 字段；ui.default-sort-by 为 group。
 * 通过返回 true，失败抛错。
 */
export function validateYamlText(yaml, endpoints) {
  if (/^storage:/m.test(yaml)) throw new Error("产物含 storage 字段：不部署 Gatus，本字段不出现");
  if (!/default-sort-by: group/.test(yaml)) throw new Error("产物缺少 ui.default-sort-by: group");
  if (!/concurrency: 3/.test(yaml)) throw new Error("产物缺少 concurrency: 3");
  const definedAnchors = new Set();
  for (const match of yaml.matchAll(/&([A-Za-z0-9_-]+)/g)) definedAnchors.add(match[1]);
  for (const match of yaml.matchAll(/<<: \*([A-Za-z0-9_-]+)/g)) {
    if (!definedAnchors.has(match[1])) throw new Error(`merge 引用了未定义的锚：*${match[1]}`);
  }
  // 每个 merge 引用必须出现在其锚定义之后（YAML 锚先定义后引用）。
  for (const match of yaml.matchAll(/<<: \*([A-Za-z0-9_-]+)/g)) {
    const anchorPos = yaml.indexOf(`&${match[1]}`);
    if (anchorPos === -1 || anchorPos > match.index) {
      throw new Error(`merge 引用出现在锚定义之前：*${match[1]}`);
    }
  }
  // name 行有两种形态：锚点源端点是 `  name:`（锚独占 `- &anchor` 行），
  // 其余端点是 `- name:`（merge 块首行）。
  const nameCount = (yaml.match(/^(?:- |  )name: /gm) ?? []).length;
  if (nameCount !== endpoints.length) {
    throw new Error(`产物端点数 ${nameCount} 与模型 ${endpoints.length} 不一致`);
  }
  const groupCount = (yaml.match(/^  group: /gm) ?? []).length;
  if (groupCount !== endpoints.length) throw new Error(`产物 group 行数 ${groupCount} 与端点数不一致`);
  const urlCount = (yaml.match(/^  url: /gm) ?? []).length;
  if (urlCount !== endpoints.length) throw new Error(`产物 url 行数 ${urlCount} 与端点数不一致`);
  return true;
}

export function buildReport(endpoints, { inputPath, outputPath, slowListGiven, looseListGiven }) {
  const https = endpoints.filter((ep) => ep.https).length;
  const http = endpoints.length - https;
  const withCert = endpoints.filter((ep) => ep.https && !ep.loose).length;
  const withDomain = endpoints.filter((ep) => !ep.loose).length;
  const loose = endpoints.filter((ep) => ep.loose).length;
  const slow = endpoints.filter((ep) => ep.slow).length;
  const suffixed = endpoints.filter((ep) => ep.suffixed).length;
  const groups = new Set(endpoints.map((ep) => ep.group)).size;
  return {
    input: inputPath,
    output: outputPath,
    total: endpoints.length,
    groups,
    https,
    http,
    withCertificateCondition: withCert,
    withDomainCondition: withDomain,
    loose,
    slow,
    suffixedNames: suffixed,
    slowListDataMissing: !slowListGiven,
    looseListDataMissing: !looseListGiven,
  };
}

export function parseArgs(argv) {
  const args = { input: "apps/web-overlay/src/navsphere/content/navigation.json", output: "gatus-config.yaml", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--output") args.output = argv[++i];
    else if (a === "--slow-list") args.slowList = argv[++i];
    else if (a === "--loose-list") args.looseList = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`不认识的参数：${a}`);
    if ((a === "--input" || a === "--output" || a === "--slow-list" || a === "--loose-list") && !args[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) {
      throw new Error(`${a} 后面要跟路径`);
    }
  }
  return args;
}

function printReport(report) {
  console.log(`Gatus 配置生成完成：${report.output}`);
  console.log(`  站点总数：${report.total}（大类 ${report.groups} 个）`);
  console.log(`  https 站：${report.https}（加证书条件 ${report.withCertificateCondition}）`);
  console.log(`  http 站：${report.http}（不加证书条件）`);
  console.log(`  加域名条件：${report.withDomainCondition}`);
  console.log(`  宽松组（疑似反爬）：${report.loose}${report.looseListDataMissing ? "（无 sentinel 历史数据，清单为空）" : ""}`);
  console.log(`  慢站（timeout 30s）：${report.slow}${report.slowListDataMissing ? "（无 sentinel 历史延迟数据，清单为空）" : ""}`);
  console.log(`  同组重名加后缀：${report.suffixedNames}`);
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`参数错误：${err.message}`);
    console.error("用法：node scripts/generate-gatus-config.mjs [--input <path>] [--output <path>] [--slow-list <json>] [--loose-list <json>] [--json]");
    return 2;
  }
  if (args.help) {
    console.log("用法：node scripts/generate-gatus-config.mjs [--input <path>] [--output <path>] [--slow-list <json>] [--loose-list <json>] [--json]");
    return 0;
  }
  let sites;
  try {
    sites = loadNavigation(resolve(args.input));
  } catch (err) {
    console.error(`读导航 JSON 失败：${err.message}`);
    return 2;
  }
  let slowList = new Set();
  let looseList = new Set();
  try {
    slowList = loadListFile(args.slowList ? resolve(args.slowList) : null);
    looseList = loadListFile(args.looseList ? resolve(args.looseList) : null);
  } catch (err) {
    console.error(`读清单文件失败：${err.message}`);
    return 2;
  }
  let endpoints;
  try {
    endpoints = buildEndpoints(sites, { slowList, looseList });
    validateEndpoints(endpoints);
  } catch (err) {
    console.error(`端点校验失败：${err.message}`);
    return 2;
  }
  const yaml = serializeConfig(endpoints);
  try {
    validateYamlText(yaml, endpoints);
  } catch (err) {
    console.error(`产物校验失败，不落盘：${err.message}`);
    return 2;
  }
  const outputPath = resolve(args.output);
  // 原子落盘：先写临时文件再 rename，写失败时旧产物原样保留（不截断覆盖）。
  const tmpPath = `${outputPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmpPath, yaml, "utf8");
    renameSync(tmpPath, outputPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // 清理失败不掩盖原始写错误。
    }
    console.error(`写产物失败：${err.message}`);
    return 2;
  }
  const report = buildReport(endpoints, {
    inputPath: args.input,
    outputPath: args.output,
    slowListGiven: Boolean(args.slowList),
    looseListGiven: Boolean(args.looseList),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return 0;
}

const invokedAsScript =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedAsScript) {
  process.exitCode = main(process.argv.slice(2));
}
