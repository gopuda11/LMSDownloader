// HKNU popup flow. Only lecture descriptors, titles and public MP4 URLs cross frames.
let ilosBatchRunning = false;
let ilosProgressRenderer = null;
const ilosProgressStore = chrome.storage?.session || chrome.storage?.local;
chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === (chrome.storage.session ? 'session' : 'local')) ilosProgressRenderer?.(changes);
});

async function scanIlosTab(tab) {
  ilosProgressRenderer = null;
  ilosBatchRunning = false;
  const results = await scanIlosFrames(tab.id);
  const top = results.find(result => result.frameId === 0)?.result;
  const lectures = LMSIlos.parseLectures(top?.onclicks || []);
  if (lectures.length) {
    recoveryStatus.textContent = `${lectures.length}개의 강의를 찾았습니다. 팝업을 닫아도 다운로드 요청은 계속됩니다.`;
    await renderIlosLectures(tab.id, lectures);
    return;
  }
  for (const frame of results) for (const url of LMSIlos.extractMp4Urls((frame.result?.sources || []).join(' '))) {
    if (detectedVideos.has(url)) continue;
    detectedVideos.set(url, {
      key: url, title: top?.title || frame.result.title || tab.title || '강의 영상',
      videoUrl: url, ext: 'mp4', directDownload: true, sourceType: '한경대 ILOS'
    });
  }
  if (detectedVideos.size) {
    renderVideoList();
    recoveryStatus.textContent = '영상 탐색이 완료되었습니다.';
  } else {
    showEmpty('주차별 강의 목록 또는 학습하기로 연 강의 화면에서 다시 스캔해주세요. 영상이 없으면 2차 인증과 로그인 상태를 확인해주세요.');
    recoveryStatus.textContent = '다운로드 가능한 강의 영상을 찾지 못했습니다.';
  }
}

// One inaccessible child frame must not hide the lecture list in the main frame.
async function scanIlosFrames(tabId) {
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: scanIlosFrameInPage });
  } catch {
    return chrome.scripting.executeScript({ target: { tabId }, func: scanIlosFrameInPage });
  }
}

// Runs in each frame without ilos.js; the popup parses and validates what it returns.
function scanIlosFrameInPage() {
  if (location.origin !== 'https://cyber.hknu.ac.kr') return {};
  if (location.pathname === '/ilos/st/course/online_list_form.acl') {
    return { onclicks: Array.from(document.querySelectorAll('[onclick]'), node => node.getAttribute('onclick')) };
  }
  const title = (document.querySelector('.item-title-lesson-on') || document.querySelector('.item-title-lesson'))?.textContent.trim() || '';
  const sources = [];
  for (const video of document.querySelectorAll('video')) {
    sources.push(video.currentSrc, video.src, ...Array.from(video.querySelectorAll('source'), source => source.src));
  }
  return { title, sources: sources.filter(Boolean) };
}

async function downloadIlosVideo(url, filename) {
  const validated = LMSIlos.extractMp4Urls(url);
  if (validated.length !== 1 || validated[0] !== url) throw new Error('한경대 MP4 영상 주소가 올바르지 않습니다.');
  const name = sanitizeFilename(filename).replace(/^\.+|\.+$/g, '') || '강의영상.mp4';
  return chrome.downloads.download({ url, filename: name, conflictAction: 'uniquify', saveAs: false });
}

async function renderIlosLectures(tabId, lectures) {
  videoList.replaceChildren();
  const all = document.createElement('button');
  all.className = 'btn btn-primary';
  all.textContent = '이번 주 전체 다운로드';
  videoList.appendChild(all);
  const rows = lectures.map((lecture, index) => {
    const card = document.createElement('div');
    card.className = 'video-card';
    const title = document.createElement('p');
    title.className = 'material-name';
    title.textContent = `${lecture.week}주차 ${index + 1}번째`;
    const button = document.createElement('button');
    button.className = 'btn btn-primary download-btn';
    button.textContent = '다운로드';
    const status = document.createElement('div');
    status.className = 'status-msg';
    card.append(title, button, status);
    videoList.appendChild(card);
    return { lecture, title, button, status };
  });

  function renderProgress(state) {
    ilosBatchRunning = !!state?.running;
    rescanBtn.disabled = emptyRescanBtn.disabled = all.disabled = ilosBatchRunning;
    rows.forEach(row => {
      row.button.disabled = ilosBatchRunning;
      const saved = state?.rows[row.lecture.seq];
      row.status.textContent = saved?.status || '';
      if (saved?.title) row.title.textContent = saved.title;
    });
    if (state) recoveryStatus.textContent = state.running
      ? `${Math.min(state.done + 1, state.total)}/${state.total} 강의 조회 및 다운로드 요청 중... 팝업을 닫아도 계속됩니다.`
      : `다운로드 요청 완료: 성공 ${state.success}개, 실패 ${state.failed}개. 실패한 강의는 개별 안내를 확인해주세요.`;
  }

  async function run(selected) {
    if (ilosBatchRunning) return;
    renderProgress({ running: true, done: 0, total: selected.length, rows: {} });
    try {
      const response = await chrome.runtime.sendMessage({ action: 'ilosBatch', tabId, lectures: selected.map(row => row.lecture) })
        .catch(() => null);
      if (!response?.ok) throw new Error(response?.error || '다운로드 요청을 시작하지 못했습니다. 확장 프로그램을 다시 열어주세요.');
    } catch (error) {
      const saved = ilosProgressStore && (await ilosProgressStore.get(key))[key];
      renderProgress(saved);
      recoveryStatus.textContent = error.message;
    }
  }
  all.addEventListener('click', () => run(rows));
  rows.forEach(row => row.button.addEventListener('click', () => run([row])));
  showList();
  const key = `ilos-batch-tab-${tabId}`;
  // Subscribe before reading so changes during get() cannot be overwritten by an older snapshot.
  let changed = false;
  const update = changes => {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) return;
    changed = true;
    renderProgress(changes[key].newValue);
  };
  ilosProgressRenderer = update;
  if (ilosProgressStore) {
    const saved = await ilosProgressStore.get(key);
    if (!changed && ilosProgressRenderer === update) renderProgress(saved[key]);
  }
}
