/**
 * 语义化版本解析与兼容性对比 (Semver Comparator)。
 */
import type { SpeculativeIntentResult } from './types.ts'

interface SemverParsed {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

function parseSemver(v: string): SemverParsed | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    raw: v.trim(),
    major: parseInt(m[1]!, 10),
    minor: parseInt(m[2]!, 10),
    patch: parseInt(m[3]!, 10),
    prerelease: m[4],
    build: m[5],
  };
}

function compareSemver(a: SemverParsed, b: SemverParsed): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  return 0;
}

function satisfiesCaret(range: SemverParsed, target: SemverParsed): boolean {
  if (range.major === 0) {
    if (range.minor === 0) {
      return target.major === 0 && target.minor === 0 && target.patch === range.patch;
    }
    return target.major === 0 && target.minor === range.minor && target.patch >= range.patch;
  }
  return target.major === range.major && (target.minor > range.minor || (target.minor === range.minor && target.patch >= range.patch));
}

function satisfiesTilde(range: SemverParsed, target: SemverParsed): boolean {
  return target.major === range.major && target.minor === range.minor && target.patch >= range.patch;
}

export function tryParseSemver(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const explicit = trimmed.match(/^(?:semver|version|ver):\s*(.+)$/i);
  const content = explicit ? explicit[1]!.trim() : trimmed;

  const vsMatch = content.match(/^([\^~>=<]*\s*v?\d+\.\d+\.\d+(?:-[^\s]+)?)\s+(?:vs|与|对比|to)\s+(v?\d+\.\d+\.\d+(?:-[^\s]+)?)$/i);
  if (vsMatch) {
    const leftRaw = vsMatch[1]!.trim();
    const rightRaw = vsMatch[2]!.trim();
    const targetParsed = parseSemver(rightRaw);
    if (!targetParsed) return null;

    if (leftRaw.startsWith('^')) {
      const baseParsed = parseSemver(leftRaw.slice(1));
      if (!baseParsed) return null;
      const satisfies = satisfiesCaret(baseParsed, targetParsed);
      const preview = `范围: ${leftRaw} (兼容 ${baseParsed.major}.x)\n目标版本: ${rightRaw}\n判定: ${satisfies ? '✅ 满足兼容范围 (Satisfies)' : '❌ 不兼容 (Out of Range)'}`;
      return {
        type: 'semver',
        title: `Semver 范围兼容判定: ${satisfies ? '✅ 满足' : '❌ 不兼容'}`,
        subtitle: `${leftRaw} vs ${rightRaw}`,
        previewValue: preview,
        actionLabel: '复制兼容结果',
        copyValue: satisfies ? 'true' : 'false',
        details: {
          '范围': leftRaw,
          '目标版本': rightRaw,
          '兼容结论': satisfies ? '兼容 (Satisfies)' : '超出范围',
        },
      };
    }

    if (leftRaw.startsWith('~')) {
      const baseParsed = parseSemver(leftRaw.slice(1));
      if (!baseParsed) return null;
      const satisfies = satisfiesTilde(baseParsed, targetParsed);
      const preview = `范围: ${leftRaw} (补丁兼容 ${baseParsed.major}.${baseParsed.minor}.x)\n目标版本: ${rightRaw}\n判定: ${satisfies ? '✅ 满足兼容范围' : '❌ 不兼容'}`;
      return {
        type: 'semver',
        title: `Semver 范围兼容判定: ${satisfies ? '✅ 满足' : '❌ 不兼容'}`,
        subtitle: `${leftRaw} vs ${rightRaw}`,
        previewValue: preview,
        actionLabel: '复制兼容结果',
        copyValue: satisfies ? 'true' : 'false',
        details: {
          '范围': leftRaw,
          '目标版本': rightRaw,
          '兼容结论': satisfies ? '兼容' : '超出范围',
        },
      };
    }

    const baseParsed = parseSemver(leftRaw);
    if (!baseParsed) return null;
    const cmp = compareSemver(baseParsed, targetParsed);
    let bumpKind = '相同版本 (Identical)';
    if (baseParsed.major !== targetParsed.major) bumpKind = '破坏性大版本变更 (Major)';
    else if (baseParsed.minor !== targetParsed.minor) bumpKind = '向后兼容功能增强 (Minor)';
    else if (baseParsed.patch !== targetParsed.patch) bumpKind = '向后兼容缺陷修复 (Patch)';
    else if (baseParsed.prerelease !== targetParsed.prerelease) bumpKind = '预发布标识变更 (Prerelease)';

    const relation = cmp < 0 ? '< (低到高升级)' : cmp > 0 ? '> (版本回退降级)' : '= (完全一致)';
    const preview = `${baseParsed.raw} ${relation} ${targetParsed.raw}\n差异级别: ${bumpKind}`;

    return {
      type: 'semver',
      title: `Semver 版本对比: ${bumpKind}`,
      subtitle: `${baseParsed.raw} 对比 ${targetParsed.raw}`,
      previewValue: preview,
      actionLabel: '复制对比摘要',
      copyValue: `${baseParsed.raw} ${cmp < 0 ? '<' : cmp > 0 ? '>' : '='} ${targetParsed.raw} (${bumpKind})`,
      details: {
        '基准版本': baseParsed.raw,
        '对比版本': targetParsed.raw,
        '对比关系': relation,
        '变更级别': bumpKind,
      },
    };
  }

  // 单版本结构化解析
  const single = parseSemver(content);
  if (!single && !explicit) return null;
  if (!single) return null;

  const preview = `主版本 (Major): ${single.major}\n次版本 (Minor): ${single.minor}\n补丁版本 (Patch): ${single.patch}${single.prerelease ? `\n预发布 (Prerelease): ${single.prerelease}` : ''}${single.build ? `\n构建元数据 (Build): ${single.build}` : ''}`;

  return {
    type: 'semver',
    title: `Semver 语义化版本: v${single.major}.${single.minor}.${single.patch}`,
    subtitle: `版本结构规范: Major=${single.major}, Minor=${single.minor}, Patch=${single.patch}`,
    previewValue: preview,
    actionLabel: '复制标准化版本',
    copyValue: `v${single.major}.${single.minor}.${single.patch}${single.prerelease ? `-${single.prerelease}` : ''}`,
    details: {
      'Major (重大破坏)': String(single.major),
      'Minor (特性增强)': String(single.minor),
      'Patch (补丁修复)': String(single.patch),
      'Prerelease': single.prerelease || '无 (正式发布版)',
    },
  };
}
