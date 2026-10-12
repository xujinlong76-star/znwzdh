/**
 * 拼音检索线索生成（写入期）与查询归一化（查询期）。
 *
 * 目标：中文站点可以用全拼、首字母、甚至中英混输命中。
 * 实测 pinyin-pro 输出：启动脚本 -> qidongjiaoben / qdjb
 */
import { pinyin } from "pinyin-pro";

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export interface PinyinTraits {
  /** 全拼，如 qidongjiaoben */
  full: string;
  /** 首字母，如 qdjb */
  initials: string;
}

/** 生成全拼与首字母线索；非中文部分原样保留（便于 "github copilot"） */
export function pinyinTraits(input: string): PinyinTraits {
  const src = (input ?? "").trim();
  if (!src || !HAN.test(src)) {
    const flat = src.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return { full: flat, initials: flat };
  }
  const full = pinyin(src, { toneType: "none", type: "array", nonZh: "consecutive" })
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const initials = pinyin(src, { pattern: "first", toneType: "none", type: "array", nonZh: "consecutive" })
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return { full, initials };
}

/** 查询侧归一化：把 "qdjb" / "启动脚本" 都变成可比较的拼音串 */
export function normalizeQueryPinyin(q: string): PinyinTraits {
  return pinyinTraits(q);
}

/** 是否看起来像拼音/拉丁输入（用于决定是否额外做拼音通道） */
export function looksLikeLatinQuery(q: string): boolean {
  return /^[a-z0-9\s]+$/i.test(q.trim());
}
