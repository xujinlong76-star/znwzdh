# 自动巡检原始数据汇总

## 全站可达性/性能普查：undefined/undefined 路由 200，失败 0
带错误路由：/404-probe-not-exist, /category/bi-and-reporting, /category/bi-and-reporting?p=2, /category/k12-and-enrollment, /category/k12-and-enrollment?p=2, /admin/plugin-health

| 路由 | wall | TTFB | LCP | CLS | 长任务ms | DOM | HTML KB | JS KB | btn | link | 字段 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| / | 3642 | 81 | 3328 | 0.1032 | 644 | 15702 | 3438 | 556 | 2145 | 476 | 2 |
| /sites | 1976 | 19 | 260 | 0 | 0 | 591 | 153 | 11 | 0 | 86 | 0 |
| /category | 2013 | 63 | 228 | 0 | 0 | 402 | 88 | 47 | 0 | 54 | 0 |
| /tags | 2454 | 39 | 736 | 0 | 312 | 8581 | 1120 | 0 | 0 | 375 | 1 |
| /collections | 1908 | 10 | 152 | 0 | 0 | 325 | 65 | 0 | 0 | 23 | 0 |
| /hot | 2108 | 27 | 332 | 0 | 178 | 873 | 198 | 0 | 33 | 77 | 1 |
| /videos | 2400 | 81 | 1116 | 0 | 173 | 382 | 84 | 174 | 11 | 18 | 1 |
| /graph | 1870 | 9 | 172 | 0 | 0 | 377 | 79 | 0 | 35 | 3 | 1 |
| /algorithms | 1887 | 10 | 264 | 0 | 128 | 425 | 81 | 0 | 20 | 16 | 1 |
| /marketplace | 2705 | 236 | 656 | 0 | 50 | 5358 | 800 | 132 | 248 | 190 | 3 |
| /custom | 1916 | 11 | 132 | 0.0004 | 0 | 515 | 85 | 54 | 23 | 24 | 2 |
| /preferences | 1988 | 58 | 244 | 0.0529 | 0 | 299 | 58 | 133 | 2 | 30 | 2 |
| /submit | 2144 | 155 | 276 | 0 | 0 | 246 | 515 | 18 | 2 | 16 | 5 |
| /import | 1887 | 9 | 112 | 0 | 0 | 203 | 48 | 0 | 0 | 16 | 1 |
| /me | 2086 | 30 | 528 | 0 | 0 | 679 | 105 | 23 | 5 | 51 | 0 |
| /favorites | 2023 | 9 | 200 | 0.0334 | 0 | 257 | 61 | 0 | 5 | 31 | 0 |
| /offline | 1932 | 45 | 184 | 0 | 0 | 151 | 45 | 6 | 0 | 3 | 0 |
| /auth/signin | 1939 | 10 | 380 | 0 | 0 | 187 | 47 | 17 | 4 | 4 | 2 |
| /404-probe-not-exist | 1918 | 37 | 408 | 0 | 0 | 190 | 48 | 0 | 0 | 7 | 1 |
| /site/0035b857-030f-46f9-b074-c0502fbc2497 | 2006 | 18 | 144 | 0 | 0 | 346 | 68 | 27 | 2 | 33 | 0 |
| /site/00901f83-1a59-4015-85c2-d77e0d6861df | 1978 | 25 | 116 | 0 | 0 | 356 | 71 | 0 | 2 | 36 | 0 |
| /site/011c975b-9306-4090-85ae-6c11b875776a | 1923 | 10 | 108 | 0 | 0 | 356 | 70 | 0 | 2 | 37 | 0 |
| /category/ai-tools | 1989 | 28 | 192 | 0 | 0 | 625 | 150 | 0 | 0 | 96 | 1 |
| /category/ai-tools?p=2 | 1998 | 14 | 188 | 0 | 0 | 625 | 150 | 0 | 0 | 96 | 1 |
| /category/bi-and-reporting | 2161 | 97 | 504 | 0 | 79 | 195 | 46 | 0 | 0 | 7 | 1 |
| /category/bi-and-reporting?p=2 | 2002 | 8 | 376 | 0 | 94 | 195 | 46 | 0 | 0 | 7 | 1 |
| /category/k12-and-enrollment | 2127 | 84 | 488 | 0 | 98 | 195 | 46 | 0 | 0 | 7 | 1 |
| /category/k12-and-enrollment?p=2 | 2740 | 20 | 688 | 0 | 331 | 195 | 46 | 0 | 0 | 7 | 1 |
| /tags/%E5%BC%80%E6%BA%90 | 2187 | 32 | 336 | 0 | 0 | 1508 | 356 | 30 | 100 | 219 | 1 |
| /tags/%E5%9B%BD%E4%BA%A7 | 2024 | 24 | 256 | 0 | 79 | 648 | 155 | 0 | 34 | 86 | 1 |
| /collections/agentic-ai | 1975 | 30 | 172 | 0 | 0 | 340 | 79 | 30 | 6 | 36 | 1 |
| /collections/ai-coding | 1925 | 29 | 136 | 0 | 0 | 280 | 68 | 0 | 3 | 27 | 1 |
| /marketplace/ai-agentic-coding | 2804 | 272 | 920 | 0 | 55 | 2174 | 285 | 56 | 15 | 228 | 0 |
| /marketplace/ai-tools-arsenal | 2549 | 163 | 624 | 0.0136 | 50 | 2222 | 289 | 0 | 15 | 233 | 0 |
| /marketplace/seed-dev-efficiency | 2324 | 140 | 504 | 0.0136 | 114 | 2258 | 292 | 0 | 15 | 237 | 0 |
| /me/account | 2041 | 56 | 256 | 0.0472 | 0 | 311 | 65 | 0 | 6 | 28 | 2 |
| /me/data | 1917 | 10 | 292 | 0.1746 | 0 | 342 | 72 | 5 | 9 | 28 | 2 |
| /me/history | 1886 | 8 | 116 | 0.0205 | 0 | 252 | 62 | 0 | 8 | 29 | 1 |
| /me/notifications | 1895 | 6 | 116 | 0.0148 | 0 | 208 | 53 | 0 | 0 | 27 | 0 |
| /me/plugins | 1900 | 10 | 120 | 0.0024 | 0 | 280 | 62 | 0 | 0 | 34 | 0 |
| /me/settings | 1903 | 10 | 352 | 0.0223 | 0 | 288 | 62 | 0 | 6 | 27 | 4 |
| /me/vault | 1973 | 23 | 144 | 0.0361 | 0 | 263 | 60 | 0 | 1 | 33 | 0 |
| /me/workspaces | 1902 | 11 | 124 | 0.0338 | 0 | 353 | 69 | 0 | 9 | 27 | 3 |
| /marketplace/installed | 2010 | 8 | 132 | 0.0521 | 0 | 228 | 50 | 0 | 12 | 4 | 0 |
| /marketplace/mine | 1876 | 6 | 92 | 0.0052 | 0 | 199 | 45 | 0 | 0 | 18 | 0 |
| /marketplace/publish | 1915 | 13 | 152 | 0 | 0 | 282 | 54 | 6 | 9 | 16 | 8 |
| /marketplace/import | 1897 | 10 | 108 | 0 | 0 | 204 | 45 | 0 | 2 | 16 | 4 |
| /admin | 2301 | 83 | 668 | 0.0018 | 264 | 1400 | 175 | 46 | 25 | 30 | 0 |
| /admin/ai | 2121 | 74 | 888 | 0.0065 | 0 | 460 | 80 | 22 | 12 | 17 | 13 |
| /admin/audit | 2102 | 71 | 212 | 0.0172 | 52 | 996 | 130 | 10 | 56 | 17 | 2 |
| /admin/categories | 1997 | 62 | 180 | 0.0186 | 63 | 5308 | 756 | 12 | 1412 | 17 | 3 |
| /admin/collections | 2116 | 56 | 424 | 0 | 0 | 358 | 69 | 12 | 13 | 17 | 3 |
| /admin/facets | 1935 | 45 | 124 | 0 | 0 | 366 | 71 | 10 | 15 | 18 | 1 |
| /admin/jobs | 2084 | 74 | 268 | 0.0127 | 75 | 2007 | 202 | 15 | 17 | 17 | 0 |
| /admin/navigation | 2048 | 107 | 780 | 0.0084 | 64 | 1038 | 176 | 48 | 138 | 17 | 1 |
| /admin/plugin-health | 2894 | 335 | 1064 | 0.038 | 70 | 1485 | 194 | 26 | 121 | 21 | 3 |
| /admin/plugins | 2220 | 130 | 380 | 0.0287 | 81 | 593 | 88 | 37 | 16 | 38 | 0 |
| /admin/resources | 3379 | 198 | 1112 | 0 | 80 | 945 | 153 | 53 | 69 | 48 | 1 |
| /admin/site | 2806 | 514 | 1064 | 0 | 0 | 343 | 71 | 19 | 9 | 17 | 3 |
| /admin/sitelist | 2036 | 87 | 224 | 0.6308 | 1105 | 28570 | 3756 | 30 | 3034 | 1025 | 1 |
| /admin/stats | 3175 | 85 | 1384 | 0.2133 | 0 | 798 | 112 | 13 | 10 | 41 | 0 |
| /admin/tags | 2439 | 76 | 340 | 0.0183 | 202 | 19276 | 2365 | 11 | 5252 | 18 | 1 |
| /admin/taxonomy | 2898 | 76 | 1508 | 0.0127 | 64 | 3254 | 405 | 14 | 218 | 17 | 102 |
| /admin/tokens | 2295 | 73 | 428 | 0.5384 | 0 | 1376 | 184 | 15 | 118 | 17 | 0 |
| /admin/trash | 2230 | 87 | 280 | 0 | 0 | 578 | 92 | 9 | 29 | 17 | 0 |
| /admin/videos | 2846 | 564 | 680 | 0 | 0 | 441 | 85 | 27 | 23 | 17 | 1 |
| /admin/data/restore | 2423 | 78 | 672 | 0 | 0 | 339 | 68 | 15 | 6 | 17 | 1 |

## 逐控件点击巡检
| 组 | 路由 | 点击控件 | 有响应 | 无响应 | 已激活空点 | 点不着(遮挡) | 慢>900ms | 链接校验 | 坏链 |
|---|---|---|---|---|---|---|---|---|---|
| public | / | 24 | 24 | 0 | 0 | 19 | 0 | 80 | 12 |
| public | /sites | 0 | 0 | 0 | 0 | 0 | 0 | 80 | 0 |
| public | /category | 7 | 7 | 0 | 0 | 0 | 0 | 50 | 0 |
| public | /tags | 0 | 0 | 0 | 0 | 0 | 0 | 80 | 1 |
| public | /collections | 0 | 0 | 0 | 0 | 0 | 0 | 20 | 0 |
| public | /hot | 23 | 22 | 0 | 1 | 0 | 0 | 74 | 10 |
| public | /videos | 11 | 7 | 4 | 0 | 1 | 0 | 15 | 0 |
| public | /graph | 23 | 18 | 5 | 0 | 16 | 2 | 1 | 0 |
| public | /algorithms | 15 | 14 | 0 | 1 | 3 | 0 | 14 | 0 |
| public | /marketplace | 22 | 19 | 3 | 0 | 1 | 16 | 80 | 0 |
| public | /custom | 18 | 12 | 6 | 0 | 2 | 9 | 25 | 1 |
| public | /preferences | 2 | 1 | 1 | 0 | 0 | 1 | 23 | 0 |
| public | /submit | 2 | 1 | 1 | 0 | 1 | 0 | 14 | 0 |
| public | /import | 0 | 0 | 0 | 0 | 0 | 0 | 14 | 0 |
| public | /me | 1 | 0 | 1 | 0 | 0 | 0 | 24 | 0 |
| public | /favorites | 15 | 13 | 2 | 0 | 2 | 11 | 43 | 6 |
| public | /offline | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| dyn | /site/0035b857-030f-46f9-b074-c0502fbc2497 | 2 | 2 | 0 | 0 | 0 | 0 | 29 | 2 |
| dyn | /site/00901f83-1a59-4015-85c2-d77e0d6861df | 2 | 2 | 0 | 0 | 0 | 0 | 30 | 0 |
| dyn | /site/011c975b-9306-4090-85ae-6c11b875776a | 2 | 2 | 0 | 0 | 0 | 0 | 31 | 3 |
| dyn | /category/ai-tools | 0 | 0 | 0 | 0 | 0 | 0 | 80 | 0 |
| dyn | /category/ai-tools?p=2 | 0 | 0 | 0 | 0 | 0 | 0 | 80 | 0 |
| dyn | /category/bi-and-reporting | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 |
| dyn | /category/bi-and-reporting?p=2 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 |
| dyn | /category/k12-and-enrollment | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 |
| dyn | /category/k12-and-enrollment?p=2 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 |
| dyn | /tags/%E5%BC%80%E6%BA%90 | 19 | 19 | 0 | 0 | 0 | 0 | 80 | 5 |
| dyn | /tags/%E5%9B%BD%E4%BA%A7 | 19 | 19 | 0 | 0 | 0 | 0 | 80 | 2 |
| dyn | /collections/agentic-ai | 6 | 6 | 0 | 0 | 0 | 0 | 26 | 1 |
| dyn | /collections/ai-coding | 3 | 3 | 0 | 0 | 0 | 0 | 20 | 0 |
| dyn | /marketplace/ai-agentic-coding | 16 | 15 | 0 | 1 | 0 | 1 | 80 | 13 |
| dyn | /marketplace/ai-tools-arsenal | 16 | 15 | 0 | 1 | 0 | 1 | 80 | 16 |
| dyn | /marketplace/seed-dev-efficiency | 16 | 15 | 0 | 1 | 0 | 1 | 80 | 16 |
| authed | /me | 5 | 5 | 0 | 0 | 4 | 0 | 24 | 0 |
| authed | /me/account | 3 | 3 | 0 | 0 | 0 | 0 | 23 | 0 |
| authed | /me/data | 4 | 3 | 1 | 0 | 0 | 0 | 24 | 0 |
| authed | /me/history | 6 | 5 | 0 | 1 | 4 | 0 | 24 | 0 |
| authed | /me/notifications | 0 | 0 | 0 | 0 | 0 | 0 | 23 | 0 |
| authed | /me/plugins | 0 | 0 | 0 | 0 | 0 | 0 | 25 | 0 |
| authed | /me/settings | 2 | 2 | 0 | 0 | 0 | 0 | 23 | 0 |
| authed | /me/vault | 0 | 0 | 0 | 0 | 0 | 0 | 23 | 0 |
| authed | /me/workspaces | 4 | 3 | 1 | 0 | 0 | 0 | 23 | 0 |
| authed | /favorites | 2 | 2 | 0 | 0 | 0 | 0 | 24 | 0 |
| authed | /marketplace/installed | 12 | 5 | 7 | 0 | 0 | 5 | 1 | 0 |
| authed | /marketplace/mine | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 |
| authed | /marketplace/publish | 7 | 6 | 1 | 0 | 1 | 4 | 14 | 0 |
| authed | /marketplace/import | 2 | 1 | 1 | 0 | 0 | 0 | 14 | 0 |
| admin | /admin | 24 | 9 | 15 | 0 | 0 | 1 | 21 | 0 |
| admin | /admin/ai | 13 | 9 | 4 | 0 | 6 | 0 | 15 | 0 |
| admin | /admin/audit | 23 | 20 | 3 | 0 | 0 | 0 | 15 | 0 |
| admin | /admin/categories | 12 | 7 | 5 | 0 | 5 | 0 | 15 | 0 |
| admin | /admin/collections | 12 | 8 | 4 | 0 | 6 | 1 | 15 | 0 |
| admin | /admin/facets | 15 | 10 | 5 | 0 | 4 | 0 | 15 | 0 |
| admin | /admin/jobs | 15 | 3 | 12 | 0 | 0 | 0 | 15 | 0 |
| admin | /admin/navigation | 24 | 4 | 20 | 0 | 18 | 0 | 15 | 0 |
| admin | /admin/plugin-health | 19 | 12 | 7 | 0 | 5 | 0 | 16 | 0 |
| admin | /admin/plugins | 14 | 8 | 6 | 0 | 0 | 1 | 34 | 0 |
| admin | /admin/resources | 8 | 5 | 3 | 0 | 0 | 0 | 46 | 0 |
| admin | /admin/site | 9 | 5 | 3 | 1 | 1 | 0 | 15 | 0 |
| admin | /admin/sitelist | 23 | 20 | 3 | 0 | 17 | 3 | 80 | 17 |
| admin | /admin/stats | 10 | 6 | 4 | 0 | 0 | 0 | 40 | 0 |
| admin | /admin/tags | 16 | 11 | 5 | 0 | 4 | 1 | 15 | 0 |
| admin | /admin/taxonomy | 22 | 16 | 6 | 0 | 5 | 0 | 15 | 0 |
| admin | /admin/tokens | 8 | 4 | 4 | 0 | 0 | 0 | 15 | 0 |
| admin | /admin/trash | 6 | 3 | 3 | 0 | 0 | 0 | 15 | 0 |
| admin | /admin/videos | 10 | 7 | 3 | 0 | 2 | 0 | 15 | 0 |
| admin | /admin/data/restore | 5 | 2 | 3 | 0 | 0 | 0 | 15 | 0 |

