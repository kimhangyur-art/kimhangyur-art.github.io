// 변형 모드(랜덤 생성 모드)의 계산 부분. 화면·저장소와 떨어진 순수 함수만 둔다 (variation.test.ts).
//
// 왼쪽 프롬프트를 기준으로, 사용자가 적은 "변수"(헤어스타일, 머리색 …)마다 후보를 바꿔 넣은 줄(변형)을 만든다.
//   - find(바꿀 글)가 있으면 프롬프트 안의 그 글을 후보로 바꾼다 (대소문자 무시, 모두, 단어 중간은 건드리지 않음)
//   - find가 비어 있거나 프롬프트에 없으면 후보를 프롬프트 끝에 붙인다
//   - 후보 '-' 또는 '없음'은 그 글을 지운다 (예: 안경을 쓴 것 / 안 쓴 것 비교)
// 방식:
//   each   하나씩 바꾸기: 변수 하나만 바꾼 줄을 후보마다 하나씩
//   all    모든 조합: 켜 둔 변수 후보의 모든 조합
//   random 무작위 N개: 모든 조합 중 서로 다른 N개
import { joinPrompt } from '@/services/comfy/prompt-syntax'

export type VariationMode = 'each' | 'all' | 'random'

export interface VariationVariable {
    id: string
    /** 화면에 보이는 이름 (예: 헤어스타일) */
    name: string
    /** 프롬프트에서 바꿀 글. 비우면 후보를 끝에 붙인다 */
    find: string
    /** 후보: 한 줄에 하나 (빈 줄은 무시) */
    options: string
    enabled: boolean
}

export interface VariantChange {
    variableId: string
    name: string
    find: string
    /** 바꿔 넣을 글. 빈 글이면 find를 지운다 */
    value: string
}

export interface Variant {
    /** 같은 변형인지 가리는 열쇠 (기준 그림은 '') */
    key: string
    isBase: boolean
    changes: VariantChange[]
}

export interface ExpandOptions {
    /** 바꾸지 않은 프롬프트를 첫 줄에 넣는다 */
    includeBase?: boolean
    /** random 방식에서 고를 조합 수 */
    randomCount?: number
    /** 0 이상 1 미만의 난수 (시험할 때 정해진 값을 넣는다) */
    rng?: () => number
    /** 주면 바꾼 결과 글이 같은 변형도 하나로 친다 */
    prompt?: string
    /** 줄 수 상한 (기본 MAX_VARIANT_ROWS) */
    maxRows?: number
}

/** 한 번에 만들 수 있는 줄(변형) 수 상한. 모든 조합이 이보다 많으면 앞에서부터 이만큼만 */
export const MAX_VARIANT_ROWS = 1000
/** 변형마다 장수 */
export const MIN_PER_VARIANT = 1
export const MAX_PER_VARIANT = 8
/** 이보다 많이 그리면 시작하기 전에 한 번 더 묻는다 */
export const CONFIRM_OVER = 100

export const BASE_LABEL = '기준'
const REMOVE_LABEL = '없음'

// ---------------------------------------------------------------------------
// 후보

/** '-' 또는 '없음' = 그 글을 지운다 */
export function isRemoveOption(value: string): boolean {
    const v = value.trim()
    return v === '-' || v === REMOVE_LABEL || v === `(${REMOVE_LABEL})`
}

/** 후보 글 → 실제로 넣을 글 (지우기 후보면 '') */
function optionValue(raw: string): string {
    return isRemoveOption(raw) ? '' : raw.trim()
}

/** 줄마다 후보 하나. 빈 줄과 (대소문자만 다른) 겹치는 후보는 뺀다 */
export function parseOptions(text: string): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const line of (text ?? '').split(/\r?\n/)) {
        const v = line.trim()
        if (!v) continue
        const k = isRemoveOption(v) ? '\u0000remove' : v.toLowerCase()
        if (seen.has(k)) continue
        seen.add(k)
        out.push(v)
    }
    return out
}

/** 그리는 데 쓰는 변수: 켜 두었고 후보가 하나 이상 */
export function activeVariables(variables: VariationVariable[]): Array<VariationVariable & { list: string[] }> {
    return variables
        .filter((v) => v.enabled)
        .map((v) => ({ ...v, list: parseOptions(v.options) }))
        .filter((v) => v.list.length > 0)
}

// ---------------------------------------------------------------------------
// 찾기·바꾸기

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

