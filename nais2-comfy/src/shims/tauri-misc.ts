// 나머지 Tauri 모듈 대체: core, dialog, shell, opener, window, app, process, updater, deep-link, store.
// vite.config.ts 와 tsconfig.json 의 별칭이 각 모듈 이름을 이 파일의 묶음(아래 shims/*.ts)으로 돌린다.
import { apiJson, launcherToken, localFileUrl } from './server'

// ---------------------------------------------------------------- core
export function convertFileSrc(filePath: string, _protocol = 'asset'): string {
    return localFileUrl(filePath)
}

export async function invoke<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
    throw new Error(`이 기능은 NAIS2 Comfy에서 쓰지 않습니다 (${cmd})`)
}

export function isTauri(): boolean {
    return false
}

// ---------------------------------------------------------------- dialog
export interface DialogFilter {
    name: string
    extensions: string[]
}

export interface OpenDialogOptions {
    title?: string
    defaultPath?: string
    directory?: boolean
    multiple?: boolean
    filters?: DialogFilter[]
    recursive?: boolean
}

export interface SaveDialogOptions {
    title?: string
    defaultPath?: string
    filters?: DialogFilter[]
}

export async function openDialog(options: OpenDialogOptions = {}): Promise<string | string[] | null> {
    const kind = options.directory ? 'folder' : 'open'
    const r = await apiJson<{ paths: string[] | null }>(`dialog/${kind}`, {
        title: options.title ?? '',
        defaultPath: options.defaultPath ?? '',
        multiple: !!options.multiple,
        filters: options.filters ?? [],
    })
    if (!r.paths || r.paths.length === 0) return null
    return options.multiple ? r.paths : r.paths[0]
}

export async function saveDialog(options: SaveDialogOptions = {}): Promise<string | null> {
    let defaultPath = options.defaultPath ?? ''
    // 파일 이름만 주면 사진 폴더에서 시작한다
    if (defaultPath && !/[\\/]/.test(defaultPath)) {
        try {
            const { pictureDir, joinSync } = await import('./path')
            defaultPath = joinSync(await pictureDir(), defaultPath)
        } catch { /* 이름만 넘긴다 */ }
    }
    const r = await apiJson<{ paths: string[] | null }>('dialog/save', {
        title: options.title ?? '',
        defaultPath,
        filters: options.filters ?? [],
    })
    return r.paths?.[0] ?? null
}

export async function message(text: string, _options?: unknown): Promise<void> {
    window.alert(text)
}

export async function ask(text: string, _options?: unknown): Promise<boolean> {
    return window.confirm(text)
}

export const confirm = ask

// ---------------------------------------------------------------- opener / shell
export async function openPath(path: string, _openWith?: string): Promise<void> {
    await apiJson('open/path', { path })
}

export async function revealItemInDir(path: string | string[]): Promise<void> {
    await apiJson('open/reveal', { path: Array.isArray(path) ? path[0] : path })
}

export async function openUrl(url: string | URL, _openWith?: string): Promise<void> {
    await apiJson('open/url', { url: String(url) })
}

export interface ChildProcess {
    code: number | null
    signal: number | null
    stdout: string
    stderr: string
}

/** shell 플러그인의 Command: 원래 코드는 explorer로 폴더를 여는 데만 쓴다 */
export class Command {
    private program: string
    private args: string[]
    private constructor(program: string, args: string | string[] = []) {
        this.program = program
        this.args = Array.isArray(args) ? args : [args]
    }
    static create(program: string, args: string | string[] = []): Command {
        return new Command(program, args)
    }
    async execute(): Promise<ChildProcess> {
        if (/^explorer(\.exe)?$/i.test(this.program) && this.args[0]) {
            const arg = this.args[0]
            if (arg.startsWith('/select,')) await revealItemInDir(arg.slice(8).replace(/^"|"$/g, ''))
            else await openPath(arg)
            return { code: 0, signal: null, stdout: '', stderr: '' }
        }
        throw new Error(`실행할 수 없는 명령입니다: ${this.program}`)
    }
    async spawn(): Promise<{ pid: number; kill: () => Promise<void> }> {
        await this.execute()
        return { pid: 0, kill: async () => { } }
    }
}

