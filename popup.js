// popup.js - LMS Video Downloader controller

const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const videoList = document.getElementById('video-list');
const schoolBadge = document.getElementById('school-badge');
const rescanBtn = document.getElementById('rescan-btn');
const emptyRescanBtn = document.getElementById('empty-rescan-btn');
const toastEl = document.getElementById('toast');
const helpLink = document.getElementById('help-link');

const detectedVideos = new Map(); // key -> VideoInfo

document.addEventListener('DOMContentLoaded', init);
rescanBtn.addEventListener('click', () => refreshScan(true));
emptyRescanBtn.addEventListener('click', () => refreshScan(true));
helpLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://github.com/gopuda11/LMSDownloader#readme' });
});

async function init() {
  await refreshScan(false);
}

async function refreshScan(isManual = false) {
  showLoading();
  detectedVideos.clear();
  videoList.innerHTML = '';

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      showEmpty('활성화된 브라우저 탭을 찾을 수 없습니다.');
      return;
    }

    updateSchoolBadge(tab.url || '');

    // 1. Fetch media intercepted by background service worker
    const bgMedia = await fetchBackgroundMedia(tab.id);

    // 2. Scan DOM and iframes in all frames
    const frameScanResults = await executeFrameScanner(tab.id);

    // 3. Process all found embed and direct media items
    const allCandidates = [...bgMedia, ...frameScanResults];

    for (const item of allCandidates) {
      await processCandidate(item, tab);
    }

    if (detectedVideos.size === 0) {
      showEmpty();
      if (isManual) {
        showToast('감지된 영상이 없습니다. 영상을 재생 후 다시 시도해보세요.');
      }
    } else {
      renderVideoList();
      if (isManual) {
        showToast(`${detectedVideos.size}개의 강의 영상을 찾았습니다!`);
      }
    }
  } catch (err) {
    console.error('[popup.js] Scan error:', err);
    showEmpty(`오류가 발생했습니다: ${err.message}`);
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length > 0 ? tabs[0] : null;
}

function updateSchoolBadge(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('dankook')) {
      schoolBadge.textContent = '단국대학교 이러닝';
      schoolBadge.className = 'badge badge-primary';
    } else if (hostname.includes('khu')) {
      schoolBadge.textContent = '경희대학교 e-Campus';
      schoolBadge.className = 'badge badge-primary';
    } else if (hostname.includes('cau')) {
      schoolBadge.textContent = '중앙대학교 e-Class';
      schoolBadge.className = 'badge badge-primary';
    } else if (hostname.includes('ginue')) {
      schoolBadge.textContent = '경인교대 LMS';
      schoolBadge.className = 'badge badge-primary';
    } else if (hostname.includes('hanyang')) {
      schoolBadge.textContent = '한양대학교 LMS';
      schoolBadge.className = 'badge badge-primary';
    } else if (hostname.includes('canvas') || hostname.includes('learningx')) {
      schoolBadge.textContent = 'LearningX LMS';
      schoolBadge.className = 'badge badge-primary';
    } else {
      schoolBadge.textContent = 'LMS / 웹 동영상';
      schoolBadge.className = 'badge badge-neutral';
    }
  } catch {
    schoolBadge.textContent = '이러닝 감지';
    schoolBadge.className = 'badge badge-neutral';
  }
}

async function fetchBackgroundMedia(tabId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getDetectedMedia', tabId }, (res) => {
      if (chrome.runtime.lastError || !res || !res.media) {
        resolve([]);
      } else {
        resolve(res.media);
      }
    });
  });
}

async function executeFrameScanner(tabId) {
  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: scanCurrentFrameInPage
    });

    const items = [];
    if (injectionResults && Array.isArray(injectionResults)) {
      for (const res of injectionResults) {
        if (res && res.result && Array.isArray(res.result.items)) {
          for (const it of res.result.items) {
            items.push({
              ...it,
              pageTitle: res.result.pageTitle || ''
            });
          }
        }
      }
    }
    return items;
  } catch (err) {
    console.warn('[popup.js] Frame script injection failed (may be restricted page):', err);
    return [];
  }
}

