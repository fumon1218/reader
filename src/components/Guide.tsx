import Icon from './Icon';
import { Sheet } from './ui';

export function GuideSteps() {
  return (
    <ol className="guide-steps">
      <li>
        <b>AI 키 넣기 (무료)</b>
        <span>
          <b>aistudio.google.com</b>에 구글 계정으로 들어가 “Get API key → Create API key”로 키를 만들고, 앱의 <b>설정 → AI 연결</b>에 붙여넣어요. 그다음 “연결 테스트”를 눌러 확인해요. 이 키는 내 것이니 다른 사람에게 알려주지 마세요.
        </span>
      </li>
      <li>
        <b>책 넣기</b>
        <span>서재의 “책 추가”에서 EPUB·TXT 파일을 올리거나 글을 붙여넣어요. 처음이라면 맛보기 책으로 먼저 써 보세요.</span>
      </li>
      <li>
        <b>읽으며 단어 찾기</b>
        <span>모르는 단어를 탭하면 문장 속 뜻이 떠요. 저장하면 단어장과 복습으로 이어져요.</span>
      </li>
      <li>
        <b>홈 화면에 추가</b>
        <span>아이폰·아이패드는 Safari에서 공유 버튼 → “홈 화면에 추가”, PC 크롬은 주소창 오른쪽의 설치 버튼이에요.</span>
      </li>
      <li>
        <b>내 데이터는 내 기기에만</b>
        <span>책, 단어장, API 키는 이 기기 안에만 저장돼요. 다른 기기로 옮기거나 안전하게 보관하려면 <b>설정 → 백업 파일 내보내기</b>를 쓰세요.</span>
      </li>
    </ol>
  );
}

const SEEN = 'wts_guide_seen';

export function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return true;
  }
}
export function markGuideSeen() {
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    /* ignore */
  }
}

export default function GuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={() => {
        markGuideSeen();
        onClose();
      }}
      title="시작하기 전에"
    >
      <div className="stack">
        <p className="muted small">외국어 원서를 읽다가 모르는 단어를 탭해 바로 뜻을 찾고, 단어장과 복습까지 이어 가는 앱이에요.</p>
        <GuideSteps />
        <button
          className="btn primary block"
          onClick={() => {
            markGuideSeen();
            onClose();
          }}
        >
          <Icon name="check" size={18} /> 알겠어요
        </button>
      </div>
    </Sheet>
  );
}
