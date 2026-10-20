// ComfyUI 서버와 주고받기.
// exe(launcher)가 /comfy/ 아래로 ComfyUI 요청을 넘겨 주므로 CORS 설정 없이 쓸 수 있다.
//   POST /prompt          작업 등록 (client_id 를 같이 보내야 WebSocket으로 진행 상황이 온다)
//   WS   /ws?clientId=    progress / executing / executed / execution_success / execution_error / execution_interrupted
//                         + 미리보기 이미지(바이너리: 4바이트 이벤트 종류, 4바이트 이미지 종류, 이미지)
//   GET  /history/{id}    결과 파일 목록 (WebSocket이 끊겼을 때 대비)
//   GET  /view            결과 이미지
//   POST /upload/image    고화질로 다시 그릴 원본 이미지 올리기
//   POST /interrupt, /queue {delete}  중단
import { launcherToken } from '@/shims/server'
import type { ApiPrompt } from './workflow'

export const COMFY_BASE = '/comfy'

function comfyHeaders(extra?: HeadersInit): Headers {
    const h = new Headers(extra)
    if (launcherToken) h.set('X-NC-Token', launcherToken)
    return h
}

export class ComfyError extends Error {
    detail?: string
    constructor(message: string, detail?: string) {
        super(message)
        this.name = 'ComfyError'
        this.detail = detail
    }
}

async function comfyFetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response
    try {
        res = await fetch(`${COMFY_BASE}${path}`, { ...init, headers: comfyHeaders(init.headers) })
    } catch (e) {
        throw new ComfyError('ComfyUI에 연결하지 못했습니다. ComfyUI가 켜져 있는지 확인하세요.', String(e))
    }
    if (res.status === 502) {
        let msg = 'ComfyUI에 연결하지 못했습니다. ComfyUI가 켜져 있는지, 설정의 주소가 맞는지 확인하세요.'
        try {
            const b = await res.clone().json()
            if (b?.error) msg = b.error
        } catch { /* empty */ }
        throw new ComfyError(msg)
    }
    return res
}

// ---------------------------------------------------------------------------
// 서버 정보

export interface ComfyStatus {
    ok: boolean
    url?: string
    version?: string
    device?: string
    error?: string
}

export async function pingComfy(): Promise<ComfyStatus> {
    if (!launcherToken) {
        // 개발 서버에서 exe 없이 띄운 경우
        try {
            const r = await comfyFetch('/system_stats')
            return { ok: r.ok }
        } catch (e) {
            return { ok: false, error: (e as Error).message }
        }
    }
    try {
        const r = await fetch('/__api/comfy/ping', { headers: comfyHeaders() })
        return await r.json()
    } catch (e) {
        return { ok: false, error: String(e) }
    }
}

export async function getComfyTarget(): Promise<string> {
    const r = await fetch('/__api/comfy/target', { headers: comfyHeaders() })
    const j = await r.json()
    return j.url
}

export async function setComfyTarget(url: string): Promise<string> {
    const r = await fetch('/__api/comfy/target', {
        method: 'POST',
        headers: comfyHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url }),
    })
    const j = await r.json()
    if (!r.ok) throw new ComfyError(j.error ?? '주소를 바꾸지 못했습니다')
    resetSocket()
    return j.url
}

/** /object_info 의 입력 정의 (형식이 두 가지라 둘 다 읽는다) */
type InputSpec = [unknown, Record<string, unknown>?]
export interface NodeInfo {
    input: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> }
    output: string[]
}

export function comboOptions(spec: InputSpec | undefined): string[] {
    if (!spec) return []
    const [first, opts] = spec
    if (Array.isArray(first)) return first.map(String)
    if (first === 'COMBO' && opts && Array.isArray((opts as { options?: unknown }).options)) {
        return ((opts as { options: unknown[] }).options).map(String)
    }
    return []
}

export async function fetchObjectInfo(): Promise<Record<string, NodeInfo>> {
    const r = await comfyFetch('/object_info')
    if (!r.ok) throw new ComfyError(`ComfyUI 노드 정보를 받지 못했습니다 (${r.status})`)
    return r.json()
}

// ---------------------------------------------------------------------------
// WebSocket: 한 개만 열어 두고 prompt_id 별로 나눠 준다

export interface ProgressEvent {
    value: number
    max: number
    node?: string
}

interface Listener {
    onProgress?: (p: ProgressEvent) => void
    onPreview?: (blob: Blob) => void
    onExecuting?: (node: string | null) => void
    onExecuted?: (node: string, output: { images?: ImageRef[] }) => void
    onDone?: (r: { status: 'success' | 'error' | 'interrupted'; error?: string; detail?: string }) => void
}

