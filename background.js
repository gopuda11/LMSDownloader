// background.js - Manifest V3 Service Worker

const tabMediaMap = new Map();
let dnrRuleCounter = 10000;

// Listen for network requests matching LMS video endpoints and media streams
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, tabId, initiator } = details;
    if (!tabId || tabId < 0) return;

    // Filter out common trackers, images, preloader videos
    if (url.includes('preloader') || url.includes('/analytics') || url.includes('/beacon')) {
      return;
    }

    if (!tabMediaMap.has(tabId)) {
      tabMediaMap.set(tabId, new Map());
    }
    const mediaSet = tabMediaMap.get(tabId);

    // 1. Xinics / Uniplayer / Commons embed or metadata endpoint
    // e.g. https://commons.dankook.ac.kr/em/..., https://cms.ginue.ac.kr/viewer/ssplayer/...
    const isEmbed = /https?:\/\/[^\/]+(?:\/em\/[a-zA-Z0-9_-]+|\/viewer\/ssplayer|\/uniplayer_support\/content\.php)/i.test(url);
    if (isEmbed) {
      const key = `embed_${url.split('?')[0]}`;
      if (!mediaSet.has(key)) {
        mediaSet.set(key, {
          type: 'embed',
          url: url,
          initiator: initiator || '',
          timestamp: Date.now()
        });
      }
      return;
    }

    // 2. Direct MP4 / M3U8 video stream request
    const isMedia = /\.(mp4|m3u8|webm)(\?|$)/i.test(url);
    if (isMedia) {
      const key = `media_${url.split('?')[0]}`;
      if (!mediaSet.has(key)) {
        const ext = url.match(/\.(mp4|m3u8|webm)/i)?.[1]?.toLowerCase() || 'mp4';
        mediaSet.set(key, {
          type: 'direct',
          url: url,
          ext: ext,
          initiator: initiator || '',
          timestamp: Date.now()
        });
      }
    }
  },
  { urls: ['*://*/*'] }
);

// Clear cache on tab navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabMediaMap.delete(tabId);
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaMap.delete(tabId);
});

// Handle incoming messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getDetectedMedia') {
    const tabId = request.tabId;
    const items = tabMediaMap.has(tabId)
      ? Array.from(tabMediaMap.get(tabId).values())
      : [];
    sendResponse({ media: items });
    return false;
  }

  if (request.action === 'registerMedia') {
    const tabId = request.tabId || sender.tab?.id;
    if (tabId && request.item) {
      if (!tabMediaMap.has(tabId)) {
        tabMediaMap.set(tabId, new Map());
      }
      const key = request.item.key || request.item.url;
      tabMediaMap.get(tabId).set(key, request.item);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'fetchUniplayerXml') {
    const { url, referer } = request;
    const headers = {};
    if (referer) {
      headers['Referer'] = referer;
    }

    fetch(url, { headers })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((xml) => sendResponse({ xml }))
      .catch((err) => sendResponse({ error: err.message }));

    return true; // async sendResponse
  }

  if (request.action === 'downloadVideo') {
    const { url, filename, referer } = request;
    handleDownload(url, filename, referer)
      .then((res) => sendResponse({ success: true, downloadId: res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    return true; // async sendResponse
  }
});

// Configure dynamic Declarative Net Request rule to set Referer for CDN bypass
async function handleDownload(videoUrl, filename, refererUrl) {
  if (refererUrl) {
    try {
      const targetHost = new URL(videoUrl).hostname;
      const refererOrigin = new URL(refererUrl).origin;
      const ruleId = (dnrRuleCounter++ % 1000) + 10000;

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: [
          {
            id: ruleId,
            priority: 100,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Referer', operation: 'set', value: refererUrl },
                { header: 'Origin', operation: 'set', value: refererOrigin }
              ]
            },
            condition: {
              urlFilter: `*://${targetHost}/*`,
              resourceTypes: [
                'main_frame',
                'sub_frame',
                'xmlhttprequest',
                'media',
                'other'
              ]
            }
          }
        ]
      });
    } catch (e) {
      console.warn('[background.js] Could not update DNR rule:', e);
    }
  }

  const safeFilename = filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/, '')
    .trim() || 'lecture.mp4';

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: videoUrl,
        filename: safeFilename,
        conflictAction: 'uniquify',
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}
