const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const D=fs.existsSync(require('node:path').join(__dirname,'../documents.js'))?require('../documents.js'):{};
test('document policy allows only HTTPS school hosts without credentials or custom ports',()=>{
 assert.equal(typeof D.schoolURL,'function');
 assert.equal(D.schoolURL('https://canvas.dankook.ac.kr/files/123/download').hostname,'canvas.dankook.ac.kr');
 for(const u of ['http://canvas.dankook.ac.kr/a','https://canvas.dankook.ac.kr.evil.test/a','https://evil.test/a','https://user@canvas.dankook.ac.kr/a','https://canvas.dankook.ac.kr:444/a'])assert.throws(()=>D.schoolURL(u));
});
test('material candidates recognize titles and Canvas file routes but do not invent filenames',()=>{
 assert.equal(typeof D.candidate,'function');
 assert.equal(D.candidate('/courses/1/files/123?wrap=1','강의 자료.pptx','https://canvas.dankook.ac.kr/courses/1').fileId,'123');
 assert.equal(D.candidate('https://clms.dankook.ac.kr/files/slides.PPTX?x=1','','https://canvas.dankook.ac.kr').ext,'pptx');
 assert.equal(D.candidate('/courses/1/files/123?wrap=1','자료','https://canvas.dankook.ac.kr').ext,'unknown');
 assert.equal(D.candidate('/courses/1','강의','https://canvas.dankook.ac.kr'),null);
 assert.equal(D.candidate('https://evil.test/f.pptx','slides.pptx','https://canvas.dankook.ac.kr'),null);
 assert.equal(D.fileId('https://canvas.dankook.ac.kr/api/v1/files/456/download'),'456');
});
test('safe PDF filenames remove paths and replace only the final presentation extension',()=>{
 assert.equal(typeof D.pdfName,'function');
 assert.equal(D.pdfName('../강의:자료.PPTX'),'.._강의_자료.pdf');
 assert.equal(D.pdfName(''),'강의자료.pdf');
});
test('bounded stream stops oversized or unreadable downloads',async()=>{
 assert.equal(typeof D.readBounded,'function');
 assert.equal((await D.readBounded(new Response(new Uint8Array([1,2,3])),3)).byteLength,3);
 await assert.rejects(D.readBounded(new Response(new Uint8Array([1,2,3,4])),3),/크기/);
 await assert.rejects(D.readBounded(new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),100),/로그인/);
 await assert.rejects(D.readBounded(new Response('',{headers:{'Content-Length':'999'}}),3),/크기/);
});
test('presentation signatures detect legacy PPT and reject malformed archives and external XML',()=>{
 assert.equal(typeof D.checkSignature,'function');
 assert.equal(D.checkSignature(new Uint8Array([208,207,17,224]).buffer),'ppt');
 assert.throws(()=>D.checkSignature(new Uint8Array([1,2,3,4]).buffer),/PPTX/);
 assert.doesNotThrow(()=>D.checkSignature(new Uint8Array([80,75,3,4]).buffer));
 assert.equal(typeof D.checkXML,'function');
 assert.throws(()=>D.checkXML('<Relationship TargetMode="External" Target="https://evil.test"/>'),/외부/);
 assert.throws(()=>D.checkXML('<!DOCTYPE r [<!ENTITY x SYSTEM "x">]>'),/XML/);
 assert.doesNotThrow(()=>D.checkXML('<Relationship Target="slides/slide1.xml"/>'));
});
test('weekly module file resolves only its own current item, never neighboring or locked items',async()=>{
 assert.equal(typeof D.resolveFileId,'function');
 const urls=[];
 const id=await D.resolveFileId('https://canvas.dankook.ac.kr/courses/10001/modules/items/20001',async u=>{urls.push(u);return {items:[{current:{id:20001,type:'File',content_id:123},next:{id:20002,type:'File',content_id:999}}]};});
 assert.equal(id,'123');assert.match(urls[0],/asset_id=20001/);
 await assert.rejects(D.resolveFileId('https://canvas.dankook.ac.kr/courses/10001/modules/items/20001',async()=>({items:[{current:{id:20001,type:'File',content_id:123,content_details:{locked_for_user:true}}}]})),/파일/);
 await assert.rejects(D.resolveFileId('https://canvas.dankook.ac.kr/courses/10001/modules/items/20001',async()=>({items:[{current:{id:20001,type:'ExternalTool',content_id:999}}]})),/파일/);
 await assert.rejects(D.resolveFileId('https://canvas.dankook.ac.kr/courses/10001/modules/items/20001',async()=>({items:[{current:{id:20002,type:'File',content_id:999}}]})),/파일/);
});
