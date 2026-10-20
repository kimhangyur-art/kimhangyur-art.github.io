// 로컬 실행 파일(launcher/)과 이야기하는 공통 부분.
// 실행 파일은 화면(index.html)에 토큰을 심어 두고, /__api/ 와 /comfy/ 요청은 그 토큰이 있어야 받아 준다.

function readMeta(name: string): string | null {
    if (typeof document === 'undefined') return null
    return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null
}

export const launcherToken: string = readMeta('nc-token') ?? (import.meta.env.VITE_NC_TOKEN as string | undefined) ?? ''

export function hasLauncher(): boolean {
    return launcherToken !== ''
}

export class LauncherError extends Error {
    status: number
    constructor(message: string, status: number) {
        super(message)
        this.name = 'LauncherError'
        this.status = status
    }
}

/** /__api/ 요청. 실패하면 LauncherError (파일이 없으면 status 404) */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!hasLauncher()) {
        throw new LauncherError('NAIS2 Comfy 실행 파일(exe)로 열어야 파일을 읽고 쓸 수 있습니다.', 0)
    }
    const headers = new Headers(init.headers)
    headers.set('X-NC-Token', launcherToken)
    const res = await fetch(`/__api/${path}`, { ...init, headers })
    if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`
        try {
            const body = await res.clone().json()
            if (body?.error) msg = body.error
        } catch { /* not json */ }
        throw new LauncherError(msg, res.status)
    }
    return res
}

export async function apiJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await apiFetch(path, body === undefined ? {} : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
}

export interface LauncherInfo {
    app: string
    platform: string
    sep: string
    dirs: Record<string, string>
    exeDir: string
}

let infoPromise: Promise<LauncherInfo> | null = null

export function launcherInfo(): Promise<LauncherInfo> {
    if (!infoPromise) {
        infoPromise = apiJson<LauncherInfo>('info').catch((e) => {
            infoPromise = null
            throw e
        })
    }
    return infoPromise
}

/** 이미지 태그 등에 바로 쓸 수 있는 로컬 파일 주소 */
export function localFileUrl(path: string): string {
    return `/__api/file?path=${encodeURIComponent(path)}&t=${encodeURIComponent(launcherToken)}`
}
