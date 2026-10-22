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
function popupHarness({ list = false, failSeq = '', failAllFrames = false } = {}) {
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
  const status = document.getElementById('automatic-status');
  Object.defineProperty(status, 'textContent', { get: () => statuses.at(-1) || '', set: value => statuses.push(value) });
  const location = { origin: 'https://cyber.hknu.ac.kr', hostname: 'cyber.hknu.ac.kr', pathname: '/ilos/st/course/' + (list ? 'online_list_form.acl' : 'online_view_form.acl') };
  const nodes = ['26', '27', '28'].map(seq => ({ getAttribute: () => `viewGo('9','${seq}','1','2','fake-${seq}');` }));
  const page = vm.createContext({ URL, URLSearchParams, AbortSignal, location,
    document: { title: '시험 강의', forms: { namedItem: () => ({ elements: { namedItem: key => ({ value: form[key] }) } }) },
      querySelector: () => ({ textContent: '홍길동 시험 강의' }), querySelectorAll: selector => selector === '[onclick]' ? nodes : [] },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('online_view_form.acl')) {
        const seq = new URLSearchParams(options.body).get('lecture_weeks');
        if (seq === failSeq) return { ok: false, status: 403 };
        return { ok: true, text: async () => viewForm };
      }
      if (url.endsWith('online_view_navi.acl')) return { ok: true, json: async () => data };
      return { ok: true, text: async () => `<video src="${media}">` };
    }
  });
  const child = vm.createContext({ URL, URLSearchParams, AbortSignal, location: { ...location, pathname: '/ilos/st/course/online_view.acl' },
    document: { querySelector: () => null, querySelectorAll: selector => selector === 'video' ? [{ currentSrc: media + '?ignored=1', querySelectorAll: () => [] }] : [] } });
  const chrome = {
    tabs: { query: async () => [{ id: 1, url: location.origin + location.pathname, title: '시험 강의' }], create() {} },
    downloads: { download: async options => { downloads.push(options); return downloads.length; } },
    scripting: { executeScript: async spec => {
      if (failAllFrames && spec.target.allFrames) throw new Error('Cannot access contents of the page');
      const frames = spec.target.allFrames ? [page, child] : [page];
      if (spec.files) { for (const frame of frames) for (const file of spec.files) vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), frame); return []; }
      const results = [];
      for (const frame of frames) {
        frame.injectedArgs = spec.args || [];
        const result = await vm.runInContext('(' + spec.func.toString() + ')(...injectedArgs)', frame);
        returned.push(result); results.push({ frameId: frame === page ? 0 : 1, result });
      }
      return results;
    } },
    runtime: { sendMessage() { throw new Error('HKNU must not use background detection or DNR downloads'); } }
  };
  const context = vm.createContext({ document, chrome, URL, URLSearchParams, console, navigator: { clipboard: { writeText: async () => {} } }, setTimeout: fn => { fn(); }, LMSIlos: I });
  for (const file of ['popup-ilos.js', 'popup.js']) {
    const filename = require('node:path').join(__dirname, '..', file);
    if (fs.existsSync(filename)) vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
  }
  return { context, elements, downloads, returned, requests, statuses };
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
  assert.equal(h.downloads.length, 2);
  assert.deepEqual(h.requests.filter(call => call.url.endsWith('online_view_form.acl')).map(call => new URLSearchParams(call.options.body).get('lecture_weeks')), ['26', '27', '28']);
  assert.match(h.statuses.at(-1), /2.*실패 1/);
  assert.ok(h.statuses.some(value => /1\/3/.test(value)));
  assert.ok(buttons.every(button => !button.disabled));
  assert.doesNotMatch(JSON.stringify(h.returned), /fake-key|fake-ky|fake-ud|_KJKEY|kj_lect_type/);
});

test('individual week button resolves and downloads only its lecture', async () => {
  const h = popupHarness({ list: true });
  await h.context.refreshScan();
  const buttons = h.elements.get('video-list').querySelectorAll('button');
  assert.equal(buttons.length, 4);
  await buttons[2].listeners.click();
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