export interface ImageRef {
    filename: string
    subfolder: string
    type: string
}

const clientId = (() => {
    const key = 'nais2-comfy-client-id'
    try {
        const saved = sessionStorage.getItem(key)
        if (saved) return saved
        const id = crypto.randomUUID().replace(/-/g, '')
        sessionStorage.setItem(key, id)
        return id
    } catch {
        return crypto.randomUUID().replace(/-/g, '')
    }
})()

let socket: WebSocket | null = null
let socketReady: Promise<void> | null = null
const listeners = new Map<string, Listener>()
/** 어느 작업 것인지 모르는 미리보기는 지금 실행 중인 작업에 준다 */
let runningPromptId: string | null = null
const socketWatchers = new Set<(open: boolean) => void>()

export function onSocketState(fn: (open: boolean) => void): () => void {
    socketWatchers.add(fn)
    return () => socketWatchers.delete(fn)
}

function socketUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const q = new URLSearchParams({ clientId })
    if (launcherToken) q.set('t', launcherToken)
    return `${proto}//${location.host}${COMFY_BASE}/ws?${q.toString()}`
}

function resetSocket() {
    if (socket) {
        socket.onclose = null
        socket.close()
    }
    socket = null
    socketReady = null
}

function ensureSocket(): Promise<void> {
    if (socket && socket.readyState === WebSocket.OPEN && socketReady) return socketReady
    if (socketReady && socket && socket.readyState === WebSocket.CONNECTING) return socketReady
    socketReady = new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(socketUrl())
        ws.binaryType = 'arraybuffer'
        socket = ws
        let opened = false
        ws.onopen = () => {
            opened = true
            socketWatchers.forEach((f) => f(true))
            resolve()
        }
        ws.onerror = () => {
            if (!opened) reject(new ComfyError('ComfyUI 실시간 연결(WebSocket)을 열지 못했습니다. ComfyUI가 켜져 있는지 확인하세요.'))
        }
        ws.onclose = () => {
            socketWatchers.forEach((f) => f(false))
            if (socket === ws) {
                socket = null
                socketReady = null
            }
        }
        ws.onmessage = (ev) => handleMessage(ev.data)
    })
    return socketReady
}

function handleMessage(data: unknown) {
    if (data instanceof ArrayBuffer) {
        const view = new DataView(data)
        if (data.byteLength < 8) return
        const event = view.getUint32(0)
        if (event !== 1 && event !== 4) return
        // 1 = PREVIEW_IMAGE (이벤트, 형식, 이미지) / 4 = PREVIEW_IMAGE_WITH_METADATA (이벤트, 메타 길이, 메타 JSON, 이미지)
        let target = runningPromptId
        let blob: Blob
        if (event === 1) {
            const fmt = view.getUint32(4)
            blob = new Blob([data.slice(8)], { type: fmt === 2 ? 'image/png' : 'image/jpeg' })
        } else {
            const metaLen = view.getUint32(4)
            try {
                const meta = JSON.parse(new TextDecoder().decode(data.slice(8, 8 + metaLen)))
                if (meta?.prompt_id) target = meta.prompt_id
                blob = new Blob([data.slice(8 + metaLen)], { type: meta?.image_type ?? 'image/jpeg' })
            } catch {
                return
            }
        }
        if (target) listeners.get(target)?.onPreview?.(blob)
        return
    }
    if (typeof data !== 'string') return
    let msg: { type: string; data: Record<string, unknown> }
    try {
        msg = JSON.parse(data)
    } catch {
        return
    }
    const d = msg.data ?? {}
    const pid = typeof d.prompt_id === 'string' ? d.prompt_id : null
    const l = pid ? listeners.get(pid) : undefined
    switch (msg.type) {
        case 'execution_start':
            if (pid) runningPromptId = pid
            break
        case 'progress':
            if (pid) runningPromptId = pid
            l?.onProgress?.({ value: Number(d.value), max: Number(d.max), node: d.node as string | undefined })
            break
        case 'executing':
            if (pid && d.node !== null) runningPromptId = pid
            l?.onExecuting?.((d.node as string | null) ?? null)
            if (d.node === null && pid) {
                // 예전 ComfyUI는 execution_success 없이 node:null 로 끝을 알린다
                l?.onDone?.({ status: 'success' })
            }
            break
        case 'executed':
            l?.onExecuted?.(String(d.node), (d.output ?? {}) as { images?: ImageRef[] })
            break
        case 'execution_success':
            l?.onDone?.({ status: 'success' })
            break
        case 'execution_error': {
            const nodeType = d.node_type ? ` (${d.node_type})` : ''
            l?.onDone?.({
                status: 'error',
                error: `ComfyUI 실행 중 오류${nodeType}: ${d.exception_message ?? '알 수 없는 오류'}`,
                detail: Array.isArray(d.traceback) ? (d.traceback as string[]).join('') : undefined,
            })
            break
        }
        case 'execution_interrupted':
            l?.onDone?.({ status: 'interrupted' })
            break
    }
}