// Injected into page frames
function scanCurrentFrameInPage() {
  const items = [];
  const currentUrl = window.location.href;
  const pageTitle = document.title || '';

  // 1. Current frame URL check
  if (/\/em\/[a-zA-Z0-9_-]+/i.test(currentUrl) || /uniplayer/i.test(currentUrl)) {
    items.push({
      type: 'embed',
      url: currentUrl,
      title: pageTitle
    });
  }

  // 2. Scan iframes
  try {
    const iframes = document.querySelectorAll('iframe');
    for (const ifr of iframes) {
      const src = ifr.src || ifr.getAttribute('data-src') || '';
      if (src && (/\/em\/[a-zA-Z0-9_-]+/i.test(src) || /uniplayer/i.test(src) || /clms/i.test(src) || /commons/i.test(src))) {
        items.push({
          type: 'embed',
          url: src,
          title: ifr.title || pageTitle
        });
      }
    }
  } catch (e) {}

  // 3. Scan video tags
  try {
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const src = v.currentSrc || v.src;
      if (src && !src.startsWith('blob:') && !src.includes('preloader')) {
        items.push({
          type: 'direct',
          url: src,
          title: pageTitle || '강의 동영상',
          duration: v.duration || 0
        });
      }
      const sources = v.querySelectorAll('source');
      for (const s of sources) {
        if (s.src && !s.src.startsWith('blob:') && !s.src.includes('preloader')) {
          items.push({
            type: 'direct',
            url: s.src,
            title: pageTitle || '강의 동영상'
          });
        }
      }
    }
  } catch (e) {}

  return {
    currentUrl,
    pageTitle,
    items
  };
}

async function processCandidate(item, tab) {
  if (!item || !item.url) return;

  const url = item.url;

  // Pattern 1: Xinics Uniplayer / Commons embed URL
  const emMatch = url.match(/\/em\/([a-zA-Z0-9_-]+)/i);
  const contentIdMatch = url.match(/[?&]content_id=([a-zA-Z0-9_-]+)/i);
  const contentId = emMatch ? emMatch[1] : (contentIdMatch ? contentIdMatch[1] : null);

  if (contentId) {
    try {
      const origin = new URL(url).origin;
      const metadataUrl = `${origin}/viewer/ssplayer/uniplayer_support/content.php?content_id=${contentId}`;

      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'fetchUniplayerXml', url: metadataUrl, referer: `${origin}/` },
          resolve
        );
      });

      if (res && res.xml) {
        const metadata = parseUniplayerXml(res.xml, origin, url);
        if (metadata && metadata.videoUrl) {
          const key = `uniplayer_${contentId}`;
          if (!detectedVideos.has(key)) {
            detectedVideos.set(key, {
              key,
              title: metadata.title || item.title || tab.title || '강의 영상',
              videoUrl: metadata.videoUrl,
              ext: metadata.ext || 'mp4',
              referer: origin + '/',
              sourceType: 'LearningX Uniplayer'
            });
          }
          return;
        }
      }
    } catch (e) {
      console.warn('[popup.js] Failed to parse Uniplayer candidate:', e);
    }
  }

  // Pattern 2: Direct media file (.mp4, .m3u8, .webm)
  if (/\.(mp4|m3u8|webm)(\?|$)/i.test(url)) {
    const ext = url.match(/\.(mp4|m3u8|webm)/i)?.[1]?.toLowerCase() || 'mp4';
    const key = `direct_${url.split('?')[0]}`;
    if (!detectedVideos.has(key)) {
      const origin = new URL(url).origin;
      detectedVideos.set(key, {
        key,
        title: item.title || tab.title || '강의 영상',
        videoUrl: url,
        ext: ext,
        referer: item.initiator || origin + '/',
        sourceType: ext.toUpperCase() + ' 스트림'
      });
    }
  }
}

