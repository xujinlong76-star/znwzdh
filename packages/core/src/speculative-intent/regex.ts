/**
 * 正则表达式即时匹配与捕获组速览 (Regex Sandbox)。
 */
import type { SpeculativeIntentResult } from './types.ts'

/** 检测是否存在易引发灾难性回溯（ReDoS）的嵌套量词模式，如 (a+)+ 或 ([a-z]*)* */
function hasNestedQuantifierRisk(pattern: string): boolean {
  return /\([^()]*[+*\}][^()]*\)\s*(?:[+*?]|\{\d+)/.test(pattern);
}

export function tryParseRegex(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  // 长度上限：防止在搜索框逐击键执行超长正则导致主线程卡死（DoS）
  if (trimmed.length > 512) return null;
  let pattern = '';
  let flags = '';
  let testText = '';

  const explicit = trimmed.match(/^(?:regex|regexp):\s*(.+)$/i);
  if (explicit) {
    const rest = explicit[1]!.trim();
    const slashMatch = rest.match(/^\/((?:\\\/|[^\/])+)\/([gimsuy]*)(?:\s+(.*))?$/);
    if (slashMatch) {
      pattern = slashMatch[1]!;
      flags = slashMatch[2] || '';
      testText = slashMatch[3] || '';
    } else {
      const quoteMatch = rest.match(/^"([^"]+)"(?:\s+(.*))?$/) || rest.match(/^'([^']+)'(?:\s+(.*))?$/);
      if (quoteMatch) {
        pattern = quoteMatch[1]!;
        testText = quoteMatch[2] || '';
      } else {
        const spaceIdx = rest.indexOf(' ');
        if (spaceIdx > 0) {
          pattern = rest.slice(0, spaceIdx);
          testText = rest.slice(spaceIdx + 1).trim();
        } else {
          pattern = rest;
        }
      }
    }
  } else {
    // 隐式匹配：必须是 /pattern/flags [testText] 形式
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
      return null;
    }
    const slashMatch = trimmed.match(/^\/((?:\\\/|[^\/])+)\/([gimsuy]*)(?:\s+(.*))?$/);
    if (!slashMatch) return null;
    pattern = slashMatch[1]!;
    flags = slashMatch[2] || '';
    testText = slashMatch[3] || '';
  }

  if (!pattern || pattern.length > 256) return null;

  try {
    const rx = new RegExp(pattern, flags);
    let captureCount = 0;
    try {
      const emptyExec = new RegExp(pattern + '|', flags).exec('');
      captureCount = emptyExec ? emptyExec.length - 1 : 0;
    } catch {
      // 容错降级
    }

    if (testText) {
      if (hasNestedQuantifierRisk(pattern) && testText.length > 24) {
        return {
          type: 'regex',
          title: 'RegExp 回溯风险保护已触发',
          subtitle: `模式: /${pattern}/${flags}`,
          previewValue: '⚠️ 检测到嵌套量词模式且测试文本较长，已阻断同步求值以防止主线程灾难性回溯 (ReDoS)。',
          actionLabel: '复制正则模式',
          copyValue: `/${pattern}/${flags}`,
        };
      }
      const match = rx.exec(testText);
      const isMatch = match !== null;
      const matchedStr = isMatch ? match[0] : '';
      const groups = isMatch ? match.slice(1) : [];
      const namedGroups = (isMatch && match.groups) ? match.groups : null;

      let preview = '';
      if (isMatch) {
        preview = `✅ 匹配成功: "${matchedStr}"`;
        if (groups.length > 0) {
          preview += '\n捕获组:\n' + groups.map((g, i) => `  Group ${i + 1}: "${g ?? ''}"`).join('\n');
        }
        if (namedGroups && Object.keys(namedGroups).length > 0) {
          preview += '\n命名组:\n' + Object.entries(namedGroups).map(([k, v]) => `  ${k}: "${v ?? ''}"`).join('\n');
        }
      } else {
        preview = `❌ 未匹配到任何内容\n模式: /${pattern}/${flags}\n目标文本: "${testText}"`;
      }

      return {
        type: 'regex',
        title: isMatch ? `RegExp 匹配成功 (${groups.length} 捕获组)` : 'RegExp 未命中目标文本',
        subtitle: `模式: /${pattern}/${flags} | 目标: "${testText.slice(0, 30)}${testText.length > 30 ? '...' : ''}"`,
        previewValue: preview,
        actionLabel: '复制匹配结果',
        copyValue: isMatch ? matchedStr : preview,
        details: {
          '模式': `/${pattern}/${flags}`,
          '测试文本': testText,
          '判定': isMatch ? '✅ 匹配成功' : '❌ 未命中',
          '捕获组数': String(captureCount),
        },
      };
    } else {
      const preview = `模式: /${pattern}/${flags}\n语法检查: 合法\n捕获组数量: ${captureCount}\n提示: 在正则后输入空格和测试字符串即可原地测试匹配`;
      return {
        type: 'regex',
        title: 'RegExp 正则表达式语法有效',
        subtitle: `模式: /${pattern}/${flags} (${captureCount} 捕获组)`,
        previewValue: preview,
        actionLabel: '复制正则模式',
        copyValue: `/${pattern}/${flags}`,
        details: {
          '模式': `/${pattern}/${flags}`,
          '修饰符': flags || '(无)',
          '语法状态': '合法',
          '捕获组数': String(captureCount),
        },
      };
    }
  } catch (err) {
    if (explicit) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        type: 'regex',
        title: 'RegExp 正则表达式语法错误',
        subtitle: `模式: ${pattern}`,
        previewValue: `语法错误: ${msg}`,
        actionLabel: '复制错误详情',
        copyValue: msg,
        details: {
          '模式': pattern,
          '语法状态': '❌ 语法错误',
        },
      };
    }
    return null;
  }
}
