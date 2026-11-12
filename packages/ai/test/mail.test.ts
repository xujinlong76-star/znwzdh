/**
 * 邮件投递适配器覆盖：parseSmtpConfig 全分支、日志投递器、SMTP 投递器（mock nodemailer）。
 *
 * mail.ts 此前没有任何测试引用（0% 覆盖）：验证码/重置邮件的投递路径
 * 完全没有回归保护，改动 SMTP 默认端口或日志格式都不会变红。
 */
import { describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  afterAll } from "vitest";

const { mockCreateTransport, mockSendMail } = vi.hoisted(() => ({
  mockCreateTransport: vi.fn(),
  mockSendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
  createTransport: mockCreateTransport,
}));

// isolate:false 卫生（D2）：上面的 nodemailer mock 实例会驻留 worker 的模块缓存，
// 不清理会把同 worker 后续文件里该模块的加载全部带偏。
afterAll(() => {
  vi.resetModules();
});

import {
  createMailTransport,
  LogMailTransport,
  parseSmtpConfig,
  redactMailLogText,
  SmtpMailTransport,
  type SmtpConfig,
} from "../src/mail.ts";

const BASE: SmtpConfig = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "user@example.com",
  pass: "secret",
  from: "noreply@example.com",
  replyTo: "support@example.com",
};

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("parseSmtpConfig", () => {
  it("无 host 返回 null（未配置）", () => {
    expect(parseSmtpConfig({})).toBeNull();
    expect(parseSmtpConfig({ NAVHUB_SMTP_HOST: "   " })).toBeNull();
    expect(parseSmtpConfig({ SMTP_HOST: "" })).toBeNull();
  });

  it("有 host 但无 from 返回 null", () => {
    expect(parseSmtpConfig({ NAVHUB_SMTP_HOST: "smtp.example.com" })).toBeNull();
    expect(parseSmtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_FROM: "  " })).toBeNull();
  });

  it("NAVHUB_ 前缀优先解析完整配置", () => {
    expect(
      parseSmtpConfig({
        NAVHUB_SMTP_HOST: "  smtp.example.com ",
        NAVHUB_SMTP_PORT: "465",
        NAVHUB_SMTP_SECURE: "true",
        NAVHUB_SMTP_USER: " u@example.com ",
        NAVHUB_SMTP_PASS: "pw",
        NAVHUB_SMTP_FROM: " noreply@example.com ",
        NAVHUB_SMTP_REPLY_TO: " help@example.com ",
      }),
    ).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "u@example.com",
      pass: "pw",
      from: "noreply@example.com",
      replyTo: "help@example.com",
    });
  });

  it("回退到 SMTP_ 前缀", () => {
    const cfg = parseSmtpConfig({
      SMTP_HOST: "mail.example.org",
      SMTP_PORT: "2525",
      SMTP_FROM: "a@example.org",
    });
    expect(cfg).toMatchObject({ host: "mail.example.org", port: 2525, from: "a@example.org" });
  });

  it("默认端口：secure 为 true 时 465，否则 587", () => {
    expect(parseSmtpConfig({ NAVHUB_SMTP_HOST: "h", NAVHUB_SMTP_FROM: "f", NAVHUB_SMTP_SECURE: "true" })?.port).toBe(465);
    expect(parseSmtpConfig({ NAVHUB_SMTP_HOST: "h", NAVHUB_SMTP_FROM: "f" })?.port).toBe(587);
    expect(parseSmtpConfig({ NAVHUB_SMTP_HOST: "h", NAVHUB_SMTP_FROM: "f", NAVHUB_SMTP_SECURE: "false" })?.port).toBe(587);
  });

  it("非法端口回退 587（非数字/0/负数）", () => {
    for (const port of ["abc", "0", "-25"]) {
      expect(parseSmtpConfig({ NAVHUB_SMTP_HOST: "h", NAVHUB_SMTP_FROM: "f", NAVHUB_SMTP_PORT: port })?.port).toBe(587);
    }
  });

  it("secure 只认字面量 true；缺失 user/pass/replyTo 时归一化为 null", () => {
    const cfg = parseSmtpConfig({
      NAVHUB_SMTP_HOST: "h",
      NAVHUB_SMTP_FROM: "f",
      NAVHUB_SMTP_SECURE: "yes",
      NAVHUB_SMTP_USER: "  ",
    });
    expect(cfg).toMatchObject({ secure: false, user: null, pass: null, replyTo: null });
  });
});

