/**
 * 邮件投递适配器。
 *
 * 解决「验证码 / 重置链接永远发不出去」的真实痛点：此前通知 outbox 里
 * email 渠道被硬编码为 `Email sender is not configured`，且 `relayNotifications`
 * 只投递 inapp 渠道，email/push 入了队就永远 `deferred`，静默失败。
 *
 * 设计取舍：
 *  - **默认不接真 SMTP**：未配置 `NAVHUB_SMTP_*` 时退化为「日志投递」
 *    （把邮件以脱敏形式打到服务端日志：收件人/主题/正文大意可见，
 *    验证/重置链接与令牌替换为 `[REDACTED]`），保证开发/内网部署开箱即用、
 *    不因缺配置而 500；生产配置 SMTP 后自动切真实投递（发送完整原文）。
 *  - **接口最小**：只暴露 `sendMail` 与 `isConfigured`，调用方不感知 SMTP 细节。
 *  - **失败不抛出到业务事务**：投递失败返回 `{ ok: false, error }`，
 *    由 outbox 的 attempts/退避机制重试，绝不让一封邮件拖垮注册/重置事务。
 */
import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  /** 纯文本正文；HTML 可选 */
  text: string;
  html?: string;
  /** 回复地址 */
  replyTo?: string;
}

export interface MailResult {
  ok: boolean;
  /** 失败原因（固定文案，不含凭据/参数原文） */
  error?: string;
  /** 开发模式下的投递标识，便于日志检索 */
  messageId?: string;
}

export interface MailTransport {
  /** 是否已具备真实投递能力 */
  isConfigured(): boolean;
  /** 人类可读的当前模式，用于 /api/health 与运维面板展示 */
  describe(): string;
  sendMail(message: MailMessage): Promise<MailResult>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string | null;
  pass?: string | null;
  from: string;
  replyTo?: string | null;
}

/** 从环境变量解析 SMTP 配置；缺 host 返回 null（= 未配置） */
export function parseSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = (env.NAVHUB_SMTP_HOST || env.SMTP_HOST || "").trim();
  if (!host) return null;
  const port = Number(env.NAVHUB_SMTP_PORT || env.SMTP_PORT || (env.NAVHUB_SMTP_SECURE === "true" ? "465" : "587"));
  const secure = (env.NAVHUB_SMTP_SECURE ?? env.SMTP_SECURE ?? "false") === "true";
  const from = (env.NAVHUB_SMTP_FROM || env.SMTP_FROM || "").trim();
  if (!from) return null;
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    user: (env.NAVHUB_SMTP_USER || env.SMTP_USER || "").trim() || null,
    pass: env.NAVHUB_SMTP_PASS || env.SMTP_PASS || null,
    from,
    replyTo: (env.NAVHUB_SMTP_REPLY_TO || env.SMTP_REPLY_TO || "").trim() || null,
  };
}

/**
 * 真实 SMTP 投递器。
 *
 * transport 采用懒加载：未配置或首次失败不阻塞启动；
 * 连接池复用单个 transport（nodemailer 内部已做连接复用）。
 */
export class SmtpMailTransport implements MailTransport {
  private readonly config: SmtpConfig;
  private transport: Transporter | null = null;
  private transportError: string | null = null;

  constructor(config: SmtpConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return true;
  }

  describe(): string {
    return `smtp://${this.config.host}:${this.config.port}${this.config.secure ? " (TLS)" : ""}`;
  }

  private async ensureTransport(): Promise<Transporter> {
    if (this.transport) return this.transport;
    const auth = this.config.user
      ? { user: this.config.user, pass: this.config.pass ?? "" }
      : undefined;
    this.transport = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth,
      // 生产邮件可能稍慢，放宽连接超时；但不无限等待
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    this.transportError = null;
    return this.transport;
  }

  async sendMail(message: MailMessage): Promise<MailResult> {
    try {
      const transport = await this.ensureTransport();
      const info = await transport.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo ?? this.config.replyTo ?? undefined,
      });
      this.transportError = null;
      return { ok: true, messageId: info.messageId };
    } catch (err) {
      // 记录具体错误供运维排查；对外只回固定文案
      this.transportError = err instanceof Error ? err.message : String(err);
      return { ok: false, error: "SMTP 投递失败" };
    }
  }
}