### 无响应控件明细
- [public] /videos :: <button> 「精选视频」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /videos :: <button> 「七年级」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /videos :: <button> 「语文」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /videos :: <button> 「【唐伯虎点秋香】 4K 自购原碟修复 全网最清晰版本 国语中字周星驰 巩俐 陈百祥 郑佩佩 朱咪咪 」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /graph :: <button> 「全部」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /graph :: <button> 「UI & 设计」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /graph :: <button> 「AI 实验室」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /graph :: <button> 「放大」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /graph :: <button> 「缩小」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /marketplace :: <button> 「全部插件」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /marketplace :: <button> 「🔥 飙升榜」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /marketplace :: <button> 「搜索」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /custom :: <button> 「💻 全栈极客工作台(7)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /custom :: <button> 「赛博点阵画布」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /custom :: <button> 「时钟」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /custom :: <button> 「UUID」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /custom :: <button> 「编辑模式」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /custom :: <button> 「复制全文内容」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /preferences :: <input> 「占位:checkbox」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /submit :: <button> 「提交推荐收录」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /me :: <button> 「刷新」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /favorites :: <button> 「明文 JSON」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [public] /favorites :: <button> 「全部 20」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /me/data :: <button> 「从浏览器书签 HTML 导入（本机）」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /me/workspaces :: <button> 「个人私有空间个人空间 · 1 位成员您的专属私密导航空间，仅本人可见所有者」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/installed :: <button> 「检索开源项目、代码与 Issue (点击直达)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/installed :: <button> 「JavaScript / TypeScript 依赖包检索 (点击直达)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/installed :: <button> 「权威 Web 技术规范与 API 参考手册 (点击直达)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/installed :: <button> 「程序员技术问答与疑难方案直达 (点击直达)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/installed :: <button> 「全栈开发文档快速速查 (点击直达)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/installed :: <button> 「前端现代特性与浏览器兼容性查询 (点击直达)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/installed :: <button> 「全部 (0)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/publish :: <button> 「网址包 (site-pack)分类导航与站点链接合集，一键增量入库并去重。」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [authed] /marketplace/import :: <input> 「占位:checkbox」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「触发全站健康巡检」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「触发热度重排」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「立即同步仪表盘数据」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「请求吞吐」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「/api/admin/maintenance/vacuum - 复制路由路径」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「/api/admin/ai/config - 复制路由路径」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「/api/admin/plugins/metrics - 复制路由路径」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「/api/admin/plugins/funnel - 复制路由路径」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「/api/admin/plugins/seed-status - 复制路由路径」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「执行数据库完整性自检」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「执行 WAL 刷盘」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin :: <button> 「执行 FTS5 段合并」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/ai :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/ai :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/ai :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/ai :: <button> 「切换到模型配置」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/audit :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/audit :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/audit :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/categories :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/categories :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/categories :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/categories :: <button> 「导出 SKOS 概念」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/categories :: <button> 「刷新」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/collections :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/collections :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/collections :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/collections :: <button> 「刷新」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/facets :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/facets :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/facets :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/facets :: <button> 「刷新分布」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/facets :: <button> 「付费模式0」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「刷新」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「健康巡检基于 Weibull 寿命衰减模型，优先巡检老旧及高危失效站点」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「元数据刷新重新抓取站点标题、描述与图标，自动更新陈旧信息」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「热度重算按近 7 天点击次数 + 收藏次数 − 年龄衰减更新 TrendScore」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「死链自愈触发故障诊断，分析死链根因并基于图谱匹配健康替代品」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「凭据巡检扫描临期、过期与长期未使用的僵尸 API 凭据并落审计」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「分类治理巡检扫描未分类/重复/低置信度分类并给出治理建议（默认只读）」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「数据保留events/audit_logs 聚合与清理：默认 rollup 预演（不删），确认后再手」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/jobs :: <button> 「清理 7d 历史」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「AI 工具已启用大模型与 AI 产品矩阵」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「前端开发已启用框架、工程化与交互实现」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「后端与云已启用运行时、数据库与基础设施」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「运维与安全已启用发布、监控与防护」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「开发者资源已启用托管、文档、演练与速查」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「设计与创意已启用灵感、UI、字体与品牌」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「效率办公已启用文档协作、笔记与桌面工具」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「数据与分析已启用BI、埋点与可视化」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「学习成长已启用课程、考试、语言与技能」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「学术科研已启用文献、检索与学术出版」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「资讯媒体已启用权威媒体、垂类资讯与核查」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「内容创作已启用自媒体、排版与音视频制作」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「职业招聘已启用招聘、简历、面试与劳动权益」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「金融财经已启用银行、证券、基金与个人财务」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「影音娱乐已启用长短视频、音乐、播客与演出」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「游戏电竞已启用游戏、赛事、攻略与开发」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/navigation :: <div role=button> 「消费生活已启用购物、美食、出行、运动与家庭」 via=dom-fallback delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugin-health :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugin-health :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugin-health :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugin-health :: <button> 「同步快照」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugin-health :: <button> 「导出 JSON」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugin-health :: <button> 「导出 Markdown」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugin-health :: <button> 「全部 (35)」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugins :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugins :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugins :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugins :: <button> 「待审核」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugins :: <button> 「展示中」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/plugins :: <button> 「刷新」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/resources :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/resources :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/resources :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/site :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/site :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/site :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/sitelist :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/sitelist :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/sitelist :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/stats :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/stats :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/stats :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/stats :: <button> 「刷新」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tags :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tags :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tags :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tags :: <button> 「刷新」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tags :: <button> 「全部」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/taxonomy :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/taxonomy :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/taxonomy :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/taxonomy :: <button> 「刷新」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/taxonomy :: <button> 「待审核」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/taxonomy :: <button> 「全部类型」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tokens :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tokens :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tokens :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/tokens :: <button> 「轮换明文（旧明文立即失效）」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/trash :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/trash :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/trash :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/videos :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/videos :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/videos :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/data/restore :: <button> 「导航管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/data/restore :: <button> 「插件市场」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}
- [admin] /admin/data/restore :: <button> 「资源管理」 via=locator delta={"urlChanged":false,"dialog":false,"menu":false,"toast":false,"bodyChanged":false,"checkedChanged":false,"tabChanged":false,"resultsChanged":false,"themeChanged":false,"detailsChanged":false}

### 点不着（被遮挡/动画不稳，需 DOM 兜底才点得到）
- [public] / :: <button> 「对话助手」
- [public] / :: <button> 「AI 编程助手」
- [public] / :: <button> 「AI 图像生成」
- [public] / :: <button> 「AI 视频生成」
- [public] / :: <button> 「AI 音频语音」
- [public] / :: <button> 「AI 写作办公」
- [public] / :: <button> 「AI 搜索知识」
- [public] / :: <button> 「智能体与自动化」
- [public] / :: <button> 「向量库与 RAG」
- [public] / :: <button> 「模型训练与微调」
- [public] / :: <button> 「模型与数据集」
- [public] / :: <button> 「AI 硬件与具身」
- [public] / :: <button> 「AI 安全与对齐」
- [public] / :: <button> 「AI 评测与学习」
- [public] / :: <button> 「核心框架」
- [public] / :: <button> 「构建与工程化」
- [public] / :: <button> 「CSS 与样式」
- [public] / :: <button> 「组件与 UI 体系」
- [public] / :: <button> 「状态与数据流」
- [public] /videos :: <button> 「语文」
- [public] /graph :: <g> 「Cursor（AI 实验室）」
- [public] /graph :: <g> 「GitHub Copilot（AI 实验室）」
- [public] /graph :: <g> 「Continue.dev（AI 实验室）」
- [public] /graph :: <g> 「Claude（AI 实验室）」
- [public] /graph :: <g> 「DeepSeek（AI 实验室）」
- [public] /graph :: <g> 「Ollama（AI 实验室）」
- [public] /graph :: <g> 「vLLM（AI 实验室）」
- [public] /graph :: <g> 「GitHub（研发全栈）」
- [public] /graph :: <g> 「GitLab（研发全栈）」
- [public] /graph :: <g> 「Vercel（研发全栈）」
- [public] /graph :: <g> 「Coolify（研发全栈）」
- [public] /graph :: <g> 「Zeabur（研发全栈）」
- [public] /graph :: <g> 「Docker Hub（研发全栈）」
- [public] /graph :: <g> 「npm（研发全栈）」
- [public] /graph :: <g> 「Next.js（研发全栈）」
- [public] /graph :: <g> 「Figma（UI & 设计）」
- [public] /algorithms :: <button> 「中文长句」
- [public] /algorithms :: <button> 「纯英文/拼音」
- [public] /algorithms :: <button> 「+ 点击强化」
- [public] /marketplace :: <button> 「#开发工具」
- [public] /custom :: <button> 「重新生成」
- [public] /custom :: <button> 「复制 UUID」
- [public] /submit :: <button> 「提交推荐收录」
- [public] /favorites :: <button> 「取消收藏：Flutter」
- [public] /favorites :: <button> 「取消收藏：jq」
- [authed] /me :: <button> 「已开启 · 点击关闭」
- [authed] /me :: <button> 「清理点击信号」
- [authed] /me :: <button> 「清理搜索信号」
- [authed] /me :: <button> 「清理收藏信号」
- [authed] /me/history :: <button> 「全部 (1)」
- [authed] /me/history :: <button> 「有命中 (1)」
- [authed] /me/history :: <button> 「零结果 (0)」
- [authed] /me/history :: <button> 「复制搜索词 react vs vue」
- [authed] /marketplace/publish :: <button> 「检测清单中站点的可达性与是否存在死链」
- [admin] /admin/ai :: <input> 「占位:checkbox」
- [admin] /admin/ai :: <button> 「添加备用模型」
- [admin] /admin/ai :: <button> 「保存」
- [admin] /admin/ai :: <button> 「测试连接」
- [admin] /admin/ai :: <button> 「清除已存密钥」
- [admin] /admin/ai :: <button> 「恢复环境变量默认」
- [admin] /admin/categories :: <button> 「语义配置」
- [admin] /admin/categories :: <button> 「重命名」
- [admin] /admin/categories :: <button> 「移动」
- [admin] /admin/categories :: <button> 「合并」
- [admin] /admin/categories :: <button> 「停用」
- [admin] /admin/collections :: <button> 「2026 前沿 Agentic AI 生产力矩阵agentic-ai · 主题启用」
- [admin] /admin/collections :: <button> 「AI 编程工具链ai-coding · 主题启用」
- [admin] /admin/collections :: <button> 「前端入门路线frontend-starter · 路线图启用」
- [admin] /admin/collections :: <button> 「设计速查工具箱design-toolkit · 主题启用」
- [admin] /admin/collections :: <button> 「开源替代open-source-alternatives · 主题启用」
- [admin] /admin/collections :: <button> 「编辑精选editors-picks · 主题启用」
- [admin] /admin/facets :: <button> 「完全免费free0100% Free」
- [admin] /admin/facets :: <button> 「免费增值freemium0Freemium」
- [admin] /admin/facets :: <button> 「商业付费paid0Paid / Commercial」
- [admin] /admin/facets :: <button> 「开源免费open_source0Open Source」
- [admin] /admin/navigation :: <button> 「添加分类」
- [admin] /admin/navigation :: <div> 「AI 工具已启用大模型与 AI 产品矩阵」
- [admin] /admin/navigation :: <div> 「前端开发已启用框架、工程化与交互实现」
- [admin] /admin/navigation :: <div> 「后端与云已启用运行时、数据库与基础设施」
- [admin] /admin/navigation :: <div> 「运维与安全已启用发布、监控与防护」
- [admin] /admin/navigation :: <div> 「开发者资源已启用托管、文档、演练与速查」
- [admin] /admin/navigation :: <div> 「设计与创意已启用灵感、UI、字体与品牌」
- [admin] /admin/navigation :: <div> 「效率办公已启用文档协作、笔记与桌面工具」
- [admin] /admin/navigation :: <div> 「数据与分析已启用BI、埋点与可视化」
- [admin] /admin/navigation :: <div> 「学习成长已启用课程、考试、语言与技能」
- [admin] /admin/navigation :: <div> 「学术科研已启用文献、检索与学术出版」
- [admin] /admin/navigation :: <div> 「资讯媒体已启用权威媒体、垂类资讯与核查」
- [admin] /admin/navigation :: <div> 「内容创作已启用自媒体、排版与音视频制作」
- [admin] /admin/navigation :: <div> 「职业招聘已启用招聘、简历、面试与劳动权益」
- [admin] /admin/navigation :: <div> 「金融财经已启用银行、证券、基金与个人财务」
- [admin] /admin/navigation :: <div> 「影音娱乐已启用长短视频、音乐、播客与演出」
- [admin] /admin/navigation :: <div> 「游戏电竞已启用游戏、赛事、攻略与开发」
- [admin] /admin/navigation :: <div> 「消费生活已启用购物、美食、出行、运动与家庭」
- [admin] /admin/plugin-health :: <button> 「仅全量体检 (35 个包)」
- [admin] /admin/plugin-health :: <button> 「仅体检异常/未测 (35 个包)」
- [admin] /admin/plugin-health :: <button> 「选中此包」
- [admin] /admin/plugin-health :: <button> 「抽样体检」
- [admin] /admin/plugin-health :: <button> 「详情」
- [admin] /admin/site :: <button> 「保存更改」
- [admin] /admin/sitelist :: <button> 「按子分类筛选」
- [admin] /admin/sitelist :: <button> 「将系统站点全量打包导出为插件市场规范的清单文件（.json）」
- [admin] /admin/sitelist :: <button> 「添加站点」
- [admin] /admin/sitelist :: <button> 「Select all」
- [admin] /admin/sitelist :: <button> 「Select Grok」
- [admin] /admin/sitelist :: <button> 「编辑」
- [admin] /admin/sitelist :: <button> 「Select DeepSeek」
- [admin] /admin/sitelist :: <button> 「Select ChatGPT」
- [admin] /admin/sitelist :: <button> 「Select 豆包」
- [admin] /admin/sitelist :: <button> 「Select HuggingChat」
- [admin] /admin/sitelist :: <button> 「Select Poe」
- [admin] /admin/sitelist :: <button> 「Select 通义千问」
- [admin] /admin/sitelist :: <button> 「Select 文心一言」
- [admin] /admin/sitelist :: <button> 「Select 腾讯元宝」
- [admin] /admin/sitelist :: <button> 「Select Le Chat (Mistral)」
- [admin] /admin/sitelist :: <button> 「Select 讯飞星火」
- [admin] /admin/sitelist :: <button> 「Select Google Gemini」
- [admin] /admin/tags :: <button> 「添加概念别名」
- [admin] /admin/tags :: <button> 「属性」
- [admin] /admin/tags :: <button> 「更名」
- [admin] /admin/tags :: <button> 「合并」
- [admin] /admin/taxonomy :: <input> 「Select all visible proposals」
- [admin] /admin/taxonomy :: <input> 「Select proposal leaf_too_small_reg-academic-commun」
- [admin] /admin/taxonomy :: <button> 「记录决议」
- [admin] /admin/taxonomy :: <input> 「Select proposal leaf_too_small_reg-academic-confer」
- [admin] /admin/taxonomy :: <input> 「Select proposal leaf_too_small_reg-agriculture-and」
- [admin] /admin/videos :: <button> 「添加分类」
- [admin] /admin/videos :: <button> 「分类管理」

