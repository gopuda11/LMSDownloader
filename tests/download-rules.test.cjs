const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const url='https://dankook-storage.commonscdn.com/video.mp4?token=test';
function worker({session=[],dynamic=[],active=[],fail=false}={}) {
 let changed;const rules=[...session],old=[...dynamic],downloads=[...active];
 const dnr={getDynamicRules:async()=>old,getSessionRules:async()=>rules,
  updateDynamicRules:async({removeRuleIds=[]})=>{for(let i=old.length-1;i>=0;i--)if(removeRuleIds.includes(old[i].id))old.splice(i,1);},
  updateSessionRules:async({removeRuleIds=[],addRules=[]})=>{for(let i=rules.length-1;i>=0;i--)if(removeRuleIds.includes(rules[i].id))rules.splice(i,1);rules.push(...addRules);}};
 const chrome={runtime:{onMessage:{addListener(){}}},webRequest:{onBeforeRequest:{addListener(){}}},tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}}},declarativeNetRequest:dnr,
  downloads:{onChanged:{addListener(fn){changed=fn;}},search:async()=>downloads.filter(x=>x.state==='in_progress'),download:(options,cb)=>{if(fail){chrome.runtime.lastError={message:'download rejected'};cb();delete chrome.runtime.lastError;}else{downloads.push({id:41,url:options.url,state:'in_progress'});cb(41);}}}};
 const ctx=vm.createContext({chrome,LMSIlos:require('../ilos.js'),LMSRecovery:{},URL,Map,Set,Date,console});vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),ctx);
 return {ctx,rules,old,downloads,finish:async state=>{downloads[0].state=state;changed({id:41,state:{current:state}});await vm.runInContext('downloadRuleQueue',ctx);}};
}
test('download header rule matches only its exact URL and is removed on completion',async()=>{
 const w=worker();assert.equal(await w.ctx.handleDownload(url,'lecture.mp4','https://clms.dankook.ac.kr/'),41);
 assert.equal(w.rules.length,1);const c=w.rules[0].condition;assert.ok(c.regexFilter,'requires exact URL rule');
 assert.ok(new RegExp(c.regexFilter).test(url));assert.equal(new RegExp(c.regexFilter).test(url+'&another=1'),false);assert.equal(new RegExp(c.regexFilter).test('https://dankook-storage.commonscdn.com/other.mp4'),false);
 await w.finish('complete');assert.equal(w.rules.length,0);
});
test('interruption and download-start failure remove temporary header rules',async()=>{
 const w=worker();await w.ctx.handleDownload(url,'lecture.mp4','https://clms.dankook.ac.kr/');await w.finish('interrupted');assert.equal(w.rules.length,0);
 const bad=worker({fail:true});await assert.rejects(bad.ctx.handleDownload(url,'lecture.mp4','https://clms.dankook.ac.kr/'),/rejected/);assert.equal(bad.rules.length,0);
});
test('worker startup clears legacy rules and abandoned session rules but preserves other rules',async()=>{
 const w=worker({dynamic:[{id:10000},{id:7}],session:[{id:10001,condition:{regexFilter:'^https://unused/$'}},{id:8}]});
 await vm.runInContext('downloadRulesReady',w.ctx);assert.deepEqual(w.old.map(x=>x.id),[7]);assert.deepEqual(w.rules.map(x=>x.id),[8]);
});
test('worker restart preserves rules still needed by an active download',async()=>{
 const w=worker({session:[{id:10001,condition:{regexFilter:'^https://dankook-storage\\.commonscdn\\.com/video\\.mp4\\?token=test$'}}],active:[{id:41,url,state:'in_progress'}]});
 await vm.runInContext('downloadRulesReady',w.ctx);assert.equal(w.rules.length,1);await w.finish('complete');assert.equal(w.rules.length,0);
});
test('video downloads reject non-school servers and untrusted referrers',async()=>{
 const w=worker();await assert.rejects(w.ctx.handleDownload('https://example.org/a.mp4','x.mp4','https://clms.dankook.ac.kr/'),/단국대/);
 await assert.rejects(w.ctx.handleDownload(url,'x.mp4','https://example.org/'),/단국대/);assert.equal(w.rules.length,0);
});
