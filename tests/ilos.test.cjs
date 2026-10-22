const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = fs.existsSync(require('node:path').join(__dirname, '../ilos.js')) ? require('../ilos.js') : {};
const args = ['current', 'fake-item', 'fake-content', 'fake-org', '26', 'fake-ky', 'fake-ud', 'N'];
const viewForm = '<div class="item-title-lesson" val="fake-item^fake-content^fake-org^26^N">2026-2_홍길동_시험과목_9-2 &amp; 실습</div><script>cv.load(' + args.map(JSON.stringify).join(', ') + ');</script>';
const media = 'https://stream.hknu.ac.kr/contents/1/2/3_720p.mp4';
const data = { isError: false, message: '', item_id: 'fake-item', content_id: 'fake-content', organization_id: 'fake-org', path: '/시험 폴더/a+b', kind: 'B', cid: 'fake-cid', link_seq: '2', vr: '' };
const lecture = { week: '9', seq: '26', itemId: 'fake-item' };
const form = { _KJKEY: 'fake-key', kj_lect_type: 'fake-type' };

test('onclick parsing dedupes by seq and prefers nonempty item IDs in either order', () => {
  assert.equal(typeof I.parseLectures, 'function');
  assert.deepEqual(I.parseLectures([
    "viewGo('9', '26', '20260101', '20260102', '');",
    "viewGo('9', '26', '20260101', '20260102','fake-item');",
    'viewGo("9", "27", "1", "2", "other-item");',
    "viewGo('9', '27', '1', '2', '');", 'unrelated()', 'viewGo(unsafe())'
  ]), [lecture, { week: '9', seq: '27', itemId: 'other-item' }]);
});

test('cv.load parses eight JSON strings without executing script', () => {
  assert.deepEqual(I.parseLoadArgs(viewForm), args);
  assert.deepEqual(I.parseLoadArgs('cv.load("current", "it\\\"em", "c", "o", "1", "k", "u", "N");')[1], 'it"em');
  assert.throws(() => I.parseLoadArgs('cv.load("too", "short");'), /강의.*정보/);
  assert.throws(() => I.parseLoadArgs('cv.load("current", evil(), "c", "o", "1", "k", "u", "N");'), /강의.*정보/);
});

test('title extraction handles classes, tags and HTML entities in node', () => {
  assert.equal(I.extractTitle(viewForm), '2026-2_홍길동_시험과목_9-2 & 실습');
  assert.equal(I.extractTitle("<span class='extra item-title-lesson-on'><b>홍길동</b> &#xAC15;&#51032; &quot;실습&quot;</span>"), '홍길동 강의 "실습"');
  assert.equal(I.extractTitle('<title>로그인</title>'), '');
});

test('navi body maps the observed cv.load positions', () => {
  assert.deepEqual(Object.fromEntries(new URLSearchParams(I.buildNaviBody(args))), {
    content_id: 'fake-content', organization_id: 'fake-org', lecture_weeks: '26', navi: 'current', item_id: 'fake-item', ky: 'fake-ky', ud: 'fake-ud', returnData: 'json', encoding: 'utf-8'
  });
});

test('view URL encodes path and includes vr only when truthy', () => {
  const url = I.buildViewUrl(data, '26');
  assert.equal(url, 'https://cyber.hknu.ac.kr/ilos/st/course/online_view.acl?item_id=fake-item&link_seq=2&lecture_weeks=26&path=%2F%EC%8B%9C%ED%97%98%20%ED%8F%B4%EB%8D%94%2Fa%2Bb&kind=B&cid=fake-cid&browserType=chrome&week=&replace=Y');
  assert.equal(I.buildViewUrl({ ...data, vr: 'Y&x' }, '26'), url + '&vr=Y%26x');
  assert.equal(new URL(I.buildViewUrl({ ...data, vr: undefined }, '26')).searchParams.has('vr'), false);
});

test('MP4 extraction dedupes and strips query but rejects HTTP, credentials and other hosts', () => {
  assert.deepEqual(I.extractMp4Urls(`<source src="${media}?a=1"> ${media}?a=2 ${media.replaceAll('/', '\\/')} ` +
    `http://stream.hknu.ac.kr/a.mp4 https://stream.hknu.ac.kr.evil.test/a.mp4 https://evil.test/a.mp4 https://user@stream.hknu.ac.kr/a.mp4 https://stream.hknu.ac.kr:444/a.mp4 ${media}evil`), [media]);
});

