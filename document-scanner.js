/* Runs in the isolated world of visible school frames; reads links only. */
(function(){
 const items=[];const seen=new Set();
 try {LMSDocuments.schoolURL(location.href);}catch{return [];}
 for(const el of document.querySelectorAll('a[href],a[data-url]')){
  const href=el.getAttribute('href')||el.getAttribute('data-url');
  const name=el.getAttribute('download')||el.getAttribute('data-filename')||el.getAttribute('title')||el.textContent;
  const item=LMSDocuments.candidate(href,name,location.href);
  if(item&&!seen.has(item.url)){seen.add(item.url);items.push(item);}
 }
 return items.slice(0,30);
})();
