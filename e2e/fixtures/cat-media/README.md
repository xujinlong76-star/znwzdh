# 猫挂件 E2E 夹具媒体（CI / 本地 E2E 专用）

> **这不是本站真正的猫形象媒体。** 真实媒体（透明待机/走路/扑视频、
> 动画 WebP/GIF）是二进制资产，不进仓库、部署时另放（见根 `.gitignore`
> 对 `apps/web-overlay/public/xiaomaomao/media/` 的排除与
> `xiaomaomao.js` 头部的文件约定）。
>
> 本目录 9 个文件只是**合成的最小可用媒体**：112×112、2 秒、12fps，
> 一个红色圆点在浅灰底（webm）/透明底（webp/gif）上左右摆动。
> 存在意义只有一个——让全新 checkout 的 CI / 本地 E2E 里，
> `playClip('idle')` 的 HEAD 探活能拿到 200、`<video>` 能解码、
> `<img>` 兜底能加载，猫挂件不走到 `hideCat()`，6 个猫 E2E 用例
> （half-screen-dock ×2、occlusion-probe ×2、cat-widget :123/:211）
> 才有东西可测。
>
> **禁止**把本目录文件当成生产媒体部署到服务器；生产媒体缺失时挂件
> 按设计藏猫（`hideCat()`，绝不回静态图），那是 William 定下的行为，
> 不要用夹具去掩盖它。

## 文件

| 文件 | 格式 | 说明 |
| --- | --- | --- |
| `play-idle.webm` | VP9 112×112 2s | 视频 tier。注意：本机 ffmpeg 8.1.2 的 libvpx-vp9 会丢 alpha 面（ffprobe 报 yuv420p），所以 webm 夹具是不透明的；挂件只要求探活 200 + 可解码，不透明不影响任何 E2E 断言。真实生产视频必须是透明 VP9。 |
| `play-idle.webp` | 动画 WebP 24 帧 | WebP tier，带真透明（alpha 0/230）。 |
| `play-idle.gif` | 动画 GIF 24 帧 | GIF tier，带透明索引。 |
| `play-walk.*` / `play-pounce.*` | 同上 | 与 idle **内容完全相同**（同一份字节复制改名）。walk/pounce 探活失败时挂件本就回 idle，不会藏猫；复制只是让三条名都存在、行为可预期。 |

合计约 52KB。walk/pounce 与 idle 的 MD5 相同是刻意的，不是复制失误。

## 怎么用

`scripts/ensure-cat-media.mjs` 在 E2E 前把本目录拷进被测应用实际
服务的两个 `public/xiaomaomao/media/`（`apps/web/` 与
`apps/web-overlay/`，后者是源码真身、前者是镜像，两个都放才不会
让 overlay 校验报漂移）。目标目录在 `.gitignore` 里，拷过去的文件
不进仓库。调用点：

- CI：`.github/workflows/ci.yml` 的 `test-e2e` 作业（`e2e-vendor` 之后）
- 本地：`scripts/e2e-web-server.mjs` 在启动 dev-all 之前调同一脚本

脚本是幂等的：重复跑只覆盖同名文件；源文件缺失或拷后为空时直接
非零退出，不让 E2E 在静默缺媒体的情况下开跑。

## 重新生成（ffmpeg 8.1.2，命令逐字记录，2026-11-18）

```sh
# 透明源（webp/gif 用）：红圆点在透明底上摆动
SRC_A="nullsrc=s=112x112:d=2:r=12,format=yuva420p,geq=lum='82':cb='90':cr='240':a='if(lt((X-(56+22*sin(2*PI*T)))*(X-(56+22*sin(2*PI*T)))+(Y-56)*(Y-56),784),230,0)'"
# 不透明源（webm 用，见上表 alpha 说明）
SRC="nullsrc=s=112x112:d=2:r=12,format=yuva420p,geq=lum='if(lt((X-(56+22*sin(2*PI*T)))*(X-(56+22*sin(2*PI*T)))+(Y-56)*(Y-56),784),82,235)':cb='if(lt((X-(56+22*sin(2*PI*T)))*(X-(56+22*sin(2*PI*T)))+(Y-56)*(Y-56),784),90,128)':cr='if(lt((X-(56+22*sin(2*PI*T)))*(X-(56+22*sin(2*PI*T)))+(Y-56)*(Y-56),784),240,128)'"

ffmpeg -y -v error -f lavfi -i "$SRC"   -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 0 -crf 30 -an play-idle.webm
ffmpeg -y -v error -f lavfi -i "$SRC_A" -c:v libwebp -loop 0 -pix_fmt yuva420p -lossless 0 -quality 70 -an play-idle.webp
ffmpeg -y -v error -f lavfi -i "$SRC_A" -vf "split[a][b];[a]palettegen=max_colors=64:reserve_transparent=1[p];[b][p]paletteuse" -loop 0 play-idle.gif

for c in walk pounce; do
  cp play-idle.webm play-$c.webm
  cp play-idle.webp play-$c.webp
  cp play-idle.gif  play-$c.gif
done
```

校验（2026-11-18 实测）：`ffprobe` webm 为 vp9 112×112；
`ffmpeg -i <文件> -f null -` 九个文件全部解码通过；
PIL 读 webp 为 24 帧 RGBA、alpha (0, 230)，gif 为 24 帧、带透明。
