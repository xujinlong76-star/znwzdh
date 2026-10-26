import type { SiteConfig, SiteInfo } from '@/types/site'
import type { NavigationData, NavigationDataRaw, NavigationItem, NavigationSubItem, NavigationSubItemRaw, VideoConfig } from '@/types/navigation'

export function processSiteData(siteDataRaw: SiteInfo): SiteConfig {
    return {
        ...siteDataRaw,
        appearance: {
            ...siteDataRaw.appearance,
            theme: (siteDataRaw.appearance?.theme === 'light' ||
                siteDataRaw.appearance?.theme === 'dark' ||
                siteDataRaw.appearance?.theme === 'system')
                ? siteDataRaw.appearance.theme
                : 'system'
        },
        navigation: {
            linkTarget: (siteDataRaw.navigation?.linkTarget === '_blank' ||
                siteDataRaw.navigation?.linkTarget === '_self')
                ? siteDataRaw.navigation.linkTarget
                : '_blank'
        }
    } as SiteConfig
}

export function processNavigationSubItem(item: NavigationSubItemRaw): NavigationSubItem {
    let videoConfig: VideoConfig | undefined = undefined

    if (item.videoConfig) {
        const validType = (item.videoConfig.type === 'bilibili' || item.videoConfig.type === 'youtube')
            ? item.videoConfig.type as 'bilibili' | 'youtube'
            : 'bilibili' // default fallback

        videoConfig = {
            type: validType,
            videoId: item.videoConfig.videoId,
            bvid: item.videoConfig.bvid,
            aid: item.videoConfig.aid,
            cid: item.videoConfig.cid,
            p: item.videoConfig.p,
            author: item.videoConfig.author,
            authorUrl: item.videoConfig.authorUrl,
            durationSec: item.videoConfig.durationSec,
            publishedAt: item.videoConfig.publishedAt,
            harvestedAt: item.videoConfig.harvestedAt,
            lastVerifiedAt: item.videoConfig.lastVerifiedAt,
            qualityScore: item.videoConfig.qualityScore,
            freshnessScore: item.videoConfig.freshnessScore,
            sourceType: item.videoConfig.sourceType,
            trendKeyword: item.videoConfig.trendKeyword,
            pinned: item.videoConfig.pinned,
            healthStatus: item.videoConfig.healthStatus,
            stats: item.videoConfig.stats,
        }
    }

    return {
        id: item.id,
        title: item.title,
        href: item.href,
        description: item.description,
        icon: item.icon,
        useDefaultIcon: item.useDefaultIcon,
        enabled: item.enabled,
        // 2026-10-21 放行 tags：navigation.json 的条目一直带着（导航站自己的
        // taxonomy），此前白名单裁掉它，首页 rich 卡片 #tag 芯片永远没数据。
        tags: item.tags,
        videoConfig
    }
}

export function processNavigationData(navigationDataRaw: NavigationDataRaw): NavigationData {
    const processedItems = navigationDataRaw.navigationItems.map(category => ({
        ...category,
        harvestPolicy: category.harvestPolicy,
        items: category.items?.map(processNavigationSubItem),
        subCategories: category.subCategories?.map(sub => ({
            ...sub,
            harvestPolicy: sub.harvestPolicy,
            items: sub.items?.map(processNavigationSubItem)
        }))
    }))

    return {
        navigationItems: processedItems as NavigationItem[],
        replacementHistory: navigationDataRaw.replacementHistory,
    }
}

export function filterNavigationData(navigationData: NavigationData): NavigationData {
    const filteredItems = navigationData.navigationItems
        .filter(category => category.enabled !== false)
        .map(category => {
            const filteredSubCategories = category.subCategories
                ? category.subCategories
                    .filter((sub) => sub.enabled !== false)
                    .map((sub) => ({
                        ...sub,
                        items: sub.items?.filter((item) => item.enabled !== false)
                    }))
                : undefined

            return {
                ...category,
                items: category.items?.filter((item) => item.enabled !== false),
                subCategories: filteredSubCategories
            }
        }) as NavigationItem[]

    return {
        navigationItems: filteredItems,
        replacementHistory: navigationData.replacementHistory,
    }
}

export function getProcessedData(navigationDataRaw: NavigationDataRaw, siteDataRaw: SiteInfo) {
    const siteData = processSiteData(siteDataRaw)
    const processedNavigationData = processNavigationData(navigationDataRaw)
    const navigationData = filterNavigationData(processedNavigationData)

    return {
        siteData,
        navigationData
    }
}