/**
 * find 글을 찾는 정규식 조각.
 * - 대소문자 무시, 띄어쓰기·밑줄은 서로 같게 (long hair = long_hair), 쉼표 앞뒤 띄어쓰기는 아무래도 좋게
 * - 글자로 시작·끝나면 단어 중간은 건드리지 않는다 (red eyes 가 tired eyes 안에서 잡히지 않게)
 */
function findSource(find: string): string | null {
    const f = find.trim()
    if (!f) return null
    const body = f
        .split(/\s*,\s*/)
        .map((part) => part.split(/[\s_]+/).map(escapeRegExp).join('[\\s_]+'))
        .join('\\s*,\\s*')
    const head = WORD_CHAR.test(f[0]) ? '(?<![\\p{L}\\p{N}_])' : ''
    const tail = WORD_CHAR.test(f[f.length - 1]) ? '(?![\\p{L}\\p{N}_])' : ''
    return `${head}${body}${tail}`
}

/** 프롬프트에 find 글이 있는지 */
export function containsFind(prompt: string, find: string): boolean {
    const src = findSource(find)
    if (!src) return false
    return new RegExp(src, 'iu').test(prompt)
}

/** 프롬프트 안에서 find 글이 있는 구간들 (미리보기에 칠할 때) */
export function findRanges(prompt: string, finds: string[]): Array<{ start: number; end: number; find: string }> {
    const out: Array<{ start: number; end: number; find: string }> = []
    for (const find of finds) {
        const src = findSource(find)
        if (!src) continue
        for (const m of prompt.matchAll(new RegExp(src, 'giu'))) {
            if (m.index === undefined || !m[0]) continue
            out.push({ start: m.index, end: m.index + m[0].length, find })
        }
    }
    out.sort((a, b) => a.start - b.start || b.end - a.end)
    // 겹치면 앞의 것만
    const merged: typeof out = []
    for (const r of out) {
        const last = merged[merged.length - 1]
        if (last && r.start < last.end) continue
        merged.push(r)
    }
    return merged
}

/** 글을 지운 자리 정리: 빈 가중치 묶음과 겹친 쉼표 */
function tidyAfterRemove(s: string): string {
    let out = s
    for (let i = 0; i < 5; i++) {
        const next = out.replace(/\(\s*:\s*-?\d*\.?\d+\s*\)/g, '').replace(/\{\s*\}|\[\s*\]/g, '')
        if (next === out) break
        out = next
    }
    for (let i = 0; i < 5; i++) {
        const next = out.replace(/,\s*,/g, ',')
        if (next === out) break
        out = next
    }
    return out
        .replace(/(^|\n)[ \t]*,[ \t]*/g, '$1')
        .replace(/^[\s,]+/, '')
        .replace(/[\s,]+$/, '')
}

/** 이 바꾸기가 아무것도 바꾸지 않는지 (find와 같은 후보, 붙일 글이 없는 지우기) */
export function isNoopChange(c: VariantChange): boolean {
    const find = c.find.trim()
    if (!find) return !c.value.trim()
    return c.value.trim().toLowerCase() === find.toLowerCase()
}

export interface ApplyResult {
    text: string
    /** 프롬프트에서 바꾼 find 글 */
    replaced: string[]
    /** find가 프롬프트에 없어 끝에 붙인 것 */
    notFound: string[]
    /** 끝에 붙인 글 */
    appended: string[]
}

/** 변형을 프롬프트에 적용한다 (바꾸기는 한 번에: 바꿔 넣은 글이 다시 바뀌지 않는다) */
export function applyVariantDetailed(prompt: string, variant: Pick<Variant, 'changes'>): ApplyResult {
    const replaced: string[] = []
    const notFound: string[] = []
    const appended: string[] = []
    const replacements: Array<{ src: string; value: string; find: string }> = []
    const seenFind = new Set<string>()
    for (const c of variant.changes) {
        const find = c.find.trim()
        const value = c.value.trim()
        if (!find) {
            if (value) appended.push(value)
            continue
        }
        const key = find.toLowerCase()
        if (seenFind.has(key)) continue
        seenFind.add(key)
        if (!containsFind(prompt, find)) {
            notFound.push(find)
            if (value) appended.push(value)
            continue
        }
        replaced.push(find)
        replacements.push({ src: findSource(find)!, value, find })
    }

    let text = prompt
    let removed = false
    if (replacements.length) {
        // 긴 find 먼저 (long hair 와 very long hair 가 같이 있으면 very long hair 가 이긴다)
        const ordered = [...replacements].sort((a, b) => b.find.length - a.find.length)
        const re = new RegExp(ordered.map((r) => `(${r.src})`).join('|'), 'giu')
        text = text.replace(re, (...args: unknown[]) => {
            const groups = args.slice(1, 1 + ordered.length)
            const i = groups.findIndex((g) => g !== undefined)
            const value = ordered[i]?.value ?? ''
            if (!value) removed = true
            return value
        })
        if (removed) text = tidyAfterRemove(text)
    }
    if (appended.length) text = joinPrompt(text, ...appended)
    return { text, replaced, notFound, appended }
}

