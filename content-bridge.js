// ISOLATED world: forward validated lesson hints to extension-only session storage.
(() => {
  const match = location.href.match(/\/learningx\/lti\/lecture_attendance\/items\/view\/(\d+)/);
  if (!match) return;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'lms-downloader-lesson-v1' || String(data.itemId) !== match[1]) return;
    try { LMSRecovery.thumbnailRequest(data.thumbnail); } catch { return; }
    chrome.runtime.sendMessage({
      action: 'captureLearningItem', itemId: data.itemId, thumbnail: data.thumbnail,
      title: String(data.title || '').slice(0, 300)
    }, () => { void chrome.runtime.lastError; });
  });
})();
