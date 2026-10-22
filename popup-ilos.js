// HKNU popup flow. Only lecture descriptors, titles and public MP4 URLs cross frames.
async function scanIlosTab(tab) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['ilos.js'] });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true }, func: scanIlosFrameInPage
  });
  const top = results.find(result => result.frameId === 0)?.result;
  if (top?.lectures?.length) {
    renderIlosLectures(tab.id, top.lectures);
    recoveryStatus.textContent = `${top.lectures.length}개의 강의를 찾았습니다. 다운로드 중에는 팝업을 열어두세요.`;
    return;
  }
  for (const frame of results) for (const url of frame.result?.urls || []) {
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

function scanIlosFrameInPage() {
  if (location.origin !== 'https://cyber.hknu.ac.kr') return {};
  if (location.pathname === '/ilos/st/course/online_list_form.acl') {
    return { lectures: LMSIlos.parseLectures(Array.from(document.querySelectorAll('[onclick]'), node => node.getAttribute('onclick'))) };
  }
  const title = (document.querySelector('.item-title-lesson-on') || document.querySelector('.item-title-lesson'))?.textContent.trim() || '';
  const urls = new Set();
  for (const video of document.querySelectorAll('video')) {
    for (const value of [video.currentSrc, video.src, ...Array.from(video.querySelectorAll('source'), source => source.src)]) {
      for (const url of LMSIlos.extractMp4Urls(value || '')) urls.add(url);
    }
  }
  return { title, urls: Array.from(urls) };
}

async function resolveIlosLectureInPage(lecture) {
  if (location.origin !== 'https://cyber.hknu.ac.kr' || location.pathname !== '/ilos/st/course/online_list_form.acl') {
    return { error: '주차별 강의 목록에서 다시 시도해주세요.' };
  }
  const form = document.forms.namedItem('myform');
  const key = form?.elements.namedItem('_KJKEY')?.value;
  const type = form?.elements.namedItem('kj_lect_type')?.value;
  if (!key || !type) return { error: '강의 양식이 없습니다. 로그인 후 주차별 강의 목록을 다시 열어주세요.' };
  try { return await LMSIlos.resolveLecture(lecture, { _KJKEY: key, kj_lect_type: type }); }
  catch (error) { return { error: error.message }; }
}

async function downloadIlosVideo(url, filename) {
  const validated = LMSIlos.extractMp4Urls(url);
  if (validated.length !== 1 || validated[0] !== url) throw new Error('한경대 MP4 영상 주소가 올바르지 않습니다.');
  const name = sanitizeFilename(filename).replace(/^\.+|\.+$/g, '') || '강의영상.mp4';
  return chrome.downloads.download({ url, filename: name, conflictAction: 'uniquify', saveAs: false });
}

function renderIlosLectures(tabId, lectures) {
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

  async function run(selected) {
    if (scanRunning) return;
    scanRunning = true;
    rescanBtn.disabled = emptyRescanBtn.disabled = all.disabled = true;
    rows.forEach(row => { row.button.disabled = true; });
    let success = 0, failed = 0;
    try {
      // Reinject in case the page was reloaded while the popup was open.
      await chrome.scripting.executeScript({ target: { tabId }, files: ['ilos.js'] });
      for (const [index, row] of selected.entries()) {
        recoveryStatus.textContent = `${index + 1}/${selected.length} 강의 조회 및 다운로드 요청 중... 팝업을 열어두세요.`;
        row.status.textContent = '영상 주소 조회 중...';
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId }, func: resolveIlosLectureInPage, args: [row.lecture]
          });
          const result = results[0]?.result;
          if (!result || result.error) throw new Error(result?.error || '강의 조회 응답이 없습니다.');
          row.title.textContent = result.title;
          await downloadIlosVideo(result.url, `${result.title}.mp4`);
          row.status.textContent = '✓ 브라우저 다운로드가 시작되었습니다.';
          success++;
        } catch (error) {
          row.status.textContent = `다운로드 실패: ${error.message}`;
          failed++;
        }
        if (index < selected.length - 1) await new Promise(resolve => setTimeout(resolve, 300));
      }
      recoveryStatus.textContent = `다운로드 요청 완료: 성공 ${success}개, 실패 ${failed}개. 실패한 강의는 개별 안내를 확인해주세요.`;
    } catch {
      recoveryStatus.textContent = '강의 페이지에 연결하지 못했습니다. 주차별 강의 목록에서 다시 시도해주세요.';
    } finally {
      scanRunning = false;
      rescanBtn.disabled = emptyRescanBtn.disabled = all.disabled = false;
      rows.forEach(row => { row.button.disabled = false; });
    }
  }
  all.addEventListener('click', () => run(rows));
  rows.forEach(row => row.button.addEventListener('click', () => run([row])));
  showList();
}