/** 변형을 프롬프트에 적용한 글 */
export function applyVariant(prompt: string, variant: Pick<Variant, 'changes'>): string {
    return applyVariantDetailed(prompt, variant).text
}

// ---------------------------------------------------------------------------
// 변형 만들기

function changeKey(c: VariantChange): string | null {
    if (isNoopChange(c)) return null
    const find = c.find.trim().toLowerCase()
    const value = c.value.trim().toLowerCase()
    return find ? `${find}=>${value}` : `+${value}`
}

function variantKey(changes: VariantChange[]): string {
    return changes
        .map(changeKey)
        .filter((k): k is string => k !== null)
        .sort()
        .join('\u0001')
}

function makeVariant(changes: VariantChange[]): Variant {
    return { key: variantKey(changes), isBase: false, changes }
}

export function baseVariant(): Variant {
    return { key: '', isBase: true, changes: [] }
}

function changeOf(v: VariationVariable, raw: string): VariantChange {
    return { variableId: v.id, name: v.name.trim(), find: v.find.trim(), value: optionValue(raw) }
}

/** 모든 조합 수 (켜 둔 변수 후보 수의 곱) */
export function comboCount(variables: VariationVariable[]): number {
    const act = activeVariables(variables)
    if (!act.length) return 0
    return act.reduce((n, v) => n * v.list.length, 1)
}

/** 하나씩 바꾸기 방식의 줄 수 (겹침을 빼기 전) */
export function eachCount(variables: VariationVariable[]): number {
    return activeVariables(variables).reduce((n, v) => n + v.list.length, 0)
}

/** 조합 번호 → 변수마다 고른 후보 번호 (첫 변수가 가장 큰 자리) */
function decodeCombo(index: number, sizes: number[]): number[] {
    const picks = new Array<number>(sizes.length)
    let rest = index
    for (let i = sizes.length - 1; i >= 0; i--) {
        picks[i] = rest % sizes[i]
        rest = Math.floor(rest / sizes[i])
    }
    return picks
}

/**
 * 변수와 방식으로 그릴 줄(변형)들을 만든다.
 * 바꿀 것이 하나도 없으면(켜 둔 변수가 없거나 후보가 모두 그대로인 것뿐이면) 빈 배열.
 */
export function expandVariants(variables: VariationVariable[], mode: VariationMode, opts: ExpandOptions = {}): Variant[] {
    const { includeBase = true, prompt } = opts
    const maxRows = Math.max(1, Math.floor(opts.maxRows ?? MAX_VARIANT_ROWS))
    const rng = opts.rng ?? Math.random
    const act = activeVariables(variables)
    if (!act.length) return []

    const out: Variant[] = []
    const keys = new Set<string>()
    const texts = new Set<string>()
    if (includeBase) {
        out.push(baseVariant())
        keys.add('')
        if (prompt !== undefined) texts.add(prompt)
    }

    /** 처음 보는 변형이면 true (보았다고 적어 둔다) */
    const accept = (v: Variant): boolean => {
        if (keys.has(v.key)) return false
        if (prompt !== undefined) {
            const text = applyVariant(prompt, v)
            if (texts.has(text)) return false
            texts.add(text)
        }
        keys.add(v.key)
        return true
    }
    const finish = () => (out.some((v) => !v.isBase) ? out : [])

    if (mode === 'each') {
        for (const v of act) {
            for (const raw of v.list) {
                if (out.length >= maxRows) return finish()
                const c = changeOf(v, raw)
                if (isNoopChange(c)) continue
                const variant = makeVariant([c])
                if (accept(variant)) out.push(variant)
            }
        }
        return finish()
    }

    const sizes = act.map((v) => v.list.length)
    const total = sizes.reduce((a, b) => a * b, 1)
    const comboAt = (index: number) => makeVariant(decodeCombo(index, sizes).map((pick, i) => changeOf(act[i], act[i].list[pick])))
    const want = mode === 'all' ? maxRows : Math.max(1, Math.min(Math.floor(opts.randomCount ?? 10), maxRows))
    const limit = Math.min(maxRows, out.length + want)

    if (mode === 'all' || total <= want) {
        for (let i = 0; i < total && out.length < limit; i++) {
            const variant = comboAt(i)
            if (accept(variant)) out.push(variant)
        }
        return finish()
    }

    // random: 서로 다른 조합 N개. 조합 번호 순으로 늘어놓아 비교하기 쉽게 한다
    const picked = new Set<number>()
    const chosen: Array<{ index: number; variant: Variant }> = []
    const maxAttempts = want * 50 + 200
    for (let attempts = 0; chosen.length < want && attempts < maxAttempts && picked.size < total; attempts++) {
        const i = Math.min(total - 1, Math.floor(rng() * total))
        if (picked.has(i)) continue
        picked.add(i)
        const variant = comboAt(i)
        if (accept(variant)) chosen.push({ index: i, variant })
    }
    chosen.sort((x, y) => x.index - y.index).forEach((c) => out.push(c.variant))
    return finish()
}