// ---------------------------------------------------------------------------
// 작업 등록 · 실행

/** /prompt 거절 응답을 사람이 읽을 문장으로 */
export function describePromptError(body: unknown): string {
    const b = body as {
        error?: { type?: string; message?: string; details?: string }
        node_errors?: Record<string, { class_type?: string; errors?: Array<{ message?: string; details?: string; extra_info?: { input_name?: string } }> }>
    }
    const lines: string[] = []
    if (b?.error?.type === 'missing_node_type') {
        return `ComfyUI에 없는 노드가 필요합니다: ${b.error.message ?? ''}`
    }
    for (const [, ne] of Object.entries(b?.node_errors ?? {})) {
        for (const e of ne.errors ?? []) {
            const what = e.extra_info?.input_name ? `${ne.class_type ?? ''}.${e.extra_info.input_name}` : ne.class_type ?? ''
            lines.push(`${what}: ${e.message ?? ''}${e.details ? ` — ${e.details}` : ''}`)
        }
    }
    const head = b?.error?.message ?? 'ComfyUI가 작업을 받지 않았습니다'
    return lines.length ? `${head}\n${lines.slice(0, 6).join('\n')}` : `${head}${b?.error?.details ? `: ${b.error.details}` : ''}`
}

export async function queuePrompt(prompt: ApiPrompt, extra?: Record<string, unknown>): Promise<string> {
    const r = await comfyFetch('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: clientId, extra_data: extra }),
    })
    let body: unknown = null
    try {
        body = await r.json()
    } catch { /* empty */ }
    if (!r.ok) throw new ComfyError(describePromptError(body))
    const id = (body as { prompt_id?: string })?.prompt_id
    if (!id) throw new ComfyError('ComfyUI가 작업 번호를 돌려주지 않았습니다')
    return id
}

export async function interruptPrompt(promptId?: string): Promise<void> {
    try {
        if (promptId) {
            // 아직 대기열에 있으면 빼고, 실행 중이면 멈춘다
            await comfyFetch('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) })
        }
        await comfyFetch('/interrupt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(promptId ? { prompt_id: promptId } : {}),
        })
    } catch { /* ComfyUI가 꺼졌으면 멈출 것도 없다 */ }
}

export async function fetchHistoryImages(promptId: string): Promise<{ done: boolean; images: Array<ImageRef & { node: string }>; error?: string }> {
    const r = await comfyFetch(`/history/${encodeURIComponent(promptId)}`)
    if (!r.ok) return { done: false, images: [] }
    const h = await r.json()
    const entry = h?.[promptId]
    if (!entry) return { done: false, images: [] }
    const images: Array<ImageRef & { node: string }> = []
    for (const [node, out] of Object.entries((entry.outputs ?? {}) as Record<string, { images?: ImageRef[] }>)) {
        for (const im of out.images ?? []) images.push({ ...im, node })
    }
    const status = entry.status?.status_str
    return { done: entry.status?.completed !== false || status === 'error', images, error: status === 'error' ? 'ComfyUI 실행 중 오류가 났습니다' : undefined }
}

/** 작업이 아직 ComfyUI 대기열(실행 중 포함)에 있는지 */
async function isQueued(promptId: string): Promise<boolean> {
    const r = await comfyFetch('/queue')
    if (!r.ok) return true
    const q = await r.json()
    const all = [...(q?.queue_running ?? []), ...(q?.queue_pending ?? [])] as unknown[][]
    return all.some((item) => item?.[1] === promptId)
}

export async function fetchImageBytes(ref: ImageRef): Promise<Uint8Array> {
    const q = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder ?? '', type: ref.type ?? 'output' })
    const r = await comfyFetch(`/view?${q.toString()}`)
    if (!r.ok) throw new ComfyError(`결과 이미지를 받지 못했습니다 (${r.status})`)
    return new Uint8Array(await r.arrayBuffer())
}

export async function uploadImage(bytes: Uint8Array, name: string): Promise<string> {
    const form = new FormData()
    form.append('image', new Blob([bytes as BlobPart], { type: 'image/png' }), name)
    form.append('type', 'input')
    form.append('subfolder', 'nais2-comfy')
    form.append('overwrite', 'true')
    const r = await comfyFetch('/upload/image', { method: 'POST', body: form })
    if (!r.ok) throw new ComfyError(`원본 이미지를 ComfyUI에 올리지 못했습니다 (${r.status})`)
    const j = await r.json()
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name
}

