'use client'

import { useCallback, useEffect, useRef, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Card, CardContent, CardHeader, CardTitle } from "@/registry/new-york/ui/card"
import { Input } from "@/registry/new-york/ui/input"
import { Button } from "@/registry/new-york/ui/button"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/registry/new-york/ui/tabs"
import { Icons } from "@/components/icons"
import { Textarea } from "@/registry/new-york/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/registry/new-york/ui/select"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/registry/new-york/ui/form"
import { loadSiteSettings, saveSiteSettings, uploadSiteAsset, SiteSettingsError, type AssetKind } from "@/services/siteConfigService"
import type { SiteSettings, SiteSettingsPatch } from "@/lib/site-settings"

/**
 * 站点设置中心。
 *
 * 与旧版的三点关键差别（都是实测缺陷的直接回应）：
 * 1. **降级不保存**：中枢不可达时读到的是构建期基线，旧版把它当真实配置渲染，
 *    一次保存就覆盖真实配置。现在降级会显式横幅 + 禁用保存。
 * 2. **按 tab 校验**：旧版三个 tab 共用一份全量 schema，外观字段为空时
 *    「保存导航设置」静默失败，错误信息渲染在看不见的 tab 里，按钮看着是死的。
 *    现在只校验并提交当前 tab 的字段，服务端负责深合并。
 * 3. **Select 受控**：旧版用 `defaultValue`（Radix 非受控），`form.reset()` 到货后
 *    下拉框仍显示初始值，管理员看到的是「设置没生效」的假象。现在改用 `value`。
 */

const ASSET_RE = /^(https?:\/\/\S+|\/\S*)$/i

/** 空串在 UI 里合法（表示「清空，用默认」），落库时折叠成 null */
const assetInput = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || ASSET_RE.test(v), { message: "必须是 http(s) 地址或站内相对路径" })

