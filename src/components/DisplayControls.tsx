import { useSettings, type ThemeSetting } from '../settings';
import { Segmented, Toggle } from './ui';

export default function DisplayControls() {
  const [s, set] = useSettings();
  return (
    <div className="stack">
      <div>
        <div className="label">테마</div>
        <Segmented<ThemeSetting>
          value={s.theme}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'auto', label: '자동' },
            { value: 'paper', label: '종이' },
            { value: 'sepia', label: '세피아' },
            { value: 'dark', label: '다크' },
          ]}
        />
      </div>
      <div>
        <div className="label">글꼴</div>
        <Segmented<'serif' | 'sans'>
          value={s.fontFamily}
          onChange={(v) => set({ fontFamily: v })}
          options={[
            { value: 'serif', label: '명조(세리프)' },
            { value: 'sans', label: '고딕(산세리프)' },
          ]}
        />
      </div>
      <div>
        <div className="label">
          글자 크기 <b>{s.fontSize}px</b>
        </div>
        <input className="range" type="range" min={15} max={32} step={1} value={s.fontSize} onChange={(e) => set({ fontSize: +e.target.value })} />
      </div>
      <div>
        <div className="label">
          줄 간격 <b>{s.lineHeight.toFixed(2)}</b>
        </div>
        <input className="range" type="range" min={1.4} max={2.5} step={0.05} value={s.lineHeight} onChange={(e) => set({ lineHeight: +e.target.value })} />
      </div>
      <p
        className={`preview reader-font-${s.fontFamily}`}
        style={{ fontSize: s.fontSize, lineHeight: s.lineHeight }}
        lang="en"
      >
        Alice was beginning to get very tired of sitting by her sister on the bank.
      </p>
      <Toggle checked={s.pageTurn} onChange={(v) => set({ pageTurn: v })} label="화면 가장자리로 넘기기" hint="왼쪽·오른쪽 가장자리를 탭하면 한 화면씩 넘어가요. PC에서는 방향키·스페이스도 돼요" />
      <Toggle checked={s.keepAwake} onChange={(v) => set({ keepAwake: v })} label="읽는 동안 화면 켜 두기" hint="책을 읽는 중에는 화면이 저절로 꺼지지 않아요(지원하는 기기에서만)" />
      <Toggle checked={s.markWords} onChange={(v) => set({ markWords: v })} label="저장한 단어 표시" hint="단어장에서 학습 중인 단어를 본문에서 형광펜으로 보여줘요" />
      <Toggle checked={s.showRuby} onChange={(v) => set({ showRuby: v })} label="저장한 일본어 단어에 후리가나" hint="단어장에 있는 한자 단어 위에 읽는 법을 보여줘요" />
      <Toggle checked={s.showKoreanReading} onChange={(v) => set({ showKoreanReading: v })} label="단어 카드에 한글 발음" hint="탭했을 때 한글 발음 표기를 함께 보여줘요" />
    </div>
  );
}
