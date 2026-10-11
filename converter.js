/* Privileged tab: fetch authorized school attachments, sandbox all PPTX rendering. */
const $=id=>document.getElementById(id);
let frame,ready,resolveReady,job='',controller=null,pdfBlob=null,filename='강의자료.pptx',busy=false;
const blobURLs=new Set();let originalURL='';
function setStatus(text){$('status').textContent=text;}
function resetSandbox(){
 frame?.remove();ready=new Promise(resolve=>resolveReady=resolve);
 frame=document.createElement('iframe');frame.src=chrome.runtime.getURL('sandbox.html');
 frame.title='격리된 PPTX 변환';$('sandbox-host').replaceChildren(frame);
}
function stop(){
 controller?.abort();controller=null;job=crypto.randomUUID();busy=false;$('cancel').disabled=true;
 resetSandbox();setStatus('변환을 취소했습니다.');
}
function fail(message){busy=false;$('cancel').disabled=true;setStatus(message);$('result').textContent='파일은 업로드되지 않았습니다. 원본 파일을 사용하거나 다른 PPTX를 선택해주세요.';}
function start(){
 if(busy)stop();busy=true;job=crypto.randomUUID();pdfBlob=null;$('save').disabled=true;$('cancel').disabled=false;
 $('result').textContent='';$('preview').hidden=true;$('progress').value=0;$('progress').max=1;
 controller=new AbortController();setStatus('파일을 읽는 중…');return job;
}
async function fetchSchool(url,signal){
 LMSDocuments.schoolURL(url);
 const response=await fetch(url,{credentials:'include',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
 LMSDocuments.schoolURL(response.url);return response;
}
async function remoteFile(url,name){
 const thisJob=start();const signal=controller.signal;
 try {
  originalURL=LMSDocuments.schoolURL(url).href;$('original').hidden=false;setStatus('로그인된 LMS에서 자료를 가져오는 중…');
  const id=await LMSDocuments.resolveFileId(url,async api=>{
   const response=await fetchSchool(api,signal);
   return JSON.parse(new TextDecoder().decode(await LMSDocuments.readBounded(response,1024*1024)));
  });
  if(thisJob!==job)return;
  let downloadURL=url;
  if(id){
   const response=await fetchSchool(`https://canvas.dankook.ac.kr/api/v1/files/${id}`,signal);
   const raw=await LMSDocuments.readBounded(response,1024*1024);
   if(thisJob!==job)return;
   const data=JSON.parse(new TextDecoder().decode(raw));
   name=data.display_name||data.filename||name;
   if(!/\.pptx?$/i.test(name||''))throw new Error('이 자료는 PPT/PPTX 파일이 아닙니다.');
   downloadURL=LMSDocuments.schoolURL(data.url).href;
  }
  filename=name||decodeURIComponent(new URL(downloadURL).pathname.split('/').pop())||'강의자료.pptx';
  $('filename').textContent=filename;
  const buffer=await LMSDocuments.readBounded(await fetchSchool(downloadURL,signal));
  if(thisJob!==job)return;
  await convert(buffer,thisJob);
 }catch(e){if(thisJob===job)fail(e.message);}
}
async function convert(buffer,thisJob){
 if(thisJob!==job)return;
 LMSDocuments.checkSignature(buffer);setStatus('변환 준비 중…');
 await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('변환 화면을 불러오지 못했습니다. 확장 프로그램을 다시 로드해주세요.')),15000))]);
 if(thisJob!==job)return;
 frame.contentWindow.postMessage({channel:'lms-pdf',type:'convert',job:thisJob,buffer},'*',[buffer]);
}
async function save(){
 if(!pdfBlob)return;
 const url=URL.createObjectURL(pdfBlob);blobURLs.add(url);
 try {
  const id=await chrome.downloads.download({url,filename:LMSDocuments.pdfName(filename),conflictAction:'uniquify',saveAs:false});
  // Do not revoke while the browser is still reading the Blob.
  const listener=delta=>{if(delta.id===id&&delta.state&&['complete','interrupted'].includes(delta.state.current)){
   URL.revokeObjectURL(url);blobURLs.delete(url);chrome.downloads.onChanged.removeListener(listener);
   $('result').textContent=delta.state.current==='complete'?'PDF가 다운로드 폴더에 저장되었습니다.':'PDF 다운로드가 중단되었습니다. 다시 저장을 눌러주세요.';
  }};
  chrome.downloads.onChanged.addListener(listener);
  const [item]=await chrome.downloads.search({id});
  if(item?.state&&item.state!=='in_progress')listener({id,state:{current:item.state}});
 }catch(e){URL.revokeObjectURL(url);blobURLs.delete(url);$('result').textContent=`저장 실패: ${e.message}`;}
}
window.addEventListener('message',e=>{
 if(e.source!==frame?.contentWindow||e.data?.channel!=='lms-pdf')return;
 const data=e.data;if(data.type==='ready'){resolveReady();return;}
 if(data.job!==job||!busy)return;
 if(data.type==='progress'){setStatus(`${data.current} / ${data.total}장 변환 중…`);$('progress').max=data.total;$('progress').value=data.current;}
 if(data.type==='preview'&&/^data:image\/png;base64,/.test(data.url||'')){$('preview').src=data.url;$('preview').hidden=false;}
 if(data.type==='error')fail(String(data.message||'변환 실패').slice(0,500));
 if(data.type==='done'){
  if(!(data.buffer instanceof ArrayBuffer)||data.buffer.byteLength>150*1024*1024){fail('PDF 출력 크기가 잘못되었습니다.');return;}
  const magic=new TextDecoder().decode(data.buffer.slice(0,5));if(magic!=='%PDF-'){fail('올바른 PDF를 생성하지 못했습니다.');return;}
  pdfBlob=new Blob([data.buffer],{type:'application/pdf'});busy=false;$('cancel').disabled=true;$('save').disabled=false;
  setStatus(`${data.total}장 변환 완료${data.warnings?' · 일부 요소를 표시하지 못했습니다. 원본과 비교해주세요.':data.legacy?' · 구형 PPT는 원본과 비교해주세요.':''}`);
  void save();
 }
});
$('file').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 const thisJob=start();filename=file.name;$('filename').textContent=filename;$('original').hidden=true;
 try {if(file.size>LMSDocuments.MAX_BYTES)throw new Error('파일 크기 제한(50 MB)을 초과했습니다.');await convert(await file.arrayBuffer(),thisJob);}catch(error){if(thisJob===job)fail(error.message);}
});
$('save').addEventListener('click',save);$('cancel').addEventListener('click',stop);
$('original').addEventListener('click',()=>{if(originalURL)chrome.tabs.create({url:originalURL});});
window.addEventListener('pagehide',()=>{controller?.abort();for(const url of blobURLs)URL.revokeObjectURL(url);});
resetSandbox();
const params=new URLSearchParams(location.search);
if(params.has('url'))void remoteFile(params.get('url'),params.get('name'));