/** 日志里绝不能出现的敏感值，一律替换为这个占位符 */
export const REDACTED = "[REDACTED]";

/** 出现在 URL / 参数名里即视为敏感的凭据类字段 */
const SENSITIVE_PARAM = /(?:token|reset|verify|verification|code|auth|password|secret|session|api[-_]?key)/i;

/**
 * 脱敏邮件日志文本。
 *
 * 只用于日志输出，绝不用于真实投递（SmtpMailTransport 始终发送完整原文）。
 * 规则：
 *  - 含敏感参数（token / verify / reset / code 等）的完整 URL（绝对或相对）
 *    整个替换为 [REDACTED]，不留可用链接；
 *  - 残留的 `token=xxx` / `code=xxx` 这类裸参数值同样替换；
 *  - 独立出现的长令牌（≥32 位连续 base64url/十六进制字符，如 generateToken(32)
 *    的 43 位令牌）替换；短验证码（如 6 位数字）不在此列，开发时仍可见。
 * 其余文本（收件人、主题、非敏感正文）原样保留，日志仍能看出发了什么邮件。
 */
export function redactMailLogText(text: string): string {
  let out = text;
  // 1. 绝对 URL：只有含敏感参数或指向验证/重置路径的才整条脱敏，普通链接保留。
  out = out.replace(/https?:\/\/[^\s"'<>]+/g, (url) =>
    SENSITIVE_PARAM.test(url) || /verify-email|reset-password|\/auth\//i.test(url) ? REDACTED : url,
  );
  // 2. 相对 URL：带敏感查询参数的整条脱敏（如 /auth/verify-email?token=...）。
  out = out.replace(
    /(^|[\s"'<(])\/[^\s"'<>]*[?&](?:token|code|auth|key|secret|password|session)=[^\s"'<>&]*/gi,
    (_match, prefix: string) => prefix + REDACTED,
  );
  // 3. 残留的裸敏感参数值（如正文里单独出现的 token=xxx）。
  out = out.replace(
    /((?:token|verification|verify|reset|code|auth|password|secret|session|api[-_]?key)=)[^\s"'<>&]+/gi,
    `$1${REDACTED}`,
  );
  // 4. 独立长令牌（≥32 位连续字符）。
  out = out.replace(/\b[A-Za-z0-9_-]{32,}\b/g, REDACTED);
  return out;
}

/**
 * 日志投递器（开发/内网默认）。
 *
 * 邮件以脱敏形式打到 stdout：收件人、主题和正文大意仍可见，
 * 但验证/重置链接和令牌会被替换为 [REDACTED]，日志泄露也不等于
 * 拿到可用链接。生产环境未配 SMTP 时也会降级到这里，并在 health 里如实上报。
 * 真实投递（SmtpMailTransport）不受影响，始终发送完整原文。
 */
export class LogMailTransport implements MailTransport {
  isConfigured(): boolean {
    return false;
  }

  describe(): string {
    return "log://stdout (未配置 SMTP，邮件仅以脱敏形式打印到服务端日志)";
  }

  async sendMail(message: MailMessage): Promise<MailResult> {
    // 用单行前缀 + JSON，避免多行正文把日志结构打散；正文/主题先脱敏，
    // 令牌链接绝不进日志。真实投递不受影响（见 SmtpMailTransport）。
    const line = [
      "[navhub:mail]",
      "to=" + message.to,
      "subject=" + redactMailLogText(message.subject),
      "text=" + redactMailLogText(message.text),
    ].join(" ");
    console.log(line);
    if (message.html) console.log("[navhub:mail:html]\n" + redactMailLogText(message.html));
    return { ok: true, messageId: "log://" + message.to };
  }
}

/**
 * 按环境变量构造邮件投递器。
 *
 * 返回的 transport 永远可用（最差退化为日志投递），调用方无需判空。
 */
export function createMailTransport(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const smtp = parseSmtpConfig(env);
  return smtp ? new SmtpMailTransport(smtp) : new LogMailTransport();
}
