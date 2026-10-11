const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const recoveryPath = path.join(__dirname, '..', 'recovery.js');
const R = fs.existsSync(recoveryPath) ? require(recoveryPath) : {};
const thumbnail = 'https://clms.dankook.ac.kr/CommonsCore2/v2/contents/11111111-2222-4333-8444-555555555555.jpg';
const content = { asset_id: '11111111-2222-4333-8444-555555555555', content_id: 'testcontent001', title: '강의', type: 'MP4', is_original_file_deleted: false, view_url: 'https://clms.dankook.ac.kr/CommonsCore2/v2/services/view/abc', share_url: 'https://clms.dankook.ac.kr/em/testcontent001', duration: 5600.64 };

test('thumbnail URL and bare UUID resolve to the same school metadata endpoint', () => {
  assert.equal(typeof R.thumbnailRequest, 'function');
  assert.equal(R.thumbnailRequest(thumbnail), thumbnail.slice(0, -4));
  assert.equal(R.thumbnailRequest(content.asset_id), thumbnail.slice(0, -4));
});
test('unrelated hosts and internal record IDs are not queried', () => {
  assert.equal(typeof R.thumbnailRequest, 'function');
  for (const value of [thumbnail.replace('clms.dankook.ac.kr', 'attacker.example'), '0123456789abcdef01234567', thumbnail.replace('.jpg', '.exe')]) {
    assert.throws(() => R.thumbnailRequest(value));
  }
});
test('closed LearningX item contributes its thumbnail despite masked content_id', () => {
  assert.equal(typeof R.learningItemCandidate, 'function');
  const item = { item_id: 12345, title: '3주차', item_content_data: { content_id: 'not_open', thumbnail_url: thumbnail }, lecture_period_status: 'closed' };
  assert.deepEqual(R.learningItemCandidate(item, 12345), { type: 'commonsRecovery', url: thumbnail, title: '3주차' });
  assert.equal(R.learningItemCandidate(item, 999), null);
  assert.equal(R.learningItemCandidate({ ...item, item_content_data: {} }, 12345), null);
});
test('recovery uses returned content ID for XML and carries the official viewer', async () => {
  assert.equal(typeof R.recoverContent, 'function');
  const urls = [];
  const result = await R.recoverContent(thumbnail, async (url) => {
    urls.push(url);
    return url.includes('CommonsCore2')
      ? { ok: true, json: async () => ({ severity: 'Succeed', result: content }) }
      : { ok: true, text: async () => '<content>real XML</content>' };
  });
  assert.equal(urls[1], 'https://clms.dankook.ac.kr/viewer/ssplayer/uniplayer_support/content.php?content_id=testcontent001');
  assert.equal(result.xml, '<content>real XML</content>');
  assert.equal(result.title, '강의');
  assert.equal(result.viewUrl, content.view_url);
  assert.equal(result.contentId, content.content_id);
});
test('deleted originals and denied metadata produce clear errors without querying XML', async () => {
  assert.equal(typeof R.recoverContent, 'function');
  await assert.rejects(R.recoverContent(thumbnail, async () => ({ ok: false, status: 403 })), /403/);
  await assert.rejects(R.recoverContent(thumbnail, async () => ({ ok: true, json: async () => ({ severity: 'Succeed', result: { ...content, is_original_file_deleted: true } }) })), /삭제/);
  await assert.rejects(R.recoverContent(thumbnail, async () => ({ ok: true, json: async () => ({ severity: 'Failed', description: 'denied' }) })), /조회/);
});
test('frame scanner re-reads only the observed current LearningX item GET endpoint', async () => {
  const frameUrl = 'https://canvas.dankook.ac.kr/learningx/lti/lecture_attendance/items/view/12345';
  const api = 'https://canvas.dankook.ac.kr/learningx/api/v1/courses/10001/items/12345';
  const element = { addEventListener() {} };
  const urls = [];
  const context = { console, URL, AbortSignal, LMSRecovery: R,
    document: { title: '3주차', getElementById: () => element, addEventListener() {}, querySelectorAll: () => [] },
    window: { location: { href: frameUrl } },
    performance: { getEntriesByType: () => [{ name: api, initiatorType: 'fetch' }, { name: api.replace('12345', '999'), initiatorType: 'fetch' }] },
    fetch: async url => { urls.push(url); return { ok: true, json: async () => ({ item_id: 12345, title: '3주차', item_content_data: { content_id: 'not_open', thumbnail_url: thumbnail } }) }; }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), context);
  const result = await context.scanCurrentFrameInPage();
  assert.equal(result.items.filter(x => x.type === 'commonsRecovery').length, 1);
  assert.deepEqual(urls, [api]);
});
test('open lessons continue using the existing player instead of recovery labeling', () => {
  assert.equal(R.learningItemCandidate({item_id:12345, item_content_data:{content_id:'testcontent001',thumbnail_url:thumbnail},lecture_period_status:'opened'},12345),null);
});
test('working video avoids the unauthorized auxiliary LearningX request',async()=>{
 const element={addEventListener(){}};let requests=0;
 const video={currentSrc:'https://clms.dankook.ac.kr/example.mp4',querySelectorAll:()=>[],duration:60};
 const ctx={console,URL,AbortSignal,LMSRecovery:R,
  document:{title:'강의',getElementById:()=>element,addEventListener(){},querySelectorAll:s=>s==='video'?[video]:[]},
  window:{location:{href:'https://canvas.dankook.ac.kr/learningx/lti/lecture_attendance/items/view/12345'}},
  performance:{getEntriesByType:()=>[{name:'https://canvas.dankook.ac.kr/learningx/api/v1/items/12345',initiatorType:'fetch'}]},
  fetch:async()=>{requests++;return {ok:false,status:401};}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','popup.js'),'utf8'),ctx);
 const result=await ctx.scanCurrentFrameInPage();assert.equal(requests,0);assert.equal(result.items.length,1);assert.equal(result.items[0].type,'direct');
});
test('successful detection has success status even if another frame returns 401; failure preserves error',()=>{
 const element={addEventListener(){}};const ctx={document:{getElementById:()=>element,addEventListener(){}},console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','popup.js'),'utf8'),ctx);
 assert.equal(typeof ctx.scanStatus,'function');
 assert.equal(ctx.scanStatus(1,['HTTP 401'],0),'영상 탐색이 완료되었습니다.');
 assert.equal(ctx.scanStatus(0,['HTTP 401'],0),'HTTP 401');
});
