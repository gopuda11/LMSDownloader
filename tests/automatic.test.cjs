const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname,'..');
const thumbnail='https://clms.dankook.ac.kr/CommonsCore2/v2/contents/11111111-2222-4333-8444-555555555555.jpg';
const frame='https://canvas.dankook.ac.kr/learningx/lti/lecture_attendance/items/view/12345';
const api='https://canvas.dankook.ac.kr/learningx/api/v1/courses/10001/items/12345';
const item={item_id:12345,title:'3주차',lecture_period_status:'closed',item_content_data:{content_id:'not_open',thumbnail_url:thumbnail}};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function source(file){const p=path.join(base,file);return fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';}

test('page fetch hook automatically captures masked lesson responses without changing the fetch result',async()=>{
 const posted=[];
 const response={url:api,clone:()=>({json:async()=>item})};
 const native=Promise.resolve(response);
 class XHR {open(){} addEventListener(){}}
 const context={URL,XMLHttpRequest:XHR,window:{location:{href:frame,origin:'https://canvas.dankook.ac.kr'},fetch:()=>native,postMessage:data=>posted.push(data)}};
 context.window.XMLHttpRequest=XHR;
 vm.createContext(context);vm.runInContext(source('page-capture.js'),context);
 assert.equal(context.window.fetch(api),native);
 await turn();
 assert.equal(posted.length,1);
 assert.equal(posted[0].itemId,12345);
 assert.equal(posted[0].thumbnail,thumbnail);
 assert.equal(posted[0].title,'3주차');
 assert.equal('item_content_data' in posted[0],false);
});

test('XHR responses are captured and unrelated responses are ignored',async()=>{
 const posted=[];
 class XHR { open(method,url){this.responseURL=url;} addEventListener(name,fn){this.listener=fn;} }
 const window={location:{href:frame,origin:'https://canvas.dankook.ac.kr'},fetch:async()=>({url:'https://example.com/other',clone:()=>({json:async()=>item})}),XMLHttpRequest:XHR,postMessage:data=>posted.push(data)};
 const context={URL,XMLHttpRequest:XHR,window};vm.createContext(context);vm.runInContext(source('page-capture.js'),context);
 const xhr=new XHR();xhr.open('GET',api);xhr.status=200;xhr.responseType='json';xhr.response=item;
 if(xhr.listener)xhr.listener();
 await window.fetch('https://example.com/other');await turn();
 assert.equal(posted.length,1);assert.equal(posted[0].thumbnail,thumbnail);
});

function worker(store){
 let listener, updated, removed;
 const storage={get:async key=>({[key]:store[key]}),set:async values=>Object.assign(store,values),remove:async key=>{delete store[key];}};
 const context={console,URL,Map,Date,fetch,AbortSignal,LMSIlos:require('../ilos.js'),LMSRecovery:require('../recovery.js'),chrome:{
  storage:{session:storage},webRequest:{onBeforeRequest:{addListener(){}}},
  tabs:{onUpdated:{addListener(fn){updated=fn;}},onRemoved:{addListener(fn){removed=fn;}}},
  runtime:{onMessage:{addListener(fn){listener=fn;}}},
  declarativeNetRequest:{getDynamicRules:async()=>[],getSessionRules:async()=>[]},
  downloads:{search:async()=>[],onChanged:{addListener(){}}}
 }};
 vm.createContext(context);vm.runInContext(source('background.js'),context);
 return {message:(request,sender={})=>new Promise(resolve=>{const handled=listener(request,sender,resolve);if(handled===undefined)resolve({});}),updated,removed};
}
test('captured lesson survives worker restart and navigation removes it',async()=>{
 const store={};let bg=worker(store);
 const sender={tab:{id:1,url:'https://canvas.dankook.ac.kr/courses/10001/modules/items/20001'},url:frame};
 const result=await bg.message({action:'captureLearningItem',itemId:12345,thumbnail,title:'3주차'},sender);
 assert.equal(result.ok,true);
 bg=worker(store);
 const media=(await bg.message({action:'getDetectedMedia',tabId:1})).media;
 assert.equal(media.length,1);assert.equal(media[0].url,thumbnail);assert.equal(media[0].type,'commonsRecovery');
 bg.updated(1,{status:'loading'});await turn();
 assert.equal((await bg.message({action:'getDetectedMedia',tabId:1})).media.length,0);
});
test('capture does not accept another page or a different item ID',async()=>{
 const bg=worker({});
 assert.equal((await bg.message({action:'captureLearningItem',itemId:999,thumbnail},{tab:{id:1},url:frame})).ok,false);
 assert.equal((await bg.message({action:'captureLearningItem',itemId:12345,thumbnail},{tab:{id:1},url:'https://other.example/'})).ok,false);
});
test('an already-open lesson is reloaded automatically and the captured response is used without user input',async()=>{
 const element={addEventListener(){}};
 let reloads=0,reads=0;
 const context={console,URL,document:{getElementById:()=>element,addEventListener(){}},setTimeout:resolve=>resolve(),chrome:{
  tabs:{reload:async id=>{assert.equal(id,1);reloads++;}},
  runtime:{sendMessage:(_,callback)=>{reads++;callback({media:reads===1?[]:[{type:'commonsRecovery',url:thumbnail}]});}}
 }};
 vm.createContext(context);vm.runInContext(source('popup.js'),context);
 assert.equal(context.isDankookLessonTab('https://canvas.dankook.ac.kr/courses/10001/modules/items/20001'),true);
 assert.equal(context.isDankookLessonTab('https://other.example/'),false);
 const found=await context.reloadAndCollect(1);
 assert.equal(reloads,1);assert.equal(reads,2);assert.equal(found[0].url,thumbnail);
});