test('resolveLecture performs same-origin form, navi and viewer requests and returns only title and MP4', async () => {
  const calls = [];
  const result = await I.resolveLecture(lecture, form, async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).origin, 'https://cyber.hknu.ac.kr');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    if (calls.length === 1) {
      assert.equal(url, 'https://cyber.hknu.ac.kr/ilos/st/course/online_view_form.acl');
      assert.equal(options.method, 'POST');
      assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), { lecture_weeks: '26', WEEK_NO: '9', _KJKEY: 'fake-key', kj_lect_type: 'fake-type', item_id: 'fake-item', force: '' });
      return { ok: true, text: async () => viewForm };
    }
    if (calls.length === 2) {
      assert.equal(url, 'https://cyber.hknu.ac.kr/ilos/st/course/online_view_navi.acl');
      assert.equal(options.method, 'POST');
      assert.equal(new URLSearchParams(options.body).get('ky'), 'fake-ky');
      return { ok: true, json: async () => data };
    }
    assert.equal(options.method, 'GET');
    assert.equal(new URL(url).searchParams.get('lecture_weeks'), '26');
    return { ok: true, text: async () => `<video src="${media}?ignored=1"></video>` };
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(result, { title: '2026-2_홍길동_시험과목_9-2 & 실습', url: media });
});

test('navi isError surfaces the server message and manual secondary-auth guidance', async () => {
  let calls = 0;
  await assert.rejects(I.resolveLecture(lecture, form, async () => ++calls === 1
    ? { ok: true, text: async () => viewForm }
    : { ok: true, json: async () => ({ isError: true, message: '시험용 인증 안내' }) }), error => {
    assert.match(error.message, /시험용 인증 안내/);
    assert.match(error.message, /학습하기.*2차 인증.*다시/);
    return true;
  });
  assert.equal(calls, 2);
});

test('title extraction prefers the active lesson over an earlier inactive one', () => {
  assert.equal(I.extractTitle('<li class="item-title-lesson">9-1</li><li class="a item-title-lesson-on">9-2</li>'), '9-2');
  assert.equal(I.extractTitle('<li class="item-title-lesson-extra">x</li>'), '');
});

test('navi error messages never echo session values to the popup', async () => {
  let calls = 0;
  await assert.rejects(I.resolveLecture(lecture, form, async () => ++calls === 1
    ? { ok: true, text: async () => viewForm }
    : { ok: true, json: async () => ({ isError: true, message: '세션 fake-key / fake-ky / fake-ud 만료' }) }), error => {
    assert.doesNotMatch(error.message, /fake-key|fake-ky|fake-ud/);
    assert.match(error.message, /세션.*만료/);
    return true;
  });
});

test('missing cv.load gives a clear error without making another request', async () => {
  let calls = 0;
  await assert.rejects(I.resolveLecture(lecture, form, async () => { calls++; return { ok: true, text: async () => '<html>로그인</html>' }; }), /강의.*정보.*학습하기/);
  assert.equal(calls, 1);
});

test('request failures do not expose transport errors with session values', async () => {
  await assert.rejects(I.resolveLecture(lecture, form, async () => { throw new Error('fake-key fake-ky'); }), error => {
    assert.match(error.message, /조회.*실패/);
    assert.doesNotMatch(error.message, /fake-key|fake-ky/);
    return true;
  });
  await assert.rejects(I.resolveLecture(lecture, form, async () => ({ ok: false, status: 403 })), /403/);
});

test('non-video and missing valid MP4 fail clearly', async () => {
  for (const kind of ['A', 'B']) {
    let calls = 0;
    await assert.rejects(I.resolveLecture(lecture, form, async () => {
      calls++;
      if (calls === 1) return { ok: true, text: async () => viewForm };
      if (calls === 2) return { ok: true, json: async () => ({ ...data, kind }) };
      return { ok: true, text: async () => '<video src="https://evil.test/a.mp4"></video>' };
    }), /영상/);
    assert.equal(calls, kind === 'A' ? 2 : 3);
  }
});

