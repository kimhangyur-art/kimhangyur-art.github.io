// PNG 글 조각(tEXt) 읽기·넣기
//
// ComfyUI가 만든 PNG에는 'prompt'(API 작업)와 'workflow' 조각이 들어 있다.
// NAIS2 Comfy는 여기에 'Comment'(NAI 형식 JSON), 'Source', 'nais2-params' 를 더 넣는다.

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]

const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        t[n] = c >>> 0
    }
    return t
})()

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

export function isPng(bytes: Uint8Array): boolean {
    if (bytes.length < 8) return false
    for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false
    return true
}

/** keyword\0value 형식의 tEXt 조각 (값은 ASCII로 넘겨야 안전하다) */
export function textChunk(keyword: string, value: string): Uint8Array {
    const enc = new TextEncoder()
    const k = enc.encode(keyword)
    const v = enc.encode(value)
    const data = new Uint8Array(k.length + 1 + v.length)
    data.set(k, 0)
    data[k.length] = 0
    data.set(v, k.length + 1)
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set([0x74, 0x45, 0x58, 0x74], 4)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
}

interface RawChunk {
    type: string
    start: number
    end: number
    data: Uint8Array
}

function chunks(bytes: Uint8Array): RawChunk[] {
    const out: RawChunk[] = []
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let off = 8
    while (off + 12 <= bytes.length) {
        const len = dv.getUint32(off)
        const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
        const end = off + 12 + len
        if (end > bytes.length) break
        out.push({ type, start: off, end, data: bytes.subarray(off + 8, off + 8 + len) })
        off = end
        if (type === 'IEND') break
    }
    return out
}

function keywordOf(c: RawChunk): string | null {
    if (c.type !== 'tEXt' && c.type !== 'iTXt' && c.type !== 'zTXt') return null
    const i = c.data.indexOf(0)
    return i < 0 ? null : new TextDecoder('latin1').decode(c.data.subarray(0, i))
}

/** 같은 이름 조각은 바꾸고, 새 조각은 IHDR 바로 뒤에 넣는다 */
export function embedTextChunks(bytes: Uint8Array, entries: Array<[string, string]>): Uint8Array {
    if (!isPng(bytes)) return bytes
    const replace = new Set(entries.map(([k]) => k))
    const list = chunks(bytes)
    const ihdr = list.find((c) => c.type === 'IHDR')
    if (!ihdr) return bytes
    const parts: Uint8Array[] = [bytes.subarray(0, 8), bytes.subarray(ihdr.start, ihdr.end)]
    for (const [k, v] of entries) parts.push(textChunk(k, v))
    for (const c of list) {
        if (c === ihdr) continue
        const kw = keywordOf(c)
        if (kw && replace.has(kw)) continue
        parts.push(bytes.subarray(c.start, c.end))
    }
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let o = 0
    for (const p of parts) {
        out.set(p, o)
        o += p.length
    }
    return out
}

/** tEXt / iTXt(압축 안 된 것) 조각을 모두 읽는다 */
export function readTextChunks(bytes: Uint8Array): Record<string, string> {
    const out: Record<string, string> = {}
    if (!isPng(bytes)) return out
    for (const c of chunks(bytes)) {
        if (c.type === 'tEXt') {
            const i = c.data.indexOf(0)
            if (i < 0) continue
            out[new TextDecoder('latin1').decode(c.data.subarray(0, i))] = new TextDecoder('utf-8').decode(c.data.subarray(i + 1))
        } else if (c.type === 'iTXt') {
            const i = c.data.indexOf(0)
            if (i < 0) continue
            const key = new TextDecoder('latin1').decode(c.data.subarray(0, i))
            const compressed = c.data[i + 1]
            if (compressed) continue
            let p = i + 3
            const langEnd = c.data.indexOf(0, p)
            if (langEnd < 0) continue
            p = langEnd + 1
            const transEnd = c.data.indexOf(0, p)
            if (transEnd < 0) continue
            out[key] = new TextDecoder('utf-8').decode(c.data.subarray(transEnd + 1))
        }
    }
    return out
}