export async function shellOpen(path: string, _openWith?: string): Promise<void> {
    if (/^https?:\/\//i.test(path)) await openUrl(path)
    else await openPath(path)
}

// ---------------------------------------------------------------- window
const noop = async () => { }
const unlisten = async (..._args: unknown[]) => () => { }

export function getCurrentWindow() {
    return {
        label: 'main',
        minimize: noop,
        unminimize: noop,
        maximize: noop,
        unmaximize: noop,
        toggleMaximize: noop,
        isMaximized: async () => false,
        isFullscreen: async () => !!document.fullscreenElement,
        setFullscreen: async (v: boolean) => {
            if (v) await document.documentElement.requestFullscreen?.()
            else if (document.fullscreenElement) await document.exitFullscreen()
        },
        close: async () => window.close(),
        destroy: async () => window.close(),
        hide: noop,
        show: noop,
        setFocus: noop,
        setTitle: async (t: string) => { document.title = t },
        startDragging: noop,
        onResized: unlisten,
        onMoved: unlisten,
        onCloseRequested: unlisten,
        onFocusChanged: unlisten,
        listen: unlisten,
        once: unlisten,
    }
}

export const getCurrentWebviewWindow = getCurrentWindow
export const appWindow = getCurrentWindow()

// ---------------------------------------------------------------- app / process / updater / deep-link
export const APP_VERSION = '2.7.4-comfy.1'

export async function getVersion(): Promise<string> {
    return APP_VERSION
}

export async function getName(): Promise<string> {
    return 'NAIS2 Comfy'
}

export async function getTauriVersion(): Promise<string> {
    return '0'
}

export async function relaunch(): Promise<void> {
    window.location.reload()
}

export async function exit(_code?: number): Promise<void> {
    window.close()
}

export interface Update {
    version: string
    currentVersion: string
    date?: string
    body?: string
    download: (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>
    install: () => Promise<void>
    downloadAndInstall: (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>
}

/** 자동 업데이트는 하지 않는다 (언제나 '새 버전 없음') */
export async function check(): Promise<Update | null> {
    return null
}

export async function onOpenUrl(_handler: (urls: string[]) => void): Promise<() => void> {
    return () => { }
}

export async function getCurrent(): Promise<string[] | null> {
    return null
}

// ---------------------------------------------------------------- store (plugin-store)
export class Store {
    private name: string
    private data: Record<string, unknown> = {}
    private loaded: Promise<void> | null = null

    constructor(name: string) {
        this.name = name.replace(/[\\/]/g, '_')
    }

    static async load(name: string, _options?: unknown): Promise<Store> {
        const s = new Store(name)
        await s.ensure()
        return s
    }

    private ensure(): Promise<void> {
        if (!this.loaded) {
            this.loaded = fetch(`/__api/store/load?name=${encodeURIComponent(this.name)}`, { headers: { 'X-NC-Token': launcherToken } })
                .then((r) => (r.ok ? r.json() : {}))
                .then((d: unknown) => { this.data = d && typeof d === 'object' ? (d as Record<string, unknown>) : {} })
                .catch(() => { this.data = {} })
        }
        return this.loaded
    }

    async get<T>(key: string): Promise<T | undefined> {
        await this.ensure()
        return this.data[key] as T | undefined
    }
    async set(key: string, value: unknown): Promise<void> {
        await this.ensure()
        this.data[key] = value
    }
    async has(key: string): Promise<boolean> {
        await this.ensure()
        return key in this.data
    }
    async delete(key: string): Promise<boolean> {
        await this.ensure()
        const had = key in this.data
        delete this.data[key]
        return had
    }
    async clear(): Promise<void> {
        this.data = {}
    }
    async keys(): Promise<string[]> {
        await this.ensure()
        return Object.keys(this.data)
    }
    async entries<T>(): Promise<Array<[string, T]>> {
        await this.ensure()
        return Object.entries(this.data) as Array<[string, T]>
    }
    async save(): Promise<void> {
        await this.ensure()
        await fetch(`/__api/store/save?name=${encodeURIComponent(this.name)}`, {
            method: 'POST',
            headers: { 'X-NC-Token': launcherToken, 'Content-Type': 'application/json' },
            body: JSON.stringify(this.data),
        })
    }
}

export class LazyStore extends Store { }

export async function load(name: string, options?: unknown): Promise<Store> {
    return Store.load(name, options)
}
