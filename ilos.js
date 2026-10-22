// Shared by the popup and injected ILOS scripts. Session fields stay in the page.
(function (root) {
  'use strict';
  const origin = 'https://cyber.hknu.ac.kr';
  const course = origin + '/ilos/st/course/';
  const authHelp = '강의를 학습하기로 한 번 열고 2차 인증을 완료한 뒤 다시 시도해주세요.';

  function parseLectures(onclicks) {
    const lectures = new Map();
    for (const text of onclicks) {
      const match = String(text).match(/\bviewGo\s*\(\s*(['"])(\d+)\1\s*,\s*(['"])(\d+)\3\s*,\s*(['"])\d*\5\s*,\s*(['"])\d*\6\s*,\s*(['"])([^'"]*)\7\s*\)/);
      if (!match) continue;
      const lecture = { week: match[2], seq: match[4], itemId: match[8] };
      if (!lectures.has(lecture.seq) || lecture.itemId) lectures.set(lecture.seq, lecture);
    }
    return Array.from(lectures.values());
  }

  function parseLoadArgs(html) {
    const string = '"(?:[^"\\\\]|\\\\.)*"';
    const pattern = new RegExp('\\bcv\\s*\\.\\s*load\\s*\\(\\s*(' + string + '(?:\\s*,\\s*' + string + '){7})\\s*\\)');
    const match = String(html).match(pattern);
    if (match) {
      try { return JSON.parse('[' + match[1] + ']'); } catch {}
    }
    throw new Error('강의 재생 정보를 찾지 못했습니다. ' + authHelp);
  }

  function extractTitle(html) {
    if (typeof DOMParser !== 'undefined') {
      const dom = new DOMParser().parseFromString(html, 'text/html');
      return (dom.querySelector('.item-title-lesson-on, .item-title-lesson')?.textContent || '').trim();
    }
    const match = String(html).match(/<([a-z][\w:-]*)\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bitem-title-lesson(?:-on)?\b[^'"]*\2[^>]*>([\s\S]*?)<\/\1\s*>/i);
    if (!match) return '';
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return match[3].replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
      if (name[0] !== '#') return entities[name.toLowerCase()];
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }).trim();
  }

  function buildNaviBody(a) {
    return new URLSearchParams({
      content_id: a[2], organization_id: a[3], lecture_weeks: a[4], navi: a[0],
      item_id: a[1], ky: a[5], ud: a[6], returnData: 'json', encoding: 'utf-8'
    }).toString();
  }

  function buildViewUrl(data, seq) {
    const fields = {
      item_id: data.item_id, link_seq: data.link_seq, lecture_weeks: seq,
      path: data.path, kind: data.kind, cid: data.cid, browserType: 'chrome', week: '', replace: 'Y'
    };
    if (data.vr) fields.vr = data.vr;
    return course + 'online_view.acl?' + Object.entries(fields)
      .map(([key, value]) => key + '=' + encodeURIComponent(value ?? '')).join('&');
  }

  function extractMp4Urls(html) {
    const text = String(html).replace(/\\\//g, '/');
    const urls = new Set();
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) {
      try {
        const url = new URL(match[0]);
        if (url.protocol !== 'https:' || url.hostname !== 'stream.hknu.ac.kr' ||
            url.username || url.password || url.port || !/\.mp4$/i.test(url.pathname)) continue;
        url.search = '';
        url.hash = '';
        urls.add(url.href);
      } catch {}
    }
    return Array.from(urls);
  }

  async function resolveLecture(lecture, form, fetchImpl = fetch) {
    async function request(file, body, json = false) {
      let response;
      try {
        response = await fetchImpl(file, {
          method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error',
          signal: AbortSignal.timeout(15000),
          ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
        });
      } catch { throw new Error('강의 정보 조회에 실패했습니다. ' + authHelp); }
      if (!response.ok) throw new Error(`강의 정보 조회 실패 (HTTP ${response.status}). ${authHelp}`);
      try { return await (json ? response.json() : response.text()); }
      catch { throw new Error('강의 정보 응답을 읽지 못했습니다. ' + authHelp); }
    }
    const body = new URLSearchParams({
      lecture_weeks: lecture.seq, WEEK_NO: lecture.week, _KJKEY: form._KJKEY,
      kj_lect_type: form.kj_lect_type, item_id: lecture.itemId, force: ''
    }).toString();
    const html = await request(course + 'online_view_form.acl', body);
    const a = parseLoadArgs(html);
    const data = await request(course + 'online_view_navi.acl', buildNaviBody(a), true);
    if (!data || data.isError) throw new Error(`${data?.message || '강의 인증 정보를 확인하지 못했습니다.'} ${authHelp}`);
    if (data.kind !== 'B') throw new Error('다운로드할 영상 강의가 아닙니다.');
    const viewer = await request(buildViewUrl(data, lecture.seq));
    const urls = extractMp4Urls(viewer);
    if (!urls.length) throw new Error('한경대 스트리밍 서버의 MP4 영상 주소를 찾지 못했습니다.');
    return { title: extractTitle(html) || `${lecture.week}주차 강의 ${lecture.seq}`, url: urls[0] };
  }

  const api = { parseLectures, parseLoadArgs, extractTitle, buildNaviBody, buildViewUrl, extractMp4Urls, resolveLecture };
  root.LMSIlos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
