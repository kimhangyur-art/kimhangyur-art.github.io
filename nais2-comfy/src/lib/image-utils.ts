/**
 * Image utility functions for memory-efficient image handling
 */

// ============================================
// File type helpers (저장·복사)
// ============================================

/** 파일 이름·경로의 확장자 (점 없이, 소문자). 없으면 'png' */
export function imageExtension(nameOrPath: string): string {
    const base = nameOrPath.split(/[\\/]/).pop() ?? nameOrPath
    const m = /\.([a-z0-9]+)$/i.exec(base)
    const ext = m ? m[1].toLowerCase() : 'png'
    return ext === 'jpeg' ? 'jpg' : ext
}

/** 확장자에 맞는 MIME 형식 */
export function imageMimeType(nameOrPath: string): string {
    switch (imageExtension(nameOrPath)) {
        case 'jpg': return 'image/jpeg'
        case 'webp': return 'image/webp'
        case 'gif': return 'image/gif'
        case 'bmp': return 'image/bmp'
        default: return 'image/png'
    }
}

/** 이름에 확장자가 없으면 붙인다 (다른 이름으로 저장) */
export function withImageExtension(name: string, ext: string): string {
    return new RegExp(`\\.${ext}$`, 'i').test(name) ? name : `${name}.${ext}`
}

/**
 * 그림을 클립보드에 복사한다.
 * 바이트에 확장자에 맞는 형식을 붙이고, 브라우저 클립보드가 PNG만 받으므로 PNG가 아니면 PNG로 바꿔 넣는다.
 */
export async function copyImageToClipboard(data: Uint8Array | Blob, nameOrPath: string): Promise<void> {
    const mime = imageMimeType(nameOrPath)
    let blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime })
    if (blob.type !== mime) blob = new Blob([blob], { type: mime })
    if (mime !== 'image/png') {
        const bmp = await createImageBitmap(blob)
        try {
            const canvas = document.createElement('canvas')
            canvas.width = bmp.width
            canvas.height = bmp.height
            canvas.getContext('2d')?.drawImage(bmp, 0, 0)
            const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
            canvas.width = 0
            canvas.height = 0
            if (!png) throw new Error('PNG로 바꾸지 못했습니다')
            blob = png
        } finally {
            bmp.close()
        }
    }
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

// ============================================
// Thumbnail Generation
// ============================================

/**
 * Generate thumbnail from base64 image (max 256px, JPEG quality 0.7)
 * Memory-safe: properly releases canvas and image resources
 * 
 * @param base64Image - Full base64 image string (with data: prefix)
 * @param maxSize - Maximum dimension for thumbnail (default 256px)
 * @returns Promise resolving to thumbnail base64 string (~10-30KB)
 */
export const createThumbnail = (base64Image: string, maxSize = 256): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            let canvas: HTMLCanvasElement | null = null
            try {
                canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')

                if (!ctx) {
                    resolve(base64Image) // Fallback to original
                    return
                }

                // Calculate thumbnail dimensions maintaining aspect ratio
                let width = img.width
                let height = img.height
                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round(height * maxSize / width)
                        width = maxSize
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round(width * maxSize / height)
                        height = maxSize
                    }
                }

                canvas.width = width
                canvas.height = height
                ctx.drawImage(img, 0, 0, width, height)

                // Use JPEG for smaller size (~10-30KB instead of 2-5MB)
                const thumbnail = canvas.toDataURL('image/jpeg', 0.7)
                resolve(thumbnail)
            } catch {
                resolve(base64Image) // Fallback to original on error
            } finally {
                // CRITICAL: Release canvas memory to prevent OOM
                if (canvas) {
                    canvas.width = 0
                    canvas.height = 0
                }
                // Help GC by clearing image reference
                img.src = ''
            }
        }
        img.onerror = () => {
            img.src = '' // Clear on error too
            resolve(base64Image) // Fallback to original
        }
        img.src = base64Image
    })
}