// Small DOM/Chrome boundary doubles; both popup scripts and injected functions run unchanged.
function popupHarness({ list = false, failSeq = '', failAllFrames = false, hold, local = false, resolvedUrl, naviError = false } = {}) {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; this.disabled = false; this.classList = { add() {}, remove() {} }; }
    addEventListener(event, fn) { this.listeners[event] = fn; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll(selector) { return this.children.flatMap(child => [ ...(selector === 'button' && child.tag === 'button' ? [child] : []), ...child.querySelectorAll(selector) ]); }
    querySelector() { return new Element(); }
  }
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, addEventListener() {}, createElement(tag) { const el = new Element(); el.tag = tag; return el; } };
  const downloads = [], returned = [], requests = [], statuses = [];
  const location = { origin: 'https://cyber.hknu.ac.kr', hostname: 'cyber.hknu.ac.kr', pathname: '/ilos/st/course/' + (list ? 'online_list_form.acl' : 'online_view_form.acl') };
  const nodes = ['26', '27', '28'].map(seq => ({ getAttribute: () => `viewGo('9','${seq}','1','2','fake-${seq}');` }));
  const page = vm.createContext({ URL, URLSearchParams, AbortSignal, location,
    document: { title: '시험 강의', forms: { namedItem: () => ({ elements: { namedItem: key => ({ value: form[key] }) } }) },
      querySelector: () => ({ textContent: '홍길동 시험 강의' }), querySelectorAll: selector => selector === '[onclick]' ? nodes : [] },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (hold) await hold;
      if (url.endsWith('online_view_form.acl')) {
        const seq = new URLSearchParams(options.body).get('lecture_weeks');
        if (seq === failSeq) return { ok: false, status: 403 };
        return { ok: true, text: async () => viewForm };
      }
      if (url.endsWith('online_view_navi.acl')) return { ok: true, json: async () => naviError ? { isError: true, message: '세션 fake-key / fake-ky / fake-ud 만료' } : data };
      return { ok: true, text: async () => `<video src="${media}">` };
    }
  });
  const child = vm.createContext({ URL, URLSearchParams, AbortSignal, location: { ...location, pathname: '/ilos/st/course/online_view.acl' },
    document: { querySelector: () => null, querySelectorAll: selector => selector === 'video' ? [{ currentSrc: media + '?ignored=1', querySelectorAll: () => [] }] : [] } });
  const store = {}, writes = [], storageListeners = [], messages = [], timers = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const storage = {
    get: async key => ({ [key]: store[key] && clone(store[key]) }),
    set: async values => {
      writes.push(clone(values));
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: clone(value) }]));
      Object.assign(store, clone(values));
      storageListeners.forEach(fn => fn(changes, local ? 'local' : 'session'));
    },
    remove: async key => { delete store[key]; storageListeners.forEach(fn => fn({ [key]: {} }, local ? 'local' : 'session')); }
  };
  let listener, updated, removed;
  const chrome = {
    storage: { [local ? 'local' : 'session']: storage, onChanged: { addListener: fn => storageListeners.push(fn) } },
    webRequest: { onBeforeRequest: { addListener() {} } },
    declarativeNetRequest: { getDynamicRules: async () => [], getSessionRules: async () => [] },
    tabs: { query: async () => [{ id: 1, url: location.origin + location.pathname, title: '시험 강의' }], get: async () => ({ url: location.origin + location.pathname }), create() {},
      onUpdated: { addListener: fn => { updated = fn; } }, onRemoved: { addListener: fn => { removed = fn; } } },
    downloads: { search: async () => [], onChanged: { addListener() {} }, download: async options => { downloads.push(options); return downloads.length; } },
    scripting: { executeScript: async spec => {
      if (failAllFrames && spec.target.allFrames) throw new Error('Cannot access contents of the page');
      const frames = spec.target.allFrames ? [page, child] : [page];
      if (spec.files) { for (const frame of frames) for (const file of spec.files) vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), frame); return []; }
      const results = [];
      for (const frame of frames) {
        frame.injectedArgs = spec.args || [];
        let result = await vm.runInContext('(' + spec.func.toString() + ')(...injectedArgs)', frame);
        if (resolvedUrl && spec.args?.length && result?.url) result = { ...result, url: resolvedUrl };
        returned.push(result); results.push({ frameId: frame === page ? 0 : 1, result });
      }
      return results;
    } },
    runtime: {
      onMessage: { addListener: fn => { listener = fn; } },
      sendMessage: request => new Promise(resolve => {
        assert.equal(request.action, 'ilosBatch', 'HKNU must not use Dankook detection or DNR downloads');
        messages.push(clone(request));
        const handled = listener(request, {}, result => { returned.push(result); resolve(result); });
        if (!handled) resolve(undefined);
      })
    }
  };
  const worker = vm.createContext({ chrome, URL, console, LMSRecovery: {},
    setTimeout: (fn, ms) => { timers.push(ms); setImmediate(fn); } });
  worker.importScripts = file => vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), worker);
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), worker);
  function openPopup() {
    elements.clear();
    const context = vm.createContext({ document, chrome, URL, URLSearchParams, console, navigator: { clipboard: { writeText: async () => {} } }, setTimeout: fn => { fn(); }, LMSIlos: I });
    for (const file of ['popup-ilos.js', 'popup.js']) vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), context);
    return context;
  }
  const context = openPopup();
  // The status history hook belongs to the currently open popup.
  const attachStatus = () => Object.defineProperty(document.getElementById('automatic-status'), 'textContent', {
    configurable: true, get: () => statuses.at(-1) || '', set: value => statuses.push(value)
  });
  attachStatus();
  return { context, worker, chrome, elements, downloads, returned, requests, statuses, store, writes, messages, timers, page, updated, removed,
    reopen: () => { storageListeners.length = 0; const fresh = openPopup(); attachStatus(); return fresh; } };

}

