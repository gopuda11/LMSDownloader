import {parseZip,buildPresentation,renderSlide} from '@aiden0z/pptx-renderer/browser';
import {toPng} from 'html-to-image';
import {jsPDF} from 'jspdf';
import JSZip from 'jszip';
import {parse as parseLegacy,slideToPng} from '@web-ppt/core';
// Chromium suspends animation frames for offscreen iframes. This private rendering
// document has no interactive animation; advance its layout tasks on timers instead.
window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);
window.cancelAnimationFrame=id=>clearTimeout(id);
let busy=false;
const limits={maxEntries:4000,maxEntryUncompressedBytes:32*1024*1024,maxTotalUncompressedBytes:160*1024*1024,maxMediaBytes:100*1024*1024,maxConcurrency:2};
const send=(job,type,data={})=>parent.postMessage({channel:'lms-pdf',job,type,...data},'*');
window.addEventListener('message',async e=>{
 if(e.source!==parent||e.data?.channel!=='lms-pdf'||e.data?.type!=='convert'||busy)return;
 const {job,buffer}=e.data;busy=true;
 try {
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength>LMSDocuments.MAX_BYTES)throw new Error('파일 크기 제한(50 MB)을 초과했습니다.');
  const kind=LMSDocuments.checkSignature(buffer);
  if(kind==='ppt'){await convertLegacy(buffer,job);return;}
  const zip=await JSZip.loadAsync(buffer);
  if(Object.keys(zip.files).length>limits.maxEntries)throw new Error('PPTX 내부 파일 수 제한을 초과했습니다.');
  for(const name of Object.keys(zip.files))if(!zip.files[name].dir&&/(?:vbaProject\.bin|^ppt\/embeddings\/|\.exe$|\.js$)/i.test(name))throw new Error('매크로 또는 삽입된 실행 콘텐츠를 포함한 PPTX는 지원하지 않습니다.');
  const files=await parseZip(buffer,limits);
  for(const [name,entry] of Object.entries(zip.files)){
   if(/\.(?:xml|rels)$/i.test(name)&&!entry.dir){
    if(entry._data?.uncompressedSize>limits.maxEntryUncompressedBytes)throw new Error('PPTX 내부 XML 크기 제한을 초과했습니다.');
    // Include relationships not retained by the renderer (e.g. document properties).
    LMSDocuments.checkXML(await entry.async('string'));
   }
  }
  const p=buildPresentation(files,{lazySlides:true});
  if(!p.slides.length||p.slides.length>200)throw new Error('1~200장의 PPTX만 변환할 수 있습니다.');
  const cache=new Map();let pdf;let warnings=0;let imageBytes=0;const host=document.getElementById('slide');
  for(let i=0;i<p.slides.length;i++){
   send(job,'progress',{current:i+1,total:p.slides.length});
   const h=renderSlide(p,p.slides[i],{mediaUrlCache:cache,onNodeError:()=>warnings++});
   try {
    host.replaceChildren(h.element);await h.ready;await document.fonts.ready;
    await new Promise(resolve=>setTimeout(resolve,50));
    const rect=h.element.getBoundingClientRect();const w=rect.width,ht=rect.height;
    if(!Number.isFinite(w)||!Number.isFinite(ht)||w<1||ht<1||w*ht>8000000||w>8000||ht>8000)throw new Error('슬라이드 크기 제한을 초과했습니다.');
    const png=await toPng(h.element,{pixelRatio:1.5,cacheBust:false,skipFonts:true,backgroundColor:'#ffffff'});
    imageBytes+=png.length*.75;if(imageBytes>100*1024*1024)throw new Error('변환 이미지 메모리 제한(100 MB)을 초과했습니다. 자료를 나누어 변환해주세요.');
    if(i===0)send(job,'preview',{url:png});
    const format=[w*0.75,ht*0.75],orientation=w>ht?'landscape':'portrait';
    if(!pdf)pdf=new jsPDF({unit:'pt',format,orientation,compress:true});else pdf.addPage(format,orientation);
    pdf.addImage(png,'PNG',0,0,format[0],format[1],undefined,'FAST');
   }finally{h.dispose();host.replaceChildren();}
  }
  for(const value of cache.values())if(typeof value==='string'&&value.startsWith('blob:'))URL.revokeObjectURL(value);
  const out=pdf.output('arraybuffer');
  if(out.byteLength>150*1024*1024)throw new Error('생성된 PDF가 150 MB 제한을 초과했습니다.');
  parent.postMessage({channel:'lms-pdf',job,type:'done',buffer:out,warnings,total:p.slides.length},'*',[out]);
 }catch(error){console.error('PPT conversion failed',error);send(job,'error',{message:error?.message||'변환하지 못했습니다.'});}
 finally{busy=false;}
});
parent.postMessage({channel:'lms-pdf',type:'ready'},'*');

async function convertLegacy(buffer,job){
 let p;try{p=await parseLegacy(buffer);}catch{throw new Error('PPT 파일을 읽지 못했습니다. 손상되었거나 암호화된 파일인지 확인해주세요.');}try{
  if(!p.slides.length||p.slides.length>200)throw new Error('1~200장의 PPT만 변환할 수 있습니다.');
  if(!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<1||p.height<1||p.width*p.height>8000000)throw new Error('슬라이드 크기 제한을 초과했습니다.');
  const format=[p.width*.75,p.height*.75],orientation=p.width>p.height?'landscape':'portrait';let pdf;let imageBytes=0;
  for(let i=0;i<p.slides.length;i++){
   send(job,'progress',{current:i+1,total:p.slides.length});
   const blob=await slideToPng(p,p.slides[i],1.5);
   const png=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
   imageBytes+=png.length*.75;if(imageBytes>100*1024*1024)throw new Error('변환 이미지 메모리 제한을 초과했습니다.');
   if(i===0)send(job,'preview',{url:png});
   if(!pdf)pdf=new jsPDF({unit:'pt',format,orientation,compress:true});else pdf.addPage(format,orientation);
   pdf.addImage(png,'PNG',0,0,format[0],format[1],undefined,'FAST');
  }
  const out=pdf.output('arraybuffer');if(out.byteLength>150*1024*1024)throw new Error('PDF 크기 제한을 초과했습니다.');
  parent.postMessage({channel:'lms-pdf',job,type:'done',buffer:out,total:p.slides.length,warnings:0,legacy:true},'*',[out]);
 }finally{p.dispose?.();}
}
