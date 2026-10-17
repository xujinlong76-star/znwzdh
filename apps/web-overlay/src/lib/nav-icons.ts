/**
 * 侧边栏分类图标的**名字 → 组件**映射。
 *
 * 起因是一个真实的体积问题：`components/sidebar.tsx` 用了
 *
 *     import * as LucideIcons from 'lucide-react'
 *     const Icon = LucideIcons[iconName] || LucideIcons.Folder
 *
 * 命名空间导入让打包器**无法 tree-shaking** —— `/videos` 的路由包里因此多出
 * 两个整包 lucide 的 chunk（实测 487 kB 图标路径数据 + 137 kB 全量索引，
 * First Load JS 349 kB，而同规模的 `/hot` 只有 205 kB）。而且数据里的名字是
 * `code` / `sparkles` 这种小写写法，与 lucide 的 PascalCase 导出对不上，
 * 会一路落到 `Folder` 兜底 —— 也就是说这份体积换来的图标**根本没显示出来**。
 *
 * 这里改成静态映射：真实用到的名字都在 `NAV_ICONS` 里，可被 tree-shaking；
 * 万一后台数据里出现了表外名字（图标字段是自由文本），由
 * `components/nav-icon.tsx` 按需拉取整包兜底，行为不变但不再进首屏。
 *
 * 名字比较大小写无关：数据里同时出现过 `Code` 与 `code`。
 */
import {
  Book,
  BookOpen,
  Box,
  Brain,
  Briefcase,
  Building,
  Calendar,
  Clock,
  Cloud,
  Code,
  Coffee,
  Compass,
  Cpu,
  Database,
  Download,
  Edit,
  Eye,
  FileText,
  Files,
  Film,
  Flame,
  Folder,
  Gamepad2,
  Globe,
  Heart,
  Home,
  Image,
  Laptop,
  Layers,
  Link,
  List,
  Lock,
  Mail,
  MapPin,
  Music,
  Palette,
  Rocket,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  Terminal,
  ThumbsUp,
  Trophy,
  User,
  Users,
  Video,
  Wand2,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** 名字对不上时的兜底图标（与旧实现的 `LucideIcons.Folder` 一致） */
export const NAV_ICON_FALLBACK: LucideIcon = Folder

/** 键一律小写；查找时把名字也转小写，于是 `Code` 与 `code` 都能命中 */
export const NAV_ICONS: Record<string, LucideIcon> = {
  // —— 真实数据里出现过的（apps/web/src/navsphere/content/navigation.json）——
  star: Star,
  coffee: Coffee,
  brain: Brain,
  box: Box,
  building: Building,
  video: Video,
  laptop: Laptop,
  code: Code,
  book: Book,
  edit: Edit,
  bookopen: BookOpen,
  files: Files,
  database: Database,
  filetext: FileText,
  folder: Folder,
  // 历史遗留的名字（iconfont 时代）：语义就是「点赞」，直译成 ThumbsUp，
  // 比默默显示一个文件夹更接近数据本意。
  'linecons-thumbs-up': ThumbsUp,
  // —— 后台 seed（apps/api/src/seed-data.json）里的小写写法 ——
  sparkles: Sparkles,
  palette: Palette,
  // —— 常见分类语义，避免为一点小事就走懒加载 ——
  globe: Globe,
  rocket: Rocket,
  wrench: Wrench,
  zap: Zap,
  heart: Heart,
  image: Image,
  music: Music,
  film: Film,
  gamepad2: Gamepad2,
  layers: Layers,
  link: Link,
  list: List,
  mail: Mail,
  mappin: MapPin,
  shoppingbag: ShoppingBag,
  tag: Tag,
  terminal: Terminal,
  trophy: Trophy,
  user: User,
  users: Users,
  settings: Settings,
  shield: Shield,
  lock: Lock,
  download: Download,
  home: Home,
  clock: Clock,
  calendar: Calendar,
  cloud: Cloud,
  cpu: Cpu,
  eye: Eye,
  flame: Flame,
  compass: Compass,
  search: Search,
  briefcase: Briefcase,
  wand2: Wand2,
}

/**
 * 解析图标名：命中静态表返回组件，否则返回 `null`
 * （调用方要么走懒加载兜底，要么用 `NAV_ICON_FALLBACK`）。
 */
export function resolveNavIcon(name?: string | null): LucideIcon | null {
  if (typeof name !== 'string') return null
  const key = name.trim().toLowerCase()
  if (!key) return null
  return NAV_ICONS[key] ?? null
}

/** 图标字段既可能是名字，也可能是图片地址（`/assets/...` 或 `http(s)://...`） */
export function isIconUrl(name: string): boolean {
  return name.startsWith('/') || name.startsWith('http')
}
