/**
 * 小猫猫 AI 助手（POST /api/ai/chat）的纯逻辑层。
 *
 * 与 AI 智能找站（ai-finder.ts）的分工：找站回答「一组卡片」，小猫猫回答「一段话 + 一组卡片」。
 * 两者共用同一份站内混合检索、同一套 LLM 配置/额度层、同一层候选校验——
 * 小猫猫在对话里提到的每个站点同样必须映射回本次检索召回的候选，
 * 模型编造的站外 id 在 validateModelPicks 就被丢掉，绝不透传到前端。
 */
import type { Site } from "@navhub/core";
import { validateModelPicks, type ModelPick } from "./ai-finder.ts";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatModelOutput {
  reply: string;
  picks: ModelPick[];
  dropped: number;
}

/** 小猫猫的人设与行为边界：只做网站导览与找站，推荐只出候选，站外问题礼貌收回话题。 */
export const CHAT_SYSTEM_PROMPT =
  "你是网址导航站的吉祥物助手「小猫猫」，一只粉色、活泼、热心的小猫，说话简短亲切（每句回复控制在 80 字内，最多 3 句），偶尔带一点点猫的语气词，但不要满屏卖萌、不要自称 AI 模型。\n" +
  "你的工作：帮访客找网站、介绍站内分类与「场景包」（首页输入框下方一排成套的找站方案，点一下按步骤给一串配套站点，还能点「换一批」轮换、常用的会自动排前面）。\n" +
  "硬规则：\n" +
  "1. 推荐网站只能从下方给出的候选站点里挑，禁止推荐候选之外的任何网站、禁止编造链接；候选为空或都不对口时，就老实说站内暂时没收录，并建议访客去最接近的分类看看，绝不硬凑。\n" +
  "2. 访客问站外话题（写代码、算题、新闻、闲聊人生等）时，用一句话礼貌带过，然后把话题领回找站，例如「这个我不太在行，不过找网站是我的强项，想找什么尽管说～」。打招呼和闲聊可以简短回应并顺势介绍你能帮他找站。\n" +
  "3. 有候选且对口时，在 picks 里挑 1~6 个最对口的，按相关程度排序，各写一句 25 字内的推荐理由；reply 里用一句话概括你挑了什么，不要在 reply 里写出网址。\n" +
  "严格只返回 JSON，不要 markdown 代码块：{\"reply\":\"回复文本\",\"picks\":[{\"siteId\":\"候选id\",\"reason\":\"一句理由\"}]}。没有可推荐的站点时 picks 返回空数组。";

/** 对话历史消毒：只留合法角色、截断长度、只取最近若干轮，防止把上下文撑爆或夹带注入。 */
export function sanitizeHistory(raw: unknown, maxTurns = 6, maxChars = 500): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const text = content.replace(/\s+/g, " ").trim().slice(0, maxChars);
    if (text) turns.push({ role, content: text });
  }
  return turns.slice(-maxTurns);
}

/**
 * 解析模型输出：容忍 markdown 代码块与前后杂字，抠出 JSON 对象；
 * reply 截断到一句完整回复的长度，picks 走与找站同一套候选校验（编造即丢弃）。
 * 解析不出来返回 null，由调用方走本地兜底，绝不把原始输出透传给访客。
 */
export function parseChatModelOutput(
  rawContent: string,
  candidates: readonly Site[],
  maxReplyChars = 400,
): ChatModelOutput | null {
  if (!rawContent) return null;
  const cleaned = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { parsed = null; }
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const replyRaw = (parsed as { reply?: unknown }).reply;
  if (typeof replyRaw !== "string") return null;
  const reply = replyRaw.replace(/\s+/g, " ").trim().slice(0, maxReplyChars);
  if (!reply) return null;
  const { picks, dropped } = validateModelPicks(
    parsed,
    candidates.map((s) => ({ siteId: s.id, title: s.title, url: s.url, description: s.description ?? null })),
  );
  return { reply, picks: picks.slice(0, 6), dropped };
}

const GREETING_RE = /^(你好|您好|哈喽|hi|hello|hey|在吗|早上好|中午好|下午好|晚上好|小猫猫|小猫)[呀啊呢吧！!。.\s]*$/i;
const THANKS_RE = /(谢谢|感谢|辛苦了)/;
const BYE_RE = /(再见|拜拜|下了|88)/;

/**
 * 本地兜底话术（无密钥 / 额度用完 / 模型出错时用）：确定性规则，不调模型。
 * - 纯打招呼/道谢/告别：只回话，不塞卡片（检索对这类句子只会召回噪声）；
 * - 有候选：说明这是站内检索直配的结果并附卡片（卡片由路由层按 picks 组装）；
 * - 无候选：如实说没找到并请他换个说法或去分类看看。
 */
export function localChatReply(
  message: string,
  opts: { candidateCount: number; retrievalFailed: boolean },
): { reply: string; attachCards: boolean } {
  const msg = message.trim();
  if (GREETING_RE.test(msg)) {
    return {
      reply: "你好呀，我是小猫猫！想找什么网站直接跟我说，比如「想看免费短剧」「要做 PPT 的工具」，我帮你从站里挑好的。",
      attachCards: false,
    };
  }
  if (THANKS_RE.test(msg)) {
    return { reply: "不客气～能帮上忙我最开心啦。还想找什么，随时喊我。", attachCards: false };
  }
  if (BYE_RE.test(msg)) {
    return { reply: "拜拜～下次想找网站记得来喊我，我一直都在。", attachCards: false };
  }
  if (opts.retrievalFailed) {
    return {
      reply: "站内检索这会儿有点忙，我没能帮你翻目录。你可以先从下面的分类入口找找，或者等会儿再问我一次。",
      attachCards: false,
    };
  }
  if (opts.candidateCount > 0) {
    return {
      reply: "我先按站内收录帮你翻到了这几个，点开就能用。想找得更准，可以再告诉我多一点细节。",
      attachCards: true,
    };
  }
  return {
    reply: "站内暂时还没有收录完全对得上的站点，我先给你最接近的分类入口。也可以换个说法再问我，比如把想做的事情说具体一点。",
    attachCards: false,
  };
}
