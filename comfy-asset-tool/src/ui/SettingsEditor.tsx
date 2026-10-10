// 설정 묶음 편집기. 단계(전역/그룹/장면)마다 [권장]/[커스텀] (그룹·장면은 [상위 설정]/[덮어쓰기])를 고른다.
// 권장/상위 모드에서는 쓰이는 값을 회색으로 보여 주고, 커스텀에서는 옵션마다 설명과 "되돌리기" 버튼이 있다.

import { useMemo, useState } from 'react';
import {
  DEFAULT_SAMPLERS,
  DEFAULT_SCHEDULERS,
  LATENT_UPSCALE_METHODS,
  PIXEL_UPSCALE_METHODS,
  aspectOf,
} from '../lib/presets';
import { normalizeOrder } from '../lib/compose';
import { isOverridden, layerActive, resolveSettings, settingsIssues, typicalRange, type Resolved } from '../lib/settings';
import {
  BUNDLES,
  HIRES_METHOD_LABELS,
  PROMPT_PART_LABELS,
  SEED_CONTROL_LABELS,
  type BundleDef,
  type FieldDef,
} from '../lib/settingsSchema';
import type { BundleKey, PromptPart, Scene, SceneGroup, SettingsLayer, SettingsLevel } from '../lib/types';
import { resetBundle, resetSettingValue, setBundleMode, setSettingValue, type LayerTarget } from '../store/actions';
import { useStore } from '../store/store';
import { Combo, NumInput, OriginBadge, Seg, TextArea, TextInput } from './common';

export function useComfyOptions() {
  const comfy = useStore((s) => s.comfy);
  return useMemo(
    () => ({
      checkpoints: comfy?.checkpoints ?? [],
      loras: comfy?.loras ?? [],
      samplers: comfy?.samplers?.length ? comfy.samplers : DEFAULT_SAMPLERS,
      schedulers: comfy?.schedulers?.length ? comfy.schedulers : DEFAULT_SCHEDULERS,
      upscaleModels: comfy?.upscaleModels ?? [],
    }),
    [comfy],
  );
}

const PARENT: Record<SettingsLevel, 'preset' | SettingsLevel> = { global: 'preset', group: 'global', scene: 'group' };
const ASPECT_LABEL = { square: '정사각', portrait: '세로', landscape: '가로' };

export function SettingsEditor({
  target,
  layer,
  group,
  scene,
  only,
  collapseInherited,
}: {
  target: LayerTarget;
  layer: SettingsLayer;
  group?: SceneGroup | null;
  scene?: Scene | null;
  only?: BundleKey[];
  collapseInherited?: boolean;
}) {
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.library);
  const level = target.level;
  const ctx = { project, library, group, scene };
  const here = resolveSettings(ctx, level);
  const parent = resolveSettings(ctx, PARENT[level]);
  const issues = settingsIssues(here, { group });
  const bundles = BUNDLES.filter((b) => b.levels.includes(level) && (!only || only.includes(b.key)));
  return (
    <div>
      {bundles.map((b) => (
        <BundleBox
          key={b.key}
          def={b}
          target={target}
          layer={layer}
          here={here}
          parent={parent}
          issues={issues.filter((i) => i.bundle === b.key)}
          collapseInherited={collapseInherited}
        />
      ))}
    </div>
  );
}

