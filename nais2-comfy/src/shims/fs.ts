// @tauri-apps/plugin-fs 대체. 실제 파일 작업은 실행 파일(/__api/fs/*)이 한다.
// 전송 오류는 그대로 던진다 (exists가 오류를 false로 바꾸면 화면이 멀쩡한 파일 목록을 지워 버린다).
import { apiFetch, apiJson } from './server'
import { BaseDirectory, resolveBase } from './path'

export { BaseDirectory }

export interface BaseOptions {
    baseDir?: BaseDirectory
}

export interface DirEntry {
    name: string
    isDirectory: boolean
    isFile: boolean
    isSymlink: boolean
}

export interface FileInfo {
    isFile: boolean
    isDirectory: boolean
    isSymlink: boolean
    size: number
    mtime: Date | null
    atime: Date | null
    birthtime: Date | null
    readonly: boolean
}

type PathLike = string | URL

function str(p: PathLike): string {
    return p instanceof URL ? decodeURIComponent(p.pathname) : p
}

async function abs(p: PathLike, options?: BaseOptions): Promise<string> {
    return resolveBase(str(p), options?.baseDir)
}

export async function readFile(path: PathLike, options?: BaseOptions): Promise<Uint8Array<ArrayBuffer>> {
    const res = await apiFetch('fs/readFile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: await abs(path, options) }),
    })
    return new Uint8Array(await res.arrayBuffer())
}

export async function readTextFile(path: PathLike, options?: BaseOptions): Promise<string> {
    return new TextDecoder().decode(await readFile(path, options))
}

export interface WriteFileOptions extends BaseOptions {
    append?: boolean
    create?: boolean
    createNew?: boolean
    mode?: number
}

export async function writeFile(
    path: PathLike,
    data: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array> | Blob,
    options?: WriteFileOptions,
): Promise<void> {
    const target = await abs(path, options)
    let body: BodyInit
    if (data instanceof ReadableStream) {
        body = await new Response(data).blob()
    } else if (data instanceof Blob) {
        body = data
    } else {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
        body = new Blob([bytes as BlobPart])
    }
    const q = new URLSearchParams({ path: target })
    if (options?.append) q.set('append', '1')
    await apiFetch(`fs/writeFile?${q.toString()}`, { method: 'POST', body })
}

export async function writeTextFile(path: PathLike, text: string, options?: WriteFileOptions): Promise<void> {
    await writeFile(path, new TextEncoder().encode(text), options)
}

export async function exists(path: PathLike, options?: BaseOptions): Promise<boolean> {
    const r = await apiJson<{ exists: boolean }>('fs/exists', { path: await abs(path, options) })
    return r.exists
}

export interface MkdirOptions extends BaseOptions {
    recursive?: boolean
    mode?: number
}

/** Tauri와 달리 언제나 상위 폴더까지 만든다 (원래 코드가 recursive 없이 여러 단계를 만드는 곳이 있다) */
export async function mkdir(path: PathLike, options?: MkdirOptions): Promise<void> {
    await apiJson('fs/mkdir', { path: await abs(path, options), recursive: true })
}

export async function readDir(path: PathLike, options?: BaseOptions): Promise<DirEntry[]> {
    const list = await apiJson<Array<DirEntry & { size?: number; mtime?: number }>>('fs/readDir', { path: await abs(path, options) })
    return list.map(({ name, isDirectory, isFile, isSymlink }) => ({ name, isDirectory, isFile, isSymlink }))
}

export interface RemoveOptions extends BaseOptions {
    recursive?: boolean
}

export async function remove(path: PathLike, options?: RemoveOptions): Promise<void> {
    await apiJson('fs/remove', { path: await abs(path, options), recursive: !!options?.recursive })
}

export interface RenameOptions {
    oldPathBaseDir?: BaseDirectory
    newPathBaseDir?: BaseDirectory
}

export async function rename(oldPath: PathLike, newPath: PathLike, options?: RenameOptions): Promise<void> {
    await apiJson('fs/rename', {
        from: await resolveBase(str(oldPath), options?.oldPathBaseDir),
        to: await resolveBase(str(newPath), options?.newPathBaseDir),
    })
}

export interface CopyFileOptions {
    fromPathBaseDir?: BaseDirectory
    toPathBaseDir?: BaseDirectory
}

export async function copyFile(fromPath: PathLike, toPath: PathLike, options?: CopyFileOptions): Promise<void> {
    await apiJson('fs/copyFile', {
        from: await resolveBase(str(fromPath), options?.fromPathBaseDir),
        to: await resolveBase(str(toPath), options?.toPathBaseDir),
    })
}

export async function stat(path: PathLike, options?: BaseOptions): Promise<FileInfo> {
    const r = await apiJson<{ isFile: boolean; isDirectory: boolean; isSymlink: boolean; size: number; mtime: number; readonly: boolean }>(
        'fs/stat',
        { path: await abs(path, options) },
    )
    return {
        isFile: r.isFile,
        isDirectory: r.isDirectory,
        isSymlink: r.isSymlink,
        size: r.size,
        mtime: r.mtime ? new Date(r.mtime) : null,
        atime: null,
        birthtime: null,
        readonly: r.readonly,
    }
}

export const lstat = stat

/** 폴더 안 파일 목록을 크기·수정 시각과 함께 (이 프로그램 전용) */
export async function readDirWithInfo(path: string): Promise<Array<DirEntry & { size?: number; mtime?: number }>> {
    return apiJson('fs/readDir', { path })
}
