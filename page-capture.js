// MAIN world: observe JSON responses, retain only the current lesson's thumbnail.
(() => {
  if (window.__lmsDownloaderCaptureInstalled) return;
  window.__lmsDownloaderCaptureInstalled = true;
  const frameMatch = window.location.href.match(/\/learningx\/lti\/lecture_attendance\/items\/view\/(\d+)/);
  if (!frameMatch) return;
  const itemId = frameMatch[1];
  const origin = window.location.origin;
  const matches = value => {
    try {
      const url = new URL(value, window.location.href);
      return url.origin === origin && url.pathname.includes('/learningx/') && url.pathname.endsWith(`/${itemId}`);
    } catch { return false; }
  };
  const publish = data => {
    if (!data || String(data.item_id) !== itemId) return;
    if (data.lecture_period_status !== 'closed' && data.item_content_data?.content_id !== 'not_open') return;
    const thumbnail = data.item_content_data?.thumbnail_url;
    if (typeof thumbnail !== 'string') return;
    window.postMessage({
      source: 'lms-downloader-lesson-v1', itemId: data.item_id,
      thumbnail, title: String(data.title || '').slice(0, 300)
    }, origin);
  };
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const pending = nativeFetch.apply(this, args);
    const requestUrl = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    if (matches(requestUrl)) {
      pending.then(response => response.clone().json()).then(publish).catch(() => {});
    }
    return pending;
  };
  const nativeOpen = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const result = nativeOpen.call(this, method, url, ...rest);
    if (matches(url)) this.addEventListener('load', () => {
      if (this.status < 200 || this.status >= 300) return;
      try {
        publish(this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
      } catch {}
    }, { once: true });
    return result;
  };
})();
