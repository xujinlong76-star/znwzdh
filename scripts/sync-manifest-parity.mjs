import { readFileSync, writeFileSync } from 'node:fs';

const core = readFileSync('packages/core/src/plugin-manifest.ts', 'utf8');
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
