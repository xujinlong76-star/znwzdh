/**
 * navhub-api 路径归一化测试（node:assert 风格，与 scripts/ 下其它测试一致）。
 *
 * 锁定双重前缀 BUG 的回归：'/api/search' 不得生成 '/api/hub/api/search'。
 * 该 bug 曾导致搜索结果/标签/榜单/站点详情/管理面板数据全部静默为空
 * （404 被各调用方的 catch 吞掉，UI 只显示空态）。
 *
 * 运行：node_modules/.bin/tsx scripts/navhub-api.test.ts
 * （导入不带 .ts 扩展：apps/web 的 tsconfig 未开 allowImportingTsExtensions；
 *   node --experimental-strip-types 则要求带扩展，二者取 tsx。）
 */
import assert from 'node:assert'
import { hubUrl } from '../src/lib/navhub-api'

// '/api/search' 归一为 /api/hub/search（不产生双重前缀）
assert.strictEqual(hubUrl('/api/search?q=AI'), '/api/hub/search?q=AI')
// '/api/sites/:id' 同理
assert.strictEqual(hubUrl('/api/sites/abc-123'), '/api/hub/sites/abc-123')
// 不带 /api 前缀的路径同样可用
assert.strictEqual(hubUrl('/search?q=x'), '/api/hub/search?q=x')
assert.strictEqual(hubUrl('/health'), '/api/hub/health')
// admin 页面的 '/api/hub/jobs' 旧写法不重复 hub
assert.strictEqual(hubUrl('/api/hub/jobs?limit=50'), '/api/hub/jobs?limit=50')
assert.strictEqual(hubUrl('/api/hub/admin/stats/trends?days=30'), '/api/hub/admin/stats/trends?days=30')
// 查询串保持完整
assert.strictEqual(hubUrl('/api/rank/trending?limit=20'), '/api/hub/rank/trending?limit=20')
assert.strictEqual(hubUrl('/api/events?anonId=anon-1'), '/api/hub/events?anonId=anon-1')
// 恰好 '/api/hub/' 不误伤
assert.strictEqual(hubUrl('/api/hub/'), '/api/hub/')

console.log('All navhub-api tests passed.')