test('HKNU view scan combines top title with frame video and reuses filename/download/open/copy cards', async () => {
  const h = popupHarness();
  await h.context.refreshScan();
  assert.equal(h.elements.get('school-badge').textContent, '한경대학교 e-Class');
  const cards = h.elements.get('video-list').children;
  assert.equal(cards.length, 1);
  const buttons = cards[0].querySelectorAll('button');
  assert.equal(buttons.length, 3);
  assert.equal(vm.runInContext('Array.from(detectedVideos.values())[0].title', h.context), '홍길동 시험 강의');
  await buttons[0].listeners.click();
  assert.deepEqual(JSON.parse(JSON.stringify(h.downloads)), [{ url: media, filename: '홍길동 시험 강의.mp4', conflictAction: 'uniquify', saveAs: false }]);
  assert.equal(h.requests.length, 0);
});

test('week batch downloads sequentially, continues after a failure, reports counts and keeps session fields inside page', async () => {
  const h = popupHarness({ list: true, failSeq: '27' });
  await h.context.refreshScan();
  const buttons = h.elements.get('video-list').querySelectorAll('button');
  assert.equal(buttons.length, 4);
  assert.equal(buttons[0].textContent, '이번 주 전체 다운로드');
  await buttons[0].listeners.click();
  await batchFinished(h);
  assert.equal(h.messages[0].action, 'ilosBatch');
  assert.equal(h.downloads.length, 2);
  assert.deepEqual(h.requests.filter(call => call.url.endsWith('online_view_form.acl')).map(call => new URLSearchParams(call.options.body).get('lecture_weeks')), ['26', '27', '28']);
  assert.match(h.statuses.at(-1), /2.*실패 1/);
  assert.ok(h.statuses.some(value => /1\/3/.test(value)));
  assert.ok(buttons.every(button => !button.disabled));
  assert.doesNotMatch(JSON.stringify([h.returned, h.writes]), /fake-key|fake-ky|fake-ud|_KJKEY|kj_lect_type/);
  const state = h.store['ilos-batch-tab-1'];
  assert.deepEqual([state.running, state.total, state.done, state.success, state.failed], [false, 3, 3, 2, 1]);
  assert.match(state.rows['27'].status, /다운로드 실패: 강의 정보 조회 실패 \(HTTP 403\)/);
  assert.ok(h.writes.some(write => write['ilos-batch-tab-1'].done === 1));
  assert.doesNotMatch(JSON.stringify(h.writes), /https:|itemId/);
  assert.deepEqual(h.timers, [300, 300]);
});

