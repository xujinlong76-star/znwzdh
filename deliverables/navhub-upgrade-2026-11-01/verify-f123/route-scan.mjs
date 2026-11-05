// 独立路由覆盖扫描（verify-officer）——不依赖 route-state-coverage.test.ts 的实现，
// 自行枚举路由目录并判定 loading/error 覆盖，找出「无覆盖」的路由，再与豁免清单对照。
// 用法: node route-scan.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'C:/Users/许进龙/Desktop/web/apps/web-overlay/src/app';

// ---- 枚举含 page.tsx 的路由目录（'' = 首页） ----
const routeDirs = [];
function walk(dirRel) {
  const full = dirRel ? join(APP, ...dirRel.split('/')) : APP;
  for (const e of readdirSync(full, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const child = dirRel ? `${dirRel}/${e.name}` : e.name;
    if (existsSync(join(APP, ...child.split('/'), 'page.tsx'))) routeDirs.push(child);
    walk(child);
  }
}
walk('');
if (existsSync(join(APP, 'page.tsx'))) routeDirs.unshift('');

// ---- 覆盖判定（与 Next 语义一致：自身或祖先；根 error.tsx 对非根路由不算） ----
function hasFile(rel) {
  return existsSync(join(APP, ...rel.split('/').filter(Boolean)));
}
function loadingVia(dir) {
  const parts = dir ? dir.split('/') : [];
  for (let i = parts.length; i >= 0; i--) {
    const seg = parts.slice(0, i).join('/');
    const rel = seg ? `${seg}/loading.tsx` : 'loading.tsx';
    if (hasFile(rel)) return rel;
  }
  return null;
}
function errorVia(dir) {
  const parts = dir ? dir.split('/') : [];
  for (let i = parts.length; i >= 0; i--) {
    const seg = parts.slice(0, i).join('/');
    const rel = seg ? `${seg}/error.tsx` : 'error.tsx';
    if (hasFile(rel)) {
      if (seg === '' && dir !== '') return null; // 根 error.tsx 是全局网，不算局部
      return rel;
    }
  }
  return null;
}

// ---- 从测试文件里抠出 STATE_EXEMPT 键（独立对照，不 import 测试实现） ----
const testSrc = readFileSync('C:/Users/许进龙/Desktop/web/apps/web/test/route-state-coverage.test.ts', 'utf8');
const blockStart = testSrc.indexOf('const STATE_EXEMPT');
const blockEnd = testSrc.indexOf('};', blockStart);
const block = testSrc.slice(blockStart, blockEnd);
const exemptLoading = new Set();
const exemptError = new Set();
// 逐条目解析： "key": { loading?: ..., error?: ... }
const entryRe = /(?:"([^"]*)"|([\w[\]\/-]+))\s*:\s*\{([^}]*)\}/g;
let m;
while ((m = entryRe.exec(block)) !== null) {
  const key = m[1] ?? m[2];
  if (key === undefined || key === 'STATE_EXEMPT') continue;
  const body = m[3];
  if (/\bloading\s*:/.test(body)) exemptLoading.add(key);
  if (/\berror\s*:/.test(body)) exemptError.add(key);
}

// ---- 扫描缺口 ----
const noLoading = [];
const noError = [];
for (const dir of routeDirs) {
  if (loadingVia(dir) === null && !exemptLoading.has(dir)) noLoading.push(dir);
  if (errorVia(dir) === null && !exemptError.has(dir)) noError.push(dir);
}

// ---- 幽灵豁免 / 残留豁免 ----
const dirSet = new Set(routeDirs);
const ghosts = [...new Set([...exemptLoading, ...exemptError])].filter((k) => !dirSet.has(k));
const stale = [];
for (const dir of exemptLoading) if (loadingVia(dir) !== null) stale.push(`${dir} loading`);
for (const dir of exemptError) if (errorVia(dir) !== null) stale.push(`${dir} error`);

// ---- 统计 ----
const loadingFiles = [];
const errorFiles = [];
(function collect(dirRel) {
  const full = dirRel ? join(APP, ...dirRel.split('/')) : APP;
  for (const e of readdirSync(full, { withFileTypes: true })) {
    const child = dirRel ? `${dirRel}/${e.name}` : e.name;
    if (e.isDirectory()) collect(child);
    else if (e.name === 'loading.tsx') loadingFiles.push(child);
    else if (e.name === 'error.tsx') errorFiles.push(child);
  }
})('');

console.log('路由目录总数:', routeDirs.length);
console.log('loading.tsx 文件数:', loadingFiles.length, JSON.stringify(loadingFiles));
console.log('error.tsx 文件数:', errorFiles.length, JSON.stringify(errorFiles));
console.log('STATE_EXEMPT loading 键数:', exemptLoading.size, 'error 键数:', exemptError.size);
console.log('--- 无 loading 覆盖且未豁免（应为空）:', JSON.stringify(noLoading));
console.log('--- 无 error 覆盖且未豁免（应为空）:', JSON.stringify(noError));
console.log('--- 幽灵豁免（应为空）:', JSON.stringify(ghosts));
console.log('--- 残留豁免（应为空）:', JSON.stringify(stale));
