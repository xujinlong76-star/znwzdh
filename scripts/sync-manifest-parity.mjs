import { readFileSync, writeFileSync } from 'node:fs';

// 工作副本可能是 CRLF（core.autocrlf=true）。旧版脚本按 '…-end\n' 精确查找，
// 在 CRLF 检出下会直接抛「找不到标记」——CI 是 LF 所以一直没暴露。
// 统一归一化为 LF 再切分，保证本地与 CI 行为一致（parity 测试本身也会归一化换行）。
const core = readFileSync('packages/core/src/plugin-manifest.ts', 'utf8').replace(/\r\n/g, '\n');
const END_TAG = '// @plugin-manifest:parity-ignore-end\n';
const idx = core.indexOf(END_TAG);
if (idx === -1) {
  throw new Error('Could not find parity-ignore-end tag in core plugin-manifest.ts');
}

const overlayHeader = `// @plugin-manifest:parity-ignore-start
/**
 * NavHub 插件市场契约（Web 客户端运行时镜像）。
 *
 * 事实源：packages/core/src/plugin-manifest.ts —— 两侧除本头部注释外
 * 必须字节级一致（apps/web/test/plugin-manifest-parity.test.ts 守门）。
 */
// @plugin-manifest:parity-ignore-end
`;

const coreBody = core.slice(idx + END_TAG.length);
const content = overlayHeader + coreBody;

writeFileSync('apps/web-overlay/src/lib/plugins/plugin-manifest.ts', content, 'utf8');
writeFileSync('apps/web/src/lib/plugins/plugin-manifest.ts', content, 'utf8');
console.log('Successfully synced plugin-manifest.ts to web-overlay and web!');
