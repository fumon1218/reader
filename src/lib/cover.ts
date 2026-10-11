/** 표지 이미지를 작게 줄여 data URL로 만듭니다. (브라우저 전용) */
export async function resizeCover(blob: Blob, maxW = 360): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return undefined;
  }
}
