# 이야기로 만나는 외국어 — 외국어 원서 리딩 앱

영어·일본어·스페인어 책(EPUB/TXT)을 읽다가 **모르는 단어를 탭**하면 문장 속 뜻이 뜨고,
저장한 단어는 **단어장 → 간격 반복 복습**으로 이어지는 개인용 독서 앱입니다. 아이폰·아이패드에서 홈 화면에 추가해 앱처럼 씁니다.

## 기능
- **서재**: EPUB·TXT 가져오기, 붙여넣기, 맛보기 책, 읽는 중/읽고 싶은/완독, 평점·메모, 이어 읽기, 표지
- **리더**: 탭해서 찾기(하단 시트), 앞·뒤 단어를 포함해 구절 조회, 문장 번역(+문법 포인트), 문단 번역, 문장 하이라이트·메모, TTS, 목차, 읽던 위치 저장, 테마(종이/세피아/다크)·글꼴·크기
- **단어장**: 책별·언어별·상태별 필터, 검색, 편집, CSV 가져오기/내보내기, Anki용 내보내기, 본문 위치로 이동
- **복습**: SM-2 단순화 간격 반복, 뜻 떠올리기/빈칸 채우기 두 가지 카드
- **기록**: 오늘/7일/14일 독서 시간, 연속 독서일, 목표, 책별 순위
- **데이터**: 전부 이 기기(IndexedDB)에 저장, JSON 백업·복원

## 실행
```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # dist/ 를 GitHub Pages·Vercel 등 정적 호스팅에 올리면 됩니다
npm test         # 핵심 로직 단위 테스트
```

## Gemini API 키
키는 **코드에 넣지 않습니다.** 앱의 `설정 → AI 연결`에 입력하면 그 기기의 localStorage에만 저장되고 Google API로만 전송됩니다.
(이전 버전처럼 `vite.config.ts`의 `define`으로 번들에 넣지 않았습니다.) 기기마다 한 번씩 입력하세요.
키는 aistudio.google.com 에서 발급합니다. 기본 모델은 `gemini-2.5-flash`이며 설정에서 바꿀 수 있습니다.

## 아이폰·아이패드에 설치
Safari로 배포 주소 열기 → 공유 → **홈 화면에 추가**. 기기 간 이동은 `설정 → 백업 파일 내보내기/복원`.

## 배포용(공유용) 판
`npm run build`는 두 가지를 함께 만듭니다.
- 기본 판(`/`): 내 기기끼리 동기화(Firebase 로그인)
- 배포용 판(`/share/`): 동기화·로그인 없음. 책·단어장·API 키가 각자 기기에만 저장되고, 첫 실행 때 사용 안내가 나옵니다. 저장 공간 이름이 달라서 내 앱 데이터와 섞이지 않습니다.
(`vite build --mode share`, `src/lib/edition.ts` 참고)

## 구조
```
src/
  db.ts            IndexedDB 래퍼 + useLive 훅 (외부 라이브러리 없음)
  settings.ts      설정(localStorage)
  lib/             tokenize, importers(TXT/EPUB), srs, cloze, csv, gemini, tts, stats, vocab, backup …
  components/      WordSheet(탭 시 하단 시트), ImportDialog, BookSheet, ui …
  pages/           Library, Reader, Vocab, Review, Stats, Settings
tests/logic.test.ts
```
의존성은 react, react-dom, jszip 세 개뿐입니다.