const uiSchema = z.object({
  basic: z.object({
    title: z.string().trim().min(2, "标题至少需要 2 个字符").max(120, "标题最长 120 字符"),
    description: z.string().trim().min(10, "描述至少需要 10 个字符").max(500, "描述最长 500 字符"),
    keywords: z.string().trim().max(300, "关键词最长 300 字符"),
    ogImage: assetInput,
  }),
  appearance: z.object({
    logo: assetInput,
    favicon: assetInput,
    theme: z.enum(["light", "dark", "system"]),
    themeColor: z
      .string()
      .trim()
      .refine((v) => v === "" || /^#[0-9a-fA-F]{6}$/.test(v), { message: "必须是 #RRGGBB 形式的十六进制色值" }),
  }),
  navigation: z.object({
    linkTarget: z.enum(["_blank", "_self"]),
  }),
  footer: z.object({
    text: z.string().trim().max(200, "页脚文案最长 200 字符"),
    icp: z
      .string()
      .trim()
      .max(60, "备案号最长 60 字符")
      .refine((v) => v === "" || /^[\d\u4e00-\u9fa5a-zA-Z\-/（）() ]+$/.test(v), {
        message: "备案号只允许汉字、数字、字母与 -/() 分隔符",
      }),
  }),
})

type UiValues = z.infer<typeof uiSchema>

const EMPTY: UiValues = {
  basic: { title: "", description: "", keywords: "", ogImage: "" },
  appearance: { logo: "", favicon: "", theme: "system", themeColor: "" },
  navigation: { linkTarget: "_blank" },
  footer: { text: "", icp: "" },
}

/** 每个 tab 的字段路径，用于「只校验本 tab」与「只提交本 tab」 */
const TAB_FIELDS: Record<string, Array<keyof UiValues>> = {
  basic: ["basic"],
  appearance: ["appearance"],
  share: ["basic"],
  navigation: ["navigation"],
  footer: ["footer"],
}

/** tab → 该 tab 实际要提交的字段（share 只提交 ogImage，不碰同段的 title/description） */
const TAB_PATCH_FIELDS: Record<string, Record<string, string[]>> = {
  basic: { basic: ["title", "description", "keywords"] },
  appearance: { appearance: ["logo", "favicon", "theme", "themeColor"] },
  share: { basic: ["ogImage"] },
  navigation: { navigation: ["linkTarget"] },
  footer: { footer: ["text", "icp"] },
}

function toFormValues(s: SiteSettings): UiValues {
  return {
    basic: {
      title: s.basic.title ?? "",
      description: s.basic.description ?? "",
      keywords: s.basic.keywords ?? "",
      ogImage: (s.basic as { ogImage?: string }).ogImage ?? "",
    },
    appearance: {
      logo: s.appearance.logo ?? "",
      favicon: s.appearance.favicon ?? "",
      theme: s.appearance.theme,
      themeColor: s.appearance.themeColor ?? "",
    },
    navigation: { linkTarget: s.navigation.linkTarget },
    footer: { text: s.footer?.text ?? "", icp: s.footer?.icp ?? "" },
  }
}

export default function SiteSettings() {
  const { toast } = useToast()
  const [loaded, setLoaded] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState("basic")
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const form = useForm<UiValues>({
    resolver: zodResolver(uiSchema),
    defaultValues: EMPTY,
  })

  const load = useCallback(
    async () => {
      setLoadError(null)
      try {
        const { settings, degraded: dg, missing: ms } = await loadSiteSettings()
        form.reset(toFormValues(settings))
        setDegraded(dg)
        setMissing(ms)
        setLoaded(true)
      } catch (err: unknown) {
        setLoadError(err instanceof Error ? err.message : "加载站点配置出错")
        setLoaded(false)
      }
    },
    [form],
  )

  useEffect(() => {
    void load()
  }, [load])

  const buildPatch = (name: string): SiteSettingsPatch => {
    const values = form.getValues()
    const spec = TAB_PATCH_FIELDS[name] ?? {}
    const patch: SiteSettingsPatch = {}
    for (const [section, keys] of Object.entries(spec)) {
      const src = (values as Record<string, Record<string, unknown>>)[section] ?? {}
      const out: Record<string, string | null> = {}
      for (const key of keys) {
        const raw = src[key]
        const value = typeof raw === "string" ? raw.trim() : raw
        // 空值 = 显式清空（服务端 merge 会把它删掉，让消费方回退到内置默认）
        out[key] = value === "" || value === null ? null : String(value)
      }
      ;(patch as Record<string, unknown>)[section] = out
    }
    return patch
  }

  const submitTab = async (name: string) => {
    setBanner(null)
    const fields = TAB_FIELDS[name] ?? []
    const ok = await form.trigger(fields as never, { shouldFocus: false })
    if (!ok) {
      const count = fields.reduce(
        (n, section) => n + Object.keys(form.formState.errors?.[section] ?? {}).length,
        0,
      )
      setBanner(`这个分组里有 ${count} 项没通过校验，红字标注在对应输入框下方；本次未提交任何修改。`)
      return
    }
    setSaving(true)
    try {
      const { settings } = await saveSiteSettings(buildPatch(name))
      form.reset(toFormValues(settings))
      setDegraded(false)
      setMissing(false)
      toast({ title: "已保存", description: "站点设置已写入中枢" })
    } catch (err: unknown) {
      if (err instanceof SiteSettingsError && err.issues.length) {
        for (const issue of err.issues) {
          const [section, key] = issue.path.split(".")
          form.setError(`${section}.${key}` as never, { message: issue.message })
        }
        setBanner("服务端拒绝了这些字段：" + err.issues.map((i) => i.message).join("；"))
      } else {
        setBanner(err instanceof Error ? err.message : "保存失败")
      }
    } finally {
      setSaving(false)
    }
  }

  const onPickFile = async (kind: AssetKind, field: { value: string; onChange: (v: string) => void }) => {
    const input = fileRefs.current[kind]
    const file = input?.files?.[0]
    if (!file) return
    setUploading(kind)
    setBanner(null)
    try {
      const { url } = await uploadSiteAsset(kind, file)
      field.onChange(url)
      toast({ title: "已上传", description: `${file.name} → ${url}` })
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : "上传失败")
    } finally {
      setUploading(null)
      if (input) input.value = ""
    }
  }

  const saveDisabled = !loaded || degraded || saving

  /**
   * 刻意写成普通函数而不是组件：组件定义在渲染函数内部，每次重渲染都是新的
   * 组件类型，React 会整棵子树卸载重挂 —— 输入框刚敲一个字符就丢焦点。
   */
  const saveButton = (name: string) => (
    <div className="flex items-center gap-3">
      <Button type="button" className="w-[120px]" disabled={saveDisabled} onClick={() => void submitTab(name)}>
        {saving ? (
          <>
            <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            保存中
          </>
        ) : (
          <>
            <Icons.save className="mr-2 h-4 w-4" />
            保存更改
          </>
        )}
      </Button>
      {degraded && (
        <span className="text-xs text-amber-500">中枢不可达（当前是构建期基线），已禁止保存</span>
      )}
    </div>
  )

  /** logo / favicon / ogImage 三处同构：URL 输入 + 位图上传 + 预览。同 saveButton，不能用组件形式。 */
  const assetField = ({
    section,
    field,
    kind,
    label,
    hint,
  }: {
    section: "basic" | "appearance"
    field: string
    kind: AssetKind
    label: string
    hint: string
  }) => (
    <FormField
      control={form.control}
      name={`${section}.${field}` as never}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex flex-wrap items-center gap-2">
            <FormControl>
              <Input placeholder="输入图片 URL 或点右侧上传" className="min-w-[240px] flex-1" {...f} />
            </FormControl>
            <input
              ref={(el) => {
                fileRefs.current[kind] = el
              }}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/x-icon"
              className="hidden"
              onChange={() => void onPickFile(kind, f)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading !== null || saveDisabled}
              onClick={() => fileRefs.current[kind]?.click()}
            >
              {uploading === kind ? <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
              上传
            </Button>
          </div>
          {f.value && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-2">
              {/* 预览失败（URL 写错、图被删）不该把表单卡住，所以只是 img，不做 onError 校验 */}
              <img src={f.value} alt="" className="h-10 w-10 rounded bg-background object-contain" />
              <span className="break-all text-xs text-muted-foreground">{f.value}</span>
            </div>
          )}
          <FormDescription>{hint}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  if (!loaded) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>站点设置中心</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {loadError ? "读取站点配置失败：" + loadError : "正在读取站点配置…"}
            </p>
            {/* 没读到配置就绝不渲染表单：渲染出来的空值与「站点真的没配」无法区分，
                管理员保存后就是拿空值覆盖真实配置。 */}
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {loadError ? "重试" : "继续等待 / 重试"}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {degraded && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            中枢当前不可达，下方显示的是**构建期基线值**。为避免覆盖真实配置，保存已禁用——
            恢复中枢后点右上角「重新读取」。
          </div>
        )}
        {!degraded && missing && (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            中枢可达，但还没有站点配置记录：下方是空表单，<strong>保存即创建</strong>。
            没填写的字段继续使用内置默认值（品牌名「山羊胡」、图标 /icons/icon-192.png）。
          </div>
        )}
        {banner && (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {banner}
          </div>
        )}

        <div className="space-y-1.5">
          {/* CardTitle 渲染的是 <div>，本页此前整页没有 h1（后台审计 P2-2） */}
          <h1 className="text-xl font-bold">站点设置中心</h1>
          <p className="text-sm text-muted-foreground">
            全站品牌、外观、分享卡与页脚备案的唯一来源。每个分组独立校验、独立保存，互不影响。
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => { setTab(v); setBanner(null) }} className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            <TabsTrigger value="appearance">外观设置</TabsTrigger>
            <TabsTrigger value="share">分享图</TabsTrigger>
            <TabsTrigger value="navigation">导航设置</TabsTrigger>
            <TabsTrigger value="footer">页脚与备案</TabsTrigger>
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>
              重新读取
            </Button>
          </TabsList>

          <TabsContent value="basic">
            <Card>
              <CardHeader><CardTitle>基本信息</CardTitle></CardHeader>
              <CardContent>
                <Form {...form}>
                  <div className="space-y-8">
                    <FormField
                      control={form.control}
                      name="basic.title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>网站标题</FormLabel>
                          <FormControl><Input placeholder="输入网站标题" {...field} /></FormControl>
                          <FormDescription>浏览器标签页、搜索结果与全站 &lt;title&gt; 后缀的唯一品牌名来源</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="basic.description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>网站描述</FormLabel>
                          <FormControl><Textarea placeholder="输入网站描述" className="resize-none" {...field} /></FormControl>
                          <FormDescription>用于搜索结果摘要、RSS 订阅源与分享卡默认文案</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="basic.keywords"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>关键词</FormLabel>
                          <FormControl><Input placeholder="输入关键词，用英文逗号分隔" {...field} /></FormControl>
                          <FormDescription>多个关键词请用英文逗号分隔</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {saveButton("basic")}
                  </div>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance">
            <Card>
              <CardHeader><CardTitle>外观设置</CardTitle></CardHeader>
              <CardContent>
                <Form {...form}>
                  <div className="space-y-8">
                    {assetField({
                      section: "appearance",
                      field: "logo",
                      kind: "logo",
                      label: "Logo",
                      hint: "前台侧边栏使用；建议 160×64。留空则回退内置图标",
                    })}
                    {assetField({
                      section: "appearance",
                      field: "favicon",
                      kind: "favicon",
                      label: "Favicon",
                      hint: "浏览器标签页与站点图标；建议 32×32。留空回退 /icons/icon-192.png",
                    })}
                    <FormField
                      control={form.control}
                      name="appearance.theme"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>默认主题</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="选择默认主题" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="system">跟随系统</SelectItem>
                              <SelectItem value="light">始终浅色</SelectItem>
                              <SelectItem value="dark">始终深色</SelectItem>
                            </SelectContent>
                          </Select>
                          {/* 以前这个字段能存但没人读，改这里要说清楚生效范围 */}
                          <FormDescription>
                            访客首次访问（或本机没存过主题偏好）时的默认外观；访客手动切换后以其个人偏好为准。
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="appearance.themeColor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>品牌色</FormLabel>
                          <div className="flex items-center gap-2">
                            <FormControl>
                              <Input type="color" className="h-10 w-14 p-1" value={field.value || "#378add"} onChange={(e) => field.onChange(e.target.value)} />
                            </FormControl>
                            <Input placeholder="#378ADD" className="w-32" {...field} />
                          </div>
                          <FormDescription>写入 PWA 安装清单的 theme_color（手机/桌面「添加到主屏幕」的状态栏色）</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {saveButton("appearance")}
                  </div>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="share">
            <Card>
              <CardHeader><CardTitle>分享图（OG / Twitter 卡片）</CardTitle></CardHeader>
              <CardContent>
                <Form {...form}>
                  <div className="space-y-8">
                    {assetField({
                      section: "basic",
                      field: "ogImage",
                      kind: "ogImage",
                      label: "默认分享大图",
                      hint: "建议 1200×630。社交平台 / 群聊未命中动态分享图时用它；留空回退 /og-default.png",
                    })}
                    <p className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                      分享卡的 <code>og:url</code> 与 canonical 不在这里改：它由环境变量{" "}
                      <code>NAVHUB_SITE_URL</code> 决定（见 lib/seo/origin.ts）。原因是构建期必须拿到确定的域名，
                      而请求头可被伪造、数据库读取在构建期不可靠——把域名做成后台字段会让整站 canonical
                      随一次取数抖动漂移。留空时分享卡不带图，这是刻意取舍。
                    </p>
                    {saveButton("share")}
                  </div>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="navigation">
            <Card>
              <CardHeader><CardTitle>导航设置</CardTitle></CardHeader>
              <CardContent>
                <Form {...form}>
                  <div className="space-y-8">
                    <FormField
                      control={form.control}
                      name="navigation.linkTarget"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>链接打开方式</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="选择链接打开方式" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="_blank">新窗口打开 (_blank)</SelectItem>
                              <SelectItem value="_self">当前窗口打开 (_self)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            站点默认值：卡片、搜索、搜索面板与 spotlight 都跟随它。访客在偏好里手动设过则以个人偏好为准。
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {saveButton("navigation")}
                  </div>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="footer">
            <Card>
              <CardHeader><CardTitle>页脚与备案</CardTitle></CardHeader>
              <CardContent>
                <Form {...form}>
                  <div className="space-y-8">
                    <FormField
                      control={form.control}
                      name="footer.text"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>页脚文案</FormLabel>
                          <FormControl><Textarea placeholder="例如：数据来源与版权声明、联系邮箱" className="resize-none" {...field} /></FormControl>
                          <FormDescription>纯文本渲染（不解析 HTML），出现在页脚版权行下方</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="footer.icp"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>备案号</FormLabel>
                          <FormControl><Input placeholder="例如：京ICP备 2026000000号-1" {...field} /></FormControl>
                          <FormDescription>
                            渲染时自动链接到工信部备案查询页；只允许汉字/数字/字母与 -/() 分隔符，防止把这里变成外链注入点
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {saveButton("footer")}
                  </div>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
