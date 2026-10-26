/**
 * 种子插件：极客 HomeLab 与自托管服务专业包（site-pack）
 *
 * 遵循 2026 前沿技术标准打造的旗舰级专业网址包。
 * 覆盖 19 大核心分类与 190 个前沿站点。
 */
import type { SeedPluginDef } from "../types.ts";

export const homelabSelfhostedPro: SeedPluginDef = {
  "slug": "homelab-selfhosted-pro",
  "status": "published",
  "manifest": {
    "manifestVersion": 1,
    "kind": "site-pack",
    "name": "极客 HomeLab 与自托管服务专业包",
    "description": "2026 前沿极客 HomeLab 与自托管 (Self-Hosted) 旗舰级导航包（19 大分类 / 192 个精选站点）：汇聚开源微服务器 OS、轻量容器管理面板、自建私人影音库、自托管网盘与知识库、自动化智能家居、私有网络穿透与安全备份体系。",
    "icon": "🏠",
    "author": "山羊胡官方",
    "license": "GPL-3.0",
    "version": "1.0.0",
    "tags": [
      "HomeLab",
      "自托管",
      "NAS",
      "Docker",
      "局域网",
      "影音",
      "开源软件"
    ],
    "payload": {
      "categories": [
        {
          "title": "容器与编排",
          "description": "HomeLab 专用轻量容器面板、应用市场与 Docker 编排调度器"
        },
        {
          "title": "数据库与存储",
          "description": "自建高可用集群数据库、轻量嵌入式存储与家庭 NAS 文件存储"
        },
        {
          "title": "网关与流量",
          "description": "反向代理网关、局域网 DNS 分流、内网穿透与全自动证书续期"
        },
        {
          "title": "网络与测速",
          "description": "软路由固件、局域网测速、网络拓扑探测与防火墙流量监控"
        },
        {
          "title": "备份与恢复",
          "description": "3-2-1 异地备份、冷热数据同步、块级快照与自动化灾备恢复"
        },
        {
          "title": "密码与隐私",
          "description": "自托管多端密码管理器、两步验证令牌与去中心化身份隐私"
        },
        {
          "title": "可观测与监控",
          "description": "家庭服务器仪表盘、心跳健康检查、硬件温度与网络利用率监控"
        },
        {
          "title": "网盘与传输",
          "description": "开源私有云盘、局域网极速文件互传与跨设备即时剪贴板共享"
        },
        {
          "title": "笔记与知识库",
          "description": "本地优先双链笔记、协同 Markdown 知识库与离线书签归档"
        },
        {
          "title": "办公套件",
          "description": "自建开源在线 Office 文档、团队协作看板与自动化表单系统"
        },
        {
          "title": "长视频",
          "description": "私有流媒体媒体库、自动刮削影视海报与多端硬解码播放服务"
        },
        {
          "title": "音乐",
          "description": "自托管高清无损音乐服务器、个人音轨串流与多房间播控系统"
        },
        {
          "title": "播客与有声书",
          "description": "有声读物服务器、播客订阅收听与个人音频媒体管理中枢"
        },
        {
          "title": "数码与家居",
          "description": "开源全屋智能家居控制系统、家庭物联网自动化与 Zigbee 协调器"
        },
        {
          "title": "代码托管",
          "description": "局域网自建极轻量 Git 仓库、代码镜像同步与个人私有开发环境"
        },
        {
          "title": "命令行速查",
          "description": "Linux 运维高频命令、存储挂载排错与家庭服务器维护速查"
        },
        {
          "title": "信创与私有云",
          "description": "轻量微型服务器 Linux 发行版、虚拟机底层 Hypervisor 操作系统"
        },
        {
          "title": "语言与运行时",
          "description": "编写 HomeLab 自动化脚本与监控插件的轻量语言与执行环境"
        },
        {
          "title": "应用与密钥安全",
          "description": "家庭服务统一单点登录、多因素认证与网络暴露防护中枢"
        }
      ],
      "sites": [
        {
          "url": "https://casaos.io/",
          "title": "CasaOS",
          "description": "极简优雅的家庭云操作系统，围绕 Docker 生态打造一键安装应用商店。",
          "category": "容器与编排",
          "subCategory": "家庭云OS",
          "tags": [
            "CasaOS",
            "极简"
          ]
        },
        {
          "url": "https://1panel.cn/",
          "title": "1Panel 开源面板",
          "description": "现代化开源 Linux 服务器运维管理面板，深度集成 Docker 容器与应用市场。",
          "category": "容器与编排",
          "subCategory": "运维面板",
          "tags": [
            "1Panel",
            "国产开源"
          ]
        },
        {
          "url": "https://www.zimaspace.com/zimaos",
          "title": "ZimaOS",
          "description": "专为个人云与微型服务器打造的现代操作系统，原生融合本地 AI 与存储。",
          "category": "容器与编排",
          "subCategory": "个人云OS",
          "tags": [
            "ZimaOS",
            "微服务器"
          ]
        },
        {
          "url": "https://www.portainer.io/products/portainer-ce",
          "title": "Portainer CE",
          "description": "功能强大的开源容器图形化管理套件，轻松管理多节点 Docker 环境。",
          "category": "容器与编排",
          "subCategory": "容器面板",
          "tags": [
            "Portainer",
            "Docker管理"
          ]
        },
        {
          "url": "https://dockge.kuma.pet/",
          "title": "Dockge",
          "description": "Uptime Kuma 作者打造的高颜值响应式 Docker Compose 编写与管理面板。",
          "category": "容器与编排",
          "subCategory": "Compose管理",
          "tags": [
            "Dockge",
            "Compose"
          ]
        },
        {
          "url": "https://cosmos-cloud.io/",
          "title": "Cosmos Server",
          "description": "集容器管理、反向代理、内网隔离与强安全防护于一体的家庭云中枢。",
          "category": "容器与编排",
          "subCategory": "全能云中枢",
          "tags": [
            "Cosmos",
            "安全隔离"
          ]
        },
        {
          "url": "https://rancher.com/",
          "title": "Rancher Desktop",
          "description": "在本地工作站与小型家庭服务器上一键运行 Kubernetes 与容器工具链。",
          "category": "容器与编排",
          "subCategory": "K8s管理",
          "tags": [
            "Rancher",
            "本地K8s"
          ]
        },
        {
          "url": "https://github.com/louislam/uptime-kuma",
          "title": "Uptime Kuma 仓库",
          "description": "单容器自建服务监控与探活面板，支持 Ping、HTTP、证书过期告警。",
          "category": "容器与编排",
          "subCategory": "必备容器",
          "tags": [
            "Uptime Kuma",
            "服务探活"
          ]
        },
        {
          "url": "https://github.com/containrrr/watchtower",
          "title": "Watchtower",
          "description": "全自动监控并热更新正在运行的 Docker 容器基础镜像的自托管利器。",
          "category": "容器与编排",
          "subCategory": "自动更新",
          "tags": [
            "Watchtower",
            "镜像更新"
          ]
        },
        {
          "url": "https://github.com/stereoscott/homepage",
          "title": "Homepage",
          "description": "高度可定制、极简现代的自托管导航起始页，原生对接数十种服务 API 状态。",
          "category": "容器与编排",
          "subCategory": "服务导航",
          "tags": [
            "Homepage",
            "自托管起始页"
          ]
        },
        {
          "url": "https://unraid.net/",
          "title": "Unraid",
          "description": "专为家庭存储、虚拟机和 Docker 打造的阵列级操作系统，支持不同容量混插。",
          "category": "数据库与存储",
          "subCategory": "存储OS",
          "tags": [
            "Unraid",
            "混插阵列"
          ]
        },
        {
          "url": "https://www.truenas.com/truenas-scale/",
          "title": "TrueNAS SCALE",
          "description": "基于 Debian Linux 与 OpenZFS 打造的企业级超强弹性开源网络附加存储 OS。",
          "category": "数据库与存储",
          "subCategory": "ZFS存储",
          "tags": [
            "TrueNAS",
            "ZFS"
          ]
        },
        {
          "url": "https://openmediavault.org/",
          "title": "openmediavault (OMV)",
          "description": "基于 Debian 打造的纯开源网络存储 (NAS) 解决方案，模块化插件丰富。",
          "category": "数据库与存储",
          "subCategory": "开源NAS",
          "tags": [
            "OMV",
            "Debian"
          ]
        },
        {
          "url": "https://xpenology.org/",
          "title": "XPEnology 社区",
          "description": "引导在通用 x86 硬件上安装群晖 DSM 系统的技术极客社区与引导工具。",
          "category": "数据库与存储",
          "subCategory": "黑群晖社区",
          "tags": [
            "黑群晖",
            "DSM"
          ]
        },
        {
          "url": "https://github.com/rclone/rclone",
          "title": "Rclone",
          "description": "云存储界的瑞士军刀，支持在数十种云盘、S3 与本地目录之间同步加密数据。",
          "category": "数据库与存储",
          "subCategory": "数据同步",
          "tags": [
            "Rclone",
            "云存储挂载"
          ]
        },
        {
          "url": "https://restic.net/",
          "title": "Restic",
          "description": "安全、极速、带加密与高效去重的现代备份程序，保护重要文件免遭丢失。",
          "category": "数据库与存储",
          "subCategory": "快照备份",
          "tags": [
            "Restic",
            "去重备份"
          ]
        },
        {
          "url": "https://syncthing.net/",
          "title": "Syncthing",
          "description": "开源的连续去中心化文件同步工具，在多台设备间点对点实时保密同步。",
          "category": "数据库与存储",
          "subCategory": "P2P同步",
          "tags": [
            "Syncthing",
            "点对点传输"
          ]
        },
        {
          "url": "https://filebrowser.org/",
          "title": "File Browser",
          "description": "轻量单二进制网页文件管理器，随时随地在浏览器中浏览、上传与分享目录。",
          "category": "数据库与存储",
          "subCategory": "网页文件管理",
          "tags": [
            "File Browser",
            "轻量管理"
          ]
        },
        {
          "url": "https://www.seafile.com/home/",
          "title": "Seafile",
          "description": "开源自托管企业级云盘，拥有极佳的协同编辑体验与高可靠网盘架构。",
          "category": "数据库与存储",
          "subCategory": "私有云盘",
          "tags": [
            "Seafile",
            "团队网盘"
          ]
        },
        {
          "url": "https://nextcloud.com/",
          "title": "Nextcloud",
          "description": "全功能开源私有云协同套件，提供日历、通讯录、协同办公与云盘同步。",
          "category": "数据库与存储",
          "subCategory": "全能云盘",
          "tags": [
            "Nextcloud",
            "协作中心"
          ]
        },
        {
          "url": "https://nginxproxymanager.com/",
          "title": "Nginx Proxy Manager",
          "description": "简单直观的网页反向代理配置工具，轻松完成 SSL 申请与子域名反代。",
          "category": "网关与流量",
          "subCategory": "反代面板",
          "tags": [
            "NPM",
            "反向代理"
          ]
        },
        {
          "url": "https://pi-hole.net/",
          "title": "Pi-hole",
          "description": "全网络广告与恶意域名黑洞屏蔽系统，保护局域网所有设备免受广告骚扰。",
          "category": "网关与流量",
          "subCategory": "DNS过滤",
          "tags": [
            "Pi-hole",
            "广告屏蔽"
          ]
        },
        {
          "url": "https://adguard.com/en/adguard-home.html",
          "title": "AdGuard Home",
          "description": "开源的全网络广告拦截与隐私保护 DNS 服务器，界面极其现代化精美。",
          "category": "网关与流量",
          "subCategory": "DNS防护",
          "tags": [
            "AdGuard",
            "DNS防骚扰"
          ]
        },
        {
          "url": "https://github.com/fatedier/frp",
          "title": "frp",
          "description": "高性能反向代理内网穿透应用，支持 TCP/UDP/HTTP/HTTPS 多种协议暴露穿透。",
          "category": "网关与流量",
          "subCategory": "内网穿透",
          "tags": [
            "frp",
            "穿透神器"
          ]
        },
        {
          "url": "https://github.com/rustdesk/rustdesk",
          "title": "RustDesk",
          "description": "开源自托管远程桌面软件，完全拥有服务器基础设施，告别向日葵等卡顿限制。",
          "category": "网关与流量",
          "subCategory": "远程控制",
          "tags": [
            "RustDesk",
            "远程桌面"
          ]
        },
        {
          "url": "https://tailscale.com/download",
          "title": "Tailscale 客户端",
          "description": "零配置连接全部家庭设备与异地云服务器的安全 WireGuard 网状网络。",
          "category": "网关与流量",
          "subCategory": "虚拟局域网",
          "tags": [
            "Tailscale",
            "Mesh网络"
          ]
        },
        {
          "url": "https://headscale.net/",
          "title": "Headscale",
          "description": "Tailscale 控制服务器的开源自托管实现，彻底解除商业版节点与多租户限制。",
          "category": "网关与流量",
          "subCategory": "自建控制台",
          "tags": [
            "Headscale",
            "自托管Tailscale"
          ]
        },
        {
          "url": "https://github.com/zerotier/ZeroTierOne",
          "title": "ZeroTier",
          "description": "创建全球加密虚拟以太网，让异地服务器与手机犹如直连同一台交换机。",
          "category": "网关与流量",
          "subCategory": "虚拟交换机",
          "tags": [
            "ZeroTier",
            "虚拟局域网"
          ]
        },
        {
          "url": "https://caddyserver.com/docs/",
          "title": "Caddy 官方文档",
          "description": "默认开启 HTTPS、语法极其清爽优雅的现代反向代理与静态 Web 服务器。",
          "category": "网关与流量",
          "subCategory": "现代Web",
          "tags": [
            "Caddy",
            "自动HTTPS"
          ]
        },
        {
          "url": "https://traefik.io/",
          "title": "Traefik Proxy",
          "description": "自动监听 Docker 容器标签并动态创建路由规则的云原生边缘网关。",
          "category": "网关与流量",
          "subCategory": "动态路由",
          "tags": [
            "Traefik",
            "容器自适应"
          ]
        },
        {
          "url": "https://openwrt.org/",
          "title": "OpenWrt",
          "description": "开源高扩展性的嵌入式 Linux 路由固件系统，拥有数千个网络扩展软件包。",
          "category": "网络与测速",
          "subCategory": "开源软路由",
          "tags": [
            "OpenWrt",
            "路由系统"
          ]
        },
        {
          "url": "https://www.pfsense.org/",
          "title": "pfSense",
          "description": "基于 FreeBSD 打造的企业级开源防火墙与路由软件，提供银行级安全特性。",
          "category": "网络与测速",
          "subCategory": "企业防火墙",
          "tags": [
            "pfSense",
            "FreeBSD"
          ]
        },
        {
          "url": "https://opnsense.org/",
          "title": "OPNsense",
          "description": "易用、安全且支持全中文界面的开源防火墙与路由平台，界面更现代。",
          "category": "网络与测速",
          "subCategory": "现代防火墙",
          "tags": [
            "OPNsense",
            "开源路由"
          ]
        },
        {
          "url": "https://www.speedtest.net/",
          "title": "Speedtest by Ookla",
          "description": "全球知名的宽带测速基准服务，精准测试下行、上行与网络延迟跳数。",
          "category": "网络与测速",
          "subCategory": "带宽测速",
          "tags": [
            "Speedtest",
            "带宽测试"
          ]
        },
        {
          "url": "https://github.com/librespeed/speedtest",
          "title": "LibreSpeed",
          "description": "轻量、无 Flash、无广告、纯原生 JS 打造的自托管局域网宽带测速页。",
          "category": "网络与测速",
          "subCategory": "自建测速",
          "tags": [
            "LibreSpeed",
            "局域网测速"
          ]
        },
        {
          "url": "https://iperf.fr/",
          "title": "iPerf3",
          "description": "测试网络带宽最大性能的行业标准网络基准工具，精准测量内网吞吐极限。",
          "category": "网络与测速",
          "subCategory": "吞吐基准",
          "tags": [
            "iPerf3",
            "内网极限"
          ]
        },
        {
          "url": "https://www.wireshark.org/",
          "title": "Wireshark",
          "description": "全球顶级网络封包分析协议分析软件，网络抓包与异常网络排错第一现场。",
          "category": "网络与测速",
          "subCategory": "封包分析",
          "tags": [
            "Wireshark",
            "抓包排障"
          ]
        },
        {
          "url": "https://nmap.org/",
          "title": "Nmap",
          "description": "著名的网络发现与安全脆弱性扫描利器，扫描局域网存活主机与开放端口。",
          "category": "网络与测速",
          "subCategory": "端口扫描",
          "tags": [
            "Nmap",
            "网络探测"
          ]
        },
        {
          "url": "https://www.netgate.com/",
          "title": "Netgate",
          "description": "提供专业安全网络硬件解决方案与 pfSense 商业级技术支持的企业门户。",
          "category": "网络与测速",
          "subCategory": "网络硬件",
          "tags": [
            "Netgate",
            "硬件路由"
          ]
        },
        {
          "url": "https://fast.com/",
          "title": "Fast.com (Netflix)",
          "description": "Netflix 提供的极简宽带测速工具，通过海量流媒体 CDN 节点实测真实下行。",
          "category": "网络与测速",
          "subCategory": "流媒体测速",
          "tags": [
            "Fast.com",
            "CDN测速"
          ]
        },
        {
          "url": "https://www.duplicati.com/",
          "title": "Duplicati",
          "description": "免费开源备份软件，支持带加密、压缩与去重存储到本地或各大网盘中。",
          "category": "备份与恢复",
          "subCategory": "图形备份",
          "tags": [
            "Duplicati",
            "加密备份"
          ]
        },
        {
          "url": "https://kopia.io/",
          "title": "Kopia",
          "description": "快速、安全且具有高级去重快照特性的开源跨平台加密数据备份利器。",
          "category": "备份与恢复",
          "subCategory": "极速快照",
          "tags": [
            "Kopia",
            "加密快照"
          ]
        },
        {
          "url": "https://borgbackup.readthedocs.io/",
          "title": "BorgBackup",
          "description": "去重备份程序的行业老牌标杆，极其节省存储空间且提供严密安全加密。",
          "category": "备份与恢复",
          "subCategory": "去重工具",
          "tags": [
            "Borg",
            "去重"
          ]
        },
        {
          "url": "https://github.com/borgmatic-community/borgmatic",
          "title": "borgmatic",
          "description": "为 Borg 提供声明式 YAML 配置、自动化数据库归档与监控告警的调度器。",
          "category": "备份与恢复",
          "subCategory": "配置调度",
          "tags": [
            "borgmatic",
            "自动化备份"
          ]
        },
        {
          "url": "https://urbackup.org/",
          "title": "UrBackup",
          "description": "易于搭建的开源客户端/服务器备份系统，结合镜像备份与文件级增量恢复。",
          "category": "备份与恢复",
          "subCategory": "C/S备份",
          "tags": [
            "UrBackup",
            "整机镜像"
          ]
        },
        {
          "url": "https://clonezilla.org/",
          "title": "Clonezilla (再生龙)",
          "description": "类似 Ghost 的开源分区与磁盘克隆微系统，支持整盘快速裸机镜像备份。",
          "category": "备份与恢复",
          "subCategory": "磁盘克隆",
          "tags": [
            "再生龙",
            "裸机备份"
          ]
        },
        {
          "url": "https://rescuezilla.com/",
          "title": "Rescuezilla",
          "description": "具备现代图形界面的 Clonezilla 开源瑞士军刀，点几下鼠标完成整盘灾备恢复。",
          "category": "备份与恢复",
          "subCategory": "图形灾备",
          "tags": [
            "Rescuezilla",
            "图形克隆"
          ]
        },
        {
          "url": "https://timeshift.app/",
          "title": "Timeshift",
          "description": "Linux 系统快照实用工具，通过增量硬链接在系统崩溃时几分钟回滚系统。",
          "category": "备份与恢复",
          "subCategory": "系统快照",
          "tags": [
            "Timeshift",
            "系统回滚"
          ]
        },
        {
          "url": "https://freefilesync.org/",
          "title": "FreeFileSync",
          "description": "开源的文件比对与文件夹同步软件，支持复杂过滤规则与批量自动化作业。",
          "category": "备份与恢复",
          "subCategory": "目录比对",
          "tags": [
            "FreeFileSync",
            "文件夹同步"
          ]
        },
        {
          "url": "https://www.veeam.com/products/free/backup-recovery.html",
          "title": "Veeam Agent for Linux",
          "description": "企业级免费 Linux 整机备份工具，提供基于块的物理机与虚拟机快照保护。",
          "category": "备份与恢复",
          "subCategory": "整机快照",
          "tags": [
            "Veeam",
            "企业备份"
          ]
        },
        {
          "url": "https://bitwarden.com/",
          "title": "Bitwarden",
          "description": "全球知名的开源端到端加密密码管理器，支持全平台同步与自动填充。",
          "category": "密码与隐私",
          "subCategory": "密码安全",
          "tags": [
            "Bitwarden",
            "密码管理"
          ]
        },
        {
          "url": "https://github.com/dani-garcia/vaultwarden",
          "title": "Vaultwarden (原 bitwarden_rs)",
          "description": "用 Rust 重写的高效极简轻量版 Bitwarden 兼容服务器，内存开销仅几十兆。",
          "category": "密码与隐私",
          "subCategory": "轻量自建",
          "tags": [
            "Vaultwarden",
            "极低内存"
          ]
        },
        {
          "url": "https://keepassxc.org/",
          "title": "KeePassXC",
          "description": "现代且功能强大的社区驱动跨平台开源离线密码管理器，数据纯本地掌握。",
          "category": "密码与隐私",
          "subCategory": "本地离线",
          "tags": [
            "KeePassXC",
            "纯本地"
          ]
        },
        {
          "url": "https://2fauth.app/",
          "title": "2FAuth",
          "description": "自托管的两步验证 (2FA) 网页端令牌管理器，无需依赖第三方云服务。",
          "category": "密码与隐私",
          "subCategory": "两步验证",
          "tags": [
            "2FAuth",
            "2FA管理"
          ]
        },
        {
          "url": "https://authelia.com/",
          "title": "Authelia",
          "description": "为反向代理提供双因素认证、单点登录 (SSO) 与访问控制的轻量安全中间件。",
          "category": "密码与隐私",
          "subCategory": "门户认证",
          "tags": [
            "Authelia",
            "SSO"
          ]
        },
        {
          "url": "https://www.authentik.io/",
          "title": "authentik",
          "description": "开源且极其灵活的企业级身份提供商 (IdP)，支持复杂的应用授权流程。",
          "category": "密码与隐私",
          "subCategory": "身份提供商",
          "tags": [
            "authentik",
            "多因素认证"
          ]
        },
        {
          "url": "https://github.com/crowdsecurity/crowdsec",
          "title": "CrowdSec",
          "description": "开源协作式入侵防御引擎，利用群体智慧封锁发起暴力破解的黑客恶意 IP。",
          "category": "密码与隐私",
          "subCategory": "入侵防御",
          "tags": [
            "CrowdSec",
            "IP拦截"
          ]
        },
        {
          "url": "https://fail2ban.org/",
          "title": "Fail2ban",
          "description": "经典防暴力破解守护进程，扫描日志并将频繁密码错误的恶意请求拉黑防火墙。",
          "category": "密码与隐私",
          "subCategory": "防爆破",
          "tags": [
            "Fail2ban",
            "防火墙拉黑"
          ]
        },
        {
          "url": "https://simplelogin.io/",
          "title": "SimpleLogin",
          "description": "Proton 旗下的开源邮件别名中转服务，隐藏真实邮箱防范网络隐私追踪与垃圾邮件。",
          "category": "密码与隐私",
          "subCategory": "隐私别名",
          "tags": [
            "SimpleLogin",
            "邮件别名"
          ]
        },
        {
          "url": "https://anonaddy.com/",
          "title": "addy.io (原 AnonAddy)",
          "description": "自托管或云端使用的匿名邮件转发系统，为每个新注册站点生成独立别名。",
          "category": "密码与隐私",
          "subCategory": "匿名中继",
          "tags": [
            "addy.io",
            "匿名邮件"
          ]
        },
        {
          "url": "https://gethomepage.dev/",
          "title": "Homepage 官方文档",
          "description": "高度可定制的自托管家庭仪表盘，直接展示各微服务的 CPU 与网络状态卡片。",
          "category": "可观测与监控",
          "subCategory": "仪表盘",
          "tags": [
            "Homepage",
            "聚合看板"
          ]
        },
        {
          "url": "https://glances.readthedocs.io/",
          "title": "Glances",
          "description": "基于 Python 编写的跨平台 curses 风格终端与网页系统实时监控利器。",
          "category": "可观测与监控",
          "subCategory": "系统状态",
          "tags": [
            "Glances",
            "系统负载"
          ]
        },
        {
          "url": "https://dashy.to/",
          "title": "Dashy",
          "description": "支持主题更换、小部件集成与本地隐私保护的全功能家庭服务器个人仪表盘。",
          "category": "可观测与监控",
          "subCategory": "看板导航",
          "tags": [
            "Dashy",
            "小组件"
          ]
        },
        {
          "url": "https://github.com/bastienwirtz/homer",
          "title": "Homer",
          "description": "一份静态 YAML 即可轻松配置的极简高颜值家庭服务导航起始页。",
          "category": "可观测与监控",
          "subCategory": "静态看板",
          "tags": [
            "Homer",
            "YAML配置"
          ]
        },
        {
          "url": "https://www.librenms.org/",
          "title": "LibreNMS",
          "description": "功能全面的自动发现网络监控系统，支持 SNMP 监控路由器、交换机与 NAS 状态。",
          "category": "可观测与监控",
          "subCategory": "SNMP监控",
          "tags": [
            "LibreNMS",
            "网络监控"
          ]
        },
        {
          "url": "https://www.zabbix.com/",
          "title": "Zabbix",
          "description": "企业级高扩展开源分布式监控系统，监控数千台设备状态与实时性能阈值报警。",
          "category": "可观测与监控",
          "subCategory": "企业级监控",
          "tags": [
            "Zabbix",
            "分布式监控"
          ]
        },
        {
          "url": "https://checkmk.com/",
          "title": "Checkmk",
          "description": "全面且开箱即用的现代化 IT 基础设施监控解决方案，安装配置极其迅速。",
          "category": "可观测与监控",
          "subCategory": "现代监控",
          "tags": [
            "Checkmk",
            "即时监控"
          ]
        },
        {
          "url": "https://cockpit-project.org/",
          "title": "Cockpit",
          "description": "Red Hat 支持的易用交互式 Linux Web 服务器管理与底层资源查看管理控制台。",
          "category": "可观测与监控",
          "subCategory": "Linux控制台",
          "tags": [
            "Cockpit",
            "Web终端"
          ]
        },
        {
          "url": "https://github.com/firehol/netdata",
          "title": "Netdata 源码",
          "description": "高性能实时分布式监控引擎，开箱即用支持每秒高分辨率可视化图表呈现。",
          "category": "可观测与监控",
          "subCategory": "实时秒级",
          "tags": [
            "Netdata",
            "实时监控"
          ]
        },
        {
          "url": "https://github.com/grafana/grafana",
          "title": "Grafana 源码",
          "description": "全球知名的通用可视化仪表盘中枢，连接家庭网络内全部监控时序数据库。",
          "category": "可观测与监控",
          "subCategory": "大盘核心",
          "tags": [
            "Grafana",
            "开源大盘"
          ]
        },
        {
          "url": "https://alist.nn.ci/",
          "title": "AList",
          "description": "支持挂载数十种网盘、本地存储、WebDAV 与对象存储的一站式聚合文件目录列表。",
          "category": "网盘与传输",
          "subCategory": "聚合盘",
          "tags": [
            "AList",
            "网盘挂载"
          ]
        },
        {
          "url": "https://github.com/localsend/localsend",
          "title": "LocalSend",
          "description": "完全开源且免公网服务器的跨平台局域网文件与文本传输神器，AirDrop 完美替代。",
          "category": "网盘与传输",
          "subCategory": "局域网互传",
          "tags": [
            "LocalSend",
            "免网络互传"
          ]
        },
        {
          "url": "https://snapdrop.net/",
          "title": "Snapdrop",
          "description": "基于浏览器的纯网页 P2P 文件传输工具，在同一个 Wi-Fi 下点开即传。",
          "category": "网盘与传输",
          "subCategory": "网页快传",
          "tags": [
            "Snapdrop",
            "WebRTC"
          ]
        },
        {
          "url": "https://pairdrop.net/",
          "title": "PairDrop",
          "description": "由 Snapdrop 分裂改进而来的现代 WebRTC 文件传输，支持扫码跨网络直接配对。",
          "category": "网盘与传输",
          "subCategory": "跨网快传",
          "tags": [
            "PairDrop",
            "扫码快传"
          ]
        },
        {
          "url": "https://github.com/filebrowser/filebrowser",
          "title": "File Browser 仓库",
          "description": "用 Go 编写的单文件静态文件浏览器，赋予任意文件夹美观的 Web 分享界面。",
          "category": "网盘与传输",
          "subCategory": "轻量网盘",
          "tags": [
            "FileBrowser",
            "Go编写"
          ]
        },
        {
          "url": "https://owncloud.com/infinite-scale/",
          "title": "ownCloud Infinite Scale",
          "description": "采用 Go 与微服务架构彻底重构的下一代云原生内容协作平台。",
          "category": "网盘与传输",
          "subCategory": "Go云盘",
          "tags": [
            "ownCloud",
            "高并发"
          ]
        },
        {
          "url": "https://github.com/cloudreve/Cloudreve",
          "title": "Cloudreve",
          "description": "支持将多家对象存储、自建服务器与网盘聚合成公私兼备的现代化网盘系统。",
          "category": "网盘与传输",
          "subCategory": "全能网盘",
          "tags": [
            "Cloudreve",
            "国产网盘"
          ]
        },
        {
          "url": "https://github.com/muesli/duo",
          "title": "Duo 双向文件同步",
          "description": "现代极简的命令行文件镜像与双向数据一致性维护小工具。",
          "category": "网盘与传输",
          "subCategory": "终端同步",
          "tags": [
            "Duo",
            "命令行同步"
          ]
        },
        {
          "url": "https://send.viscon.dev/",
          "title": "Send (Firefox Send 社区版)",
          "description": "端到端加密、阅后即焚且带密码保护的临时安全文件分享服务平台。",
          "category": "网盘与传输",
          "subCategory": "阅后即焚",
          "tags": [
            "Send",
            "阅后即焚"
          ]
        },
        {
          "url": "https://github.com/transfer-sh/transfer.sh",
          "title": "transfer.sh",
          "description": "专为命令行用户设计的易用文件共享服务，用一行 curl 命令即可上传下载。",
          "category": "网盘与传输",
          "subCategory": "命令行传输",
          "tags": [
            "transfer.sh",
            "curl传输"
          ]
        },
        {
          "url": "https://obsidian.md/",
          "title": "Obsidian",
          "description": "本地优先、支持双链与丰富插件生态的知识管理工具，纯 Markdown 文本存储。",
          "category": "笔记与知识库",
          "subCategory": "本地双链",
          "tags": [
            "Obsidian",
            "本地优先"
          ]
        },
        {
          "url": "https://logseq.com/",
          "title": "Logseq",
          "description": "尊重隐私的开源大纲型本地双链笔记，完美支持任务管理与 PDF 批注。",
          "category": "笔记与知识库",
          "subCategory": "大纲笔记",
          "tags": [
            "Logseq",
            "大纲双链"
          ]
        },
        {
          "url": "https://www.usememos.com/",
          "title": "Memos",
          "description": "自托管碎片化想法记录系统，打造专属私有微博与灵感闪念捕捉工具。",
          "category": "笔记与知识库",
          "subCategory": "碎片灵感",
          "tags": [
            "Memos",
            "碎片笔记"
          ]
        },
        {
          "url": "https://affine.pro/",
          "title": "AFFiNE",
          "description": "开源下一代全能知识库，无缝融合大纲文档、白板画板与多维表格。",
          "category": "笔记与知识库",
          "subCategory": "白板知识库",
          "tags": [
            "AFFiNE",
            "Notion替代"
          ]
        },
        {
          "url": "https://joplinapp.org/",
          "title": "Joplin",
          "description": "开源端到端加密笔记与待办清单应用，支持自托管同步到 Nextcloud 或 S3。",
          "category": "笔记与知识库",
          "subCategory": "加密笔记",
          "tags": [
            "Joplin",
            "端到端加密"
          ]
        },
        {
          "url": "https://www.bookstackapp.com/",
          "title": "BookStack",
          "description": "简单而功能强大的开源文档Wiki平台，采用书籍、章节、页面的树状直观排布。",
          "category": "笔记与知识库",
          "subCategory": "Wiki手册",
          "tags": [
            "BookStack",
            "文档管理"
          ]
        },
        {
          "url": "https://js.wiki/",
          "title": "Wiki.js",
          "description": "采用 Node.js 编写的高颜值现代化开源 Wiki 引擎，支持多种编辑器与 Git 备份。",
          "category": "笔记与知识库",
          "subCategory": "现代Wiki",
          "tags": [
            "Wiki.js",
            "Git同步"
          ]
        },
        {
          "url": "https://github.com/triliumnext/trilium",
          "title": "Trilium Notes",
          "description": "专为构建大型个人知识库设计的分层树状笔记应用，拥有强悍的思维链归档。",
          "category": "笔记与知识库",
          "subCategory": "树状知识库",
          "tags": [
            "Trilium",
            "个人脑图"
          ]
        },
        {
          "url": "https://wallabag.org/",
          "title": "wallabag",
          "description": "开源稍后阅读应用，自动剔除杂质正文排版，保存网页内容免遭原站失效丢失。",
          "category": "笔记与知识库",
          "subCategory": "稍后阅读",
          "tags": [
            "wallabag",
            "离线归档"
          ]
        },
        {
          "url": "https://github.com/karlicoss/archivebox",
          "title": "ArchiveBox",
          "description": "开源的个人互联网自托管档案馆，将收藏书签自动保存为静态 HTML、PDF 与 WARC。",
          "category": "笔记与知识库",
          "subCategory": "网页归档",
          "tags": [
            "ArchiveBox",
            "静态归档"
          ]
        },
        {
          "url": "https://www.onlyoffice.com/",
          "title": "ONLYOFFICE",
          "description": "高度兼容微软 Office 格式的自建开源在线办公套件，支持多人实时协同编辑。",
          "category": "办公套件",
          "subCategory": "在线文档",
          "tags": [
            "ONLYOFFICE",
            "文档协同"
          ]
        },
        {
          "url": "https://www.collaboraoffice.com/",
          "title": "Collabora Online",
          "description": "基于 LibreOffice 核心构建的企业级安全在线编辑套件，深度适配信创办公。",
          "category": "办公套件",
          "subCategory": "开源Office",
          "tags": [
            "Collabora",
            "LibreOffice"
          ]
        },
        {
          "url": "https://taiga.io/",
          "title": "Taiga",
          "description": "专为敏捷开发团队打造的开源看板、Scrum 迭代管理与项目追踪敏捷套件。",
          "category": "办公套件",
          "subCategory": "敏捷看板",
          "tags": [
            "Taiga",
            "Scrum"
          ]
        },
        {
          "url": "https://focalboard.com/",
          "title": "Focalboard",
          "description": "Mattermost 打造的开源、多语言多维看板管理工具，Trello 的自托管优秀替代。",
          "category": "办公套件",
          "subCategory": "多维表格",
          "tags": [
            "Focalboard",
            "任务看板"
          ]
        },
        {
          "url": "https://mattermost.com/",
          "title": "Mattermost",
          "description": "企业级高安全开源团队沟通与即时协作平台，Slack 的成熟私有化替代品。",
          "category": "办公套件",
          "subCategory": "即时通讯",
          "tags": [
            "Mattermost",
            "私有聊天"
          ]
        },
        {
          "url": "https://element.io/",
          "title": "Element (Matrix)",
          "description": "基于 Matrix 去中心化开放协议的端到端加密即时通讯与音视频聊天客户端。",
          "category": "办公套件",
          "subCategory": "去中心化IM",
          "tags": [
            "Element",
            "Matrix协议"
          ]
        },
        {
          "url": "https://noco-db.com/",
          "title": "NocoDB",
          "description": "将任意现有关系型数据库转化为现代化智能电子表格的开源无代码平台。",
          "category": "办公套件",
          "subCategory": "无代码表格",
          "tags": [
            "NocoDB",
            "Airtable替代"
          ]
        },
        {
          "url": "https://baserow.io/",
          "title": "Baserow",
          "description": "易用且支持自托管的开源无代码关系型数据库，具有无限数据行支持。",
          "category": "办公套件",
          "subCategory": "关系表格",
          "tags": [
            "Baserow",
            "数据库视图"
          ]
        },
        {
          "url": "https://www.appflowy.io/",
          "title": "AppFlowy",
          "description": "基于 Flutter 与 Rust 构建的开源本地优先通用工作区，Notion 的开源竞品。",
          "category": "办公套件",
          "subCategory": "Notion替代",
          "tags": [
            "AppFlowy",
            "Flutter开发"
          ]
        },
        {
          "url": "https://planka.app/",
          "title": "Planka",
          "description": "专为个人与小型敏捷团队打造的极简优雅开源看板项目管理协同工具。",
          "category": "办公套件",
          "subCategory": "极简看板",
          "tags": [
            "Planka",
            "Trello替代"
          ]
        },
        {
          "url": "https://jellyfin.org/",
          "title": "Jellyfin",
          "description": "100% 自由开源、无商业授权限制的家庭流媒体服务器，支持硬件转码与全客户端。",
          "category": "长视频",
          "subCategory": "开源媒体库",
          "tags": [
            "Jellyfin",
            "纯开源"
          ]
        },
        {
          "url": "https://www.plex.tv/",
          "title": "Plex",
          "description": "生态成熟、海报墙极其精美且跨平台支持极度广泛的老牌家庭流媒体中枢。",
          "category": "长视频",
          "subCategory": "主流媒体中枢",
          "tags": [
            "Plex",
            "精美海报墙"
          ]
        },
        {
          "url": "https://emby.media/",
          "title": "Emby",
          "description": "功能强大的多媒体管理套件，具备强大的服务端转码控制与细粒度用户权限。",
          "category": "长视频",
          "subCategory": "成熟媒体库",
          "tags": [
            "Emby",
            "权限管理"
          ]
        },
        {
          "url": "https://kodi.tv/",
          "title": "Kodi",
          "description": "老牌开源家庭影院软件，电视盒子与大屏投影播放各类本地音视频的最佳前端。",
          "category": "长视频",
          "subCategory": "电视大屏",
          "tags": [
            "Kodi",
            "影院前端"
          ]
        },
        {
          "url": "https://github.com/mandarons/videomass",
          "title": "Videomass",
          "description": "基于 FFmpeg 的跨平台可视化音视频批量转码、音频提取与画质优化利器。",
          "category": "长视频",
          "subCategory": "转码工具",
          "tags": [
            "Videomass",
            "FFmpeg"
          ]
        },
        {
          "url": "https://github.com/Radarr/Radarr",
          "title": "Radarr",
          "description": "自动化电影追踪与下载整理系统，与各大索引器与下载工具无缝联动。",
          "category": "长视频",
          "subCategory": "影视刮削整理",
          "tags": [
            "Radarr",
            "自动化入库"
          ]
        },
        {
          "url": "https://github.com/Sonarr/Sonarr",
          "title": "Sonarr",
          "description": "剧集与连续剧自动抓取整理工具，自动监控新剧更新并重命名归档。",
          "category": "长视频",
          "subCategory": "剧集管理",
          "tags": [
            "Sonarr",
            "剧集追更"
          ]
        },
        {
          "url": "https://github.com/jellyfin/jellyfin-vue",
          "title": "Jellyfin Vue",
          "description": "采用 Vue 3 重新编写的高颜值、现代化响应式 Jellyfin Web 前端客户端。",
          "category": "长视频",
          "subCategory": "现代前端",
          "tags": [
            "JellyfinVue",
            "高颜值前端"
          ]
        },
        {
          "url": "https://github.com/StashApp/stash",
          "title": "Stash",
          "description": "自托管个人视频收藏分类管理器，具备极其强大细致的标签与表演者索引系统。",
          "category": "长视频",
          "subCategory": "个人视频库",
          "tags": [
            "Stash",
            "标签分类"
          ]
        },
        {
          "url": "https://handbrake.fr/",
          "title": "HandBrake",
          "description": "开源免费的视频压制神器，支持几乎全部主流编码器（H.264/H.265/AV1）。",
          "category": "长视频",
          "subCategory": "视频压制",
          "tags": [
            "HandBrake",
            "格式压缩"
          ]
        },
        {
          "url": "https://navidrome.org/",
          "title": "Navidrome",
          "description": "用 Go 语言编写的超轻量现代开源音乐服务器，兼容 Subsonic 丰富客户端生态。",
          "category": "音乐",
          "subCategory": "轻量音乐服",
          "tags": [
            "Navidrome",
            "Go编写"
          ]
        },
        {
          "url": "https://www.subsonic.org/",
          "title": "Subsonic",
          "description": "经典老牌流媒体音乐服务器，定义了整个自托管音乐客户端的互通通信标准。",
          "category": "音乐",
          "subCategory": "经典协议",
          "tags": [
            "Subsonic",
            "协议基准"
          ]
        },
        {
          "url": "https://airsonic.github.io/",
          "title": "Airsonic",
          "description": "基于 Java 打造的免费开源社区驱动音乐流媒体服务器，功能全面强大。",
          "category": "音乐",
          "subCategory": "Java音乐服",
          "tags": [
            "Airsonic",
            "多格式支持"
          ]
        },
        {
          "url": "https://mopidy.com/",
          "title": "Mopidy",
          "description": "可扩展的音乐服务器，支持接入本地硬盘音乐、Spotify 等多源头聚合播放。",
          "category": "音乐",
          "subCategory": "音频中枢",
          "tags": [
            "Mopidy",
            "聚合串流"
          ]
        },
        {
          "url": "https://volumio.com/",
          "title": "Volumio",
          "description": "专为发烧友打造的高保真 (Hi-Fi) 开源音乐播放器系统，支持树莓派单板安装。",
          "category": "音乐",
          "subCategory": "Hi-Fi发烧友",
          "tags": [
            "Volumio",
            "无损音质"
          ]
        },
        {
          "url": "https://moodeaudio.org/",
          "title": "moOde audio",
          "description": "专为树莓派优化的纯粹无损音频播放系统，具备极其出色的音频输出调谐。",
          "category": "音乐",
          "subCategory": "发烧调音",
          "tags": [
            "moOde",
            "无损发烧"
          ]
        },
        {
          "url": "https://musicbee.fandom.com/",
          "title": "MusicBee",
          "description": "终极音乐管理与播放利器，支持海量音乐标签刮削、自动整理与音效均衡器。",
          "category": "音乐",
          "subCategory": "本地整理",
          "tags": [
            "MusicBee",
            "音轨整理"
          ]
        },
        {
          "url": "https://beets.io/",
          "title": "beets",
          "description": "面向音乐极客的音乐库管理系统，通过 MusicBrainz 自动抓取精确专辑元数据。",
          "category": "音乐",
          "subCategory": "元数据抓取",
          "tags": [
            "beets",
            "自动化标签"
          ]
        },
        {
          "url": "https://www.feishubee.com/",
          "title": "Funkwhale",
          "description": "去中心化联邦式音乐音频分享与串流服务器，支持音乐人与听众自主互联。",
          "category": "音乐",
          "subCategory": "联邦音乐",
          "tags": [
            "Funkwhale",
            "去中心化音乐"
          ]
        },
        {
          "url": "https://github.com/feeluown/FeelUOwn",
          "title": "FeelUOwn",
          "description": "极客开发的高颜值多源音乐播放器，统一收听网易云、QQ 音乐等跨平台歌单。",
          "category": "音乐",
          "subCategory": "聚合播放",
          "tags": [
            "FeelUOwn",
            "多平台音乐"
          ]
        },
        {
          "url": "https://www.audiobookshelf.org/",
          "title": "Audiobookshelf",
          "description": "自托管有声书与播客服务器首选，支持记录每位用户独立的收听进度与书签。",
          "category": "播客与有声书",
          "subCategory": "有声书首选",
          "tags": [
            "Audiobookshelf",
            "进度记忆"
          ]
        },
        {
          "url": "https://podgrab.alext.net/",
          "title": "Podhouse / Podgrab",
          "description": "轻量自托管播客下载器，输入 RSS 链接即可全自动在后台离线归档音频。",
          "category": "播客与有声书",
          "subCategory": "离线下载",
          "tags": [
            "Podgrab",
            "播客抓取"
          ]
        },
        {
          "url": "https://antennapod.org/",
          "title": "AntennaPod",
          "description": "完全开源且无广告的播客收听手机客户端，支持同步自建 Gpodder 进度服务。",
          "category": "播客与有声书",
          "subCategory": "开源移动端",
          "tags": [
            "AntennaPod",
            "无广告收听"
          ]
        },
        {
          "url": "https://gpodder.net/",
          "title": "gPodder",
          "description": "自由开源的播客聚合客户端与跨设备进度同步服务，支持自动化订阅下载。",
          "category": "播客与有声书",
          "subCategory": "跨设备同步",
          "tags": [
            "gPodder",
            "播客同步"
          ]
        },
        {
          "url": "https://castopod.org/",
          "title": "Castopod",
          "description": "面向播客创作者的开源自托管发布平台，支持 ActivityPub 协议接入联邦宇宙。",
          "category": "播客与有声书",
          "subCategory": "播客自发布",
          "tags": [
            "Castopod",
            "联邦广播"
          ]
        },
        {
          "url": "https://github.com/advplyr/audiobookshelf-app",
          "title": "Audiobookshelf 移动 App",
          "description": "官方打造的手机端应用程序，流畅离线缓存与多设备收听历史无缝同步。",
          "category": "播客与有声书",
          "subCategory": "配套客户端",
          "tags": [
            "ABS移动端",
            "离线缓存"
          ]
        },
        {
          "url": "https://podhome.fm/",
          "title": "Podhome",
          "description": "拥有现代音频处理与 AI 自动化字幕转写的播客托管与制作工作台。",
          "category": "播客与有声书",
          "subCategory": "播客制作",
          "tags": [
            "Podhome",
            "AI字幕"
          ]
        },
        {
          "url": "https://pocketcasts.com/",
          "title": "Pocket Casts",
          "description": "体验极度丝滑的主流播客收听应用，具备强大的静音消除与人声增强音效。",
          "category": "播客与有声书",
          "subCategory": "高质收听",
          "tags": [
            "PocketCasts",
            "人声增强"
          ]
        },
        {
          "url": "https://overcast.fm/",
          "title": "Overcast",
          "description": "iOS 上声誉极高的经典独立播客播放器，智能加速 (Smart Speed) 功能先驱。",
          "category": "播客与有声书",
          "subCategory": "智能加速",
          "tags": [
            "Overcast",
            "独立开发"
          ]
        },
        {
          "url": "https://rsshub.app/",
          "title": "RSSHub 播客转换器",
          "description": "万物皆可 RSS 的开源生成利器，将各类音频节目一键转化为标准播客源。",
          "category": "播客与有声书",
          "subCategory": "RSS转换",
          "tags": [
            "RSSHub",
            "万能播客源"
          ]
        },
        {
          "url": "https://www.home-assistant.io/installation/",
          "title": "Home Assistant 部署指南",
          "description": "全球顶级开源智能家居系统，支持本地离线控制全屋数万种不同品牌智能设备。",
          "category": "数码与家居",
          "subCategory": "智能家居中枢",
          "tags": [
            "Home Assistant",
            "全屋智能"
          ]
        },
        {
          "url": "https://www.zigbee2mqtt.io/",
          "title": "Zigbee2MQTT",
          "description": "摆脱商业网关限制，直接将 Zigbee 设备的消息桥接转为标准 MQTT 消息通信。",
          "category": "数码与家居",
          "subCategory": "Zigbee网关",
          "tags": [
            "Zigbee2MQTT",
            "免商业网关"
          ]
        },
        {
          "url": "https://z-wave-js.github.io/zwave-js-ui/",
          "title": "Z-Wave JS UI",
          "description": "功能全面的 Z-Wave 无线智能家居协议控制面板与驱动中枢服务。",
          "category": "数码与家居",
          "subCategory": "Z-Wave协议",
          "tags": [
            "ZWave",
            "智能设备"
          ]
        },
        {
          "url": "https://esphome.io/",
          "title": "ESPHome",
          "description": "通过简单清晰的 YAML 配置文件为 ESP8266/ESP32 编写专属传感器固件。",
          "category": "数码与家居",
          "subCategory": "DIY固件",
          "tags": [
            "ESPHome",
            "DIY传感器"
          ]
        },
        {
          "url": "https://tasmota.github.io/docs/",
          "title": "Tasmota",
          "description": "开源的 ESP 芯片通用固件，将普通的市售智能插座与开关改造为本地 MQTT 控制。",
          "category": "数码与家居",
          "subCategory": "开源插座固件",
          "tags": [
            "Tasmota",
            "本地受控"
          ]
        },
        {
          "url": "https://github.com/wled/WLED",
          "title": "WLED",
          "description": "用于驱动 NeoPixel (WS2812B) 可寻址炫彩幻彩 LED 灯带的顶级开源固件与控制端。",
          "category": "数码与家居",
          "subCategory": "灯光氛围",
          "tags": [
            "WLED",
            "幻彩灯带"
          ]
        },
        {
          "url": "https://emqx.com/zh",
          "title": "EMQX 开源 MQTT 消息中枢",
          "description": "超大规模分布式物联网 MQTT 消息服务器，高可靠承载全屋设备万级消息吞吐。",
          "category": "数码与家居",
          "subCategory": "MQTT中枢",
          "tags": [
            "EMQX",
            "高吞吐MQTT"
          ]
        },
        {
          "url": "https://mosquitto.org/",
          "title": "Eclipse Mosquitto",
          "description": "轻量级、低内存消耗的经典开源 MQTT 协议消息代理，家庭局域网运行首选。",
          "category": "数码与家居",
          "subCategory": "轻量MQTT",
          "tags": [
            "Mosquitto",
            "极简代理"
          ]
        },
        {
          "url": "https://nodered.org/",
          "title": "Node-RED",
          "description": "面向物联网与硬件交互的低代码可视化事件连线编排平台，直观编排全屋逻辑。",
          "category": "数码与家居",
          "subCategory": "流式编排",
          "tags": [
            "Node-RED",
            "自动化联动"
          ]
        },
        {
          "url": "https://homebridge.io/",
          "title": "Homebridge",
          "description": "让不支持苹果生态的普通智能硬件无缝接入 Apple HomeKit 并通过 Siri 语音操控。",
          "category": "数码与家居",
          "subCategory": "HomeKit桥接",
          "tags": [
            "Homebridge",
            "Apple家庭"
          ]
        },
        {
          "url": "https://about.gitlab.com/install/",
          "title": "GitLab CE 自建部署",
          "description": "企业级代码托管社区版，支持自建全套 CI/CD 流水线与代码审查环境。",
          "category": "代码托管",
          "subCategory": "企业自建",
          "tags": [
            "GitLab CE",
            "私有代码库"
          ]
        },
        {
          "url": "https://docs.gitea.com/installation",
          "title": "Gitea 极轻部署手册",
          "description": "超轻量、纯 Go 编译，哪怕在 512MB 内存的小主机上也能行云流水运行的 Git 托管。",
          "category": "代码托管",
          "subCategory": "轻量自建",
          "tags": [
            "Gitea",
            "极省资源"
          ]
        },
        {
          "url": "https://forgejo.org/docs/latest/user/",
          "title": "Forgejo 用户手册",
          "description": "秉承无商业裹挟宗旨、百分百属于社区所有的现代轻量代码托管协作分支。",
          "category": "代码托管",
          "subCategory": "纯净开源",
          "tags": [
            "Forgejo",
            "社区驱动"
          ]
        },
        {
          "url": "https://cgit.zonnet.nl/cgit/",
          "title": "cgit",
          "description": "用纯 C 语言编写、生成极快只读 Web 界面的超级轻量级 Git 仓库浏览器。",
          "category": "代码托管",
          "subCategory": "极简展示",
          "tags": [
            "cgit",
            "C编写"
          ]
        },
        {
          "url": "https://git-scm.com/book/zh/v2",
          "title": "Pro Git 中文版官方指南",
          "description": "深入透彻学习 Git 底层对象模型、树对象、引用与网络传输协议的标准专著。",
          "category": "代码托管",
          "subCategory": "权威专著",
          "tags": [
            "Pro Git",
            "Git底层"
          ]
        },
        {
          "url": "https://github.com/cli/cli",
          "title": "GitHub CLI (gh)",
          "description": "GitHub 官方命令行工作流工具，直接在终端中创建 PR、查看 CI 状态与 Issue。",
          "category": "代码托管",
          "subCategory": "官方终端",
          "tags": [
            "gh",
            "GitHub命令行"
          ]
        },
        {
          "url": "https://gitoxide.dev/",
          "title": "gitoxide",
          "description": "采用纯 Rust 重写的高性能现代 Git 实现，探索下一代极速版本控制内核。",
          "category": "代码托管",
          "subCategory": "Rust实现",
          "tags": [
            "gitoxide",
            "Rust重写"
          ]
        },
        {
          "url": "https://git-lfs.com/",
          "title": "Git LFS",
          "description": "开源的 Git 大文件存储扩展，将大型音频、视频与权重文件指针化管理。",
          "category": "代码托管",
          "subCategory": "大文件存储",
          "tags": [
            "Git LFS",
            "大文件"
          ]
        },
        {
          "url": "https://radicle.xyz/guides",
          "title": "Radicle 去中心化指南",
          "description": "指导如何脱离集中式服务器、使用 P2P 密码学网络协作开发开源代码仓库。",
          "category": "代码托管",
          "subCategory": "去中心化协作",
          "tags": [
            "Radicle",
            "P2P代码"
          ]
        },
        {
          "url": "https://git-cola.github.io/",
          "title": "Git Cola",
          "description": "用 Python 编写的现代且精简强大的开源 Git 图形交互界面客户端。",
          "category": "代码托管",
          "subCategory": "开源客户端",
          "tags": [
            "Git Cola",
            "图形客户端"
          ]
        },
        {
          "url": "https://linuxjourney.com/",
          "title": "Linux Journey (Linux 旅程)",
          "description": "以优雅关卡方式系统学习 Linux 权限、进程管理、文件系统与网络配置。",
          "category": "命令行速查",
          "subCategory": "系统入门",
          "tags": [
            "Linux学习",
            "自学系统"
          ]
        },
        {
          "url": "https://linux.vbird.org/",
          "title": "鸟哥的 Linux 私房菜",
          "description": "华人世界极负盛名的 Linux 经典巨著，讲解详尽生动，基础运维必读书目。",
          "category": "命令行速查",
          "subCategory": "经典专著",
          "tags": [
            "鸟哥",
            "Linux宝典"
          ]
        },
        {
          "url": "https://ss64.com/bash/",
          "title": "SS64 Bash 命令大全",
          "description": "详尽列出 Bash 全部核心命令、环境变量、操作符与返回码的速查指南。",
          "category": "命令行速查",
          "subCategory": "语法速查",
          "tags": [
            "SS64",
            "Bash大全"
          ]
        },
        {
          "url": "https://cheat.sh/tar",
          "title": "cheat.sh 实用命令提取",
          "description": "极速查询解压不同后缀压缩包、查找日志等高频棘手命令的最佳参数写法。",
          "category": "命令行速查",
          "subCategory": "高频速查",
          "tags": [
            "解压参数",
            "命令速查"
          ]
        },
        {
          "url": "https://man7.org/linux/man-pages/",
          "title": "Linux man-pages 官方手册",
          "description": "Linux 内核与 GNU C 库系统调用、POSIX 标准接口的权威在线手册库。",
          "category": "命令行速查",
          "subCategory": "权威手册",
          "tags": [
            "man-pages",
            "系统调用"
          ]
        },
        {
          "url": "https://bropages.org/",
          "title": "bro pages",
          "description": "就像 man 手册一样，但只呈现社区最常用、最实用的命令示例干货。",
          "category": "命令行速查",
          "subCategory": "实用案例",
          "tags": [
            "bro pages",
            "简洁案例"
          ]
        },
        {
          "url": "https://github.com/nvbn/thefuck",
          "title": "thefuck",
          "description": "神奇的终端错误自动纠正工具，敲错命令时只需输入 fuck 即可自动修正执行。",
          "category": "命令行速查",
          "subCategory": "纠错神器",
          "tags": [
            "thefuck",
            "智能纠错"
          ]
        },
        {
          "url": "https://github.com/sharkdp/bat",
          "title": "bat (更好的 cat)",
          "description": "带语法高亮、Git 变更集成与自动分页的现代 cat 替代品。",
          "category": "命令行速查",
          "subCategory": "文件查看",
          "tags": [
            "bat",
            "高亮cat"
          ]
        },
        {
          "url": "https://github.com/eza-community/eza",
          "title": "eza (现代 ls 替代)",
          "description": "为命令行带来图标支持、Git 状态与文件元信息色彩的现代化 ls 替代程序。",
          "category": "命令行速查",
          "subCategory": "目录列表",
          "tags": [
            "eza",
            "现代ls"
          ]
        },
        {
          "url": "https://github.com/sharkdp/fd",
          "title": "fd (简单极速的 find)",
          "description": "比传统 find 简单直观十倍且快数倍的极速文件搜索命令行工具。",
          "category": "命令行速查",
          "subCategory": "文件检索",
          "tags": [
            "fd",
            "极速find"
          ]
        },
        {
          "url": "https://www.proxmox.com/en/proxmox-virtual-environment/overview",
          "title": "Proxmox VE (PVE)",
          "description": "极客 HomeLab 最爱的开源虚拟化管理平台，集成 KVM 虚拟机与 LXC 轻量容器。",
          "category": "信创与私有云",
          "subCategory": "虚拟化平台",
          "tags": [
            "PVE",
            "Hypervisor"
          ]
        },
        {
          "url": "https://xcp-ng.org/",
          "title": "XCP-ng",
          "description": "基于 Xen 构建的高性能企业级开源虚拟机管理平台，Citrix Hypervisor 的开源替代。",
          "category": "信创与私有云",
          "subCategory": "Xen虚拟化",
          "tags": [
            "XCP-ng",
            "开源云底座"
          ]
        },
        {
          "url": "https://www.debian.org/",
          "title": "Debian 官方门户",
          "description": "通用操作系统，以超高稳定性与丰富软件包库成为绝大多数自托管服务器的坚实基座。",
          "category": "信创与私有云",
          "subCategory": "服务器基石",
          "tags": [
            "Debian",
            "稳定基座"
          ]
        },
        {
          "url": "https://ubuntu.com/server",
          "title": "Ubuntu Server",
          "description": "全球企业最广泛采用的 Linux 服务器发行版，软件支持极全且社区教程丰富。",
          "category": "信创与私有云",
          "subCategory": "主流服务器系统",
          "tags": [
            "Ubuntu",
            "企业主流"
          ]
        },
        {
          "url": "https://alpinelinux.org/",
          "title": "Alpine Linux",
          "description": "基于 musl libc 和 BusyBox 的极轻极小面向安全的操作系统，Docker 基础镜像首选。",
          "category": "信创与私有云",
          "subCategory": "极简系统",
          "tags": [
            "Alpine",
            "超小体积"
          ]
        },
        {
          "url": "https://nixos.org/",
          "title": "NixOS",
          "description": "完全纯函数式、通过单份配置文件即可完全重现整个操作系统状态的先进 Linux。",
          "category": "信创与私有云",
          "subCategory": "声明式系统",
          "tags": [
            "NixOS",
            "可复现"
          ]
        },
        {
          "url": "https://archlinux.org/",
          "title": "Arch Linux",
          "description": "轻量、简单且遵循滚动更新的极客发行版，拥有全网最详尽的 ArchWiki 知识库。",
          "category": "信创与私有云",
          "subCategory": "滚动发行",
          "tags": [
            "Arch",
            "ArchWiki"
          ]
        },
        {
          "url": "https://rockylinux.org/",
          "title": "Rocky Linux",
          "description": "由 CentOS 创始人发起的开源企业级操作系统，与 Red Hat Enterprise Linux 100% 兼容。",
          "category": "信创与私有云",
          "subCategory": "RHEL兼容",
          "tags": [
            "Rocky Linux",
            "CentOS替代"
          ]
        },
        {
          "url": "https://almalinux.org/",
          "title": "AlmaLinux",
          "description": "社区拥有并管理的免费开源企业级操作系统，长效稳定提供二进制 RHEL 兼容。",
          "category": "信创与私有云",
          "subCategory": "社区发行版",
          "tags": [
            "AlmaLinux",
            "企业级"
          ]
        },
        {
          "url": "https://talos.dev/",
          "title": "Talos Linux",
          "description": "专为运行 Kubernetes 设计的不可变、极简安全操作系统，无 SSH、完全通过 API 管理。",
          "category": "信创与私有云",
          "subCategory": "不可变OS",
          "tags": [
            "Talos",
            "K8s专用"
          ]
        },
        {
          "url": "https://go.dev/",
          "title": "Go 语言官网",
          "description": "原生高并发、极快编译与单二进制交付的明星语言，驱动了现代云原生半壁江山。",
          "category": "语言与运行时",
          "subCategory": "并发云原生",
          "tags": [
            "Go",
            "单二进制"
          ]
        },
        {
          "url": "https://www.rust-lang.org/learn",
          "title": "Rust 学习指南",
          "description": "编写极高安全性、低内存开销系统守护进程与高性能反向代理的首选现代语言。",
          "category": "语言与运行时",
          "subCategory": "系统语言",
          "tags": [
            "Rust",
            "零成本抽象"
          ]
        },
        {
          "url": "https://www.python.org/doc/",
          "title": "Python 官方资源库",
          "description": "快速编写自动化备份脚本、家庭网络探测工具与定时爬虫的极佳胶水语言。",
          "category": "语言与运行时",
          "subCategory": "自动化脚本",
          "tags": [
            "Python",
            "万能胶水"
          ]
        },
        {
          "url": "https://nodejs.org/en/about",
          "title": "Node.js 架构概述",
          "description": "基于事件驱动的单线程异步非阻塞 I/O 运行时，构建家庭仪表盘应用的主流选择。",
          "category": "语言与运行时",
          "subCategory": "事件驱动",
          "tags": [
            "Node.js",
            "异步IO"
          ]
        },
        {
          "url": "https://lua.org/",
          "title": "Lua 官方主页",
          "description": "轻量、紧凑且极易嵌入的高性能脚本语言，广泛用于 OpenWrt 路由与 NGINX 扩展。",
          "category": "语言与运行时",
          "subCategory": "嵌入式脚本",
          "tags": [
            "Lua",
            "OpenWrt扩展"
          ]
        },
        {
          "url": "https://www.ruby-lang.org/",
          "title": "Ruby 官方主页",
          "description": "专注于程序员幸福感与生产力的优雅脚本语言，驱动了 Homebrew 等知名工具。",
          "category": "语言与运行时",
          "subCategory": "优雅脚本",
          "tags": [
            "Ruby",
            "开发幸福感"
          ]
        },
        {
          "url": "https://ziglang.org/",
          "title": "Zig 语言官网",
          "description": "致力于替代 C 语言的现代通用系统编程语言，无隐藏控制流且交叉编译极度强大。",
          "category": "语言与运行时",
          "subCategory": "现代C替代",
          "tags": [
            "Zig",
            "交叉编译"
          ]
        },
        {
          "url": "https://www.gnu.org/software/bash/",
          "title": "GNU Bash",
          "description": "绝大多数 Linux 发行版默认交互式 Shell 与脚本解释器，系统运维脚本的根基。",
          "category": "语言与运行时",
          "subCategory": "Shell基石",
          "tags": [
            "Bash",
            "Linux核心"
          ]
        },
        {
          "url": "https://fishshell.com/",
          "title": "Fish Shell",
          "description": "开箱即用自带智能语法自动建议、绚丽高亮与易读语法的现代交互式命令行。",
          "category": "语言与运行时",
          "subCategory": "现代Shell",
          "tags": [
            "Fish",
            "智能补全"
          ]
        },
        {
          "url": "https://www.nushell.sh/",
          "title": "Nushell",
          "description": "以结构化数据表为核心理念的全新现代命令行，用查 SQL 表的方式管道过滤系统信息。",
          "category": "语言与运行时",
          "subCategory": "结构化Shell",
          "tags": [
            "Nushell",
            "结构化管道"
          ]
        },
        {
          "url": "https://www.cloudflare.com/zero-trust/",
          "title": "Cloudflare Zero Trust",
          "description": "企业级免费零信任访问套件，通过身份验证保护所有自建服务，告别端口直接暴露。",
          "category": "应用与密钥安全",
          "subCategory": "零信任保护",
          "tags": [
            "Zero Trust",
            "安全网关"
          ]
        },
        {
          "url": "https://letsencrypt.org/",
          "title": "Let's Encrypt 证书中心",
          "description": "免费、自动化且开放的数字证书认证机构，推动全球互联网迈入全 HTTPS 时代。",
          "category": "应用与密钥安全",
          "subCategory": "免费证书",
          "tags": [
            "SSL证书",
            "HTTPS"
          ]
        },
        {
          "url": "https://certbot.eff.org/",
          "title": "Certbot (EFF)",
          "description": "电子前哨基金会维护的 Let's Encrypt 证书自动申请与部署的经典命令行工具。",
          "category": "应用与密钥安全",
          "subCategory": "证书自动化",
          "tags": [
            "Certbot",
            "证书续期"
          ]
        },
        {
          "url": "https://github.com/acmesh-official/acme.sh",
          "title": "acme.sh 纯 Shell 证书客户端",
          "description": "纯 Shell 脚本编写的极简 ACME 客户端，支持自动 DNS 验证与自动证书安装更新。",
          "category": "应用与密钥安全",
          "subCategory": "DNS验证",
          "tags": [
            "acme.sh",
            "证书神器"
          ]
        },
        {
          "url": "https://www.wireguard.com/",
          "title": "WireGuard 协议官方",
          "description": "现代、极速、极简且具备最先进密码学加密的下一代网络隧道 VPN 协议标准。",
          "category": "应用与密钥安全",
          "subCategory": "现代VPN",
          "tags": [
            "WireGuard",
            "先进加密"
          ]
        },
        {
          "url": "https://openvpn.net/",
          "title": "OpenVPN 官方门户",
          "description": "久经考验、兼容性极高的开源虚拟专用网络解决方案，支持丰富路由配置。",
          "category": "应用与密钥安全",
          "subCategory": "经典VPN",
          "tags": [
            "OpenVPN",
            "高度兼容"
          ]
        },
        {
          "url": "https://www.yubico.com/",
          "title": "YubiKey 硬件安全密钥",
          "description": "行业标杆级物理安全密钥，提供防钓鱼的 FIDO2 / WebAuthn 硬件多重认证保护。",
          "category": "应用与密钥安全",
          "subCategory": "硬件安全密钥",
          "tags": [
            "YubiKey",
            "FIDO2"
          ]
        },
        {
          "url": "https://github.com/dani-garcia/vaultwarden/wiki",
          "title": "Vaultwarden 安全配置指南",
          "description": "全面讲解如何配置自建密码库的 HTTPS 强证书、两步验证与环境安全加固。",
          "category": "应用与密钥安全",
          "subCategory": "加固指南",
          "tags": [
            "密码加固",
            "安全指南"
          ]
        },
        {
          "url": "https://gnupg.org/",
          "title": "GnuPG (GPG)",
          "description": "遵循 OpenPGP 标准的完全免费数据通信与文件签名加密实现工具。",
          "category": "应用与密钥安全",
          "subCategory": "文件加密",
          "tags": [
            "GPG",
            "数字签名"
          ]
        },
        {
          "url": "https://age-encryption.org/",
          "title": "age 现代加密工具",
          "description": "简单、现代化且高度安全的命令行文件加密工具，告别庞大晦涩的 GPG 配置。",
          "category": "应用与密钥安全",
          "subCategory": "现代加密",
          "tags": [
            "age",
            "极简加密"
          ]
        }
      ]
    }
  }
};
