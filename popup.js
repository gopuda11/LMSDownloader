// popup.js - LMS Video Downloader controller

const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const videoList = document.getElementById('video-list');
const schoolBadge = document.getElementById('school-badge');
const rescanBtn = document.getElementById('rescan-btn');
const emptyRescanBtn = document.getElementById('empty-rescan-btn');
const toastEl = document.getElementById('toast');
const helpLink = document.getElementById('help-link');
const recoveryStatus = document.getElementById('automatic-status');
let scanRunning = false;
let recoveryErrors = [];
let materialCount = 0;

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
  if (scanRunning) return;
  scanRunning = true;
  rescanBtn.disabled = true;
  emptyRescanBtn.disabled = true;
  recoveryErrors = [];
  recoveryStatus.textContent = '';
  showLoading();
  detectedVideos.clear();
  videoList.replaceChildren();

  let isIlos = false;
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      showEmpty('활성화된 브라우저 탭을 찾을 수 없습니다.');
      return;
    }

    updateSchoolBadge(tab.url || '');
    isIlos = /^https:\/\/cyber\.hknu\.ac\.kr\//.test(tab.url || '');
    if (isIlos) {
      materialCount = 0;
      document.getElementById('document-section').classList.add('hidden');
      await scanIlosTab(tab);
      return;
    }
    materialCount = await scanMaterials(tab.id, tab.url);

    // 1. Fetch media intercepted by background service worker
    let bgMedia = await fetchBackgroundMedia(tab.id);

    // 2. Scan DOM and iframes in all frames
    const frameScanResults = await executeFrameScanner(tab.id);

    // Old tabs opened before the update cannot have an early response hook.
    // Reload once automatically, then wait for the document-start collector.
    if (!materialCount && !bgMedia.length && !frameScanResults.some(item => item.url) && isDankookLessonTab(tab.url)) {
      recoveryStatus.textContent = '강의 정보를 자동으로 다시 불러오는 중...';
      bgMedia = await reloadAndCollect(tab.id);
    }

    // 3. Process all found embed and direct media items
    const allCandidates = [...bgMedia, ...frameScanResults];
    const seen = new Set();

    for (const item of allCandidates) {
      const key = `${item.type}:${item.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.type === 'recoveryError') { recoveryErrors.push(item.error); continue; }
      await processCandidate(item, tab);
    }

    if (detectedVideos.size === 0) {
      showEmpty(recoveryErrors[0] || '영상이 감지되지 않았습니다. 페이지에서 원본 영상 정보를 찾지 못했습니다. 로그인 상태 또는 서버의 원본 삭제 여부를 확인해주세요.');
      if (isManual) {
        showToast(recoveryErrors[0] || '이 강의에서 다운로드 가능한 원본을 찾지 못했습니다.');
      }
    } else {
      renderVideoList();
      if (isManual) {
        showToast(`${detectedVideos.size}개의 강의 영상을 찾았습니다!`);
      }
    }
  } catch (err) {
    if (isIlos) {
      showEmpty('한경대 강의 화면에 연결하지 못했습니다. 로그인 후 다시 스캔해주세요.');
      recoveryStatus.textContent = '강의 탐색에 실패했습니다.';
    } else {
      console.error('[popup.js] Scan error:', err);
      showEmpty(`오류가 발생했습니다: ${err.message}`);
    }
  } finally {
    scanRunning = false;
    rescanBtn.disabled = false;
    emptyRescanBtn.disabled = false;
    if (!isIlos) recoveryStatus.textContent = scanStatus(detectedVideos.size, recoveryErrors, materialCount);
  }
}

function isDankookLessonTab(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'canvas.dankook.ac.kr' && (/^\/courses\/\d+\/modules\/items\/\d+/.test(u.pathname) || /^\/learningx\/lti\/lecture_attendance\/items\/view\/\d+/.test(u.pathname));
  } catch { return false; }
}

async function reloadAndCollect(tabId) {
  await chrome.tabs.reload(tabId);
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const items = await fetchBackgroundMedia(tabId);
    if (items.length) return items;
  }
  recoveryErrors.push('강의 정보가 수집되지 않았습니다. LMS 로그인 상태를 확인해주세요.');
  return [];
}

async function recoverCandidate(item, tab) {
  LMSRecovery.thumbnailRequest(item.url);
  const result = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'recoverCommonsContent', thumbnail: item.url }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response || response.error) reject(new Error(response?.error || '원본 조회 응답이 없습니다.'));
      else resolve(response);
    });
  });
  const parsed = parseUniplayerXml(result.xml, result.origin, result.shareUrl);
  if (!parsed?.videoUrl || !/^https?:\/\//i.test(parsed.videoUrl)) throw new Error('원본 정보는 찾았지만 재생 가능한 영상 주소가 없습니다.');
  if (Array.from(detectedVideos.values()).some(video => video.videoUrl === parsed.videoUrl)) return;
  const key = `uniplayer_${result.contentId}`;
  detectedVideos.set(key, {
    key, title: result.title || parsed.title || item.title || tab.title || '강의 영상',
    videoUrl: parsed.videoUrl, ext: parsed.ext || 'mp4', referer: result.origin + '/',
    viewUrl: result.viewUrl, sourceType: '기간 종료 영상 · 원본 찾음'
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length > 0 ? tabs[0] : null;
}

function updateSchoolBadge(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'cyber.hknu.ac.kr') {
      schoolBadge.textContent = '한경대학교 e-Class';
      schoolBadge.className = 'badge badge-primary';
    } else if (hostname.includes('dankook')) {
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
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['recovery.js'] });
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
async function scanCurrentFrameInPage() {
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

  // Re-read the GET request this LearningX item page already made. Do not guess API routes.
  const itemMatch = currentUrl.match(/\/learningx\/lti\/lecture_attendance\/items\/view\/(\d+)/);
  if (itemMatch && !items.some(item => item.type === 'direct' || item.type === 'embed')) {
    try {
      const itemId = itemMatch[1];
      const pageOrigin = new URL(currentUrl).origin;
      const resourceUrls = [...new Set(performance.getEntriesByType('resource')
        .filter(entry => ['fetch', 'xmlhttprequest'].includes(entry.initiatorType))
        .map(entry => entry.name))].filter(value => {
          try {
            const u = new URL(value);
            return u.origin === pageOrigin && u.pathname.includes('/learningx/') && u.pathname.endsWith(`/${itemId}`);
          } catch { return false; }
        });
      for (const url of resourceUrls.slice(-2)) {
        const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`강의 정보 조회 실패 (HTTP ${response.status}). 로그인 상태를 확인해주세요.`);
        const candidate = LMSRecovery.learningItemCandidate(await response.json(), itemId);
        if (candidate) { items.push(candidate); break; }
      }
    } catch (error) {
      items.push({ type: 'recoveryError', error: error.message });
    }
  }

  return {
    currentUrl,
    pageTitle,
    items
  };
}

async function processCandidate(item, tab) {
  if (!item || !item.url) return;
  if (item.type === 'commonsRecovery') {
    try { await recoverCandidate(item, tab); }
    catch (error) { recoveryErrors.push(error.message); }
    return;
  }

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
    if (!detectedVideos.has(key) && !Array.from(detectedVideos.values()).some(video => video.videoUrl === url)) {
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
  videoList.replaceChildren();
  let index = 1;

  detectedVideos.forEach((video) => {
    const card = document.createElement('div');
    card.className = 'video-card';

    const defaultFilename = sanitizeFilename(
      video.title && video.title.length > 1 ? video.title : `강의영상_${index}`
    );

    // 1. Meta
    const meta = document.createElement('div');
    meta.className = 'video-meta';
    const typePill = document.createElement('span');
    typePill.className = 'type-pill';
    typePill.textContent = (video.ext || 'mp4').toUpperCase();
    const srcPill = document.createElement('span');
    srcPill.className = 'source-pill';
    srcPill.textContent = video.sourceType || 'LMS';
    meta.appendChild(typePill);
    meta.appendChild(srcPill);
    card.appendChild(meta);

    // 2. Filename input group
    const group = document.createElement('div');
    group.className = 'filename-input-group';
    const label = document.createElement('label');
    label.textContent = '저장 파일명';
    const inputWithExt = document.createElement('div');
    inputWithExt.className = 'input-with-ext';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'filename-input';
    input.value = defaultFilename;

    const extLabel = document.createElement('span');
    extLabel.className = 'ext-label';
    extLabel.textContent = `.${video.ext || 'mp4'}`;

    inputWithExt.appendChild(input);
    inputWithExt.appendChild(extLabel);
    group.appendChild(label);
    group.appendChild(inputWithExt);
    card.appendChild(group);

    // 3. Actions
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-primary download-btn';
    downloadBtn.textContent = '⬇ 다운로드';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-secondary open-btn';
    openBtn.title = '새 탭에서 재생';
    openBtn.textContent = '↗ 새 탭';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary copy-btn';
    copyBtn.title = '영상 주소 복사';
    copyBtn.textContent = '📋 복사';

    actions.appendChild(downloadBtn);
    actions.appendChild(openBtn);
    actions.appendChild(copyBtn);
    card.appendChild(actions);

    // 4. Status message
    const statusMsg = document.createElement('div');
    statusMsg.className = 'status-msg hidden';
    card.appendChild(statusMsg);

    downloadBtn.addEventListener('click', async () => {
      const chosenName = input.value.trim() || `강의영상_${index}`;
      const fullFilename = `${chosenName}.${video.ext}`;

      downloadBtn.disabled = true;
      downloadBtn.textContent = '요청 중...';
      statusMsg.className = 'status-msg';
      statusMsg.textContent = '다운로드를 시작합니다...';
      statusMsg.classList.remove('hidden');

      const onDownload = (res) => {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '⬇ 다운로드';

        if (res && res.success) {
          statusMsg.className = 'status-msg success';
          statusMsg.textContent = '✓ 브라우저 다운로드가 시작되었습니다!';
          showToast('다운로드가 시작되었습니다!');
        } else {
          statusMsg.className = 'status-msg error';
          statusMsg.textContent = `다운로드 실패: ${res?.error || '알 수 없는 오류'}`;
        }
      };
      if (video.directDownload) {
        try {
          await downloadIlosVideo(video.videoUrl, fullFilename);
          onDownload({ success: true });
        } catch (error) { onDownload({ error: error.message }); }
      } else {
        chrome.runtime.sendMessage({
          action: 'downloadVideo', url: video.videoUrl,
          filename: fullFilename, referer: video.referer
        }, onDownload);
      }
    });

    openBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: video.viewUrl || video.videoUrl });
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


// Material conversion lives in a tab so closing the popup cannot interrupt it.
document.getElementById('local-pdf-btn').addEventListener('click', () => chrome.tabs.create({url: chrome.runtime.getURL('converter.html')}));
async function scanMaterials(tabId, tabURL) {
  const section = document.getElementById('document-section');
  const list = document.getElementById('document-list');
  section.classList.add('hidden'); list.replaceChildren();
  try {
    LMSDocuments.schoolURL(tabURL);
    const results = await chrome.scripting.executeScript({target:{tabId,allFrames:true},files:['documents.js','document-scanner.js']});
    const seen = new Set();
    for (const result of results) for (const item of result.result || []) {
      if (seen.has(item.url)) continue;
      let validated = LMSDocuments.candidate(item.url,item.title,tabURL);
      if (!validated) continue;
      if (validated.ext === 'unknown') {
        try {
          const response = await fetch(`https://canvas.dankook.ac.kr/api/v1/files/${validated.fileId}`, {credentials:'include',signal:AbortSignal.timeout(8000)});
          LMSDocuments.schoolURL(response.url);
          const data = JSON.parse(new TextDecoder().decode(await LMSDocuments.readBounded(response,1024*1024)));
          validated = LMSDocuments.candidate(item.url,data.display_name || data.filename,tabURL);
          if (!validated || validated.ext === 'unknown') continue;
        } catch { continue; }
      }
      item.title = validated.title;
      seen.add(item.url);
      const card = document.createElement('div'); card.className='video-card';
      const title=document.createElement('p');title.textContent=item.title;title.className='material-name';card.appendChild(title);
      const actions=document.createElement('div');actions.className='material-actions';
      const button=document.createElement('button');button.className='btn btn-primary';
      button.textContent='PDF로 저장';
      button.addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('converter.html')+'?'+new URLSearchParams({url:item.url,name:item.title})}));
      const original=document.createElement('button');original.className='btn btn-secondary';original.textContent='원본';
      original.addEventListener('click',()=>chrome.tabs.create({url:validated.url}));
      actions.append(button,original);card.appendChild(actions);list.appendChild(card);
    }
    if(seen.size)section.classList.remove('hidden');
    return seen.size;
  } catch {return 0;}
}

function scanStatus(videoCount, errors, materials) {
  if (videoCount) return '영상 탐색이 완료되었습니다.';
  if (materials) return '강의자료를 찾았습니다. PDF로 저장을 눌러주세요.';
  return errors[0] || '다운로드 가능한 원본을 찾지 못했습니다.';
}