### 坏链接
- [public] / :: 403 https://x.ai/ 
- [public] / :: 0 https://chatgpt.com apiRequestContext.get: Client network socket disconnected before secure TLS connection was established (ECONNRESET)
Call
- [public] / :: 0 https://www.continue.dev/ apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://www.continue.dev/[22m
[2m    - user
- [public] / :: 403 https://ideogram.ai/ 
- [public] / :: 403 https://www.midjourney.com/ 
- [public] / :: 0 https://www.fakeyou.com/ apiRequestContext.get: Client network socket disconnected before secure TLS connection was established (ECONNRESET)
Call
- [public] / :: 0 https://www.copy.ai/ apiRequestContext.get: Client network socket disconnected before secure TLS connection was established (ECONNRESET)
Call
- [public] / :: 0 https://www.topazlabs.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.topazlabs.com/[22m
[2m    - user-
- [public] / :: 0 https://github.com/hiyouga/LLaMA-Factory apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://github.com/hiyouga/LLaMA-Factory[22m
- [public] / :: 0 https://quillbot.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://quillbot.com/[22m
[2m    - user-agent
- [public] / :: 0 https://www.labelbox.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.labelbox.com/[22m
[2m    - user-a
- [public] / :: 0 https://ollama.com apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://ollama.com/[22m
[2m    - user-agent: 
- [public] /tags :: 0 /tags/%E4%B8%AD%E6%96%87 apiRequestContext.get: read ECONNRESET
Call log:
[2m  - → GET http://127.0.0.1:3400/tags/%E4%B8%AD%E6%96%87[22m
[2m  
- [public] /hot :: 403 https://x.ai/ 
- [public] /hot :: 403 https://codepen.io/ 
- [public] /hot :: 403 https://www.ccleaner.com/ 
- [public] /hot :: 0 https://crowdin.com/ apiRequestContext.get: aborted (ECONNRESET)
Call log:
[2m  - → GET https://crowdin.com/[22m
[2m    - user-agent: Mozi
- [public] /hot :: 0 https://mobx.js.org/ apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://mobx.js.org/[22m
[2m    - user-agen
- [public] /hot :: 403 https://jsbin.com/ 
- [public] /hot :: 0 https://github.com/rakyll/hey apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://github.com/rakyll/hey[22m
[2m    - us
- [public] /hot :: 0 https://www.techsmith.com/video-editor.html apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://www.techsmith.com/video-editor.html[
- [public] /hot :: 0 https://uberduck.ai/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://uberduck.ai/[22m
[2m    - user-agent:
- [public] /hot :: 0 https://learn.microsoft.com/zh-cn/sysinternals/downloads/process-explorer apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://learn.microsoft.com/zh-cn/sysinternals/
- [public] /custom :: 0 https://pixpinapp.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://pixpinapp.com/[22m
[2m    - user-agen
- [public] /favorites :: 403 https://www.ccleaner.com/ 
- [public] /favorites :: 403 https://x.ai/ 
- [public] /favorites :: 403 https://codepen.io/ 
- [public] /favorites :: 0 https://angular.io/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://angular.io/[22m
[2m    - user-agent: 
- [public] /favorites :: 0 https://jqlang.github.io/jq/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://jqlang.github.io/jq/[22m
[2m    - use
- [public] /favorites :: 0 https://www.ruanyifeng.com/blog/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.ruanyifeng.com/blog/[22m
[2m    -
- [dyn] /site/0035b857-030f-46f9-b074-c0502fbc2497 :: 0 https://gatling.io/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://gatling.io/[22m
[2m    - user-agent: 
- [dyn] /site/0035b857-030f-46f9-b074-c0502fbc2497 :: 0 https://www.artillery.io/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.artillery.io/[22m
[2m    - user-a
- [dyn] /site/011c975b-9306-4090-85ae-6c11b875776a :: 403 https://www.adobe.com/cn/acrobat/online.html 
- [dyn] /site/011c975b-9306-4090-85ae-6c11b875776a :: 403 https://www.adobe.com/cn/acrobat.html 
- [dyn] /site/011c975b-9306-4090-85ae-6c11b875776a :: 0 https://smallpdf.com/cn/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://smallpdf.com/cn/[22m
[2m    - user-ag
- [dyn] /tags/%E5%BC%80%E6%BA%90 :: 400 https://ai.meta.com/ 
- [dyn] /tags/%E5%BC%80%E6%BA%90 :: 0 https://stability.ai/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://stability.ai/[22m
[2m    - user-agent
- [dyn] /tags/%E5%BC%80%E6%BA%90 :: 0 https://fastgpt.in/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://fastgpt.in/[22m
[2m    - user-agent: 
- [dyn] /tags/%E5%BC%80%E6%BA%90 :: 0 https://baserow.io/ apiRequestContext.get: aborted
Call log:
[2m  - → GET https://baserow.io/[22m
[2m    - user-agent: Mozilla/5.0 (Windo
- [dyn] /tags/%E5%BC%80%E6%BA%90 :: 0 https://www.appsmith.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.appsmith.com/[22m
[2m    - user-a
- [dyn] /tags/%E5%9B%BD%E4%BA%A7 :: 405 https://www.gaoding.com/ 
- [dyn] /tags/%E5%9B%BD%E4%BA%A7 :: 0 https://www.speedtest.cn/ apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://www.speedtest.cn/[22m
[2m    - user
- [dyn] /collections/agentic-ai :: 0 https://github.com/langchain-ai/langgraph apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://github.com/langchain-ai/langgraph[22m

- [dyn] /marketplace/ai-agentic-coding :: 0 https://v0.dev/ apiRequestContext.get: aborted (ECONNRESET)
Call log:
[2m  - → GET https://v0.dev/[22m
[2m    - user-agent: Mozilla/5
- [dyn] /marketplace/ai-agentic-coding :: 0 https://tasking.ai/ apiRequestContext.get: write EPROTO 74AD0000:error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:c:\w
- [dyn] /marketplace/ai-agentic-coding :: 403 https://milvus.io/ 
- [dyn] /marketplace/ai-agentic-coding :: 0 https://lancedb.com/ apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://lancedb.com/[22m
[2m    - user-agen
- [dyn] /marketplace/ai-agentic-coding :: 0 https://windsurf.ai/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://windsurf.ai/[22m
[2m    - user-agent:
- [dyn] /marketplace/ai-agentic-coding :: 403 https://unsloth.ai/ 
- [dyn] /marketplace/ai-agentic-coding :: 403 https://civitai.com/ 
- [dyn] /marketplace/ai-agentic-coding :: 403 https://chat.lmsys.org/ 
- [dyn] /marketplace/ai-agentic-coding :: 0 https://www.ray.io/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.ray.io/[22m
[2m    - user-agent: 
- [dyn] /marketplace/ai-agentic-coding :: 0 https://www.phind.com/ apiRequestContext.get: Client network socket disconnected before secure TLS connection was established (ECONNRESET)
Call
- [dyn] /marketplace/ai-agentic-coding :: 0 https://crfm.stanford.edu/helm/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://crfm.stanford.edu/helm/[22m
[2m    - 
- [dyn] /marketplace/ai-agentic-coding :: 0 https://arxiv.org/list/cs.AI/recent apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://arxiv.org/list/cs.AI/recent[22m
[2m  
- [dyn] /marketplace/ai-agentic-coding :: 0 https://x.ai/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://x.ai/[22m
[2m    - user-agent: Mozill
- [dyn] /marketplace/ai-tools-arsenal :: 403 https://chat.mistral.ai/ 
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://gemini.google.com/ apiRequestContext.get: Parse Error: Header overflow
Call log:
[2m  - → GET https://gemini.google.com/[22m
[2m    - us
- [dyn] /marketplace/ai-tools-arsenal :: 403 https://poe.com/ 
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://x.ai/ apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://x.ai/[22m
[2m    - user-agent: Mozi
- [dyn] /marketplace/ai-tools-arsenal :: 403 https://civitai.com/ 
- [dyn] /marketplace/ai-tools-arsenal :: 403 https://www.midjourney.com/ 
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://www.tabnine.com/ apiRequestContext.get: Parse Error: Header overflow
Call log:
[2m  - → GET https://www.tabnine.com/[22m
[2m    - user
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://www.doubao.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.doubao.com/[22m
[2m    - user-age
- [dyn] /marketplace/ai-tools-arsenal :: 403 https://leonardo.ai/ 
- [dyn] /marketplace/ai-tools-arsenal :: 403 https://ideogram.ai/ 
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://play.ht/ apiRequestContext.get: write EPROTO 74AD0000:error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure
- [dyn] /marketplace/ai-tools-arsenal :: 403 https://quillbot.com/ 
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://elevenlabs.io/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://elevenlabs.io/[22m
[2m    - user-agen
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://qdrant.tech/ apiRequestContext.get: aborted (ECONNRESET)
Call log:
[2m  - → GET https://qdrant.tech/[22m
[2m    - user-agent: Mozi
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://www.resemble.ai/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.resemble.ai/[22m
[2m    - user-ag
- [dyn] /marketplace/ai-tools-arsenal :: 0 https://www.cnki.net/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.cnki.net/[22m
[2m    - user-agent
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://codeberg.org/ apiRequestContext.get: aborted (ECONNRESET)
Call log:
[2m  - → GET https://codeberg.org/[22m
[2m    - user-agent: Moz
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://www.gitkraken.com/ apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://www.gitkraken.com/[22m
[2m    - use
- [dyn] /marketplace/seed-dev-efficiency :: 403 https://stackoverflow.com/ 
- [dyn] /marketplace/seed-dev-efficiency :: 403 https://superuser.com/ 
- [dyn] /marketplace/seed-dev-efficiency :: 403 https://serverfault.com/ 
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://gitee.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://gitee.com/[22m
[2m    - user-agent: M
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://docs.docker.com/ apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://docs.docker.com/[22m
[2m    - user-
- [dyn] /marketplace/seed-dev-efficiency :: 403 https://replit.com/ 
- [dyn] /marketplace/seed-dev-efficiency :: 403 https://codepen.io/ 
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://codesandbox.io/ apiRequestContext.get: aborted (ECONNRESET)
Call log:
[2m  - → GET https://codesandbox.io/[22m
[2m    - user-agent: M
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://dev.to/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://dev.to/[22m
[2m    - user-agent: Mozi
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://spec.openapis.org/oas/latest.html apiRequestContext.get: aborted (ECONNRESET)
Call log:
[2m  - → GET https://spec.openapis.org/oas/latest.html[22m
[2m 
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://jsbin.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://jsbin.com/[22m
[2m    - user-agent: M
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://regex101.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://regex101.com/[22m
[2m    - user-agent
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://jwt.io/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://jwt.io/[22m
[2m    - user-agent: Mozi
- [dyn] /marketplace/seed-dev-efficiency :: 0 https://supabase.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://supabase.com/[22m
[2m    - user-agent
- [admin] /admin/sitelist :: 403 https://x.ai/ 
- [admin] /admin/sitelist :: 0 https://gemini.google.com/ apiRequestContext.get: Parse Error: Header overflow
Call log:
[2m  - → GET https://gemini.google.com/[22m
[2m    - us
- [admin] /admin/sitelist :: 403 https://chat.mistral.ai/ 
- [admin] /admin/sitelist :: 403 https://poe.com/ 
- [admin] /admin/sitelist :: 0 https://yuanbao.tencent.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://yuanbao.tencent.com/[22m
[2m    - use
- [admin] /admin/sitelist :: 0 https://www.recraft.ai/ apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
[2m  - → GET https://www.recraft.ai/[22m
[2m    - user-a
- [admin] /admin/sitelist :: 403 https://ideogram.ai/ 
- [admin] /admin/sitelist :: 0 https://lingma.aliyun.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://lingma.aliyun.com/[22m
[2m    - user-
- [admin] /admin/sitelist :: 403 https://midjourney.com 
- [admin] /admin/sitelist :: 0 https://www.tabnine.com/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.tabnine.com/[22m
[2m    - user-ag
- [admin] /admin/sitelist :: 403 https://leonardo.ai/ 
- [admin] /admin/sitelist :: 403 https://www.midjourney.com/ 
- [admin] /admin/sitelist :: 0 https://windsurf.ai apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://windsurf.ai/[22m
[2m    - user-agent:
- [admin] /admin/sitelist :: 0 https://firefly.adobe.com/ apiRequestContext.get: Client network socket disconnected before secure TLS connection was established (ECONNRESET)
Call
- [admin] /admin/sitelist :: 403 https://www.adobe.com/products/podcast.html 
- [admin] /admin/sitelist :: 0 https://play.ht/ apiRequestContext.get: write EPROTO 18830000:error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure
- [admin] /admin/sitelist :: 0 https://www.voicemod.net/ apiRequestContext.get: Timeout 10000ms exceeded.
Call log:
[2m  - → GET https://www.voicemod.net/[22m
[2m    - user-a

### 跳过的危险控件（改数据类，未点）
- [public] /graph :: 重置视图
- [public] /algorithms :: 重置收益矩阵
- [authed] /me/data :: 永久删除
- [authed] /me/history :: 清空全部 | 删除历史 react vs vue
- [authed] /me/vault :: 删除云端金库
- [authed] /me/workspaces :: 移除成员 Admin (系统管理员) | 移除成员 TechLead (架构组) | 移除成员 ProductOps (产品运维) | 移除成员 FrontendDev (前端研发) | 移除成员 SecurityAuditor (安全审计员)
- [admin] /admin/categories :: 删除
- [admin] /admin/jobs :: 检索重建全量重算 FTS5 CJK 二元分词与多音字拼音线索 | 清理回收站彻底物理抹除软删除超过 30 天的垃圾站点与相关向量 | 插件治理巡检扫描待审超 SLA、插件举报与评价举报，只写告警审计，不自动下架
- [admin] /admin/plugins :: 已驳回 | 已下架
- [admin] /admin/sitelist :: 删除
- [admin] /admin/tags :: 删除
- [admin] /admin/taxonomy :: 已驳回 | 驳回
- [admin] /admin/tokens :: 吊销（停用但保留记录） | 彻底删除（抹除全部记录）
- [admin] /admin/trash :: 彻底删除
- [admin] /admin/videos :: 删除分类

### 响应慢（>900ms，且是常规点击命中）
- [public] /graph :: 「研发全栈」 1708ms
- [public] /graph :: 「效率创作」 1399ms
- [public] /marketplace :: 「Taps 订阅源」 2754ms
- [public] /marketplace :: 「AI 生成插件」 1047ms
- [public] /marketplace :: 「🚀 极客全栈装备」 2442ms
- [public] /marketplace :: 「🔍 快捷直达引擎」 1123ms
- [public] /marketplace :: 「📊 生产力工作台」 1222ms
- [public] /marketplace :: 「🎨 赛博与暗黑美学」 970ms
- [public] /marketplace :: 「🧩 精选组合包」 1014ms
- [public] /marketplace :: 「#AI效率」 1099ms
- [public] /marketplace :: 「#设计灵感」 999ms
- [public] /marketplace :: 「#自托管」 929ms
- [public] /marketplace :: 「#极简生活」 1012ms
- [public] /marketplace :: 「#精选常用」 1056ms
- [public] /marketplace :: 「复制安装分享链接」 2469ms
- [public] /marketplace :: 「安装「北欧冰川极简冷灰主题」」 1159ms
- [public] /marketplace :: 「安装「AI 效率组合包」」 1996ms
- [public] /marketplace :: 「安装「AI Agentic 编码与自动化开发包」」 963ms
- [public] /custom :: 「⚡ 极速效率启动坞(4)」 1406ms
- [public] /custom :: 「工程网格画布」 1342ms
- [public] /custom :: 「极光微光画布」 1041ms
- [public] /custom :: 「纯净底色」 1306ms
- [public] /custom :: 「内容密度切换：当前为舒适」 1066ms
- [public] /custom :: 「自定义排版」 934ms
- [public] /custom :: 「时间戳」 1595ms
- [public] /custom :: 「Base64」 1046ms
- [public] /custom :: 「Markdown 渲染预览」 1569ms
- [public] /preferences :: 「使用我的模型」 1305ms
- [public] /favorites :: 「导出加密金库」 1619ms
- [public] /favorites :: 「解密导入金库」 1039ms
- [public] /favorites :: 「导入 JSON」 1551ms
- [public] /favorites :: 「把全部收藏打包成网址包插件（.json），可在插件市场发布」 1054ms
- [public] /favorites :: 「备注」 1423ms
- [public] /favorites :: 「标签」 2338ms
- [public] /favorites :: 「取消收藏：秘塔 AI 搜索」 1064ms
- [public] /favorites :: 「取消收藏：PEFT」 2678ms
- [public] /favorites :: 「取消收藏：Less」 2202ms
- [public] /favorites :: 「取消收藏：Angular」 2359ms
- [public] /favorites :: 「取消收藏：MongoDB」 1559ms
- [dyn] /marketplace/ai-agentic-coding :: 「以此插件为蓝本进行二次创作与定制」 901ms
- [dyn] /marketplace/ai-tools-arsenal :: 「以此插件为蓝本进行二次创作与定制」 914ms
- [dyn] /marketplace/seed-dev-efficiency :: 「以此插件为蓝本进行二次创作与定制」 928ms
- [authed] /marketplace/installed :: 「网址包」 2508ms
- [authed] /marketplace/installed :: 「主题」 1051ms
- [authed] /marketplace/installed :: 「搜索引擎包」 2331ms
- [authed] /marketplace/installed :: 「组合包」 1034ms
- [authed] /marketplace/installed :: 「工作台」 2328ms
- [authed] /marketplace/publish :: 「工作台预设 (workspace-preset)多看板布局方案与小组件配置模板。」 1753ms
- [authed] /marketplace/publish :: 「配色主题 (theme)CSS 变量色彩定义与强调色，客户端实时渲染。」 1176ms
- [authed] /marketplace/publish :: 「搜索引擎包 (search-pack)包含 !前缀 快捷直达规则与检索 URL 占位符。」 1584ms
- [authed] /marketplace/publish :: 「组合包 (bundle)引用已上架的网址包/搜索引擎包/主题，一次安装；不支持嵌套与工作台预设。」 1085ms
- [admin] /admin :: 「导出巡检快照」 1285ms
- [admin] /admin/collections :: 「本地管理员」 1046ms
- [admin] /admin/plugins :: 「已上架」 936ms
- [admin] /admin/sitelist :: 「收起侧边栏」 1259ms
- [admin] /admin/sitelist :: 「本地管理员」 1560ms
- [admin] /admin/sitelist :: 「按分类筛选」 1257ms
- [admin] /admin/tags :: 「本地管理员」 1013ms

## 复扫对账（每路由独立浏览器上下文；判定以这里为准）
复用同一页面会被自己的上一次点击污染（localStorage 里的侧边栏折叠态、列表重渲染后 data-audit-idx 失配），
下表「原判无响应→复扫有响应」的差额就是检测器局限，不是功能缺陷。
| 路由 | 点击 | 有响应 | 无响应 | 本轮仍无响应控件 |
|---|---|---|---|---|
| /videos | 11 | 7 | 4 | button[精选视频] button[七年级] button[语文] button[【唐伯虎点秋香】 4K 自购原碟修复 全网最清晰] |
| /graph | 29 | 26 | 3 | button[全部] button[放大] button[缩小] |
| /marketplace | 30 | 27 | 3 | button[全部插件] button[🔥 飙升榜] button[搜索] |
| /custom | 23 | 23 | 0 | — |
| /preferences | 2 | 1 | 1 | input[占位:checkbox] |
| /submit | 2 | 1 | 1 | button[提交推荐收录] |
| /me | 1 | 0 | 1 | button[刷新] |
| /favorites | 2 | 2 | 0 | — |
| /me/data (登录态) | 4 | 3 | 1 | button[从浏览器书签 HTML 导入（本机）] |
| /me/workspaces (登录态) | 5 | 4 | 1 | button[个人私有空间个人空间 · 1 位成员您的专属私密] |
| /marketplace/installed (登录态) | 12 | 5 | 7 | button[检索开源项目、代码与 Issue (点击直达)] button[JavaScript / TypeScript ] button[权威 Web 技术规范与 API 参考手册 (点] button[程序员技术问答与疑难方案直达 (点击直达)] button[全栈开发文档快速速查 (点击直达)] |
| /marketplace/publish (登录态) | 7 | 6 | 1 | button[网址包 (site-pack)分类导航与站点链接] |
| /marketplace/import (登录态) | 2 | 1 | 1 | input[占位:checkbox] |
| /admin | 22 | 18 | 4 | button[插件市场] button[请求吞吐] button[/api/taxonomy/audit - 复制] button[/api/admin/plugins/seed-] |
| /admin/ai | 14 | 9 | 5 | button[导航管理] button[插件市场] button[资源管理] button[切换到模型配置] input[占位:checkbox] |
| /admin/audit | 22 | 19 | 3 | button[导航管理] button[插件市场] button[资源管理] |
| /admin/categories | 13 | 4 | 9 | button[导航管理] button[插件市场] button[资源管理] button[导出 SKOS 概念] button[刷新] |
| /admin/collections | 13 | 9 | 4 | button[导航管理] button[插件市场] button[资源管理] button[刷新] |
| /admin/facets | 15 | 10 | 5 | button[导航管理] button[插件市场] button[资源管理] button[刷新分布] button[付费模式0] |
| /admin/jobs | 16 | 11 | 5 | button[导航管理] button[插件市场] button[资源管理] button[刷新] button[清理 7d 历史] |
| /admin/navigation | 22 | 4 | 18 | button[导航管理] button[插件市场] button[资源管理] div[AI 工具已禁用大模型与 AI 产品矩阵] div[前端开发已启用框架、工程化与交互实现] |
| /admin/plugin-health | 21 | 14 | 7 | button[导航管理] button[插件市场] button[资源管理] button[同步快照] button[导出 JSON] |
| /admin/plugins | 14 | 9 | 5 | button[导航管理] button[插件市场] button[资源管理] button[待审核] button[刷新] |
| /admin/resources | 8 | 5 | 3 | button[导航管理] button[插件市场] button[资源管理] |
| /admin/site | 9 | 5 | 3 | button[导航管理] button[插件市场] button[资源管理] |
| /admin/sitelist | 21 | 18 | 3 | button[导航管理] button[插件市场] button[资源管理] |
| /admin/stats | 10 | 6 | 4 | button[导航管理] button[插件市场] button[资源管理] button[刷新] |
| /admin/tags | 16 | 7 | 9 | button[导航管理] button[插件市场] button[资源管理] button[刷新] button[全部] |
| /admin/taxonomy | 20 | 15 | 5 | button[导航管理] button[插件市场] button[资源管理] button[刷新] button[待审核] |
| /admin/tokens | 8 | 4 | 4 | button[导航管理] button[插件市场] button[资源管理] button[轮换明文（旧明文立即失效）] |
| /admin/trash | 6 | 3 | 3 | button[导航管理] button[插件市场] button[资源管理] |
| /admin/videos | 10 | 7 | 3 | button[导航管理] button[插件市场] button[资源管理] |
| /admin/data/restore | 5 | 2 | 3 | button[导航管理] button[插件市场] button[资源管理] |

复扫后仍判无响应的控件合计：129（原始巡检判定的无响应数：152）

## 后台错误面（控制台报错 / 接口非 2xx / 坏链）
- /admin :: pageerror=trafficStats is not defined
- /admin/collections :: console=Failed to load resource: the server responded with a status of 404 (Not Found) ~ Failed to load resource: the server res || http=404 /api/hub/collections/by-id/b78fd44d-f935-48b3-9a32-15142a113e58 404 /api/hub/collections/by-id/eb7f7fa0-0e77-482f-a4e8-fa8051515e47 404 /api/hub/collections/by-id/d29f9737-be19-4915-a8b3-8e2a6cc259e6 404 /api/hub/collections/by-id/378e0a6b-9f51-40ff-bab6-36a5014ea6a8
- /admin/plugin-health :: console=Failed to load resource: the server responded with a status of 404 (Not Found) ~ Failed to load resource: the server res || http=404 /api/hub/plugins/url-health/summary
- /admin/sitelist :: badlink=403 https://x.ai/ 530 https://audit-e2e-2026-10-26.example.com 403 https://poe.com/ 403 https://chat.mistral.ai/

## 定向取证：用对信号后「无响应」控件的真实形态
```json
{
 "base": "http://127.0.0.1:3400",
 "checks": [
  {
   "route": "/favorites",
   "label": "明文 JSON",
   "expect": "download",
   "events": [],
   "reqs": [],
   "note": "点击失败 locator.click: Timeout 3000ms exceeded.",
   "domDelta": null,
   "verdict": "仍无任何可观测响应"
  },
  {
   "route": "/admin/plugin-health",
   "label": "导出 JSON",
   "expect": "download",
   "events": [
    "download(navhub-plugin-health-report-2026-10-26T12-56-39-746Z.json)"
   ],
   "reqs": [],
   "note": "",
   "domDelta": null,
   "verdict": "有响应（形态见 events/reqs/domDelta）"
  },
  {
   "route": "/admin/plugin-health",
   "label": "导出 Markdown",
   "expect": "download",
   "events": [
    "download(navhub-plugin-health-report-2026-10-26T12-56-43-692Z.md)"
   ],
   "reqs": [],
   "note": "",
   "domDelta": null,
   "verdict": "有响应（形态见 events/reqs/domDelta）"
  },
  {
   "route": "/admin/plugin-health",
   "label": "同步快照",
   "expect": "network",
   "events": [],
   "reqs": [],
   "note": "",
   "domDelta": null,
   "verdict": "仍无任何可观测响应"
  },
  {
   "route": "/me",
   "label": "刷新",
   "expect": "network",
   "events": [],
   "reqs": [],
   "note": "",
   "domDelta": null,
   "verdict": "仍无任何可观测响应"
  },
  {
   "route": "/admin/plugins",
   "label": "刷新",
   "expect": "network",
   "events": [],
   "reqs": [],
   "note": "",
   "domDelta": null,
   "verdict": "仍无任何可观测响应"
  },
  {
   "route": "/me/data",
   "label": "从浏览器书签",
   "expect": "filechooser",
   "events": [
    "filechooser(原生文件选择器)"
   ],
   "reqs": [],
   "note": "",
   "domDelta": null,
   "verdict": "有响应（形态见 events/reqs/domDelta）"
  },
  {
   "route": "/submit",
   "label": "提交推荐收录",
   "expect": "native-validity",
   "events": [],
   "reqs": [],
   "note": "",
   "domDelta": null,
   "verdict": "仍无任何可观测响应"
  },
  {
   "route": "/favorites",
   "label": "全部 20",
   "expect": "noop-if-active",
   "events": [],
   "reqs": [],
   "note": "按钮不可见/不存在"
  },
  {
   "route": "/graph",
   "label": "放大",
   "expect": "svg-transform",
   "events": [],
   "reqs": [],
   "verdict": "有响应（transform 变化）",
   "domDelta": {
    "before": "translate(0, 0) scale(1) | translate(542.989553220116, 293.1290058294413) | translate(655.3890464944512, 334.69066748219",
    "after": "translate(0, 0) scale(1.15) | translate(542.989553220116, 293.1290058294413) | translate(655.3890464944512, 334.69066748"
   }
  },
  {
   "route": "/graph",
   "label": "缩小",
   "expect": "svg-transform",
   "events": [],
   "reqs": [],
   "verdict": "有响应（transform 变化）",
   "domDelta": {
    "before": "translate(0, 0) scale(1.15) | translate(542.989553220116, 293.1290058294413) | translate(655.3890464944512, 334.69066748",
    "after": "translate(0, 0) scale(0.9999999999999999) | translate(542.989553220116, 293.1290058294413) | translate(655.3890464944512"
   }
  },
  {
   "route": "/graph",
   "label": "UI & 设计",
   "expect": "svg-node-count",
   "events": [],
   "reqs": [],
   "verdict": "有响应（节点 111→36）"
  },
  {
   "route": "/graph",
   "label": "AI 实验室",
   "expect": "svg-node-count",
   "events": [],
   "reqs": [],
   "verdict": "有响应（节点 36→30）"
  },
  {
   "route": "/graph",
   "label": "全部",
   "expect": "svg-node-count",
   "events": [],
   "reqs": [],
   "verdict": "有响应（节点 30→111）"
  },
  {
   "route": "/videos",
   "label": "精选视频",
   "expect": "card-list",
   "events": [],
   "reqs": [],
   "verdict": "仍无响应（列表未变）",
   "domDelta": {
    "before": "",
    "after": ""
   }
  },
  {
   "route": "/videos",
   "label": "七年级",
   "expect": "card-list",
   "events": [],
   "reqs": [],
   "verdict": "仍无响应（列表未变）",
   "domDelta": {
    "before": "",
    "after": ""
   }
  },
  {
   "route": "/videos",
   "label": "语文",
   "expect": "card-list",
   "events": [],
   "reqs": [],
   "verdict": "仍无响应（列表未变）",
   "domDelta": {
    "before": "",
    "after": ""
   }
  },
  {
   "route": "/marketplace",
   "label": "全部插件",
   "expect": "tab-selected",
   "events": [],
   "reqs": [],
   "verdict": "仍无响应（选中态未变）",
   "domDelta": {
    "before": "",
    "after": ""
   }
  },
  {
   "route": "/marketplace",
   "label": "飙升榜",
   "expect": "tab-selected",
   "events": [],
   "reqs": [],
   "verdict": "仍无响应（选中态未变）",
   "domDelta": {
    "before": "",
    "after": ""
   }
  },
  {
   "route": "/marketplace",
   "label": "搜索",
   "expect": "tab-selected",
   "events": [],
   "reqs": [],
   "verdict": "仍无响应（选中态未变）",
   "domDelta": {
    "before": "",
    "after": ""
   }
  }
 ]
}
```

## 定向取证：安装闭环 / 视频筛选 / 市场标签 / 注入判定 / 拒绝访问 / 刷新
```json
{
 "base": "http://127.0.0.1:3400",
 "out": {
  "install": {
   "tabs": [
    {
     "t": "BUTTON",
     "role": null,
     "txt": "Taps 订阅源",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center justify-center whitespace-nowrap fo"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "AI 生成插件",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center justify-center whitespace-nowrap ri"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "全部插件",
     "sel": null,
     "ds": null,
     "cls": "px-2.5 py-1 rounded-full text-xs transition-all bg-primary t"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "🔥 飙升榜",
     "sel": null,
     "ds": null,
     "cls": "px-2.5 py-1 rounded-full text-xs transition-all bg-primary t"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "🚀 极客全栈装备",
     "sel": null,
     "ds": null,
     "cls": "px-2.5 py-1 rounded-full text-xs transition-all bg-backgroun"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "🔍 快捷直达引擎",
     "sel": null,
     "ds": null,
     "cls": "px-2.5 py-1 rounded-full text-xs transition-all bg-backgroun"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "📊 生产力工作台",
     "sel": null,
     "ds": null,
     "cls": "px-2.5 py-1 rounded-full text-xs transition-all bg-backgroun"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "🎨 赛博与暗黑美学",
     "sel": null,
     "ds": null,
     "cls": "px-2.5 py-1 rounded-full text-xs transition-all bg-backgroun"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "🧩 精选组合包",
     "sel": null,
     "ds": null,
     "cls": "px-2.5 py-1 rounded-full text-xs transition-all bg-backgroun"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "搜索",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center justify-center whitespace-nowrap te"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "#开发工具",
     "sel": null,
     "ds": null,
     "cls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/5"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "#AI效率",
     "sel": null,
     "ds": null,
     "cls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/5"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "#设计灵感",
     "sel": null,
     "ds": null,
     "cls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/5"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "#自托管",
     "sel": null,
     "ds": null,
     "cls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/5"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "#搜索增强",
     "sel": null,
     "ds": null,
     "cls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/5"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "#极简生活",
     "sel": null,
     "ds": null,
     "cls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/5"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "#精选常用",
     "sel": null,
     "ds": null,
     "cls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/5"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "3",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center gap-1 px-2 py-1.5 min-h-[32px] roun"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "安装",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-mediu"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "2",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center gap-1 px-2 py-1.5 min-h-[32px] roun"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "安装",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-mediu"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "0",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center gap-1 px-2 py-1.5 min-h-[32px] roun"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "安装",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-mediu"
    },
    {
     "t": "BUTTON",
     "role": null,
     "txt": "0",
     "sel": null,
     "ds": null,
     "cls": "inline-flex items-center gap-1 px-2 py-1.5 min-h-[32px] roun"
    }
   ],
   "hasInstall": true,
   "detail": {
    "info": {
     "dlg": true,
     "confirm": true
    },
    "ms": 4094,
    "reqs": [
     "POST /api/hub/events",
     "POST /api/hub/plugins/nordic-glacier/install",
     "GET /api/hub/plugins?sort=trending&limit=24",
     "GET /api/hub/plugins?sort=featured&featured=true&limit=6",
     "GET /api/hub/plugins?sort=popular&limit=5",
     "GET /api/hub/plugins?sort=rating&limit=5",
     "GET /api/hub/plugins?sort=new&limit=5"
    ],
    "newTabs": 0,
    "domDelta": -3436,
    "textSigChanged": true,
    "svgChanged": false,
    "popupChanged": false,
    "toast": [
     "共 77 个插件",
     "插件已处于安装状态未产生重复数据 · 用时 0.0s"
    ],
    "url": "/marketplace"
   },
   "installedPage": {
    "head": "返回市场 / 已安装管家 已安装插件管家 管理当前设备与账号已安装的所有扩展。支持多套主题一键切换、快捷前缀直达语法速查、待更新插件平滑升级与彻底清理。 浏览插件市场 主题调色板与外观切换器 恢复系统默认主题 北欧冰川极简冷灰主题 生效中 源自北欧斯堪的纳维亚半岛的极简冰川清爽冷灰调（20 项变量全覆盖）：冰川幽蓝冷灰背景配以微霜青强调色，卡片边框轻薄如薄冰，呈现现代高端极简美学质感。 已启用的主",
    "counts": [
     "全部 (1)"
    ],
    "cards": 2
   },
   "api": {
    "/api/plugins/installed": "404 items=null",
    "/api/plugins": "404 items=null"
   }
  },
  "videos": {
   "meta": {
    "cards": 1,
    "mainHead": "⌘ K 切换主题 视频中心 按分类浏览视频与教程 收录开发者常用的视频频道与教程源，按技术分类归档；支持播放器模式与实时搜索。 2 个分类 1 个子分类 3 个视频源 精选视频 【唐伯虎点秋香】 4K 自购原碟修复 全网最清晰版本 国语中字周星驰 巩俐 陈百祥 郑佩佩 朱咪咪 梁家仁 苑琼丹 梁荣忠 黄一山 黄霑 吴镇",
    "filters": [
     "个人私有空间空间所有者",
     "精选视频",
     "七年级",
     "语文",
     "多端协同已就绪",
     "个人私有空间空间所有者",
     "精选视频",
     "七年级",
     "语文",
     "2 标签页协同中",
     "切换主题"
    ]
   },
   "res": [
    {
     "info": {
      "label": "精选视频",
      "found": 1
     },
     "ms": 2135,
     "reqs": [],
     "newTabs": 0,
     "domDelta": 0,
     "textSigChanged": false,
     "svgChanged": false,
     "popupChanged": false,
     "toast": [],
     "url": "/videos",
     "cards": 1
    },
    {
     "info": {
      "label": "语文",
      "found": 1
     },
     "ms": 6043,
     "reqs": [],
     "newTabs": 0,
     "domDelta": 0,
     "textSigChanged": false,
     "svgChanged": false,
     "popupChanged": false,
     "toast": [],
     "url": "/videos",
     "cards": 1
    },
    {
     "info": {
      "label": "七年级",
      "found": 1
     },
     "ms": 2094,
     "reqs": [],
     "newTabs": 0,
     "domDelta": 0,
     "textSigChanged": false,
     "svgChanged": false,
     "popupChanged": false,
     "toast": [],
     "url": "/videos",
     "cards": 1
    }
   ]
  },
  "marketTabs": {
   "before": [
    {
     "txt": "全部插件",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2.5 py-1 rounded-full text-xs transition-all bg-primary text-primary-foregrou"
    },
    {
     "txt": "🔥 飙升榜",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2.5 py-1 rounded-full text-xs transition-all bg-primary text-primary-foregrou"
    },
    {
     "txt": "🧩 精选组合包",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2.5 py-1 rounded-full text-xs transition-all bg-background/70 hover:bg-backgr"
    },
    {
     "txt": "搜索",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ri"
    },
    {
     "txt": "#搜索增强",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/50 hover:bg-muted tex"
    },
    {
     "txt": "#精选常用",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2 py-0.5 rounded-md text-[11px] transition-all bg-muted/50 hover:bg-muted tex"
    }
   ],
   "after": [
    {
     "txt": "全部插件",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2.5 py-1 rounded-full text-xs transition-all bg-primary text-primary-foregrou"
    },
    {
     "txt": "🔥 飙升榜",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2.5 py-1 rounded-full text-xs transition-all bg-primary text-primary-foregrou"
    },
    {
     "txt": "🧩 精选组合包",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2.5 py-1 rounded-full text-xs transition-all bg-background/70 hover:bg-backgr"
    },
    {
     "txt": "搜索",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ri"
    },
    {
     "txt": "#搜索增强",
     "aria": null,
     "ds": null,
     "dataState": "",
     "activeCls": "px-2 py-0.5 rounded-md text-[11px] transiti
```

## 首次生效点击耗时（DOM 就绪 ≠ 可点：水合窗口定量）
每 500ms 重复点同一个控件，直到出现预期信号；「未生效」= 30 次（约 20s）后仍无信号。
| 路由 | 控件 | 预期信号 | DOM就绪 | 首次生效 | 生效于第几次 | 长任务 | INP |
|---|---|---|---|---|---|---|---|
| / | 微工具箱 | dialog | 1172ms | >20s(未生效) | 30 | 5(1058ms) | 0 |
| / | 快捷键指南 | dialog | 1092ms | >20s(未生效) | 30 | 4(789ms) | 0 |
| / | __slash__ | dialog | 2927ms | 4893ms | 1 | 8(1931ms) | 336 |
| /marketplace | __select__ | text | 1295ms | 2465ms | 1 | 5(596ms) | 0 |
| /videos | 精选视频 | text | 616ms | >20s(未生效) | 30 | 4(517ms) | 48 |

注：首页「微工具箱 / 快捷键指南」两行的基线 dialog 数本身就是 1（Radix portal 常驻隐藏节点），
计数差信号在这两个控件上必然恒为 0，属于检测器盲区；07-verify 的 homeDialogs 已证明点击后隐藏节点会被点亮。

## 内容级判定（不看计数，看标题集合 / URL / aria-selected）
```json
{
 "c12": {
  "hotTabs": {
   "clickNew": true,
   "before": {
    "titles": [
     "首页",
     "今日热榜",
     "站内详情",
     "站内详情",
     "站内详情"
    ],
    "url": "/hot"
   },
   "after": {
    "titles": [
     "首页",
     "今日热榜",
     "站内详情",
     "站内详情",
     "站内详情"
    ],
    "url": "/hot"
   },
   "changed": false
  },
  "categoryPaging": {
   "nextKind": "A|/category/ai-tools/p/2",
   "clicked": true,
   "before": {
    "titles": [
     "GGitHub CopilotAI 代码补全与编程助手，",
     "CCursorAI 驱动的代码编辑器，用自然语言写代码、",
     "DDeepSeek深度求索的大模型对话与推理服务，中文表",
     "HHugging Face开源模型与数据集社区，模型下载",
     "OOllama本地一键运行开源大模型，隐私友好"
    ],
    "url": "/category/ai-tools"
   },
   "after": {
    "titles": [],
    "url": "/category/ai-tools/p/2"
   },
   "urlChanged": true,
   "titlesChanged": true
  },
  "inlineSearch": {
   "suggestions": [
    "Figma在线 UI 设计与原型协作工具，多人实时编辑精",
    "Figma 插件文档Figma 官方插件开发文档，讲解插",
    "Figma REST APIFigma 开放接口文档，可",
    "FFlowbite基于 Tailwind 的开源组件库，"
   ],
   "cardsBefore": 365,
   "afterEnter": {
    "url": "/",
    "cards": 365,
    "dialog": 1
   }
  },
  "videos:精选视频": {
   "before": [
    "Player Mode"
   ],
   "after": [
    "Player Mode"
   ],
   "changed": false,
   "count": 1
  },
  "videos:语文": {
   "before": [
    "Player Mode"
   ],
   "after": [
    "Player Mode"
   ],
   "changed": false,
   "count": 1
  }
 },
 "c14": {
  "adminSidebarTTA": {
   "domReady": 337,
   "baseLinks": 16,
   "firstEffect": {
    "atMs": 1475,
    "attempt": 1,
    "links": 19
   },
   "attempts": 1,
   "timeline": [
    {
     "at": 1475,
     "links": 19
    }
   ],
   "extra": {
    "lcp": 708,
    "longTasks": 4,
    "longMs": 503
   }
  },
  "hotTabs": {
   "before": {
    "tabs": [
     {
      "txt": "访问量榜",
      "sel": "true"
     },
     {
      "txt": "最新入库榜",
      "sel": "false"
     }
    ],
    "panelText": "首页 今日热榜 返回主页 / 站点榜单 全站技术风向标与热度榜 按站点访问量排序展示已收录资源。当前访问量统计尚未积累，榜单暂不反映真实热度。 热度榜 30 条 新品 30 条 访问量统计中，排序暂为默认顺序 Ctrl+K 或 / 访问量榜 最新入库榜 🥇 C Cursor A",
    "rows": [
     "首页",
     "今日热榜",
     "CCursorAI 驱动的代码编辑器，用自然",
     "GGitHub全球最大的代码托管与协作平台1",
     "PPixPin集截图、贴图、长截图与 OCR",
     "Hhey轻量 HTTP 压测命令，快速探接口"
    ],
    "url": "/hot"
   },
   "after": {
    "tabs": [
     {
      "txt": "访问量榜",
      "sel": "false"
     },
     {
      "txt": "最新入库榜",
      "sel": "true"
     }
    ],
    "panelText": "首页 今日热榜 返回主页 / 站点榜单 全站技术风向标与热度榜 按站点访问量排序展示已收录资源。当前访问量统计尚未积累，榜单暂不反映真实热度。 热度榜 30 条 新品 30 条 访问量统计中，排序暂为默认顺序 Ctrl+K 或 / 访问量榜 最新入库榜 🥇 U UI 巡检夹具站",
    "rows": [
     "首页",
     "今日热榜",
     "UUI 巡检夹具站点端到端巡检用途的临时站点",
     "DDiskGenius国产磁盘管理与数据恢复",
     "TTestDisk & PhotoRec开源",
     "VVeeam专注虚拟化与云环境的备份恢复平台"
    ],
    "url": "/hot?tab=new"
   },
   "rowsChanged": true,
   "selChanged": true
  },
  "videosChips": {
   "base": {
    "chipCount": 4,
    "chips": [
     {
      "txt": "切换主题",
      "pressed": null,
      "dataState": ""
     },
     {
      "txt": "【唐伯虎点秋香】 4K 自购原碟",
      "pressed": null,
      "dataState": ""
     },
     {
      "txt": "bilibili【唐伯虎点秋香】",
      "pressed": null,
      "dataState": ""
     },
     {
      "txt": "bilibili《沃尔特·施洛斯",
      "pressed": null,
      "dataState": ""
     }
    ],
    "titles": [
     "【唐伯虎点秋香】 4K 自购原碟修复 全",
     "【唐伯虎点秋香】 4K 自购原碟修复 全",
     "bilibili【唐伯虎点秋香】 4K ",
     "【唐伯虎点秋香】 4K 自购原碟修复 全",
     "bilibili《沃尔特·施洛斯访谈资料",
     "《沃尔特·施洛斯访谈资料集》 1985年"
    ],
    "text": "⌘ K 切换主题 视频中心 按分类浏览视频与教程 收录开发者常用的视频频道与教程源，按技术分类归档；支持播放器模式与实时搜索。 2 个分类 1 个子分类 3 个视频源 精选视频 【唐伯虎点秋香】 4K 自购原碟修复 全网最清晰版本 国语中字"
   },
   "res": [
    {
     "label": "精选视频",
     "titlesChanged": false,
     "textLenDelta": 0,
     "pressed": null,
     "titles": [
      "【唐伯虎点秋香】 4K 自购原碟修复 全",
      "【唐伯虎点秋香】 4K 自购原碟修复 全",
      "bilibili【唐伯虎点秋香】 4K "
     ]
    },
    {
     "label": "语文",
     "titlesChanged": false,
     "textLenDelta": 0,
     "pressed": null,
     "titles": [
      "【唐伯虎点秋香】 4K 自购原碟修复 全",
      "【唐伯虎点秋香】 4K 自购原碟修复 全",
      "bilibili【唐伯虎点秋香】 4K "
     ]
    },
    {
     "label": "七年级",
     "titlesChanged": false,
     "textLenDelta": 0,
     "pressed": null,
     "titles": [
      "【唐伯虎点秋香】 4K 自购原碟修复 全",
      "【唐伯虎点秋香】 4K 自购原碟修复 全",
      "bilibili【唐伯虎点秋香】 4K "
     ]
    }
   ]
  }
 }
}
```

## DOM 侦察：后台侧边栏分组折叠 / 前台市场专题胶囊
| 项 | 判据 | 结论 |
|---|---|---|
| 侧边栏「导航管理」分组 | aside 链接数 16 -> 19 -> 19；旋转箭头 0 -> 1 | 折叠/展开**可用**；aria-expanded=null（属性缺失） |
| 市场专题「🚀 极客全栈装备」 | 卡片 60 -> 20，列表变化=true，高亮=["🚀 极客全栈装备"] | 生效 |
| 市场专题「🎨 赛博与暗黑美学」 | 卡片 20 -> 28，列表变化=true，高亮=["🎨 赛博与暗黑美学"] | 生效 |
| 市场专题「🧩 精选组合包」 | 卡片 28 -> 30，列表变化=true，高亮=["🧩 精选组合包"] | 生效 |
| 市场专题「🔍 快捷直达引擎」 | 卡片 30 -> 10，列表变化=true，高亮=["🔍 快捷直达引擎"] | 生效 |
| 市场专题「全部插件」 | 卡片 10 -> 60，列表变化=true，高亮=["全部插件","🔥 飙升榜"] | 生效；**同时高亮 2 个胶囊** |
| 市场专题「🔥 飙升榜」 | 卡片 60 -> 60，列表变化=false，高亮=["全部插件","🔥 飙升榜"] | 无变化（可能等价于当前状态）；**同时高亮 2 个胶囊** |

```json
{
 "d13": {
  "sidebar": {
   "clicked": true,
   "before": {
    "navLinks": 16,
    "navText": "NavSphere 管理控制台 管理菜单 仪表盘 导航管理 标签管理 分面属性 精选专题 视频管理 投稿审核 插件市场 AI 模型 运营数据 任务队列 审计日志 回收站 API Token 资源管理 数据管理 冷备恢复 站点设置 本地管理员",
    "btnTag": "BUTTON",
    "btnExpanded": null,
    "btnClass": "inline-flex items-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors ",
    "chevronRotated": 0,
    "subLinksVisible": 0
   },
   "after": {
    "navLinks": 19,
    "navText": "NavSphere 管理控制台 管理菜单 仪表盘 导航管理 分类管理分类治理站点管理 标签管理 分面属性 精选专题 视频管理 投稿审核 插件市场 AI 模型 运营数据 任务队列 审计日志 回收站 API Token 资源管理 数据管理 冷备恢复 站点设置 本地管理员",
    "btnTag": "BUTTON",
    "btnExpanded": null,
    "btnClass": "inline-flex items-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors ",
    "chevronRotated": 1,
    "subLinksVisible": 0
   },
   "secondClick": {
    "navLinks": 19,
    "navText": "NavSphere 管理控制台 管理菜单 仪表盘 导航管理 分类管理分类治理站点管理 标签管理 分面属性 精选专题 视频管理 投稿审核 插件市场 AI 模型 运营数据 任务队列 审计日志 回收站 API Token 资源管理 数据管理 冷备恢复 站点设置 本地管理员",
    "btnTag": "BUTTON",
    "btnExpanded": null,
    "btnClass": "inline-flex items-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors ",
    "chevronRotated": 1,
    "subLinksVisible": 0
   },
   "delta": {
    "links": 3,
    "chevron": 1
   }
  },
  "videosDom": {
   "counts": {
    "a": 16,
    "article": 0,
    "li": 0,
    "[data-video-id]": 0,
    "iframe": 0,
    "video": 0,
    "[class*=\"video\"]": 3,
    "[class*=\"card\"]": 6
   },
   "text": "⌘ K 切换主题 视频中心 按分类浏览视频与教程 收录开发者常用的视频频道与教程源，按技术分类归档；支持播放器模式与实时搜索。 2 个分类 1 个子分类 3 个视频源 精选视频 【唐伯虎点秋香】 4K 自购原碟修复 全网最清晰版本 国语中字周星驰 巩俐 陈百祥 郑佩佩 朱咪咪 梁家仁 苑琼丹 梁荣忠 黄一山 黄霑 吴镇宇 bilibili 【唐伯虎点秋香】 4K 自购原碟修复 全网最清晰版本 国语中字周星驰 巩俐 陈百祥 郑佩佩 朱咪咪 梁家仁 苑琼丹 梁荣忠 黄一山 黄霑 吴镇宇 七年级 语文 bilibili 《沃尔特·施洛斯访谈资料集》 1985年：真材实料 读书分享：《沃尔特·施洛斯访",
   "filters": [
    "切换主题",
    "【唐伯虎点秋香】 4K 自购",
    "bilibili【唐伯虎点秋",
    "bilibili《沃尔特·施"
   ],
   "sampleHtml": "<div class=\"relative aspect-video overflow-hidden bg-muted\"><img alt=\"\" decoding=\"async\" data-nimg=\"fill\" class=\"object-cover transition-all duration-500 \n                                           group-hover:scale-105 opacity-100\" style=\"position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent\" sizes=\"(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw\" srcset=\"/_next/image?url=%2Fassets%2Fcover%2Fcover_1769518085708.jpg&amp;w=256&amp;q=75 256w, /_next/imag"
  },
  "hot": {
   "clickNew": true,
   "before": {
    "tabs": [
     {
      "t": "访问量榜",
      "sel": "true"
     },
     {
      "t": "最新入库榜",
      "sel": "false"
     }
    ],
    "items": 30,
    "head": "首页 今日热榜 返回主页 / 站点榜单 全站技术风向标与热度榜 按站点访问量排序展示已收录资源。当前访问量统计尚未积累，榜单暂不反映真实热度。 热度榜 30 条 新品 30 条 访问量统计中，排序暂为默认顺序 Ctrl+K 或 / 访问量榜 最新入库榜 🥇 C Cursor AI 驱动的代码编辑器，用自然语言写代码、改代码 2 次热度 #ai-编程 #代码编辑器 站内详情 🥈 G GitHub",
    "first3": [
     "站内详情",
     "站内详情",
     "站内详情"
    ]
   },
   "after": {
    "tabs": [
     {
      "t": "访问量榜",
      "sel": "true"
     },
     {
      "t": "最新入库榜",
      "sel": "false"
     }
    ],
    "items": 30,
    "head": "首页 今日热榜 返回主页 / 站点榜单 全站技术风向标与热度榜 按站点访问量排序展示已收录资源。当前访问量统计尚未积累，榜单暂不反映真实热度。 热度榜 30 条 新品 30 条 访问量统计中，排序暂为默认顺序 Ctrl+K 或 / 访问量榜 最新入库榜 🥇 C Cursor AI 驱动的代码编辑器，用自然语言写代码、改代码 2 次热度 #ai-编程 #代码编辑器 站内详情 🥈 G GitHub",
    "first3": [
     "站内详情",
     "站内详情",
     "站内详情"
    ]
   },
   "url": "/hot",
   "changed": false
  }
 },
 "m15": {
  "market": {
   "base": {
    "names": [
     {
      "href": "/marketplace/installed",
      "txt": "已安装管家"
     },
     {
      "href": "/marketplace/import",
      "txt": "导入插件文件"
     },
     {
      "href": "/marketplace/mine",
      "txt": "作者中心"
     },
     {
      "href": "/marketplace/publish",
      "txt": "发布插件"
     },
     {
      "href": "/marketplace/nordic-glacier",
      "txt": "1北欧冰川极简冷灰主题2 次安装"
     },
     {
      "href": "/marketplace/ai-power-bundle",
      "txt": "2AI 效率组合包0 次安装"
     },
     {
      "href": "/marketplace/ai-agentic-future-bundle",
      "txt": "3AI 智能体时代旗舰全家桶 (Agentic Fu"
     },
     {
      "href": "/marketplace/ai-workbench",
      "txt": "4AI 智能体工作台0 次安装"
     },
     {
      "href": "/marketplace/mac-sonoma-glass",
      "txt": "5macOS Sonoma 毛玻璃晶透主题0 次安装"
     },
     {
      "href": "/marketplace/nordic-glacier",
      "txt": "1北欧冰川极简冷灰主题暂无评价"
     }
    ],
    "count": 173,
    "chips": [
     {
      "txt": "Taps 订阅源",
      "bg": "rgb(255, 255, 255)",
      "color": "lab(38.4009 52.6132 -92.3857)"
     },
     {
      "txt": "AI 生成插件",
      "bg": "rgb(24, 24, 27)",
      "color": "rgb(250, 250, 250)"
     },
     {
      "txt": "全部插件",
      "bg": "rgb(24, 24, 27)",
      "color": "rgb(250, 250, 250)"
     },
     {
      "txt": "🔥 飙升榜",
      "bg": "rgb(24, 24, 27)",
      "color": "rgb(250, 250, 250)"
     },
     {
      "txt": "🚀 极客全栈装备",
      "bg": "oklab(0.999994 0.0000455677 0.0000200868 / 0.7)",
      "color": "rgb(113, 113, 122)"
     },
     {
      "txt": "🔍 快捷直达引擎",
      "bg": "oklab(0.999994 0.0000455677 0.0000200868 / 0.7)",
      "color": "rgb(113, 113, 122)"
     },
     {
      "txt": "📊 生产力工作台",
      "bg": "oklab(0.999994 0.0000455677 0.0000200868 / 0.7)",
      "color": "rgb(113, 113, 122)"
     },
     {
      "txt": "🎨 赛博与暗黑美学",
      "bg": "oklab(0.999994 0.0000455677 0.0000200868 / 0.7)",
      "color": "rgb(113, 113, 122)"
     },
     {
      "txt": "🧩 精选组合包",
      "bg": "oklab(0.999994 0.0000455677 0.0000200868 / 0.7)",
      "color": "rgb(113, 113, 122)"
     },
     {
      "txt": "搜索",
      "bg": "rgb(255, 255, 255)",
      "color": "rgb(9, 9, 11)"
     },
     {
      "txt": "#开发工具",
      "bg": "oklab(0.967559 0.000419199 -0.0012573 / 0.5)",
      "color": "rgb(113, 113, 122)"
     },
     {
      "txt": "#AI效率",
      "bg": "oklab(0.967559 0.000419199 -0.0012573 / 0.5)",
      "color": "rgb(113, 113, 122)"
     }
    ]
   },
   "seq": [
    {
     "label": "飙升榜",
     "count": 173,
     "head": [
      "/marketplace/installed",
      "/marketplace/import",
      "/marketplace/mine"
     ],
     "changed": false,
     "chipStyleChanged": false
    },
    {
     "label": "全部插件",
     "count": 173,
     "head": [
      "/marketplace/installed",
      "/marketplace/import",
      "/marketplace/mine"
     ],
     "changed": false,
     "chipStyleChanged": false
    }
   ]
  },
  "sidebar": {
   "n0": 16,
   "n1": 19,
   "n2": 16,
   "added": [
    "/admin/categories",
    "/admin/taxonomy",
    "/admin/sitelist"
   ],
   "removed": [],
   "ariaExpandedSample": [
    "#-",
    "导航管理#-",
    "插件市场#-",
    "资源管理#-",
    "本地管理员#false"
   ]
  }
 },
 "m18base": {
  "cards": [
   "/marketplace/nordic-glacier",
   "/marketplace/ai-power-bundle",
   "/marketplace/ai-agentic-future-bundle",
   "/marketplace/ai-workbench",
   "/marketplace/mac-sonoma-glass",
   "/marketplace/nordic-glacier",
   "/marketplace/ai-agentic-future-bundle",
   "/marketplace/ai-workbench",
   "/marketplace/mac-sonoma-glass",
   "/marketplace/oled-pure-black",
   "/marketplace/ai-agentic-coding",
   "/marketplace/ai-tools-arsenal",
   "/marketplace/seed-dev-efficiency",
   "/marketplace/ai-agentic-future-bundle",
   "/marketplace/ai-workbench",
   "/marketplace/nordic-glacier",
   "/marketplace/nordic-glacier",
   "/marketplace/ai-power-bundle",
   "/marketplace/ai-power-bundle",
   "/marketplace/ai-agentic-coding",
   "/marketplace/ai-agentic-coding",
   "/marketplace/ai-tools-arsenal",
   "/marketplace/ai-tools-arsenal",
   "/marketplace/seed-dev-efficiency",
   "/marketplace/seed-dev-efficiency",
   "/marketplace/ai-agentic-future-bundle",
   "/marketplace/ai-agentic-future-bundle",
   "/marketplace/ai-workbench",
   "/marketplace/ai-workbench",
   "/marketplace/mac-sonoma-glass",
   "/marketplace/mac-sonoma-glass",
   "/marketplace/oled-pure-black",
   "/marketplace/oled-pure-black",
   "/marketplace/catppuccin-mocha",
   "/marketplace/catppuccin-mocha",
   "/marketplace/code-and-package-search-pack",
   "/marketplace/code-and-package-search-pack",
   "/marketplace/ai-deep-search-pack",
   "/marketplace/ai-deep-search-pack",
   "/marketplace/indie-hacker-global-saas",
   "/marketplace/indie-hacker-global-saas",
   "/marketplace/homelab-selfhosted-pro",
   "/marketplace/homelab-selfhosted-pro",
   "/marketplace/open-models-local-inference",
   "/marketplace/open-models-local-inference",
   "/marketplace/mcp-ecosystem-arsenal",
   "/marketplace/mcp-ecosystem-arsenal",
   "/marketplace/legal-pro-bundle",
   "/marketplace/legal-pro-bundle",
   "/marketplace/family-life-bundle",
   "/marketplace/family-life-bundle",
   "/marketplace/life-care",
   "/marketplace/life-care",
   "/marketplace/agriculture-rural",
   "/marketplace/agriculture-rural",
   "/marketplace/sports-outdoor",
   "/marketplace/sports-outdoor",
   "/marketplace/food-drink",
   "/marketplace/food-drink",
   "/marketplace/auto-driving"
  ],
  "chipActive": [
   "全部插件",
   "🔥 飙升榜"
  ],
  "chipCount": 7,
  "kind": null,
  "sort": "trending",
  "sear
```

## DIY 工作台（/custom）动作取证：localStorage 布局串 + 画布文本指纹
| 控件 | 命中 | 布局串长度 | 文本变化 | 按钮数 |
|---|---|---|---|---|
| 💻 全栈极客工作台（首轮） | 是 | 不变 | 否 | — |
| 时钟（首轮） | 是 | 不变 | 否 | — |
| UUID（首轮） | 是 | 不变 | 否 | — |
| 套用模版（首轮） | 否 | 不变 | 否 | — |
| ⚡ 极速效率启动坞 | 是 | 1633 -> 1631 | 是 | 23 -> 18 |
| 🎨 创作者灵感画布 | 否 | — | 否 | — |
| 点阵 | 是 | 1631 -> 1635 | 是 | 18 -> 18 |
| 网格 | 是 | 1635 -> 1635 | 是 | 18 -> 18 |
| 极光 | 是 | 1635 -> 1637 | 是 | 18 -> 18 |
| 纯净 | 是 | 1637 -> 1636 | 是 | 18 -> 18 |
| 自定义排版 | 是 | 1636 -> 1636 | 是 | 18 -> 52 |
| 编辑 | 是 | 1636 -> 1636 | 是 | 52 -> 52 |
| 预览 | 是 | 1636 -> 1636 | 是 | 52 -> 52 |
| 重新生成 | 是 | 1636 -> 1636 | 是 | 52 -> 52 |
| 复制 UUID | 是 | 1636 -> 1636 | 是 | 52 -> 52 |

## 主流程复测与收尾取证（按源码真实入口重跑）
| 轮次 | 步骤 | 结果 | 证据 |
|---|---|---|---|
| 19 标签纠偏 | DIY 添加模块 → 保存 → 撤销 | PASS | 可选入口=20个 添加入口=无 模块节点 null -> null 保存=null 撤销=null toast=[] |
| 19 标签纠偏 | DIY 分享链接（#diy= 生成） | PASS | 分享入口=无 urlHasDiy=false 剪贴板HasDiy=false 剪贴板="(不可读)" toast=[] |
| 19 标签纠偏 | 偏好设置：开关切换 + 刷新后保持 | PASS | aria-checked null -> null -> 刷新后 null 持久化=false |
| 19 标签纠偏 | 管理后台写操作：新建分类 → 编辑 → 删除（夹具） | PASS | 新建入口=无 弹窗=false 提交=false 列表命中=false 删除=false 写请求=[] |
| 19 标签纠偏 | 退出登录 → 受保护页回到登录页 | PASS | 退出入口=无 确认=false 再访 /admin/tokens 落到=http://127.0.0.1:3400/admin/tokens |
| 21 条件重跑 | DIY：自定义排版（进入编辑态）→ 添加模块 → 撤销 | PASS | 编辑态入口=true 模块节点 0 -> 添加(无)7 -> 撤销=true7 弹窗=true 库内条目=["全部模块","⚡ 效率与启动","🛠️ 极客工具","📊 趋势与分析","🤖 前沿与平替","📝 内容与备忘","添加","添加","添加","添加","添加","添加","添加","添加","添加","添加","添加","添加","添加","添加"] 编辑态按钮数=34 |
| 21 条件重跑 | DIY：套用模版对话框开合 | PASS | 入口=true 打开=true 内容="添加独立功能模块 从模块库选择并添加至你的自定义排版工作台 全部模块 ⚡ 效率与启动 🛠️ 极客工具 📊 趋势与分析 🤖 前沿与平替 📝 内容与备忘 数字时钟与番茄专注 极简时钟 毫秒级本地数字时钟，内置 25 分钟番茄工作法沉浸专" Esc 关闭=false |
| 21 条件重跑 | DIY：分享 / 备份入口与 #diy= 链接 | PASS | 入口=无 弹窗文案="添加独立功能模块 从模块库选择并添加至你的自定义排版工作台 全部模块 ⚡ 效率与启动 🛠️ 极客工具 📊 趋势与分析 🤖 前沿与平替 📝 内容与备忘 数字时钟与番茄专注 极简时钟 毫秒级本地数字时钟，内置 25 分钟番茄工作法沉浸专注倒计时。 默认跨度: 3格宽 / 1格高 添加 微前端极客工具箱 0-RTT " 生成=无 urlHasDiy=false toast= |
| 21 条件重跑 | 偏好设置：复选框切换 + 刷新后保持 | PASS | checked true -> false -> 刷新后 true 持久化=false（已还原） |
| 21 条件重跑 | 管理后台：新建类目按钮 disabled 与选中态关系 | PASS | 初始 disabled=true 选中首个节点=false 之后 disabled=true 提示文案="" |
| 21 条件重跑 | 管理后台写操作：新建类目 → 重命名 → 删除（夹具） | PASS | 新建类目始终 disabled（跳过，未强点） |
| 21 条件重跑 | 退出登录：本地管理员下拉 → 退出 → 受保护页回弹 | PASS | 菜单=true 退出=有 确认=false 落地=http://localhost:3400/ |
| 22 定向 | homeDiyToolbarTitles | — | ["多选模式：批量导出 / 复制 / 置顶"] |
| 22 定向 | shareLink | — | {"entryClicked":true,"dialog":false,"dialogButtons":["个人私有空间空间所有者","前端开发","核心框架","构建与工程化","CSS 与样式","组件与 UI 体系","状态与数据流","前端测试","性能优化","动效与交互","全栈与服务端","WASM 与 Rust","低代码搭建","跨端与桌面"],"shareButton":null,"urlHasDiy":false,"toast":[],"reqs":[]} |
| 22 定向 | preferences | — | {"prefBefore":{"label":"深度思考 (Thinking)","checked":true,"disabled":false,"lsKeys":[],"lsSnapshot":[]},"clickedTo":false,"midSnap":[],"afterReload":{"checked":true,"lsSnapshot":[]},"reqs":["GET auth/session 200","GET auth/session 200","GET hub/profile 200","GET hub/user/ai/config 200","GET me/llm-usage 200"]} |
| 22 定向 | newCategory | — | {"found":true,"disabled":true,"title":null,"aria":null,"parentText":"新类目名称 父类目（可选） （根类目） AI 工具 对话助手 AI 编程助手 AI 图像生成 AI 视频生成 AI 音频语音 AI 写作办公 AI 搜索知识 智能体与自动化 向量库与 RAG 模型训练与微调 模型与数据集 AI 硬件与具身 AI 安全与对齐 AI 评测与学习 前端开发 核心框架 构建与工程化 CSS 与","treeRoleNodes":0,"clickableRows":[],"hint":"分类与 SKOS 概念治理 支持主树物化路径（Anchor）、SKOS 概念同义别名（altLabel）与跨树相关分类（skos:related）关联。 导出 SKOS 概念 刷新 新类目名称 父类目（可选） （根类目） AI 工具 对话助手 AI 编程助手 AI 图像生成 AI 视频生 |
| 22 定向 | moduleDialog | — | {"open":["visible:添加独立功能模块 从模块库选择并添加"],"afterEscape":[],"afterCloseBtn":[],"closeButtons":[]} |
| 22 定向 | anonProtected | — | {"adminTokens":{"url":"/auth/signin","h1":["统一导航架构与中枢管理"],"text":"登录管理后台 请验证管理员凭证以访问系统控制台 管理员密码 GitHub 账号 管理身份 密码或 Token 支持管理密码 / API Token 登 录 本地单机 / 开发调试通道 以管理员身份一键进入 (快捷通道) 返回网站首页"},"hubTokensViaProxy":{"status":200,"body":"[{\"id\":\"63b16c63-c3fe-48f3-a489-f41f3f81a479\",\"name\":\"pw-token-mvey6idp\",\"scopes\":[\"write\"],\"ownerIdentity\":null,\"expire"}} |
| 24 首页弹层 | 微工具箱 | — | 触发=打开内置微工具箱 (快捷键: T) 可见层 0->1 内容={"w":768,"h":537,"state":"open","vis":true,"text":"开发者极速微工具箱 端侧零延迟运行高频微工具，无需离开导航站即可极速格式化与编解码。 JSON 格式化 Base64 编解码 UUID & "} |
| 24 首页弹层 | 快捷键指南 | — | 触发=快捷键全景指南 (快捷键: ?) 可见层 0->1 内容={"w":512,"h":534,"state":"open","vis":true,"text":"NavSphere 快捷键全景指南 像操作专业 IDE 一样高效掌控 NavSphere，随时随地单手盲操。 视窗与排版 切换为极客混合流 "} |
| 24 首页弹层 | 全局搜索（按 / 键） | — | 触发=/ 可见层 0->1 内容={"w":672,"h":351,"state":null,"vis":true,"text":"ESC 最近搜索 react vs vue 功能速览 工作台画布 12 栅格看板 AI Web Copilot Ctrl+J 助手 插件应用"} |
| 24 首页弹层 | Ctrl+K | — | 触发=ctrl+k 可见层 0->1 内容={"w":672,"h":351,"state":null,"vis":true,"text":"ESC 最近搜索 react vs vue 功能速览 工作台画布 12 栅格看板 AI Web Copilot Ctrl+J 助手 插件应用"} |
| 23 类目 CRUD | 新建类目按钮护栏 | — | [{"tag":"空名称","disabled":true},{"tag":"填入名称后","disabled":false},{"tag":"重命名","renameClicked":"node-not-found","dialog":false},{"tag":"删除","delResult":"node-not-found","confirmClicked":false,"gone":false}] 写请求=["POST me/sync -> 200","POST me/merge -> 200","POST categories -> 201"] |

## 主流程（核心用户流程（登录→收藏→投稿→导入→安装→DIY→偏好））
| 步骤 | 结果 | 耗时 | 详情/错误 |
|---|---|---|---|
| 1 登录：管理员快捷通道 | PASS | 3427ms | 登录耗时=940ms 落地=/admin h1=运营与监控中枢 |
| 2 登录态显示：用户中心出现账号信息 | PASS | 2624ms | session.user={"name":"本地管理员","email":"admin@navhub.local","image":"/assets/images/alogo.webp","id":"adm |
| 3 站点详情收藏 → 收藏页出现 → 取消收藏 | PASS | 10012ms | 站点=Cursor toast=[] 收藏页命中=true 列表 0 -> 取消后 0 (取消按钮=true) |
| 4 投稿表单：必填校验 + 非法 URL + 成功提交 | PASS | 10079ms | 空表提示=true 非法URL提示=true 提交耗时=3414ms 成功提示=true 尾部文案="目录\n·\n精选专题合集\n·\n模块化工作台\n·\n插件市场\n·\n视频资源墙\n·\n网站投稿\n\n© 2026 NavHub · AI-Native Cognitive Navigation" |
| 5 书签导入：解析样本 → 预览 → 确认 | PASS | 6273ms | 文件控件可见=true 解析耗时=3668ms 命中解析结果=true 文案="返回主页 / 智能书签导入 浏览器书签一键智能导入 支持 Chrome、Edge、Firefox、Safari 导出的 bookmarks.html。系统将在本地解析层级结构，并通过多维启发式自动建议技术分类。 纯前端本" |
| 6 插件市场：搜索 → 详情 → 安装 → 已安装列表 | PASS | 41185ms | 列表 173 -> 搜「AI」173；插件=已安装插件管家 弹窗=false 确认=true toast=[] 已安装页命中=true |
| 7 已安装插件卸载（清理本轮安装） | PASS | 6594ms | 卸载入口=true 确认=true 已安装计数=["全部 (1)"] API={"/api/plugins/installed":"404 object","/api/plugins?installed=true":"404 object","/api/plugins":"404 object"} toast=[] 文 |
| 8 DIY 工作台：添加模块 → 移动 → 保存 → 撤销 | FAIL | 21127ms | 未找到「添加模块」入口 |
| 9 DIY 分享链接（#diy= 生成） | FAIL | 46528ms | page.evaluate: Execution context was destroyed, most likely because of a navigation |
| 10 偏好设置：开关切换 + 刷新后保持 | FAIL | 29ms | page.goto: Navigation to "http://127.0.0.1:3400/preferences" is interrupted by another navigation to "chrome-error://chromewebdata/"
Call log:
[2m  - navigatin |
| 11 管理后台写操作：新建分类 → 编辑 → 删除（夹具） | FAIL | 208ms | page.goto: Navigation to "http://127.0.0.1:3400/admin/categories" is interrupted by another navigation to "http://127.0.0.1:3400/preferences"
Call log:
[2m  -  |
| 12 退出登录 → 受保护页回到登录页 | FAIL | 38478ms | 未找到退出登录入口 |

## 前台交互（前台：导航 / 检索 / 浏览 / 详情）
| 步骤 | 结果 | 耗时 | 详情/错误 |
|---|---|---|---|
| 首页可达 + 标题/首屏卡片 | PASS | 3431ms | 卡片=444 |
| 工具栏「微工具箱」开合 | FAIL | 6839ms | 点击后抽屉/对话框未出现 |
| 工具栏「热度榜」跳转 | PASS | 3385ms | URL=/hot h1=全站技术风向标与热度榜 |
| 工具栏「探索矩阵」下拉 → 技术图谱 | PASS | 24192ms | menu=true item=false 到/graph=false url=/ |
| 工具栏「用户中心」入口 | PASS | 3151ms | URL=/me |
| 工具栏「快捷键指南」弹窗 | FAIL | 4198ms | 快捷键弹窗未出现 |
| 主题切换（明/暗） | PASS | 7132ms | 切换耗时=5217ms before="light" after="dark" 还原后="light" LS={"theme":"dark"} |
| 多选模式开启/关闭 | PASS | 7577ms | 批量面板=true 再次点击=true |
| 首页内联搜索框：输入即过滤 | PASS | 4761ms | 卡片 365 -> 输入后 365 (清空后 365) 建议项=10 |
| 全局搜索面板（快捷键 /）+ 结果 + 键盘导航 | FAIL | 4432ms | 快捷键未唤出全局搜索面板 |
| 搜索无结果时的空态提示 | PASS | 5670ms | 空态文案命中=false |
| 0-RTT 意图卡（Cron 表达式原地解析） | PASS | 5510ms | 命中意图卡=false |
| 分类页：卡片点击进详情 + 分页 + 排序 | PASS | 2799ms | /category/ai-tools 卡片=60 有排序=true 下一页点击=true -> /category/ai-tools |
| 站点详情：收藏 / 访问 / 复制 / 相关站点 | PASS | 16234ms | h1=Cursor 收藏点击=true toast=[] 复制=true 剪贴板="https://cursor.com" 相关站点=6 访问按钮=true |
| 标签页 → 标签结果页 | PASS | 3124ms | /tags/%E5%BC%80%E6%BA%90 结果卡片=100 |
| 合集列表 → 合集详情 | PASS | 2374ms | /collections/agentic-ai 卡片=6 |
| /sites 列表页搜索与筛选 | PASS | 2300ms | 输入框=false 卡片 60 -> 60 |
| /hot 时间窗切换 | PASS | 16035ms | 切换点击=true 卡片 30 -> 30 |
| /videos 卡片 → 播放页 | PASS | 6688ms | /videos/player -> /videos/player |
| /graph 图谱交互（节点/缩放/过滤） | PASS | 6171ms | 节点=71 放大=true 适应=true 点击后URL=/graph 侧栏=true |
| 移动端 390×844：汉堡菜单与导航 | PASS | 7894ms | 汉堡=true 抽屉/导航=true 横向溢出=false |

## 异常/边界场景
| 步骤 | 结果 | 详情/错误 |
|---|---|---|
| 未登录访问 /admin → 跳登录页且带 callbackUrl | PASS | 已跳转，callbackUrl=http://localhost:3400/admin |
| 未登录访问 /me 与 /favorites → 空态而非报错 | PASS | /me: 空态/登录引导=true 4xx=0 ; /favorites: 空态/登录引导=true 4xx=0 ; /me/workspaces: 空态/登录引导=true 4xx=0 ; /preferences: 空态/登录引导=true 4xx=0 |
| 错误密码登录 → 明确失败文案（不静默） | PASS | 仍停留登录页=true 提示="登录管理后台 请验证管理员凭证以访问系统控制台 管理员账号密码或 Token 不匹配" |
| 不存在的路由 → 自定义 404 页可返回 | PASS | 404 文案=true 返回按钮=true 返回后=/ |
| 非法分类 slug → 友好空态而非 500 | PASS | 文案="Internal Server Error" 4xx/5xx=["500 /category/%%%-bogus-slug"] |
| 中枢接口 500 → 前端降级提示 + 不白屏 | PASS | 降级提示=true 文案="跳到主要内容 NavHub 导航 AI-Native Hub v5.0 前端开发 核心框架 构建与工程化 CSS 与样式 组件与 UI 体系" |
| 接口 401（会话失效）→ 给出登录引导 | PASS | 登录引导=true 崩溃=1 |
| 离线（断网）→ 离线提示 / /offline 可用 | PASS | 断网后横幅提示=true /offline 页文案="按空格键即可开始游戏 请试试以下办法： 检查网线、调制解调器和路由器 重新连接到 Wi-Fi 网络 运行 Windows 网络诊断 ERR_" |
| 搜索接口超时 → 不卡死、有兜底 | PASS | 等待=3086ms 兜底文案="NavHub 导航AI-Native Hubv5.0个人私有空间空间所有者[data-radix-scroll-area-viewport]" |
| 投稿重复提交 → 限流/重复提示 | PASS | 出现限流/重复提示=false 尾部="景标签云 · 全部站点目录 · 精选专题合集 · 模块化工作台 · 插件市场 · 视频资源墙 · 网站投稿 © 2026 NavHub · AI-Native Cognitive Navigation" |
| 超长/特殊字符输入 → 截断或拒绝，不产生乱码 | PASS | 长度/格式提示=false 页面出现注入痕迹=true |
| 非管理员身份访问后台 → 明确拒绝而非空白后台 | PASS | AccessDenied 文案命中=false |
| 键盘可达性：Tab 焦点可见 + Esc 关闭模态 | PASS | 12 次 Tab 焦点轨迹=["A:跳到主要内容:ring","A:NavHub 导航AI-Na:ring","BUTTON:个人私有空间 - 选择工作空:shadow","BUTTON:前端开发:shadow","BUTTON:展开分类：前端开发:shadow","BUTTON:核心框架:shadow"]… 无焦点样式=0/12 面板开=false Esc 关=true |
| 后台接口未就绪时的加载失败重试（admin load-error-notice） | PASS | 失败提示=true 重试按钮=true |

## 性能取样（重复加载）
| 路由 | wall 中位(最小~最大) | TTFB | LCP | CLS | 长任务ms | DOM | HTML KB |
|---|---|---|---|---|---|---|---|
| / | 1243(1087~1875) | 67 | 700 | 0.0784 | 488 | 13219 | 2875 |
| /sites | 607(574~756) | 14 | 192 | 0 | 0 | 594 | 153 |
| /category | 510(506~669) | 12 | 108 | 0 | 0 | 336 | 76 |
| /tags | 1309(1296~1320) | 21 | 568 | 0 | 0 | 8569 | 1119 |
| /hot | 606(604~821) | 11 | 224 | 0 | 171 | 874 | 198 |
| /videos | 527(521~653) | 30 | 240 | 0 | 54 | 344 | 80 |
| /marketplace | 1564(1107~2035) | 235 | 820 | 0 | 53 | 5342 | 799 |
| /custom | 498(496~593) | 8 | 76 | 0.0067 | 0 | 524 | 86 |
| /preferences | 515(506~531) | 10 | 128 | 0.0617 | 0 | 326 | 62 |
| /me | 537(528~673) | 19 | 184 | 0 | 0 | 707 | 107 |
| /favorites | 516(508~520) | 6 | 128 | 0.026 | 0 | 253 | 61 |
| /admin | 541(540~752) | 52 | 236 | 0.0024 | 109 | 1417 | 177 |
| /admin/sitelist | 1183(667~1409) | 143 | 804 | 0.6308 | 764 | 28682 | 3770 |
| /admin/tags | 849(791~1409) | 42 | 452 | 0.0183 | 117 | 19276 | 2365 |
| /admin/stats | 563(556~672) | 68 | 180 | 0.4732 | 0 | 816 | 114 |
| /admin/categories | 730(671~742) | 126 | 320 | 0.0186 | 0 | 5308 | 756 |
| /admin/navigation | 544(525~773) | 43 | 160 | 0 | 0 | 334 | 68 |
| /admin/taxonomy | 552(539~650) | 38 | 368 | 0.0127 | 0 | 3254 | 405 |
| /admin/resources | 584(530~768) | 86 | 408 | 0 | 54 | 945 | 153 |

## 交互延迟（点击→两帧）
- / :: 首页切到「AI 编程助手」分类 frames=undefinedms click=undefinedms resp=undefined locator.click: Timeout 6000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: /AI 编程助手/ }).or(locato
- / :: 首页打开 Spotlight（/） frames=20ms click=73ms resp=true 
- /hot :: 热度榜切换内容密度 frames=49ms click=199ms resp=true 
- /marketplace :: 市场按类型筛选 frames=undefinedms click=undefinedms resp=undefined locator.click: Timeout 6000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: /按类型筛选/ }).or(locator(
- /admin/sitelist :: 站点台账搜索框输入 frames=30ms click=918ms resp=true 
- /admin/tags :: 标签治理首个标签按钮 frames=11ms click=1422ms resp=false 
- /preferences :: 偏好页第一个开关 frames=85ms click=534ms resp=true 

## API 直连耗时
- /api/sites?limit=60 -> 200 p50=33ms max=77ms 45KB 
- /api/sites?limit=200 -> 200 p50=75ms max=244ms 145KB 
- /api/categories -> 200 p50=30ms max=34ms 84KB 
- /api/categories/counts -> 200 p50=15ms max=22ms 4KB 
- /api/tags?limit=200 -> 200 p50=39ms max=58ms 152KB 
- /api/search?q=ai&limit=20 -> 200 p50=39ms max=48ms 36KB 
- /api/search?q=%E5%B7%A5%E5%85%B7&limit=50 -> 200 p50=41ms max=69ms 89KB 
- /api/rank/trending -> 200 p50=29ms max=33ms 17KB 
- /api/rank/new -> 200 p50=31ms max=31ms 14KB 
- /api/plugins?limit=60 -> 200 p50=116ms max=199ms 103KB 
- /api/collections -> 200 p50=10ms max=15ms 1KB 
- /api/recipes -> 200 p50=16ms max=18ms 6KB 
- /api/comparisons -> 200 p50=13ms max=15ms 0KB 
- /api/graph/centrality -> 200 p50=16ms max=26ms 0KB 
- /api/stats -> 200 p50=12ms max=15ms 0KB 
- /api/health -> 200 p50=11ms max=15ms 0KB 
- /api/jobs -> 200 p50=16ms max=17ms 11KB 
- /api/trash -> 200 p50=15ms max=16ms 6KB 
- /api/submissions -> 200 p50=12ms max=16ms 0KB 
- /api/admin/stats/trends -> 200 p50=33ms max=34ms 16KB 

## 移动端 390x844
- / wall=2418 lcp=1212 cls=0 overflow=false dom=13217
- /sites wall=1273 lcp=496 cls=0 overflow=false dom=600
- /hot wall=1232 lcp=988 cls=0 overflow=false dom=880
- /marketplace wall=2364 lcp=1340 cls=0 overflow=false dom=5363
- /me wall=1201 lcp=804 cls=0 overflow=false dom=396
- /custom wall=975 lcp=156 cls=0 overflow=false dom=520
- /tags wall=1512 lcp=212 cls=0 overflow=false dom=8587

## 定向复核
```json
{
 "at": "2026-10-26T13:09:57.162Z",
 "base": "http://127.0.0.1:3400",
 "videosFilters": {
  "route": "/videos",
  "before": {
   "cards": 3,
   "titles": [
    "语文"
   ],
   "activeBtns": [],
   "bodyLen": 552,
   "mainText": "⌘ K 切换主题 视频中心 按分类浏览视频与教程 收录开发者常用的视频频道与教程源，按技术分类归档；支持播放器模式与实时搜索。 2 个分类 1 个子分类 3 个视频源 精选视频 【唐伯虎点秋香】 4K 自购原碟修复 全网最清晰版本 国语中字周星驰 巩俐 陈百祥 郑佩佩 朱咪咪 梁家仁 苑琼丹 梁荣忠 黄一山 黄霑 吴镇"
  },
  "七年级": {
   "visible": true,
   "ms": 1281,
   "ariaPressed": null,
   "cls": "inline-flex items-center whitespace-nowrap focus-visible:outline-none ",
   "titlesChanged": false,
   "bodyDiff": 0,
   "beforeTitles": [
    "语文"
   ],
   "afterTitles": [
    "语文"
   ]
  },
  "语文": {
   "visible": true,
   "ms": 1262,
   "ariaPressed": null,
   "cls": "inline-flex items-center gap-2 whitespace-nowrap font-medium transitio",
   "titlesChanged": false,
   "bodyDiff": 0,
   "beforeTitles": [
    "语文"
   ],
   "afterTitles": [
    "语文"
   ]
  },
  "精选视频": {
   "visible": true,
   "ms": 1262,
   "ariaPressed": null,
   "cls": "inline-flex items-center whitespace-nowrap focus-visible:outline-none ",
   "titlesChanged": false,
   "bodyDiff": 0,
   "beforeTitles": [
    "语文"
   ],
   "afterTitles": [
    "语文"
   ]
  }
 },
 "categorySummary": [
  {
   "label": "AI 工具 209 · 9 个子分类",
   "parent": "DETAILS",
   "open": true,
   "children": 10,
   "hasOnClickAttr": false
  },
  {
   "label": "前端开发 147 · 4 个子分类",
   "parent": "DETAILS",
   "open": false,
   "children": 5,
   "hasOnClickAttr": false
  },
  {
   "label": "后端与云 155 · 5 个子分类",
   "parent": "DETAILS",
   "open": false,
   "children": 6,
   "hasOnClickAttr": false
  },
  {
   "label": "运维与安全 101 · 1 个子分类",
   "parent": "DETAILS",
   "open": false,
   "children": 2,
   "hasOnClickAttr": false
  },
  {
   "label": "开发者资源 145 · 5 个子分类",
   "parent": "DETAILS",
   "open": false,
   "children": 6,
   "hasOnClickAttr": false
  },
  {
   "label": "设计与创意 27 · 1 个子分类",
   "parent": "DETAILS",
   "open": false,
   "children": 2,
   "hasOnClickAttr": false
  },
  {
   "label": "效率办公 173 · 4 个子分类",
   "parent": "DETAILS",
   "open": false,
   "children": 5,
   "hasOnClickAttr": false
  }
 ],
 "categorySummaryProbe": {
  "before": 1,
  "after": 2,
  "expanded": true
 },
 "adminHeadings": [
  {
   "route": "/admin/navigation",
   "h1": [],
   "h2": [
    "管理菜单"
   ],
   "headingish": [
    "NavSphere"
   ],
   "mainAria": "",
   "skeleton": 0
  },
  {
   "route": "/admin/resources",
   "h1": [],
   "h2": [
    "管理菜单"
   ],
   "headingish": [
    "NavSphere"
   ],
   "mainAria": "",
   "skeleton": 0
  },
  {
   "route": "/admin/site",
   "h1": [],
   "h2": [
    "管理菜单"
   ],
   "headingish": [
    "NavSphere"
   ],
   "mainAria": "",
   "skeleton": 0
  },
  {
   "route": "/admin/sitelist",
   "h1": [],
   "h2": [
    "管理菜单"
   ],
   "headingish": [
    "NavSphere"
   ],
   "mainAria": "",
   "skeleton": 0
  },
  {
   "route": "/admin/videos",
   "h1": [],
   "h2": [
    "管理菜单"
   ],
   "headingish": [
    "NavSphere"
   ],
   "mainAria": "",
   "skeleton": 0
  },
  {
   "route": "/admin/tags",
   "h1": [
    "多维标签与词表治理"
   ],
   "h2": [
    "管理菜单"
   ],
   "headingish": [
    "NavSphere",
    "多维标签与词表治理"
   ],
   "mainAria": "",
   "skeleton": 0
  }
 ],
 "homeDialogs": [
  {
   "label": "站点导航",
   "hidden": "true",
   "state": null,
   "visible": false,
   "text": "NavHub 导航AI-Native Hubv5.0个人私有空间空间所有者[da"
  }
 ],
 "homeTabSwitch": {
  "found": false,
  "wallMs": 136
 },
 "graph": [
  {
   "label": "全部",
   "visible": true,
   "nodesDiff": 0,
   "transformChanged": false,
   "beforeTransform": "translate(0, 0) scale(1)",
   "afterTransform": "translate(0, 0) scale(1)",
   "bodyDiff": 0
  },
  {
   "label": "UI & 设计",
   "visible": true,
   "nodesDiff": -75,
   "transformChanged": false,
   "beforeTransform": "translate(0, 0) scale(1)",
   "afterTransform": "translate(0, 0) scale(1)",
   "bodyDiff": -216
  },
  {
   "label": "AI 实验室",
   "visible": true,
   "nodesDiff": -6,
   "transformChanged": false,
   "beforeTransform": "translate(0, 0) scale(1)",
   "afterTransform": "translate(0, 0) scale(1)",
   "bodyDiff": -8
  },
  {
   "label": "放大",
   "visible": false
  },
  {
   "label": "缩小",
   "visible": false
  }
 ],
 "marketplace": [
  {
   "label": "全部插件",
   "visible": true,
   "via": "locator",
   "ms": 1293,
   "cardsDiff": 0,
   "bodyDiff": 0,
   "dialog": false,
   "headChanged": false,
   "beforeActive": [],
   "afterActive": []
  },
  {
   "label": "🔥 飙升榜",
   "visible": true,
   "via": "locator",
   "ms": 1311,
   "cardsDiff": 0,
   "bodyDiff": 0,
   "dialog": false,
   "headChanged": false,
   "beforeActive": [],
   "afterActive": []
  },
  {
   "label": "搜索",
   "visible": true,
   "via": "locator",
   "ms": 1295,
   "cardsDiff": 0,
   "bodyDiff": 0,
   "dialog": false,
   "headChanged": false,
   "beforeActive": [],
   "afterActive": []
  },
  {
   "label": "已安装",
   "visible": false
  },
  {
   "label": "Taps 订阅源",
   "visible": true,
   "via": "locator",
   "ms": 1519,
   "cardsDiff": 0,
   "bodyDiff": 480,
   "dialog": true,
   "headChanged": false,
   "beforeActive": [],
   "afterActive": []
  }
 ],
 "custom": [
  {
   "label": "💻 全栈极客工作台",
   "visible": true,
   "dialogNow": false,
   "bodyDiff": 0,
   "modulesDiff": 0,
   "hashChanged": false,
   "canvasChanged": false
  },
  {
   "label": "赛博点阵画布",
   "visible": false
  },
  {
   "label": "时钟",
   "visible": true,
   "dialogNow": false,
   "bodyDiff": 0,
   "modulesDiff": 0,
   "hashChanged": false,
   "canvasChanged": false
  },
  {
   "label": "UUID",
   "visible": true,
   "dialogNow": false,
   "bodyDiff": 0,
   "modulesDiff": 0,
   "hashChanged": false,
   "canvasChanged": false
  },
  {
   "label": "编辑模式",
   "visible": false
  },
  {
   "label": "复制全文内容",
   "visible": false
  },
  {
   "label": "添加模块",
   "visible": false
  }
 ],
 "adminSidebar": [
  {
   "label": "导航管理",
   "visible": true,
   "latency": 72,
   "before": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 0
   },
   "expanded": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 1
   },
   "collapsed": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 0
   }
  },
  {
   "label": "插件市场",
   "visible": true,
   "latency": 102,
   "before": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 0
   },
   "expanded": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 1
   },
   "collapsed": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 0
   }
  },
  {
   "label": "资源管理",
   "visible": true,
   "latency": 57,
   "before": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 0
   },
   "expanded": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 1
   },
   "collapsed": {
    "childPresent": false,
    "url": "/admin/trash",
    "chev": 0
   }
  }
 ],
 "zeroControlPages": [
  {
   "route": "/sites",
   "at": [
    {
     "settle": 600,
     "total": 90,
     "visible": 86,
     "buttons": 0,
     "inputs": 0,
     "bodyLen": 2532,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:按分类浏览",
      "A:按标签浏览全部站点",
      "A:精选专题合集",
      "A:CCursorAI 驱动的代"
     ]
    },
    {
     "settle": 2500,
     "total": 90,
     "visible": 86,
     "buttons": 0,
     "inputs": 0,
     "bodyLen": 2532,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:按分类浏览",
      "A:按标签浏览全部站点",
      "A:精选专题合集",
      "A:CCursorAI 驱动的代"
     ]
    },
    {
     "settle": 5000,
     "total": 90,
     "visible": 86,
     "buttons": 0,
     "inputs": 0,
     "bodyLen": 2532,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:按分类浏览",
      "A:按标签浏览全部站点",
      "A:精选专题合集",
      "A:CCursorAI 驱动的代"
     ]
    }
   ]
  },
  {
   "route": "/tags",
   "at": [
    {
     "settle": 600,
     "total": 380,
     "visible": 376,
     "buttons": 0,
     "inputs": 1,
     "bodyLen": 7325,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:返回主页",
      "INPUT:搜索标签名称或技术栈",
      "A:开源123",
      "A:国产34"
     ]
    },
    {
     "settle": 2500,
     "total": 380,
     "visible": 376,
     "buttons": 0,
     "inputs": 1,
     "bodyLen": 7325,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:返回主页",
      "INPUT:搜索标签名称或技术栈",
      "A:开源123",
      "A:国产34"
     ]
    },
    {
     "settle": 5000,
     "total": 380,
     "visible": 376,
     "buttons": 0,
     "inputs": 1,
     "bodyLen": 7325,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:返回主页",
      "INPUT:搜索标签名称或技术栈",
      "A:开源123",
      "A:国产34"
     ]
    }
   ]
  },
  {
   "route": "/collections",
   "at": [
    {
     "settle": 600,
     "total": 27,
     "visible": 23,
     "buttons": 0,
     "inputs": 0,
     "bodyLen": 585,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:返回主页",
      "A:主题2026 前沿 Agen",
      "A:主题AI 编程工具链从补全到",
      "A:路线图前端入门路线零基础到能"
     ]
    },
    {
     "settle": 2500,
     "total": 27,
     "visible": 23,
     "buttons": 0,
     "inputs": 0,
     "bodyLen": 585,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:返回主页",
      "A:主题2026 前沿 Agen",
      "A:主题AI 编程工具链从补全到",
      "A:路线图前端入门路线零基础到能"
     ]
    },
    {
     "settle": 5000,
     "total": 27,
     "visible": 23,
     "buttons": 0,
     "inputs": 0,
     "bodyLen": 585,
     "sample": [
      "A:跳到主要内容",
      "A:首页",
      "A:返回主页",
      "A:主题2026 前沿 Agen",
      "A:主题AI 编程工具链从补全到",
      "A:路线图前端入门路线零基础到能"
     ]
    }
   ]
  },
  {
   "route": "/preferences",
   "at": [
    {
     "settle": 600,
     "total": 38,
     "visible": 34,
     "buttons": 3,
     "inputs": 2,
     "bodyLen": 798,
     "sample": [
      "A:跳到主要内容",
      "A:概览",
      "A:账号",
      "A:工作空间",
      "A:收藏",
      "A:搜索历史"
     ]
    },
    {
     "settle": 2500,
     "total": 38,
     "visible": 34,
     "buttons": 3,
     "inputs": 2,
     "bodyLen": 798,
     "sample": [
      "A:跳到主要内容",
      "A:概览",
      "A:账号",
      "A:工作空间",
      "A:收藏",
      "A:搜索历史"
     ]
    },
    {
     "settle": 5000,
     "total": 38,
     "visible": 34,
     "buttons": 3,
     "inputs": 2,
     "bodyLen": 798,
     "sample": [
      "A:跳到主要内容",
      "A:概览",
      "A:账号",
      "A:工作空间",
      "A:收藏",
      "A:搜索历史"
     ]
    }
   ]
  }
 ],
 "externalRetry": [
  {
   "url": "https://podcastle.ai/",
   "attempts": [
    {
     "status": 200,
     "ms": 4364
    },
    {
     "status": 200,
     "ms": 2435
    }
   ]
  },
  {
   "url": "https://www.copy.ai/",
   "attempts": [
    {
     "status": 200,
     "ms": 1544
    },
    {
     "status": 200,
     "ms": 818
    }
   ]
  },
  {
   "url": "https://github.com/huggingface/peft",
   "attempts": [
    {
     "status": 200,
     "ms": 4486
    },
    {
     "status": 200,
     "ms": 557
    }
   ]
  },
  {
   "url": "https://uniapp.dcloud.net.cn/",
   "attempts": [
    {
     "status": 200,
     "ms": 273
    },
    {
     "status": 200,
     "ms": 188
    }
   ]
  },
  {
   "url": "https://uberduck.ai/",
   "attempts": [
    {
     "status": 200,
     "ms": 3925
    },
    {
     "status": 200,
     "ms": 2020
    }
   ]
  },
  {
   "url": "https://x.ai/",
   "attempts": [
    {
     "status": 200,
     "ms": 2496
    },
    {
     "status": 200,
     "ms": 774
    }
   ]
  },
  {
   "url": "https://poe.com/",
   "attempts": [
    {
     "status": 0,
     "ms": 12100,
     "error": "apiRequestContext.get: Timeout 12000ms exceeded."
    },
    {
     "status": 403,
     "ms": 4594
    }
   ]
  }
 ]
}
```