function parseUniplayerXml(xmlText, origin, embedUrl) {
  try {
    const parser = new DOMParser();
    const dom = parser.parseFromString(xmlText, 'text/xml');

    let titleEl = dom.querySelector('content_metadata title') || dom.querySelector('title');
    let title = titleEl ? titleEl.textContent.trim() : '';

    const contentTypeEl = dom.querySelector('content_playing_info content_type');
    const contentType = contentTypeEl?.textContent.trim() || '';

    let videoUrl = '';
    let ext = 'mp4';

    if (contentType.toLowerCase() !== 'upf') {
      // New format
      const cpi = dom.querySelector('content_playing_info');
      if (cpi) {
        const mediaUris = Array.from(cpi.getElementsByTagName('media_uri'));
        const targetMedia = mediaUris.find((el) => el.hasAttribute('auth_value')) || mediaUris[0];
        if (targetMedia) {
          const uri = targetMedia.textContent.trim();
          const auth = targetMedia.getAttribute('auth_value');
          videoUrl = auth ? `${uri}?token=${auth}` : uri;
          ext = uri.split('?')[0].split('.').pop() || 'mp4';
        }
      }
    } else {
      // Old format (UPF)
      const mainMediaEl = dom.querySelector('main_media');
      const mediaUriEl = dom.querySelector('media_uri');
      if (mainMediaEl && mediaUriEl) {
        const mediaFile = mainMediaEl.textContent.trim();
        const baseUri = mediaUriEl.textContent.trim();
        const auth = mainMediaEl.getAttribute('auth_value');
        const resolved = baseUri.replace('[MEDIA_FILE]', mediaFile);
        videoUrl = auth ? `${resolved}?token=${auth}` : resolved;
        ext = mediaFile.split('.').pop().trim() || 'mp4';
      }
    }

    if (!videoUrl) return null;

    // Relative path resolution
    if (videoUrl.startsWith('/')) {
      videoUrl = origin + videoUrl;
    }

    return { title, videoUrl, ext };
  } catch (err) {
    console.error('[popup.js] XML parse error:', err);
    return null;
  }
}

function renderVideoList() {
  videoList.innerHTML = '';
  let index = 1;

  detectedVideos.forEach((video) => {
    const card = document.createElement('div');
    card.className = 'video-card';

    const defaultFilename = sanitizeFilename(
      video.title && video.title.length > 1 ? video.title : `강의영상_${index}`
    );

    card.innerHTML = `
      <div class="video-meta">
        <span class="type-pill">${escapeHtml(video.ext.toUpperCase())}</span>
        <span class="source-pill">${escapeHtml(video.sourceType || 'LMS')}</span>
      </div>
      <div class="filename-input-group">
        <label>저장 파일명</label>
        <div class="input-with-ext">
          <input type="text" class="filename-input" value="${escapeHtml(defaultFilename)}" />
          <span class="ext-label">.${escapeHtml(video.ext)}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary download-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
          다운로드
        </button>
        <button class="btn btn-secondary open-btn" title="새 탭에서 재생">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
          </svg>
          새 탭
        </button>
        <button class="btn btn-secondary copy-btn" title="영상 주소 복사">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
          복사
        </button>
      </div>
      <div class="status-msg hidden"></div>
    `;

    const input = card.querySelector('.filename-input');
    const downloadBtn = card.querySelector('.download-btn');
    const openBtn = card.querySelector('.open-btn');
    const copyBtn = card.querySelector('.copy-btn');
    const statusMsg = card.querySelector('.status-msg');

    downloadBtn.addEventListener('click', async () => {
      const chosenName = input.value.trim() || `강의영상_${index}`;
      const fullFilename = `${chosenName}.${video.ext}`;

      downloadBtn.disabled = true;
      downloadBtn.textContent = '요청 중...';
      statusMsg.className = 'status-msg';
      statusMsg.textContent = '다운로드를 시작합니다...';
      statusMsg.classList.remove('hidden');

      chrome.runtime.sendMessage(
        {
          action: 'downloadVideo',
          url: video.videoUrl,
          filename: fullFilename,
          referer: video.referer
        },
        (res) => {
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
            </svg> 다운로드
          `;

          if (res && res.success) {
            statusMsg.className = 'status-msg success';
            statusMsg.textContent = '✓ 브라우저 다운로드가 시작되었습니다!';
            showToast('다운로드가 시작되었습니다!');
          } else {
            statusMsg.className = 'status-msg error';
            statusMsg.textContent = `다운로드 실패: ${res?.error || '알 수 없는 오류'}`;
          }
        }
      );
    });

    openBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: video.videoUrl });
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(video.videoUrl);
        showToast('영상 URL이 클립보드에 복사되었습니다.');
      } catch {
        showToast('클립보드 복사 실패');
      }
    });

    videoList.appendChild(card);
    index++;
  });

  showList();
}

function showLoading() {
  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  videoList.classList.add('hidden');
}

function showEmpty(customText) {
  loadingState.classList.add('hidden');
  emptyState.classList.remove('hidden');
  videoList.classList.add('hidden');
  if (customText) {
    const tip = emptyState.querySelector('.empty-tip');
    if (tip) tip.textContent = customText;
  }
}

function showList() {
  loadingState.classList.add('hidden');
  emptyState.classList.add('hidden');
  videoList.classList.remove('hidden');
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2400);
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
