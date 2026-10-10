import type { LoraUse } from '../lib/types';
import { Combo, NumInput } from './common';
import { useComfyOptions } from './SettingsEditor';

export function LoraListEditor({ loras, onChange }: { loras: LoraUse[]; onChange: (l: LoraUse[]) => void }) {
  const opts = useComfyOptions();
  const set = (i: number, patch: Partial<LoraUse>) => onChange(loras.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div style={{ display: 'grid', gap: 6, flex: 1 }}>
      {loras.map((l, i) => (
        <div className="row wrap" key={i}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Combo value={l.file} options={opts.loras} placeholder="로라 파일명 (예: mychar.safetensors)" onChange={(v) => set(i, { file: v })} />
          </div>
          <span className="small muted">강도</span>
          <NumInput value={l.strength} step={0.05} onChange={(n) => n != null && set(i, { strength: n })} />
          <span className="small muted" title="비우면 강도와 같음">CLIP</span>
          <NumInput value={l.clipStrength ?? null} nullable step={0.05} placeholder="같음" onChange={(n) => set(i, { clipStrength: n })} />
          <button className="btn small danger" onClick={() => onChange(loras.filter((_, j) => j !== i))}>
            빼기
          </button>
        </div>
      ))}
      <div>
        <button className="btn small" onClick={() => onChange([...loras, { file: '', strength: 1, clipStrength: null }])}>
          + 로라 추가
        </button>
      </div>
    </div>
  );
}
