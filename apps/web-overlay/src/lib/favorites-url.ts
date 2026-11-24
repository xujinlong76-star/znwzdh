/**
 * 收藏页筛选条件的 URL 序列化（纯函数，可单测）。
 *
 * 为什么需要：搜索词、收藏夹、排序原本只是组件内 state。用户点开一个收藏
 * 站点再按浏览器返回，三个条件全部复位——在几十上百条收藏里重新筛一次。
 * 写进地址栏（replaceState）后，返回、刷新、复制链接都能还原同一视图。
 *
 * 约定：
 *  - 默认值不落参数，`/favorites` 保持干净；
 *  - 非法 sort 回退 `created`，超长 q 截断到 100（与输入框上限一致）；
 *  - folder 只接受非空字符串，`all` 视为默认。
 */

export type FavoritesSort = 'created' | 'title' | 'recent';

/**
 * 工作区视图（?view=）：站点收藏 / 星标插件 / 我的批注 / 公开导航页。
 * 我的批注是独立页面（/me/annotations），这里保留其值以兼容直达链接的回读。
 */
export type FavoritesView = 'sites' | 'plugins' | 'annotations' | 'public';

export interface FavoritesFilters {
  q: string;
  folder: string;
  sort: FavoritesSort;
  view: FavoritesView;
}

export const FAVORITES_DEFAULT_FILTERS: FavoritesFilters = {
  q: '',
  folder: 'all',
  sort: 'created',
  view: 'sites',
};

const MAX_Q = 100;
const VIEWS: readonly FavoritesView[] = ['sites', 'plugins', 'annotations', 'public'];

export function parseFavoritesFilters(search: string): FavoritesFilters {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawQ = params.get('q') ?? '';
  const rawFolder = params.get('folder') ?? '';
  const rawSort = params.get('sort');
  const rawView = params.get('view');
  return {
    q: rawQ.slice(0, MAX_Q),
    folder: rawFolder && rawFolder !== 'all' ? rawFolder.slice(0, 128) : 'all',
    sort: rawSort === 'title' ? 'title' : rawSort === 'recent' ? 'recent' : 'created',
    view: VIEWS.includes(rawView as FavoritesView) ? (rawView as FavoritesView) : 'sites',
  };
}

export function buildFavoritesSearch(filters: Omit<FavoritesFilters, 'view'> & { view?: FavoritesView }): string {
  const params = new URLSearchParams();
  const q = filters.q.trim().slice(0, MAX_Q);
  if (q) params.set('q', q);
  if (filters.folder && filters.folder !== 'all') params.set('folder', filters.folder);
  if (filters.sort === 'title') params.set('sort', 'title');
  if (filters.sort === 'recent') params.set('sort', 'recent');
  if (filters.view && filters.view !== 'sites') params.set('view', filters.view);
  const s = params.toString();
  return s ? `?${s}` : '';
}
