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

export type FavoritesSort = 'created' | 'title';

export interface FavoritesFilters {
  q: string;
  folder: string;
  sort: FavoritesSort;
}

export const FAVORITES_DEFAULT_FILTERS: FavoritesFilters = {
  q: '',
  folder: 'all',
  sort: 'created',
};

const MAX_Q = 100;

export function parseFavoritesFilters(search: string): FavoritesFilters {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawQ = params.get('q') ?? '';
  const rawFolder = params.get('folder') ?? '';
  const rawSort = params.get('sort');
  return {
    q: rawQ.slice(0, MAX_Q),
    folder: rawFolder && rawFolder !== 'all' ? rawFolder.slice(0, 128) : 'all',
    sort: rawSort === 'title' ? 'title' : 'created',
  };
}

export function buildFavoritesSearch(filters: FavoritesFilters): string {
  const params = new URLSearchParams();
  const q = filters.q.trim().slice(0, MAX_Q);
  if (q) params.set('q', q);
  if (filters.folder && filters.folder !== 'all') params.set('folder', filters.folder);
  if (filters.sort === 'title') params.set('sort', 'title');
  const s = params.toString();
  return s ? `?${s}` : '';
}
