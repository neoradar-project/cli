"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeCloudflareCache = purgeCloudflareCache;
// Cloudflare's purge-by-URL accepts at most 30 files per request.
const MAX_URLS_PER_REQUEST = 30;
async function purgeCloudflareCache(options) {
    const urls = [...new Set(options.urls.filter((u) => !!u))];
    if (urls.length === 0) {
        return 0;
    }
    for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
        const files = urls.slice(i, i + MAX_URLS_PER_REQUEST);
        const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${options.zoneId}/purge_cache`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${options.apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ files }),
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Cloudflare cache purge failed (HTTP ${response.status}): ${body}`);
        }
        const result = (await response.json());
        if (!result.success) {
            throw new Error(`Cloudflare cache purge failed: ${JSON.stringify(result.errors)}`);
        }
    }
    return urls.length;
}
//# sourceMappingURL=cloudflare.js.map