// ---------------------------------------------------------------------------
// 이름표

function valueLabel(value: string): string {
    return value.trim() ? value.trim() : REMOVE_LABEL
}

/** 줄 이름: '기준', '헤어스타일: ponytail', 조합은 'ponytail · blonde hair' */
export function variantLabel(v: Pick<Variant, 'isBase' | 'changes'>): string {
    if (v.isBase || v.changes.length === 0) return BASE_LABEL
    if (v.changes.length === 1) {
        const c = v.changes[0]
        return c.name ? `${c.name}: ${valueLabel(c.value)}` : valueLabel(c.value)
    }
    return v.changes.map((c) => valueLabel(c.value)).join(' · ')
}

/** 자세한 줄 이름: '헤어스타일: ponytail · 머리색: blonde hair' */
export function variantFullLabel(v: Pick<Variant, 'isBase' | 'changes'>): string {
    if (v.isBase || v.changes.length === 0) return BASE_LABEL
    return v.changes.map((c) => (c.name ? `${c.name}: ${valueLabel(c.value)}` : valueLabel(c.value))).join(' · ')
}

/** 파일 이름에 넣을 짧은 이름: 'ponytail', 'ponytail_blonde hair' */
export function variantFileLabel(v: Pick<Variant, 'isBase' | 'changes'>): string {
    if (v.isBase || v.changes.length === 0) return BASE_LABEL
    return v.changes
        .map((c) => valueLabel(c.value))
        .join('_')
        .replace(/[{}[\]()\\:]/g, '')
        .slice(0, 60)
}

/** 메타데이터에 넣을 값: { 헤어스타일: 'ponytail' } */
export function variantValues(v: Pick<Variant, 'changes'>): Record<string, string> {
    const out: Record<string, string> = {}
    v.changes.forEach((c, i) => {
        out[c.name || `변수 ${i + 1}`] = valueLabel(c.value)
    })
    return out
}

// ---------------------------------------------------------------------------
// 시드·작업 계획

export function randomSeed(rng: () => number = Math.random): number {
    // 0은 ComfyUI 쪽에서 '무작위'로 보므로 1 이상
    return 1 + Math.floor(rng() * 4294967294)
}

export interface PlannedJob {
    row: number
    col: number
    seed: number
}

/**
 * 줄 × 장수 만큼 작업을 만든다.
 * sameSeed 면 시드 N개를 한 번만 뽑아 k번째 칸은 모든 줄이 k번째 시드를 쓴다 → 그림 차이는 프롬프트 차이뿐.
 */
export function planJobs(rows: number, perVariant: number, sameSeed: boolean, rng: () => number = Math.random): { seeds: number[]; jobs: PlannedJob[] } {
    const n = clampPerVariant(perVariant)
    const seeds = sameSeed ? Array.from({ length: n }, () => randomSeed(rng)) : []
    const jobs: PlannedJob[] = []
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < n; c++) jobs.push({ row: r, col: c, seed: sameSeed ? seeds[c] : randomSeed(rng) })
    }
    return { seeds, jobs }
}

export function clampPerVariant(n: number): number {
    if (!Number.isFinite(n)) return 2
    return Math.max(MIN_PER_VARIANT, Math.min(MAX_PER_VARIANT, Math.round(n)))
}

/** 기본 묶음 이름: '변형 2026-10-20 14-05' (폴더 이름에 쓰므로 : 대신 -) */
export function defaultRunName(d: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `변형 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`
}