test('individual week button resolves and downloads only its lecture', async () => {
  const h = popupHarness({ list: true });
  await h.context.refreshScan();
  const buttons = h.elements.get('video-list').querySelectorAll('button');
  assert.equal(buttons.length, 4);
  await buttons[2].listeners.click();
  await batchFinished(h);
  assert.equal(h.downloads.length, 1);
  assert.equal(new URLSearchParams(h.requests[0].options.body).get('lecture_weeks'), '27');
});

test('list scan still works when an inaccessible child frame breaks allFrames injection', async () => {
  const h = popupHarness({ list: true, failAllFrames: true });
  await h.context.refreshScan();
  const buttons = h.elements.get('video-list').querySelectorAll('button');
  assert.equal(buttons.length, 4);
  assert.equal(buttons[0].textContent, '이번 주 전체 다운로드');
});

async function batchFinished(h) {
  for (let i = 0; i < 100; i++) {
    if (h.store['ilos-batch-tab-1']?.running === false) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('batch did not finish');
}

test('background accepts immediately, rejects a concurrent batch and popup reopens with live progress', async () => {
  let release;
  const h = popupHarness({ list: true, hold: new Promise(resolve => { release = resolve; }) });
  await h.context.refreshScan();
  await h.elements.get('video-list').querySelectorAll('button')[0].listeners.click();
  assert.equal(h.downloads.length, 0);
  const second = await h.chrome.runtime.sendMessage({ action: 'ilosBatch', tabId: 1, lectures: [lecture] });
  assert.match(second.error, /진행 중/);
  // Destroy popup listeners and globals; reopening must read storage, then receive live changes.
  const reopened = h.reopen();
  await reopened.refreshScan();
  assert.ok(h.elements.get('video-list').querySelectorAll('button').every(button => button.disabled));
  assert.match(h.statuses.at(-1), /팝업.*닫/);
  release();
  await batchFinished(h);
  assert.match(h.statuses.at(-1), /성공 3개, 실패 0개/);
  assert.ok(h.elements.get('video-list').querySelectorAll('button').every(button => !button.disabled));
  assert.match(h.elements.get('video-list').children[1].children[0].textContent, /시험과목/);
});

test('background rejects noncanonical MP4 URLs and uses local storage fallback', async () => {
  for (const resolvedUrl of [media + '?secret=1', 'https://evil.test/a.mp4', 'http://stream.hknu.ac.kr/a.mp4']) {
    const h = popupHarness({ list: true, local: true, resolvedUrl });
    await h.chrome.runtime.sendMessage({ action: 'ilosBatch', tabId: 1, lectures: [lecture] });
    await batchFinished(h);
    assert.equal(h.downloads.length, 0);
    assert.equal(h.store['ilos-batch-tab-1'].failed, 1);
  }
});

test('navigation and tab close cancel pending batch without recreating state or downloading', async () => {
  for (const close of [false, true]) {
    let release;
    const h = popupHarness({ list: true, hold: new Promise(resolve => { release = resolve; }) });
    await h.chrome.runtime.sendMessage({ action: 'ilosBatch', tabId: 1, lectures: [lecture] });
    await new Promise(resolve => setImmediate(resolve));
    if (close) h.removed(1);
    else h.updated(1, { url: 'https://cyber.hknu.ac.kr/ilos/main/main_form.acl' });
    release();
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.store['ilos-batch-tab-1'], undefined);
    assert.equal(h.downloads.length, 0);
  }
});

test('resolver is self-contained and checks origin, list path, form values and missing helper', async () => {
  const h = popupHarness({ list: true });
  const resolve = () => h.chrome.scripting.executeScript({ target: { tabId: 1 }, func: I.resolveLectureInPage, args: [lecture] });
  assert.match((await resolve())[0].result.error, /LMSIlos missing/);
  await h.chrome.scripting.executeScript({ target: { tabId: 1 }, files: ['ilos.js'] });
  vm.runInContext("location.origin = 'https://evil.test'", h.page);
  assert.match((await resolve())[0].result.error, /주차별/);
  vm.runInContext("location.origin = 'https://cyber.hknu.ac.kr'; location.pathname = '/ilos/st/course/online_view_form.acl'", h.page);
  assert.match((await resolve())[0].result.error, /주차별/);
  vm.runInContext("location.pathname = '/ilos/st/course/online_list_form.acl'; document.forms.namedItem = () => null", h.page);
  assert.match((await resolve())[0].result.error, /양식/);
  assert.equal(h.requests.length, 0);
});

