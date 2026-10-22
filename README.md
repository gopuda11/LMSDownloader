# 러닝엑스/LMS 다운로더 (LMS Video Downloader)

단국대학교 이러닝(LearningX / Canvas LMS)과 한경대학교 사이버캠퍼스(ILOS) 강의 영상을 다운로드하는 **크롬 확장 프로그램**입니다. Chrome·Edge·Whale·Brave 등 Chromium 계열 브라우저에서 쓸 수 있고, PPT/PPTX 강의자료를 PDF로 바꾸는 기능도 들어 있습니다.

[zinirun/LMSDownloader](https://github.com/zinirun/LMSDownloader)를 바탕으로 고친 비공식 도구입니다.

**소개 페이지:** https://gopuda11.github.io/LMSDownloader/

## v1.4.0

- 한경대학교 ILOS 지원: 강의 화면에서 영상 다운로드, 주차별 목록에서 개별 다운로드와 이번 주 전체 다운로드
- 이번 주 전체 다운로드는 팝업을 닫아도 계속 진행
- PPT/PPTX → PDF 변환 기능 포함 (실제 학교 강의자료 미확인)

## 설치 방법

Chrome 116 이상 또는 같은 기능을 지원하는 Edge·Whale·Brave 등 Chromium 계열 브라우저가 필요합니다.

1. [최신 릴리스](https://github.com/gopuda11/LMSDownloader/releases/latest)에서 `LMSDownloader-v1.4.0.zip`을 내려받아 압축을 풉니다.
2. 확장 프로그램 관리 화면을 엽니다. Chrome은 `chrome://extensions/`, Edge는 `edge://extensions/`입니다.
3. **개발자 모드**를 켜고 **압축해제된 확장 프로그램 로드**를 누릅니다.
4. `manifest.json`이 있는 폴더를 선택합니다.
5. 확장 프로그램을 툴바에 고정해 두면 강의 화면에서 바로 열 수 있습니다.

업데이트할 때는 새 파일로 덮어쓴 뒤 확장 프로그램 관리 화면에서 **새로고침**을 누릅니다.

## 사용 방법

### 단국대학교 (LearningX)

1. 단국대학교 LMS에 로그인하고 **개별 영상 강의 화면**을 엽니다.
2. 영상 재생 버튼을 누릅니다. 인트로가 있으면 본 영상이 나올 때까지 기다립니다.
3. 툴바에서 **LMS Downloader**를 엽니다. 감지가 안 되면 **다시 스캔**을 누릅니다.
4. 파일명을 확인하고 **다운로드**를 누릅니다. 브라우저 기본 다운로드 폴더에 저장됩니다.

![일반 영상 감지 및 다운로드 버튼](img/usage-normal-redacted.png)

### 한경대학교 (ILOS)

1. [한경대학교 사이버캠퍼스](https://cyber.hknu.ac.kr)에 로그인합니다.
2. **학습하기**로 강의 화면을 연 뒤 확장 프로그램을 열면 그 영상을 다운로드할 수 있습니다.
3. **주차별 강의 목록**에서 확장 프로그램을 열면 강의마다 **다운로드** 버튼과 **이번 주 전체 다운로드** 버튼이 나옵니다. 실패한 강의는 건너뛰고 마지막에 성공·실패 개수를 보여 줍니다.
4. 전체 다운로드는 팝업을 닫아도 계속됩니다. 다시 열면 진행 상황이 보입니다.
5. 인증 오류가 나오면 **학습하기**로 강의를 한 번 열어 **2차 인증**을 마친 뒤 목록에서 다시 시도해 주세요.

### PPT / PPTX 강의자료를 PDF로 저장 (실제 강의자료 미확인)

지금 듣는 과목에 PPT/PPTX 강의자료가 없어서 **학교에 올라온 실제 자료로는 아직 확인하지 못했습니다.** 작동하지 않거나 결과가 이상하면 [GitHub Issues](https://github.com/gopuda11/LMSDownloader/issues)에 알려 주세요.

1. 단국대 LMS의 **강의자료실 또는 주차학습**에서 PPT/PPTX 파일 링크가 보이는 화면을 엽니다. 필요하면 자료 상세 화면까지 들어갑니다.
2. 확장 프로그램의 **강의자료 · PDF 변환** 목록에서 **PDF로 저장**을 누릅니다.
3. 새로 열린 변환 탭에서 진행 상황과 첫 슬라이드 미리보기를 확인합니다. 끝나면 PDF가 다운로드 폴더에 저장됩니다.
4. 자료가 감지되지 않거나 학교 서버가 파일 조회를 거절하면, 원본을 먼저 내려받고 **내 PPT / PPTX 파일 선택**으로 변환할 수 있습니다.

따로 프로그램을 설치하거나 계정을 만들 필요가 없고, 파일을 서버에 올리지도 않습니다. 구형 PPT도 PPTX로 다시 저장하지 않고 바로 읽습니다.

- 최대 50 MB, 200장까지 변환합니다.
- 슬라이드를 이미지로 담은 PDF라서 **글자 검색·복사는 안 됩니다.**
- 글꼴, 구형 PPT의 일부 도형, 수식·차트·애니메이션은 원본과 다르게 보일 수 있습니다. 중요한 자료는 원본과 비교해 주세요.
- 암호가 걸렸거나 손상된 파일은 변환하지 못합니다. 외부 링크, 매크로, OLE 삽입 콘텐츠는 막습니다. 이런 파일은 원본 앱에서 PDF로 저장해 주세요.

아래는 개인정보가 없는 시험용 자료를 **실제 Chromium 확장 프로그램**으로 변환한 화면입니다.

![PPT 강의자료의 PDF 변환 완료와 첫 슬라이드 미리보기](img/usage-pdf-conversion.png)

## 데이터와 권한

이 확장 프로그램은 비밀번호, 쿠키, 인증 값을 수집하거나 저장하지 않고, 분석 서비스나 개발자 서버로 아무것도 보내지 않습니다. 영상과 자료 정보는 학교 서버에서 직접 가져옵니다.

강의 제목이나 진행 상태처럼 화면 표시에 필요한 정보만 탭별로 브라우저에 잠깐 보관하고, 페이지를 벗어나거나 탭을 닫으면 지웁니다. PPT/PPTX 변환은 외부 네트워크가 막힌 격리 화면에서 처리합니다.

사이트 접근 권한은 `*.dankook.ac.kr`, `dankook-storage.commonscdn.com`, `cyber.hknu.ac.kr`, `stream.hknu.ac.kr`로 제한합니다.

## 개발

```sh
node --test tests/*.test.cjs
python3 scripts/build.py
```

변환 코드를 고쳤다면 번들과 패키지를 다시 만듭니다. 배포 ZIP만 쓰는 경우에는 필요 없습니다.

```sh
npm ci
npm run bundle
npm test
python3 scripts/build.py
# Python Playwright와 Chromium을 준비한 개발 환경에서:
python scripts/check-browser.py --output /tmp/lms-pdf-check
```

## 라이선스와 이용 범위

직접 작성한 코드는 MIT 라이선스이며, 원저작자 저작권 고지와 [LICENSE](LICENSE)를 유지합니다. 이 라이선스가 강의 영상을 이용하거나 공유할 권한을 주지는 않습니다. 본인이 수강하는 강의를 개인 학습용으로만 쓰고, 학교 이용 규정과 교수자 안내를 확인해 주세요. 학교와 관계없는 비공식 도구입니다.

포함된 변환 라이브러리의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 `vendor/licenses/`에 있습니다. PPTX 렌더러는 Apache-2.0, 구형 PPT 렌더러는 MIT이며, MPL-2.0 구성 요소의 소스 위치도 함께 적어 두었습니다.