describe("LogMailTransport（未配置 SMTP 的降级路径）", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("isConfigured 为 false，describe 标明日志模式", () => {
    const t = new LogMailTransport();
    expect(t.isConfigured()).toBe(false);
    expect(t.describe()).toContain("log://stdout");
  });

  it("sendMail 打印单行日志并返回 log:// messageId", async () => {
    const t = new LogMailTransport();
    const res = await t.sendMail({ to: "a@b.com", subject: "验证码", text: "123456" });
    expect(res).toEqual({ ok: true, messageId: "log://a@b.com" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[navhub:mail]"));
    expect(logSpy.mock.calls[0]![0]).toContain("to=a@b.com");
    expect(logSpy.mock.calls[0]![0]).toContain("subject=验证码");
    expect(logSpy.mock.calls[0]![0]).toContain("text=123456");
  });

  it("带 html 时额外打印 html 行", async () => {
    const t = new LogMailTransport();
    await t.sendMail({ to: "a@b.com", subject: "s", text: "t", html: "<b>hi</b>" });
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls[1]![0]).toContain("<b>hi</b>");
  });

  it("验证链接在日志里被脱敏：令牌和可用链接都不进日志", async () => {
    const t = new LogMailTransport();
    const token = "Ab3xK9mQ2vZ8rT5wY7uJ4hN6sD1fG0pL3aB9cE7dF2gH5";
    const link = `https://example.com/auth/verify-email?token=${token}`;
    await t.sendMail({
      to: "a@b.com",
      subject: "【山羊胡】请验证你的邮箱",
      text: `欢迎注册山羊胡。请点击下面的链接完成邮箱验证：\n${link}`,
    });
    const logged = logSpy.mock.calls[0]![0] as string;
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("verify-email?token=");
    expect(logged).toContain("to=a@b.com");
    expect(logged).toContain("欢迎注册山羊胡");
  });

  it("html 里的重置链接同样脱敏", async () => {
    const t = new LogMailTransport();
    const token = "Zk8mQ2vR5tY7uJ4hN6sD1fG0pL3aB9cE7dF2gH5jK8mN";
    const link = `https://example.com/auth/reset-password?token=${token}`;
    await t.sendMail({
      to: "a@b.com",
      subject: "【山羊胡】重置你的账号密码",
      text: "请点击下面的链接设置新密码",
      html: `<p><a href="${link}">${link}</a></p>`,
    });
    const htmlLogged = logSpy.mock.calls[1]![0] as string;
    expect(htmlLogged).toContain("[REDACTED]");
    expect(htmlLogged).not.toContain(token);
    expect(htmlLogged).not.toContain("reset-password?token=");
  });

  it("不含敏感参数的普通链接保留原样", async () => {
    const t = new LogMailTransport();
    await t.sendMail({
      to: "a@b.com",
      subject: "s",
      text: "看看这个站点 https://example.com/sites/123",
    });
    expect(logSpy.mock.calls[0]![0]).toContain("https://example.com/sites/123");
    expect(logSpy.mock.calls[0]![0]).not.toContain("[REDACTED]");
  });
});

describe("redactMailLogText（日志脱敏规则）", () => {
  it("相对路径的验证链接整条脱敏", () => {
    expect(redactMailLogText("/auth/verify-email?token=abcdef123456")).toBe("[REDACTED]");
  });

  it("残留的裸 token=/code= 参数值脱敏", () => {
    expect(redactMailLogText("token=abc123XYZ")).toBe("token=[REDACTED]");
    expect(redactMailLogText("请用 code=123456 验证")).toBe("请用 code=[REDACTED] 验证");
  });

  it("独立长令牌脱敏，短验证码保留", () => {
    const longToken = "a".repeat(43);
    expect(redactMailLogText(`令牌 ${longToken} 已发出`)).toBe("令牌 [REDACTED] 已发出");
    expect(redactMailLogText("你的验证码是 123456")).toBe("你的验证码是 123456");
    expect(redactMailLogText("64 位哈希 " + "f".repeat(64))).toBe("64 位哈希 [REDACTED]");
  });

  it("不含敏感参数的普通 URL 和正文原样保留", () => {
    expect(redactMailLogText("见 https://example.com/sites/123 的介绍")).toBe(
      "见 https://example.com/sites/123 的介绍",
    );
  });
});

