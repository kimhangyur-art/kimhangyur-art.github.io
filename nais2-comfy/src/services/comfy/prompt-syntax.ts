// NAI 프롬프트 문법 → ComfyUI 문법
//
// NAI:     {태그} = 1.05배, {{태그}} = 1.05²배, [태그] = 1/1.05배, 1.3::태그:: = 1.3배, 괄호 ( ) 는 글자 그대로
// ComfyUI: (태그:1.1) 가 가중치, 괄호는 가중치 문법이라 글자 괄호는 \( \) 로 써야 한다
//
// 이미 ComfyUI 식으로 쓴 (태그:1.2) 는 그대로 둔다. 그래서 두 문법을 섞어 써도 된다.
// 예) "{{blue eyes}}, hatsune miku (vocaloid), (smile:1.2)"
//   → "(blue eyes:1.1), hatsune miku \(vocaloid\), (smile:1.2)"

const STEP = 1.05

interface Segment {
    text: string
    weight: number
}

function fmt(w: number): string {
    const r = Math.round(w * 100) / 100
    return Number.isInteger(r) ? r.toFixed(1) : String(r)
}

/** ( 다음부터 짝이 맞는 ) 까지의 위치. 없으면 -1 */
function matchParen(s: string, open: number): number {
    let depth = 0
    for (let i = open; i < s.length; i++) {
        const c = s[i]
        if (c === '\\') {
            i++
            continue
        }
        if (c === '(') depth++
        else if (c === ')') {
            depth--
            if (depth === 0) return i
        }
    }
    return -1
}

const COMFY_WEIGHT = /:\s*-?\d*\.?\d+\s*$/

/** 숫자::내용:: 가중치 구간 시작인지 (반환: [가중치, 내용 시작 위치]) */
function numericWeightAt(s: string, i: number): [number, number] | null {
    const m = /^(-?\d*\.?\d+)::/.exec(s.slice(i))
    if (!m) return null
    // 앞 글자가 숫자·글자면 태그 일부(예: "x2::")일 수 있으니 구분자 뒤에서만 인정한다
    const prev = i > 0 ? s[i - 1] : ''
    if (prev && !/[\s,{}[\]()|]/.test(prev)) return null
    return [parseFloat(m[1]), i + m[0].length]
}

export function naiToComfy(input: string): string {
    if (!input) return input
    if (!/[{}[\]()]|::/.test(input)) return input
    const segments: Segment[] = []
    const stack: number[] = []
    let numericDepth = 0
    let buf = ''
    const weight = () => stack.reduce((a, b) => a * b, 1)
    const flush = () => {
        if (buf) segments.push({ text: buf, weight: weight() })
        buf = ''
    }
    for (let i = 0; i < input.length; i++) {
        const c = input[i]
        if (c === '\\' && i + 1 < input.length) {
            buf += c + input[i + 1]
            i++
            continue
        }
        if (c === '(') {
            const close = matchParen(input, i)
            if (close > 0 && COMFY_WEIGHT.test(input.slice(i + 1, close))) {
                // 이미 ComfyUI 가중치 문법 → 바깥 NAI 가중치만 곱해서 그대로 둔다
                flush()
                const inner = input.slice(i + 1, close)
                const m = /^([\s\S]*?):\s*(-?\d*\.?\d+)\s*$/.exec(inner)!
                segments.push({ text: `(${m[1]}:${fmt(parseFloat(m[2]) * weight())})`, weight: 1 })
                i = close
                continue
            }
            buf += '\\('
            continue
        }
        if (c === ')') {
            buf += '\\)'
            continue
        }
        if (c === '{' || c === '[') {
            flush()
            stack.push(c === '{' ? STEP : 1 / STEP)
            continue
        }
        if (c === '}' || c === ']') {
            flush()
            // 짝 없는 닫는 괄호는 버린다 (NAI도 무시한다)
            const top = stack[stack.length - 1]
            if (top !== undefined && ((c === '}' && top === STEP) || (c === ']' && top === 1 / STEP))) stack.pop()
            continue
        }
        if (c === ':' && input[i + 1] === ':') {
            if (numericDepth > 0) {
                flush()
                stack.pop()
                numericDepth--
                i++
                continue
            }
        }
        const nw = c === '-' || c === '.' || /\d/.test(c) ? numericWeightAt(input, i) : null
        if (nw) {
            flush()
            stack.push(nw[0])
            numericDepth++
            i = nw[1] - 1
            continue
        }
        buf += c
    }
    flush()

    let out = ''
    for (const seg of segments) {
        if (Math.abs(seg.weight - 1) < 1e-6) {
            out += seg.text
            continue
        }
        const m = /^([\s,]*)([\s\S]*?)([\s,]*)$/.exec(seg.text)!
        const [, lead, body, trail] = m
        if (!body) {
            out += seg.text
            continue
        }
        out += `${lead}(${body}:${fmt(seg.weight)})${trail}`
    }
    return out
}

/** 쉼표로 이어 붙이되 빈 조각과 앞뒤 쉼표를 정리한다 */
export function joinPrompt(...parts: Array<string | undefined | null>): string {
    return parts
        .map((p) => (p ?? '').trim().replace(/^,+|,+$/g, '').trim())
        .filter(Boolean)
        .join(', ')
}

/** # 으로 시작하는 줄(주석)을 지운다 */
export function removeComments(text: string): string {
    return text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n')
}

/** 줄바꿈을 쉼표로 (ComfyUI는 줄바꿈을 구분자로 쓰지 않는다) */
export function flattenLines(text: string): string {
    return text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(', ')
        .replace(/,\s*,+/g, ',')
}
