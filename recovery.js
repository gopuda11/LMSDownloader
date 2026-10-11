// Shared by the popup, injected frame scanner and background worker.
(function (root) {
  'use strict';
  const origin = 'https://clms.dankook.ac.kr';
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

  function thumbnailRequest(input) {
    const value = String(input || '').trim();
    if (new RegExp(`^${uuid}$`, 'i').test(value)) {
      return `${origin}/CommonsCore2/v2/contents/${value.toLowerCase()}`;
    }
    let url;
    try { url = new URL(value); } catch { throw new Error('썸네일 주소 또는 UUID를 입력해주세요.'); }
    const match = url.pathname.match(new RegExp(`^/CommonsCore2/v2/contents/(${uuid})\\.jpg$`, 'i'));
    if (url.hostname !== 'clms.dankook.ac.kr' || !['https:', 'http:'].includes(url.protocol) || url.port || !match) {
      throw new Error('단국대 콘텐츠 서버의 썸네일 주소(.jpg)를 입력해주세요.');
    }
    return `${origin}/CommonsCore2/v2/contents/${match[1].toLowerCase()}`;
  }

  function learningItemCandidate(data, expectedId) {
    if (!data || String(data.item_id) !== String(expectedId)) return null;
    if (data.lecture_period_status !== 'closed' && data.item_content_data?.content_id !== 'not_open') return null;
    const thumbnail = data.item_content_data?.thumbnail_url;
    try { thumbnailRequest(thumbnail); } catch { return null; }
    return { type: 'commonsRecovery', url: thumbnail, title: data.title || '' };
  }

  async function recoverContent(input, fetchImpl = fetch) {
    const metadataUrl = thumbnailRequest(input);
    const options = { credentials: 'omit', signal: AbortSignal.timeout(15000) };
    const response = await fetchImpl(metadataUrl, options);
    if (!response.ok) throw new Error(`원본 정보 조회 실패 (HTTP ${response.status})`);
    const envelope = await response.json();
    const data = envelope.result;
    if (!data || (envelope.severity && envelope.severity !== 'Succeed')) {
      throw new Error('원본 콘텐츠 정보를 조회할 수 없습니다.');
    }
    if (data.asset_id?.toLowerCase() !== metadataUrl.split('/').pop()) {
      throw new Error('썸네일과 원본 콘텐츠 정보가 일치하지 않습니다.');
    }
    if (data.is_original_file_deleted === true) throw new Error('서버에서 원본 영상이 삭제되었습니다.');
    if (String(data.type).toUpperCase() !== 'MP4' || !/^[a-z0-9_-]+$/i.test(data.content_id || '') || data.content_id === 'not_open') {
      throw new Error('다운로드할 원본 영상 정보를 찾지 못했습니다.');
    }
    const xmlUrl = `${origin}/viewer/ssplayer/uniplayer_support/content.php?content_id=${encodeURIComponent(data.content_id)}`;
    const xmlResponse = await fetchImpl(xmlUrl, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
    if (!xmlResponse.ok) throw new Error(`영상 주소 조회 실패 (HTTP ${xmlResponse.status})`);
    const shareUrl = `${origin}/em/${data.content_id}`;
    let viewUrl = shareUrl;
    try {
      const supplied = new URL(data.view_url);
      if (supplied.origin === origin) viewUrl = supplied.href;
    } catch {}
    return {
      contentId: data.content_id, title: data.title || '', duration: data.duration || 0,
      viewUrl, shareUrl, origin, xml: await xmlResponse.text()
    };
  }

  const api = { thumbnailRequest, learningItemCandidate, recoverContent };
  root.LMSRecovery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