function BundleBox({
  def,
  target,
  layer,
  here,
  parent,
  issues,
  collapseInherited,
}: {
  def: BundleDef;
  target: LayerTarget;
  layer: SettingsLayer;
  here: Resolved;
  parent: Resolved;
  issues: ReturnType<typeof settingsIssues>;
  collapseInherited?: boolean;
}) {
  const level = target.level;
  const custom = layerActive(layer, def.key);
  const [open, setOpen] = useState(false);
  const collapsed = collapseInherited && !custom && !open;
  const fields = def.fields.filter((f) => !f.levels || f.levels.includes(level));
  const hasValues = Object.keys((layer.values[def.key] as object) ?? {}).length > 0;
  const recommendLabel = level === 'global' ? '권장' : '상위 설정';
  const customLabel = level === 'global' ? '커스텀' : '덮어쓰기';
  return (
    <div className={`bundle ${collapsed ? 'collapsed' : ''}`}>
      <div className="bundle-head">
        <h4>{def.label}</h4>
        {!def.noPreset && (
          <Seg
            value={custom ? 'custom' : 'inherit'}
            options={[
              { value: 'inherit', label: recommendLabel, title: level === 'global' ? '프리셋 값을 그대로 씁니다' : '위 단계의 값을 그대로 씁니다' },
              { value: 'custom', label: customLabel, title: '이 단계에서 값을 직접 고칩니다' },
            ]}
            onChange={(m) => {
              setBundleMode(target, def.key, m);
              if (m === 'custom') setOpen(true);
            }}
          />
        )}
        <span className="desc">{def.help}</span>
        <span className="right row">
          {issues.some((i) => i.level !== 'info') && <span className="badge warn">경고 {issues.filter((i) => i.level !== 'info').length}</span>}
          {custom && hasValues && !def.noPreset && (
            <button className="btn small ghost" onClick={() => resetBundle(target, def.key)}>
              모두 되돌리기
            </button>
          )}
          {collapseInherited && !custom && (
            <button className="btn small ghost" onClick={() => setOpen(!open)}>
              {open ? '접기' : '쓰이는 값 보기'}
            </button>
          )}
        </span>
      </div>
      {!collapsed && (
        <div className="bundle-body">
          {fields.map((f) => (
            <FieldRow
              key={f.key}
              def={f}
              target={target}
              editable={custom}
              layer={layer}
              here={here}
              parent={parent}
              issues={issues.filter((i) => i.field === f.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  def,
  target,
  editable,
  layer,
  here,
  parent,
  issues,
}: {
  def: FieldDef;
  target: LayerTarget;
  editable: boolean;
  layer: SettingsLayer;
  here: Resolved;
  parent: Resolved;
  issues: ReturnType<typeof settingsIssues>;
}) {
  const opts = useComfyOptions();
  const b = def.bundle;
  const values = here.values[b] as unknown as Record<string, unknown>;
  const parentValues = parent.values[b] as unknown as Record<string, unknown>;
  const originKey = def.key === 'resolution' ? 'width' : def.key;
  const origin = here.origins[b][originKey];
  const note = here.notes[`${b}.${def.key}`];
  const overridden = editable && isOverridden(layer, b, def.key);
  const cls = overridden ? '' : 'inherited';
  const disabled = !editable;
  const set = (v: Record<string, unknown>) => setSettingValue(target, b, v);
  const reset = () => resetSettingValue(target, b, def.key === 'resolution' ? ['width', 'height'] : [def.key]);
  const range = typicalRange(here.preset, b, def.key);
  const v = values[def.key];

  let control: React.ReactNode;
  switch (def.type) {
    case 'int':
    case 'float':
      control = (
        <NumInput
          className={cls}
          value={v as number | null}
          step={def.step}
          min={def.min}
          max={def.max}
          nullable={def.nullable}
          placeholder={def.nullable ? `기본 단계와 같음` : undefined}
          onChange={(n) => (disabled ? undefined : set({ [def.key]: n }))}
        />
      );
      if (disabled) control = <input className={`input num ${cls}`} disabled value={v == null ? '(기본 단계와 같음)' : String(v)} />;
      break;
    case 'bool':
      control = (
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={!!v} disabled={disabled} onChange={(e) => set({ [def.key]: e.target.checked })} />
          <span className={cls}>{v ? '켬' : '끔'}</span>
        </label>
      );
      break;
    case 'text':
      control = <TextInput className={cls} mono value={String(v ?? '')} disabled={disabled} onChange={(t) => set({ [def.key]: t })} />;
      break;
    case 'textarea':
      control = disabled ? (
        <div className={`prompt-out ${cls}`} style={{ flex: 1 }}>
          {String(v ?? '') || '(비어 있음)'}
        </div>
      ) : (
        <TextArea className={cls} value={String(v ?? '')} rows={2} onChange={(t) => set({ [def.key]: t })} />
      );
      break;
    case 'select': {
      const list =
        def.options === 'hiresMethods'
          ? Object.entries(HIRES_METHOD_LABELS)
          : def.options === 'seedControls'
            ? Object.entries(SEED_CONTROL_LABELS)
            : (def.options === 'latentMethods' ? LATENT_UPSCALE_METHODS : PIXEL_UPSCALE_METHODS).map((x) => [x, x]);
      control = (
        <select className={`select ${cls}`} value={String(v)} disabled={disabled} onChange={(e) => set({ [def.key]: e.target.value })}>
          {list.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      );
      break;
    }
    case 'combo': {
      const list =
        def.options === 'samplers' || def.options === 'samplersOrSame'
          ? opts.samplers
          : def.options === 'schedulers' || def.options === 'schedulersOrSame'
            ? opts.schedulers
            : opts.upscaleModels;
      control = disabled ? (
        <input className={`input mono ${cls}`} disabled value={String(v ?? '') || (def.nullable ? '(기본 단계와 같음)' : '')} />
      ) : (
        <Combo
          className={cls}
          value={String(v ?? '')}
          options={list}
          placeholder={def.nullable ? '비우면 기본 단계와 같음' : '목록에서 고르거나 입력'}
          onChange={(t) => set({ [def.key]: t })}
        />
      );
      break;
    }
    case 'resolution': {
      const w = values.width as number;
      const h = values.height as number;
      const known = here.preset.resolutions.some(([a, c]) => a === w && c === h);
      control = (
        <>
          <select
            className={`select ${cls}`}
            style={{ maxWidth: 230 }}
            disabled={disabled}
            value={known ? `${w}x${h}` : 'custom'}
            onChange={(e) => {
              if (e.target.value === 'custom') return;
              const [a, c] = e.target.value.split('x').map(Number);
              set({ width: a, height: c });
            }}
          >
            {here.preset.resolutions.map(([a, c]) => (
              <option key={`${a}x${c}`} value={`${a}x${c}`}>
                {a}×{c} ({ASPECT_LABEL[aspectOf(a, c)]})
              </option>
            ))}
            <option value="custom">직접 입력…</option>
          </select>
          {!disabled && (
            <>
              <NumInput className={cls} value={w} step={8} min={64} onChange={(n) => n != null && set({ width: n, height: h })} title="가로" />
              ×
              <NumInput className={cls} value={h} step={8} min={64} onChange={(n) => n != null && set({ width: w, height: n })} title="세로" />
            </>
          )}
        </>
      );
      break;
    }
    case 'order': {
      const order = normalizeOrder(v as PromptPart[]);
      control = (
        <div className="order-list" style={{ flex: 1 }}>
          {order.map((k, i) => (
            <div className="order-item" key={k}>
              <span className="n">{i + 1}</span>
              <span className={cls}>{PROMPT_PART_LABELS[k]}</span>
              {!disabled && (
                <span className="right row" style={{ gap: 2 }}>
                  <button
                    className="btn small ghost"
                    disabled={i === 0}
                    onClick={() => {
                      const o = [...order];
                      [o[i - 1], o[i]] = [o[i], o[i - 1]];
                      set({ order: o });
                    }}
                  >
                    ▲
                  </button>
                  <button
                    className="btn small ghost"
                    disabled={i === order.length - 1}
                    onClick={() => {
                      const o = [...order];
                      [o[i + 1], o[i]] = [o[i], o[i + 1]];
                      set({ order: o });
                    }}
                  >
                    ▼
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      );
      break;
    }
  }

  const parentValue = def.key === 'resolution' ? `${parentValues.width}×${parentValues.height}` : fmtValue(parentValues[def.key]);
  return (
    <div className="field">
      <label>
        {def.label}
        <div style={{ marginTop: 4 }}>
          <OriginBadge origin={origin} note={note} />
        </div>
      </label>
      <div>
        <div className="control">
          {control}
          {overridden && (
            <button className="btn small ghost" onClick={reset} title={`되돌리면 ${parentValue}`}>
              {target.level === 'global' ? '권장값으로 되돌리기' : '상위값으로 되돌리기'}
            </button>
          )}
        </div>
        {issues.map((i, n) => (
          <div key={n} className={i.level === 'error' ? 'inline-err' : i.level === 'warn' ? 'inline-warn' : 'faint small'}>
            {i.level === 'info' ? 'ℹ' : '⚠'} {i.message}
          </div>
        ))}
        <div className="help">
          {def.help}
          {range && (def.type === 'int' || def.type === 'float') && b === 'generation' && here.preset.ranges?.[def.key] && (
            <> 이 계열({here.preset.label})의 보통 범위: {range[0]}~{range[1]}.</>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (v == null || v === '') return '(기본 단계와 같음)';
  if (Array.isArray(v)) return v.join(' → ');
  if (typeof v === 'boolean') return v ? '켬' : '끔';
  return String(v);
}
