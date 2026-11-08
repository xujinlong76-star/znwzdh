import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), 'apps/web-overlay/src/components/sidebar.tsx');
let content = readFileSync(file, 'utf-8');

const target = `{navigationData.navigationItems.map((category) => (`;
const replacement = `{navigationData.navigationItems
            .filter((category) => {
              const directCount = category.items?.length || 0;
              const subCount = category.subCategories?.reduce((acc, sub) => acc + (sub.items?.length || 0), 0) || 0;
              if (category.title === '未分类' && directCount + subCount === 0) return false;
              return true;
            })
            .map((category) => {
              const visibleSubCategories = (category.subCategories || []).filter(
                (sub) => !sub.items || sub.items.length > 0
              );`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  // Also replace category.subCategories references inside the map
  content = content.replace(
    `{category.subCategories && category.subCategories.length > 0 && (`,
    `{visibleSubCategories.length > 0 && (`
  );
  content = content.replace(
    `{category.subCategories && category.subCategories.length > 0 && (`,
    `{visibleSubCategories.length > 0 && (`
  );
  content = content.replace(
    `{category.subCategories.map((subCategory) => (`,
    `{visibleSubCategories.map((subCategory) => (`
  );
  // Add closing brace for map
  content = content.replace(
    `            </div>\n          ))}`,
    `            </div>\n          )})}`
  );
  writeFileSync(file, content, 'utf-8');
  console.log('[Sidebar] Filtered empty uncategorized and empty subcategories');
} else {
  console.log('[Sidebar] Target not found');
}
