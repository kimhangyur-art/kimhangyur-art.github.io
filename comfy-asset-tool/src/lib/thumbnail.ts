// 확정 이미지를 작게 줄인 썸네일(data URL). 프로젝트 파일과 자동 저장에 함께 들어가므로 작게 만든다.

export async function makeThumbnail(blob: Blob, max = 144): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const webp = canvas.toDataURL('image/webp', 0.72);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.75);
  } catch {
    return null;
  }
}
