/**
 * 核验工作流单测的套件入口（thin wrapper）。
 *
 * 完整用例在 `../src/lib/exam-verification.test.ts`（与实现同目录，任务书指定位置）；
 * 根 vitest 的 include 只收 `apps/web/test/**`（由 mirror:web 从 overlay 的
 * `test/` 镜像生成），不收 `apps/web-overlay/src/lib/**`，故这里只做一行业务：
 * import 该文件即注册全部 describe/it。mirror 后 `apps/web/test/` 里的同名文件
 * 同样 import `../src/lib/exam-verification.test`（镜像后的 `apps/web/src/lib/`）。
 */
import '../src/lib/exam-verification.test'
