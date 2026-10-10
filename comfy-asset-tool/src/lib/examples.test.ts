import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeProject } from './model';
import { planGeneration } from './plan';
import { buildWorkflow } from './workflow/generate';
import { validateWorkflow } from './workflow/validate';

// examples/ 의 작업 파일이 지금 버전에서도 열리고, 막힘 없이 올바른 워크플로우가 나오는지
const dir = new URL('../../examples/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('_초안'));

describe('예시 작업 파일', () => {
  it.each(files)('%s', (file) => {
    const p = normalizeProject(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
    const lib = { sets: [], myPresets: [] };
    const plan = planGeneration(p, lib, { mode: 'draft' });
    expect(plan.blocked).toBe(false);
    expect(plan.targets.length).toBe(p.rows.length);
    expect(plan.rows.flatMap((r) => r.issues).filter((i) => i.level !== 'info')).toEqual([]);
    const { workflow } = buildWorkflow(p, lib, plan);
    expect(validateWorkflow(workflow, { checkOverlap: true })).toEqual([]);
  });
});
