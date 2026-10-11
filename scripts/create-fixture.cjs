// Synthetic presentation only. No real course titles, IDs or student data.
const Pptx=require('pptxgenjs');
const p=new Pptx();p.layout='LAYOUT_WIDE';p.author='Synthetic test';
let s=p.addSlide();s.addText('한글 강의자료 변환 테스트',{x:.7,y:.7,w:10,h:.8,fontFace:'Noto Sans CJK KR',fontSize:30,color:'123456'});
s.addImage({path:'icon-128.png',x:11.7,y:.5,w:.8,h:.8});
s.addShape(p.ShapeType.rect,{x:.8,y:2,w:3,h:1,fill:{color:'2563EB'},line:{color:'2563EB'}});
s.addText('도형과 한글',{x:1,y:2.2,w:2.6,h:.5,fontFace:'Noto Sans CJK KR',fontSize:20,color:'FFFFFF'});
s=p.addSlide();s.addText('두 번째 슬라이드 · 표',{x:.7,y:.7,w:11,h:.8,fontFace:'Noto Sans CJK KR',fontSize:30});
s.addTable([['항목','값'],['합계','123'],['표 테스트','정상']],{x:1,y:2,w:10,h:2,fontFace:'Noto Sans CJK KR',fontSize:20,border:{type:'solid',pt:1,color:'8090A0'},fill:'F0F5FF'});
p.writeFile({fileName:'tests/fixtures/sample.pptx'});
