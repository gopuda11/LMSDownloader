"""Real Chromium extension test. Requires Python playwright and its Chromium runtime.
Run: python scripts/check-browser.py --output /tmp/lms-pdf-check
Fixtures are synthetic, not actual lecture materials.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse,json,tempfile,time,zipfile
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
fixtures=root/'tests/fixtures';results={};errors=[];requests=[]
def wait(page,predicate,seconds=60):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  if predicate():return
  page.wait_for_timeout(100)
 raise AssertionError('Timed out: '+page.locator('#status').inner_text())
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='lms-pdf-check-') as profile:
 ctx=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,args=[f'--disable-extensions-except={root}',f'--load-extension={root}'])
 sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');ext=sw.url.split('/')[2]
 page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 # Expected malformed-file errors are reported in the UI; uncaught page errors fail below.
 ctx.on('request',lambda r:requests.append(r.url) if r.url.startswith('http') else None)
 page.goto(f'chrome-extension://{ext}/converter.html');page.wait_for_load_state('networkidle')
 for name in ['sample.pptx','sample.ppt']:
  page.locator('#file').set_input_files(fixtures/name)
  wait(page,lambda:'변환 완료' in page.locator('#status').inner_text() or '업로드되지' in page.locator('#result').inner_text())
  assert '2장 변환 완료' in page.locator('#status').inner_text(),page.locator('#status').inner_text()
  wait(page,lambda:'저장되었습니다' in page.locator('#result').inner_text())
  downloads=page.evaluate('chrome.downloads.search({orderBy:["-startTime"]})')
  d=downloads[0];assert d['state']=='complete';data=Path(d['filename']).read_bytes();assert data.startswith(b'%PDF-')
  (out/(name+'.pdf')).write_bytes(data);page.screenshot(path=str(out/(name+'.png')),full_page=True)
  results[name]={'status':page.locator('#status').inner_text(),'bytes':len(data),'downloadState':d['state']}
 assert not requests,requests
 # Cancel must destroy the rendering iframe and permit a new conversion.
 page.locator('#file').set_input_files(fixtures/'sample.pptx');page.locator('#cancel').click()
 assert '취소' in page.locator('#status').inner_text()
 page.locator('#file').set_input_files(fixtures/'sample.ppt');wait(page,lambda:'변환 완료' in page.locator('#status').inner_text())
 results['cancel']='passed'
 files={}
 with zipfile.ZipFile(fixtures/'sample.pptx') as z:files={n:z.read(n) for n in z.namelist()}
 files['ppt/slides/_rels/slide1.xml.rels']=files['ppt/slides/_rels/slide1.xml.rels'].replace(b'</Relationships>',b'<Relationship Id="bad" Type="image" TargetMode="External" Target="https://example.invalid/tracker.png"/></Relationships>')
 with zipfile.ZipFile(out/'external.pptx','w') as z:
  for n,b in files.items():z.writestr(n,b)
 for name,data,expected in [('invalid.pptx',b'bad','올바른'),('invalid.ppt',bytes([208,207,17,224,0,0,0,0]),'PPT 파일을 읽지'),('external.pptx',None,'외부')]:
  if data is not None:(out/name).write_bytes(data)
  page.locator('#file').set_input_files(out/name);wait(page,lambda:'업로드되지' in page.locator('#result').inner_text())
  assert expected in page.locator('#status').inner_text(),page.locator('#status').inner_text()
  results[name]=page.locator('#status').inner_text()
 assert not requests,requests
 # A controlled school-origin attachment tests scanner, logged-in metadata fetch,
 # download and sandbox end-to-end. This is NOT a live school account test.
 payload=(fixtures/'sample.pptx').read_bytes();school='https://canvas.dankook.ac.kr'
 def route(r):
  path=r.request.url
  if '/module_item_sequence' in path:r.fulfill(json={'items':[{'current':{'id':20001,'type':'File','content_id':123}}]})
  elif '/api/v1/files/123' in path:r.fulfill(json={'display_name':'강의자료.pptx','url':school+'/files/123/download'})
  elif '/files/123/download' in path:r.fulfill(body=payload,content_type='application/vnd.openxmlformats-officedocument.presentationml.presentation')
  else:r.fulfill(body='<html><meta charset="utf-8"><title>시험 강의자료실</title><a href="/courses/10001/modules/items/20001">강의자료.pptx</a></html>',content_type='text/html')
 ctx.route('https://canvas.dankook.ac.kr/**',route)
 schoolpage=ctx.new_page();schoolpage.goto(school+'/courses/10001/files');schoolpage.bring_to_front()
 popup=ctx.new_page();popup.goto(f'chrome-extension://{ext}/popup.html')
 # Extension tab foreground needs explicit source tab injection in this test only.
 tabid=sw.evaluate("async () => (await chrome.tabs.query({url:'https://canvas.dankook.ac.kr/courses/10001/files'}))[0].id")
 popup.evaluate('async id => { getActiveTab=async()=>({id,url:"https://canvas.dankook.ac.kr/courses/10001/files"}); while(scanRunning) await new Promise(r=>setTimeout(r,50)); await refreshScan(); }',tabid)
 assert popup.locator('#document-list').get_by_text('강의자료.pptx').is_visible()
 with ctx.expect_page() as newpage:popup.get_by_role('button',name='PDF로 저장',exact=True).click()
 remote=newpage.value;remote.wait_for_load_state('networkidle')
 wait(remote,lambda:'변환 완료' in remote.locator('#status').inner_text() or '업로드되지' in remote.locator('#result').inner_text())
 assert '변환 완료' in remote.locator('#status').inner_text(),remote.locator('#status').inner_text()
 wait(remote,lambda:'저장되었습니다' in remote.locator('#result').inner_text())
 results['controlledSchoolAttachment']='metadata + scan + conversion + download passed'
 assert not errors,errors
 results['pageErrors']=errors;results['localConversionHTTPRequests']=[]
 (out/'evidence.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False,indent=2))
 ctx.close()