describe("SmtpMailTransport（mock nodemailer）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    mockSendMail.mockResolvedValue({ messageId: "<msg-1@example.com>" });
  });

  it("isConfigured 为 true，describe 含 host:port 与 TLS 标记", () => {
    expect(new SmtpMailTransport(BASE).isConfigured()).toBe(true);
    expect(new SmtpMailTransport(BASE).describe()).toBe("smtp://smtp.example.com:587");
    expect(new SmtpMailTransport({ ...BASE, secure: true, port: 465 }).describe()).toBe(
      "smtp://smtp.example.com:465 (TLS)",
    );
  });

  it("成功投递：透传 from/to/subject/text/html，replyTo 优先用消息里的", async () => {
    const t = new SmtpMailTransport(BASE);
    const res = await t.sendMail({
      to: "a@b.com",
      subject: "重置链接",
      text: "点这里",
      html: "<a>点这里</a>",
      replyTo: "me@example.com",
    });
    expect(res).toEqual({ ok: true, messageId: "<msg-1@example.com>" });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "a@b.com",
      subject: "重置链接",
      text: "点这里",
      html: "<a>点这里</a>",
      replyTo: "me@example.com",
    });
  });

  it("真实投递不受日志脱敏影响：发送完整原文（含令牌链接）", async () => {
    const t = new SmtpMailTransport(BASE);
    const token = "Ab3xK9mQ2vZ8rT5wY7uJ4hN6sD1fG0pL3aB9cE7dF2gH5";
    const link = `https://example.com/auth/verify-email?token=${token}`;
    await t.sendMail({ to: "a@b.com", subject: "【山羊胡】请验证你的邮箱", text: `请点击：\n${link}` });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining(link) }),
    );
  });

  it("消息无 replyTo 时回退到配置 replyTo；配置也没有时为 undefined", async () => {
    const t = new SmtpMailTransport(BASE);
    await t.sendMail({ to: "a@b.com", subject: "s", text: "t" });
    expect(mockSendMail.mock.calls[0]![0]).toMatchObject({ replyTo: "support@example.com" });

    const t2 = new SmtpMailTransport({ ...BASE, replyTo: null });
    await t2.sendMail({ to: "a@b.com", subject: "s", text: "t" });
    expect(mockSendMail.mock.calls[1]![0]).toMatchObject({ replyTo: undefined });
  });

  it("transport 只创建一次（连接复用），auth 按有无 user 分支", async () => {
    const t = new SmtpMailTransport(BASE);
    await t.sendMail({ to: "a@b.com", subject: "s", text: "t" });
    await t.sendMail({ to: "c@d.com", subject: "s2", text: "t2" });
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "user@example.com", pass: "secret" },
      }),
    );

    const noAuth = new SmtpMailTransport({ ...BASE, user: null, pass: null });
    await noAuth.sendMail({ to: "a@b.com", subject: "s", text: "t" });
    expect(mockCreateTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it("无 user 但有 pass 时也不带 auth（pass 为空串时同样）", async () => {
    const t = new SmtpMailTransport({ ...BASE, user: null, pass: "pw" });
    await t.sendMail({ to: "a@b.com", subject: "s", text: "t" });
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it("投递失败返回固定文案、不抛错", async () => {
    mockSendMail.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const t = new SmtpMailTransport(BASE);
    await expect(t.sendMail({ to: "a@b.com", subject: "s", text: "t" })).resolves.toEqual({
      ok: false,
      error: "SMTP 投递失败",
    });
  });

  it("非 Error 异常同样收敛为固定文案", async () => {
    mockSendMail.mockRejectedValueOnce("boom");
    const t = new SmtpMailTransport(BASE);
    await expect(t.sendMail({ to: "a@b.com", subject: "s", text: "t" })).resolves.toEqual({
      ok: false,
      error: "SMTP 投递失败",
    });
  });
});

describe("createMailTransport", () => {
  it("未配置时返回日志投递器", () => {
    const t = createMailTransport({});
    expect(t.isConfigured()).toBe(false);
    expect(t).toBeInstanceOf(LogMailTransport);
  });

  it("配置完整时返回 SMTP 投递器", () => {
    const t = createMailTransport({
      NAVHUB_SMTP_HOST: "smtp.example.com",
      NAVHUB_SMTP_FROM: "noreply@example.com",
    });
    expect(t.isConfigured()).toBe(true);
    expect(t).toBeInstanceOf(SmtpMailTransport);
  });
});
