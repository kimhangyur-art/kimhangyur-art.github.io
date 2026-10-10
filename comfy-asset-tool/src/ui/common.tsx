import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ORIGIN_LABELS } from '../lib/settingsSchema';
import type { Issue, Origin } from '../lib/types';

export function Seg<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <span className="seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} title={o.title} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className = '',
  mono,
  disabled,
  title,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  disabled?: boolean;
  title?: string;
  onBlur?: () => void;
}) {
  return (
    <input
      className={`input ${mono ? 'mono' : ''} ${className}`}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return <textarea className={`textarea ${className}`} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** 숫자 입력: 입력 중에는 글자 그대로 두고, 숫자로 읽히면 바로 반영한다 */
export function NumInput({
  value,
  onChange,
  step,
  min,
  max,
  nullable,
  placeholder,
  className = '',
  title,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  nullable?: boolean;
  placeholder?: string;
  className?: string;
  title?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value));
  }, [value]);
  return (
    <input
      className={`input num ${className}`}
      type="number"
      step={step ?? 'any'}
      min={min}
      max={max}
      value={text}
      title={title}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(value == null ? '' : String(value));
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === '') {
          if (nullable) onChange(null);
          return;
        }
        const n = Number(t);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

/** 목록에서 고르거나 직접 입력 (datalist) */
export function Combo({
  value,
  onChange,
  options,
  placeholder,
  className = '',
  mono = true,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <>
      <input
        className={`input ${mono ? 'mono' : ''} ${className}`}
        list={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

export function Check({
  checked,
  indeterminate,
  onChange,
  label,
  title,
  disabled,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const box = (
    <input ref={ref} type="checkbox" checked={checked} disabled={disabled} title={title} onChange={(e) => onChange(e.target.checked)} />
  );
  if (!label) return box;
  return (
    <label className="row" style={{ gap: 6, cursor: 'pointer' }} title={title}>
      {box}
      <span>{label}</span>
    </label>
  );
}

export function Field({ label, help, children, extra }: { label: ReactNode; help?: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div>
        <div className="control">{children}</div>
        {extra}
        {help && <div className="help">{help}</div>}
      </div>
    </div>
  );
}

const ICON: Record<string, string> = { error: '⛔', warn: '⚠', info: 'ℹ' };

export function IssueList({ issues, limit }: { issues: Issue[]; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!issues.length) return null;
  const shown = limit && !all ? issues.slice(0, limit) : issues;
  return (
    <ul className="issues">
      {shown.map((i, n) => (
        <li key={n} className={`issue ${i.level}`}>
          <span className="icon">{ICON[i.level]}</span>
          <span>{i.message}</span>
        </li>
      ))}
      {limit && issues.length > limit && !all && (
        <li>
          <button className="btn small ghost" onClick={() => setAll(true)}>
            {issues.length - limit}개 더 보기
          </button>
        </li>
      )}
    </ul>
  );
}

export function OriginBadge({ origin, note }: { origin: Origin; note?: string }) {
  return (
    <span className={`badge origin-${origin}`} title={note ?? `이 값은 ${ORIGIN_LABELS[origin]} 단계에서 왔습니다`}>
      {ORIGIN_LABELS[origin]}
      {note ? ` · ${note}` : ''}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(1000px, 100%)' } : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost right" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function StatusBadge({ status, seeded }: { status: 'pending' | 'confirmed' | 'done'; seeded?: boolean }) {
  const label = status === 'pending' ? (seeded ? '미정 · 시드 고정' : '미정') : status === 'confirmed' ? '확정' : '완성';
  return <span className={`badge st-${status}`}>{label}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#888888'} onChange={(e) => onChange(e.target.value)} />;
}
