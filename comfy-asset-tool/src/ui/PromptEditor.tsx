// 프롬프트 입력: 글자로 직접 쓰고, 아래 태그 칩을 눌러 (tag:1.2) 가중치를 슬라이더로 조절한다.

import { useMemo, useState } from 'react';
import { findParenPitfalls, fixParenPitfalls, removeSegment, setSegmentWeight, splitTopLevel } from '../lib/prompt';

export function PromptEditor({
  value,
  onChange,
  placeholder,
  rows = 3,
  negative,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  negative?: boolean;
}) {
  const segs = useMemo(() => splitTopLevel(value), [value]);
  const [active, setActive] = useState<number | null>(null);
  const pitfalls = useMemo(() => (negative ? [] : findParenPitfalls(value)), [value, negative]);
  const seg = active != null ? segs[active] : undefined;

  return (
    <div className="prompt-editor" style={{ flex: 1, minWidth: 0 }}>
      <textarea
        className="textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(null);
        }}
      />
      {segs.length > 0 && (
        <div className="chips" aria-label="태그 (누르면 가중치 조절)">
          {segs.map((s, i) => (
            <button
              key={`${i}-${s.raw}`}
              type="button"
              className={`chip ${s.weight > 1 ? 'weighted' : s.weight < 1 ? 'down' : ''} ${active === i ? 'active' : ''}`}
              title={`${s.raw}\n눌러서 가중치 조절`}
              onClick={() => setActive(active === i ? null : i)}
            >
              {s.inner}
              {s.weight !== 1 && <span className="w">{s.weight}</span>}
            </button>
          ))}
        </div>
      )}
      {seg && (
        <div className="weight-pop">
          <span className="mono ellipsis" style={{ maxWidth: 220 }}>
            {seg.inner}
          </span>
          <input
            type="range"
            min={0.5}
            max={1.8}
            step={0.05}
            value={seg.weight}
            onChange={(e) => onChange(setSegmentWeight(value, seg, Number(e.target.value)))}
          />
          <span className="mono">{seg.weight.toFixed(2)}</span>
          <button className="btn small" type="button" onClick={() => onChange(setSegmentWeight(value, seg, 1))}>
            1로
          </button>
          <button
            className="btn small danger"
            type="button"
            onClick={() => {
              onChange(removeSegment(value, seg));
              setActive(null);
            }}
          >
            태그 지우기
          </button>
          <span className="faint small">1보다 크면 강하게, 작으면 약하게. 보통 0.8~1.4.</span>
        </div>
      )}
      {pitfalls.length > 0 && (
        <div className="issue info">
          <span className="icon">ℹ</span>
          <span>
            괄호가 가중치로 읽힙니다: {pitfalls.map((p) => `"${p.found}"`).join(', ')}. 작품 이름이라면 \( \)로 써야 합니다.{' '}
            <button className="btn small" type="button" onClick={() => onChange(fixParenPitfalls(value))}>
              고치기
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
