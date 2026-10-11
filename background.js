// background.js - Manifest V3 Service Worker

if (typeof LMSRecovery === 'undefined') importScripts('recovery.js');

const tabMediaMap = new Map();
let dnrRuleCounter = 10000;
const allowedRequestUrls = ['*://*.dankook.ac.kr/*', '*://dankook-storage.commonscdn.com/*'];
const recoveryStore = chrome.storage?.session || chrome.storage?.local;
const recoveryKey = tabId => `lms-recovery-tab-${tabId}`;
const pendingStorage = new Map();

function queueStorage(tabId, operation) {
  const next = (pendingStorage.get(tabId) || Promise.resolve()).catch(() => {}).then(operation);
  pendingStorage.set(tabId, next);
  next.finally(() => { if (pendingStorage.get(tabId) === next) pendingStorage.delete(tabId); }).catch(() => {});
  return next;
}

async function capturedMedia(tabId) {
  await (pendingStorage.get(tabId) || Promise.resolve()).catch(() => {});
  if (!recoveryStore) return [];
  const key = recoveryKey(tabId);
  const record = (await recoveryStore.get(key))[key];
  return record ? [record] : [];
}

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
  { urls: allowedRequestUrls }
);

// Clear cache on tab navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    tabMediaMap.delete(tabId);
    if (recoveryStore) queueStorage(tabId, () => recoveryStore.remove(recoveryKey(tabId))).catch(() => {});
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaMap.delete(tabId);
  if (recoveryStore) queueStorage(tabId, () => recoveryStore.remove(recoveryKey(tabId))).catch(() => {});
});

// Handle incoming messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureLearningItem') {
    const match = String(sender.url || '').match(/^https:\/\/canvas\.dankook\.ac\.kr\/learningx\/lti\/lecture_attendance\/items\/view\/(\d+)(?:[/?#]|$)/);
    const tabId = sender.tab?.id;
    try {
      if (!match || String(request.itemId) !== match[1] || !Number.isInteger(tabId) || tabId < 0 || !recoveryStore) throw new Error('Invalid lesson sender');
      LMSRecovery.thumbnailRequest(request.thumbnail);
    } catch {
      sendResponse({ ok: false });
      return false;
    }
    const record = {
      type: 'commonsRecovery', url: request.thumbnail,
      title: String(request.title || '').slice(0, 300),
      itemId: request.itemId, pageUrl: sender.tab.url || '', timestamp: Date.now()
    };
    queueStorage(tabId, () => recoveryStore.set({ [recoveryKey(tabId)]: record }))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (request.action === 'getDetectedMedia') {
    const tabId = request.tabId;
    const items = tabMediaMap.has(tabId) ? Array.from(tabMediaMap.get(tabId).values()) : [];
    capturedMedia(tabId)
      .then(captured => sendResponse({ media: [...captured, ...items] }))
      .catch(() => sendResponse({ media: items }));
    return true;
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

  if (request.action === 'recoverCommonsContent') {
    LMSRecovery.recoverContent(request.thumbnail)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.name === 'TimeoutError' ? '콘텐츠 서버 응답 시간이 초과되었습니다. 다시 시도해주세요.' : err.message }));
    return true;
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

function allowedDownloadUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      !(url.hostname === 'dankook.ac.kr' || url.hostname.endsWith('.dankook.ac.kr') ||
        url.hostname === 'dankook-storage.commonscdn.com')) {
    throw new Error('단국대 LMS 및 확인된 콘텐츠 서버 주소만 지원합니다.');
  }
  url.hash = '';
  return url.href;
}

const ownedDownloadRule = rule => rule.id >= 10000 && rule.id < 11000;
const pendingDownloadRules = new Set();
let downloadRuleQueue = Promise.resolve();
function serializeDownloadRules(operation) {
  const task = downloadRuleQueue.then(operation);
  downloadRuleQueue = task.catch(() => {});
  return task;
}

async function removeUnusedDownloadRules() {
  const rules = (await chrome.declarativeNetRequest.getSessionRules()).filter(ownedDownloadRule);
  const active = await chrome.downloads.search({ state: 'in_progress' });
  const removeRuleIds = rules.filter(rule => {
    if (pendingDownloadRules.has(rule.id)) return false;
    try { return !active.some(download => new RegExp(rule.condition.regexFilter).test(download.url)); }
    catch { return true; }
  }).map(rule => rule.id);
  if (removeRuleIds.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
}

// Clear host-wide rules from older versions and recover after worker suspension.
const downloadRulesReady = serializeDownloadRules(async () => {
  const removeRuleIds = (await chrome.declarativeNetRequest.getDynamicRules()).filter(ownedDownloadRule).map(rule => rule.id);
  if (removeRuleIds.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
  await removeUnusedDownloadRules();
});
downloadRulesReady.catch(error => console.warn('[background.js] Rule initialization failed:', error));
chrome.downloads.onChanged.addListener(delta => {
  if (['complete', 'interrupted'].includes(delta.state?.current)) {
    serializeDownloadRules(removeUnusedDownloadRules).catch(error => console.warn('[background.js] Rule cleanup failed:', error));
  }
});

// Temporary header rule for exactly the requested download URL.
async function handleDownload(videoUrl, filename, refererUrl) {
  videoUrl = allowedDownloadUrl(videoUrl);
  if (refererUrl) refererUrl = allowedDownloadUrl(refererUrl);
  await downloadRulesReady;
  let ruleId;
  if (refererUrl) await serializeDownloadRules(async () => {
    const used = new Set((await chrome.declarativeNetRequest.getSessionRules()).map(rule => rule.id));
    for (let count = 0; count < 1000; count++) {
      const candidate = (dnrRuleCounter++ % 1000) + 10000;
      if (!used.has(candidate) && !pendingDownloadRules.has(candidate)) { ruleId = candidate; break; }
    }
    if (ruleId === undefined) throw new Error('진행 중인 다운로드가 너무 많습니다.');
    pendingDownloadRules.add(ruleId);
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{
        id: ruleId, priority: 100, action: { type: 'modifyHeaders', requestHeaders: [
          { header: 'Referer', operation: 'set', value: refererUrl },
          { header: 'Origin', operation: 'set', value: new URL(refererUrl).origin }
        ] }, condition: {
          regexFilter: '^' + videoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
          isUrlFilterCaseSensitive: true,
          resourceTypes: ['main_frame', 'media', 'other']
        }
      }] });
    } catch (error) { pendingDownloadRules.delete(ruleId); throw error; }
  });

  const safeFilename = String(filename || 'lecture.mp4')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/, '')
    .trim() || 'lecture.mp4';

  try { return await new Promise((resolve, reject) => {
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
  }); } finally {
    pendingDownloadRules.delete(ruleId);
    await serializeDownloadRules(removeUnusedDownloadRules).catch(error => console.warn('[background.js] Rule cleanup failed:', error));
  }
}