test('background reinjects a missing page helper and does not leak authentication errors', async () => {
  const h = popupHarness({ list: true, naviError: true });
  const execute = h.chrome.scripting.executeScript;
  let injections = 0, removed = false;
  h.chrome.scripting.executeScript = async spec => {
    if (spec.files) injections++;
    else if (spec.args?.length && !removed) {
      vm.runInContext('delete globalThis.LMSIlos', h.page);
      removed = true;
    }
    return execute(spec);
  };
  await h.chrome.runtime.sendMessage({ action: 'ilosBatch', tabId: 1, lectures: [lecture] });
  await batchFinished(h);
  assert.equal(injections, 2);
  assert.equal(h.store['ilos-batch-tab-1'].failed, 1);
  assert.doesNotMatch(JSON.stringify([h.returned, h.writes]), /fake-key|fake-ky|fake-ud|_KJKEY|kj_lect_type/);
});

test('background awaits each download before resolving the next lecture and sanitizes filenames', async () => {
  let release;
  const holdDownload = new Promise(resolve => { release = resolve; });
  const h = popupHarness({ list: true });
  const download = h.chrome.downloads.download;
  let calls = 0;
  h.chrome.downloads.download = async options => {
    if (++calls === 1) await holdDownload;
    return download(options);
  };
  await h.chrome.runtime.sendMessage({ action: 'ilosBatch', tabId: 1, lectures: [lecture, { ...lecture, seq: '27' }] });
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(h.requests.filter(call => call.url.endsWith('online_view_form.acl')).length, 1);
  release();
  await batchFinished(h);
  assert.equal(calls, 2);
  assert.equal(h.worker.downloadFilename('../a:<b>?*.mp4'), '.._a__b___.mp4');
  assert.deepEqual(JSON.parse(JSON.stringify(h.downloads[0])), {
    url: media, filename: '2026-2_홍길동_시험과목_9-2 & 실습.mp4', conflictAction: 'uniquify', saveAs: false
  });
});

test('resolved titles cannot carry page session values across the frame boundary', async () => {
  let calls = 0;
  const result = await I.resolveLecture(lecture, form, async () => {
    if (++calls === 1) return { ok: true, text: async () => viewForm.replace('시험과목', 'fake-key fake-ky fake-ud') };
    if (calls === 2) return { ok: true, json: async () => data };
    return { ok: true, text: async () => `<video src="${media}">` };
  });
  assert.doesNotMatch(JSON.stringify(result), /fake-key|fake-ky|fake-ud/);
});

test('injection and download API failures do not stop later lectures or expose transport secrets', async () => {
  const h = popupHarness({ list: true });
  const execute = h.chrome.scripting.executeScript;
  let injected = false, downloaded = false;
  h.chrome.scripting.executeScript = spec => {
    if (spec.files && !injected) {
      injected = true;
      throw new Error('fake-key fake-ky fake-ud');
    }
    return execute(spec);
  };
  const download = h.chrome.downloads.download;
  h.chrome.downloads.download = options => {
    if (!downloaded) {
      downloaded = true;
      throw new Error('fake-key fake-ky fake-ud');
    }
    return download(options);
  };
  await h.chrome.runtime.sendMessage({ action: 'ilosBatch', tabId: 1, lectures: ['26', '27', '28'].map(seq => ({ ...lecture, seq })) });
  await batchFinished(h);
  assert.deepEqual([h.store['ilos-batch-tab-1'].done, h.store['ilos-batch-tab-1'].success, h.store['ilos-batch-tab-1'].failed], [3, 1, 2]);
  assert.equal(h.downloads.length, 1);
  assert.doesNotMatch(JSON.stringify([h.returned, h.writes]), /fake-key|fake-ky|fake-ud/);
});