/** 정해진 시작값으로 늘 같은 난수를 내는 함수 (무작위 N개를 미리 보여 준 그대로 그리기 위해) */
export function seededRng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ---------------------------------------------------------------------------
// 자주 쓰는 변수

export interface VariableTemplate {
    id: string
    name: string
    options: string[]
}

export const VARIABLE_TEMPLATES: VariableTemplate[] = [
    { id: 'hairstyle', name: '헤어스타일', options: ['long hair', 'short hair', 'medium hair', 'bob cut', 'ponytail', 'twintails', 'braid', 'hair bun', 'side ponytail'] },
    { id: 'hair-color', name: '머리색', options: ['black hair', 'brown hair', 'blonde hair', 'silver hair', 'white hair', 'pink hair', 'blue hair', 'red hair', 'purple hair'] },
    { id: 'eye-color', name: '눈색', options: ['red eyes', 'blue eyes', 'green eyes', 'purple eyes', 'yellow eyes', 'brown eyes', 'grey eyes'] },
    { id: 'eye-shape', name: '눈 모양', options: ['tsurime', 'tareme', 'jitome', 'half-closed eyes', 'sanpaku'] },
    { id: 'bangs', name: '앞머리', options: ['blunt bangs', 'swept bangs', 'parted bangs', 'hair over one eye', 'hair between eyes'] },
    { id: 'expression', name: '표정', options: ['smile', 'expressionless', 'smug', 'embarrassed', 'angry'] },
]

/**
 * 후보 중 이미 프롬프트에 있는 것을 찾아 '바꿀 글'로 쓴다 (긴 후보 먼저).
 * 예) 프롬프트에 'long hair'가 있으면 헤어스타일 변수의 바꿀 글은 'long hair'.
 */
export function detectFind(prompt: string, options: string[]): string {
    const sorted = [...options].filter((o) => !isRemoveOption(o)).sort((a, b) => b.length - a.length)
    for (const o of sorted) {
        if (containsFind(prompt, o)) return o.trim()
    }
    return ''
}

/** 켜 둔 변수 중 바꿀 글을 프롬프트에서 못 찾은 것 */
export function missingFinds(prompt: string, variables: VariationVariable[]): VariationVariable[] {
    return activeVariables(variables).filter((v) => v.find.trim() && !containsFind(prompt, v.find))
}

// ---------------------------------------------------------------------------
// '이 조합을 프롬프트에 적용'

export interface PromptFields {
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
}

export const FIELD_LABELS: Record<keyof PromptFields, string> = {
    basePrompt: '기본 프롬프트',
    additionalPrompt: '추가 프롬프트',
    detailPrompt: '세부 프롬프트',
}

/** 끝에 덧붙이기 (줄바꿈은 그대로 두고 쉼표로 잇는다) */
function appendTag(text: string, tag: string): string {
    const t = text.replace(/[\s,]+$/, '')
    return t ? `${t}, ${tag}` : tag
}

/**
 * 변형의 바꾸기를 왼쪽 프롬프트 칸들에 그대로 옮긴다.
 * find 글은 그 글이 있는 칸(기본·추가·세부)에서 바꾸고, 붙이기 변수와 어느 칸에도 없는 find는 세부 프롬프트 끝에 붙인다.
 */
export function applyVariantToFields(fields: PromptFields, variant: Pick<Variant, 'changes'>): { fields: PromptFields; notes: string[] } {
    const next: PromptFields = { ...fields }
    const notes: string[] = []
    const order: Array<keyof PromptFields> = ['basePrompt', 'additionalPrompt', 'detailPrompt']
    for (const c of variant.changes) {
        if (isNoopChange(c)) continue
        const find = c.find.trim()
        const value = c.value.trim()
        if (find) {
            const hit = order.filter((k) => containsFind(next[k], find))
            if (hit.length) {
                for (const k of hit) next[k] = applyVariant(next[k], { changes: [c] })
                notes.push(`${hit.map((k) => FIELD_LABELS[k]).join('·')}: ${find} → ${valueLabel(value)}`)
                continue
            }
        }
        if (!value) continue
        next.detailPrompt = appendTag(next.detailPrompt, value)
        notes.push(find ? `${FIELD_LABELS.detailPrompt} 끝에 ${value} 추가 ("${find}"는 칸에 없었습니다)` : `${FIELD_LABELS.detailPrompt} 끝에 ${value} 추가`)
    }
    return { fields: next, notes }
}