export interface RunOptions {
    /** 결과로 가져올 출력 노드 id (없으면 처음 나온 이미지) */
    outputNode?: string
    signal?: AbortSignal
    onQueued?: (promptId: string) => void
    onProgress?: (p: ProgressEvent) => void
    onPreview?: (blob: Blob) => void
    extraPngInfo?: Record<string, unknown>
}

export interface RunResult {
    promptId: string
    bytes: Uint8Array
    image: ImageRef
}

export class ComfyInterrupted extends Error {
    constructor() {
        super('중단했습니다')
        this.name = 'ComfyInterrupted'
    }
}

/** 작업을 등록하고 끝날 때까지 기다려 결과 이미지를 받아 온다 */
export async function runPrompt(prompt: ApiPrompt, opts: RunOptions = {}): Promise<RunResult> {
    if (opts.signal?.aborted) throw new ComfyInterrupted()
    try {
        await ensureSocket()
    } catch {
        // WebSocket이 안 되면 /history 를 물어보며 기다린다
    }
    const promptId = await queuePrompt(prompt, opts.extraPngInfo ? { extra_pnginfo: opts.extraPngInfo } : undefined)
    opts.onQueued?.(promptId)
    const collected: Array<ImageRef & { node: string }> = []

    const outcome = await new Promise<{ status: 'success' | 'error' | 'interrupted'; error?: string; detail?: string }>((resolve) => {
        let finished = false
        const finish = (r: { status: 'success' | 'error' | 'interrupted'; error?: string; detail?: string }) => {
            if (finished) return
            finished = true
            clearInterval(poll)
            listeners.delete(promptId)
            opts.signal?.removeEventListener('abort', onAbort)
            resolve(r)
        }
        const onAbort = () => {
            void interruptPrompt(promptId)
            finish({ status: 'interrupted' })
        }
        opts.signal?.addEventListener('abort', onAbort)
        listeners.set(promptId, {
            onProgress: opts.onProgress,
            onPreview: opts.onPreview,
            onExecuted: (node, output) => {
                for (const im of output.images ?? []) collected.push({ ...im, node })
            },
            onDone: finish,
        })
        // WebSocket 이 끊겨도 끝나는 것을 놓치지 않게 /history 를 확인한다.
        // ComfyUI가 다시 켜져 작업이 사라졌거나, 오래 연결이 안 되면 기다림을 끝낸다.
        let missing = 0
        let unreachableSince = 0
        let tick = 0
        const poll = setInterval(async () => {
            tick++
            const wsOpen = !!socket && socket.readyState === WebSocket.OPEN
            // 연결이 살아 있으면 10초에 한 번만 확인
            if (wsOpen && tick % 5 !== 0) return
            if (!wsOpen) void ensureSocket().catch(() => { /* 다음에 다시 */ })
            try {
                const h = await fetchHistoryImages(promptId)
                unreachableSince = 0
                if (h.done) {
                    for (const im of h.images) if (!collected.some((c) => c.filename === im.filename && c.subfolder === im.subfolder)) collected.push(im)
                    finish(h.error ? { status: 'error', error: h.error } : { status: 'success' })
                    return
                }
                if (await isQueued(promptId)) missing = 0
                else if (++missing >= 3) {
                    finish({ status: 'error', error: 'ComfyUI 대기열에서 작업이 사라졌습니다. ComfyUI를 다시 켰거나 다른 곳에서 대기열을 비웠을 수 있습니다.' })
                }
            } catch {
                if (!unreachableSince) unreachableSince = Date.now()
                else if (Date.now() - unreachableSince > 30_000) {
                    finish({ status: 'error', error: 'ComfyUI 연결이 끊겼습니다. ComfyUI가 켜져 있는지 확인하세요.' })
                }
            }
        }, 2000)
    })

    if (outcome.status === 'interrupted') throw new ComfyInterrupted()
    if (outcome.status === 'error') throw new ComfyError(outcome.error ?? 'ComfyUI 실행 중 오류', outcome.detail)

    let images = collected
    if (images.length === 0) {
        // executed 메시지를 못 받았으면 기록에서 찾는다
        for (let i = 0; i < 5 && images.length === 0; i++) {
            images = (await fetchHistoryImages(promptId)).images
            if (images.length === 0) await new Promise((r) => setTimeout(r, 300))
        }
    }
    const pick = (opts.outputNode ? images.find((im) => im.node === opts.outputNode) : undefined) ?? images[images.length - 1]
    if (!pick) throw new ComfyError('ComfyUI가 이미지를 만들지 않았습니다 (결과 없음)')
    const bytes = await fetchImageBytes(pick)
    return { promptId, bytes, image: pick }
}
