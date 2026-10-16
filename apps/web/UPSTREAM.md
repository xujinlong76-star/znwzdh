# NavSphere upstream

This directory is derived from [NavSphere](https://github.com/tianyaxiang/NavSphere) (MIT licensed).

- Upstream ref: main
- Upstream commit: 6ba74fab9f86aa6ba4e276c002128a8f5a0acc0a
- Vendored at: 2026-10-16T08:36:42.195Z
- Re-vendor: node scripts/vendor-web.mjs

NavHub-owned files live in apps/web-overlay/ (applied on top of upstream):
- src/lib/storage-adapter.ts -- storage seam (github | http | sqlite)
- src/lib/github.ts -- facade keeping upstream's two-function signature
- src/lib/navhub-api.ts, src/lib/identity.ts, src/hooks/useFavorites.ts
- src/components/search-palette.tsx, favorite-button.tsx, ...
- src/app/tags|hot|favorites|site/[id]|admin/jobs|admin/stats pages
