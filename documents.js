/* Attachment policy shared by popup, injected scanner and converter. */
(function(root){
 const MAX_BYTES=50*1024*1024;
 function schoolURL(value,base){
  const u=new URL(value,base);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname==='dankook.ac.kr'||u.hostname.endsWith('.dankook.ac.kr')))throw new Error('단국대학교 HTTPS 자료 주소만 사용할 수 있습니다.');
  return u;
 }
 function fileId(value){
  try {const u=schoolURL(value); if(u.hostname!=='canvas.dankook.ac.kr')return null; return u.pathname.match(/^\/(?:courses\/\d+\/|api\/v1\/)?files\/(\d+)(?:\/|$)/)?.[1]||null;}catch{return null;}
 }
 async function resolveFileId(value,getJSON){
  const u=schoolURL(value);const direct=fileId(u.href);if(direct)return direct;
  const match=u.hostname==='canvas.dankook.ac.kr'&&u.pathname.match(/^\/courses\/(\d+)\/modules\/items\/(\d+)(?:\/|$)/);
  if(!match)return null;
  const data=await getJSON(`https://canvas.dankook.ac.kr/api/v1/courses/${match[1]}/module_item_sequence?asset_type=ModuleItem&asset_id=${match[2]}`);
  const current=(data.items||[]).map(node=>node.current).find(item=>String(item?.id)===match[2]);
  if(!current||current.type!=='File'||current.content_details?.locked_for_user||!/^\d+$/.test(String(current.content_id)))throw new Error('이 주차학습 항목에서 접근 가능한 자료 파일을 찾지 못했습니다. 파일을 직접 열어주세요.');
  return String(current.content_id);
 }
 function candidate(href,name,base){
  try {
   const u=schoolURL(href,base);
   const text=String(name||'').trim().slice(0,300);
   const path=decodeURIComponent(u.pathname);
   const ext=(text.match(/\.(pptx|ppt)(?:\s|$)/i)||path.match(/\.(pptx|ppt)$/i))?.[1]?.toLowerCase();
   const id=fileId(u.href);
   if(!ext&&!id)return null;
   return {url:u.href,title:text||path.split('/').pop()||'강의자료',ext:ext||'unknown',fileId:id};
  }catch{return null;}
 }
 function pdfName(name){return (String(name||'강의자료').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.(pptx|ppt)$/i,'').slice(0,180).trim()||'강의자료')+'.pdf';}
 async function readBounded(response,limit=MAX_BYTES){
  if(!response.ok)throw new Error(`자료 다운로드 실패 (HTTP ${response.status}). 로그인 상태를 확인해주세요.`);
  if(/text\/html/i.test(response.headers.get('content-type')||''))throw new Error('로그인 페이지가 반환되었습니다. LMS에 다시 로그인해주세요.');
  if(Number(response.headers.get('content-length'))>limit)throw new Error('파일 크기 제한(50 MB)을 초과했습니다.');
  const reader=response.body.getReader(); let total=0;const parts=[];
  try {while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw new Error('파일 크기 제한(50 MB)을 초과했습니다.');parts.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
  const out=new Uint8Array(total);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.byteLength;}return out.buffer;
 }
 function checkSignature(buffer){
  const a=new Uint8Array(buffer);
  if(a[0]===208&&a[1]===207&&a[2]===17&&a[3]===224)return "ppt";
  if(a[0]!==80||a[1]!==75||a[2]!==3||a[3]!==4)throw new Error("올바른 PPT/PPTX 파일이 아닙니다.");
  return "pptx";
 }
 function checkXML(xml){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error("허용되지 않는 XML 문서입니다.");
  if(/TargetMode\s*=\s*[\"\']External[\"\']/i.test(xml))throw new Error("외부 리소스 또는 링크를 포함한 PPTX는 지원하지 않습니다. 해당 링크를 제거한 뒤 다시 시도해주세요.");
 }
 const api={resolveFileId,checkSignature,checkXML,MAX_BYTES,schoolURL,fileId,candidate,pdfName,readBounded};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LMSDocuments=api;
})(typeof globalThis!=='undefined'?globalThis:this);
