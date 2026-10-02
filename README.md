# LMS Video Downloader (Manifest V3)

단국대학교 및 전국 주요 대학 이러닝(LearningX / Canvas LMS / Uniplayer) 강의 동영상을 감지하고 손쉽게 다운로드할 수 있는 Chrome 확장 프로그램입니다.  
([zinirun/LMSDownloader](https://github.com/zinirun/LMSDownloader) 포크 및 현대화 버전)

---

## 🚀 주요 개선 사항 (v1.0.0)

1. **Chrome Manifest V3 완벽 대응**
   - 구형 Manifest V2 폐지에 맞추어 Service Worker(`background.js`) 및 `action` API로 전면 개편.
   - `chrome.tabs.executeScript` 제거 및 최신 `chrome.scripting.executeScript` 적용.
2. **별도 백엔드/Node.js 서버 없이 100% 브라우저 자체 다운로드**
   - 일부 CDN의 `Referer` 검증 차단(403 Forbidden) 문제를 `chrome.declarativeNetRequest` 동적 규칙을 통해 확장 프로그램 내부에서 자체 해결.
3. **크로스 오리진 4단 중첩 iframe 탐색 한계 극복**
   - 브라우저 보안 정책(SOP)으로 막히던 iframe DOM 접근 대신, `allFrames: true` 컨텍스트 인젝션을 통해 내부 플레이어와 직접 통신.
4. **전국 주요 대학 이러닝/LearningX 호환**
   - 단국대(`nlms.dankook.ac.kr`, `clms.dankook.ac.kr`)
   - 경희대(`khcanvas.khu.ac.kr`, `commons.khu.ac.kr`)
   - 중앙대, 경인교대, 한양대 등 Xinics / Uniplayer / HTML5 Video 기반 LMS 자동 감지
5. **현대적인 UI & 편의 기능**
   - 강의 제목 자동 파일명 적용 및 사용자 수정 지원
   - 브라우저 다운로드 / 새 탭에서 재생 / 스트림 URL 복사 버튼 제공

---

## 🛠️ 설치 방법

### 🦊 파이어폭스 (Firefox)
1. 파이어폭스 주소창에 `about:debugging#/runtime/this-firefox` 입력 후 접속
2. **[임시 부가 기능 로드 (Load Temporary Add-on...)]** 버튼 클릭
3. 이 프로젝트 폴더 안의 `manifest.json` 파일 선택 (즉시 활성화)

### 🌐 크롬 및 크로미움 계열 (Chrome / Edge / Whale / Brave)
1. 브라우저 주소창에 `chrome://extensions/` 입력 후 접속
2. 우측 상단의 **개발자 모드(Developer mode)** 스위치 켜기
3. 좌측 상단 **[압축해제된 확장 프로그램을 로드합니다]** 클릭 후 이 프로젝트 폴더 선택

---

## 📖 사용 방법

1. 대학교 이러닝 사이트에 로그인하여 수강할 강의 페이지로 이동합니다.
2. 강의 동영상을 재생합니다 (로딩/인트로가 지나고 본 강의 영상이 재생될 때).
3. 브라우저 우측 상단 퍼즐 아이콘에서 **LMS Downloader** 아이콘을 클릭합니다.
4. 감지된 강의 목록에서 제목을 확인/수정한 뒤 **[다운로드]** 버튼을 누르면 다운로드가 시작됩니다.

> 💡 **참고:** 목록에 영상이 바로 나타나지 않는 경우, 동영상을 1~2초간 재생한 상태에서 팝업 상단의 **[새로고침 / 다시 스캔(↻)]** 버튼을 눌러주세요.

---

## ⚠️ 유의사항

- 본 프로그램은 학생들의 개인 학습 및 복습 편의를 위해 제작된 비공식 오픈소스 도구입니다.
- 강의 영상은 교수자 및 교육기관의 저작물입니다. 다운로드한 강의를 무단 배포, 공유, 재업로드하는 행위는 저작권법에 위배될 수 있으므로 오직 개인 학습 용도로만 사용해야 합니다.
