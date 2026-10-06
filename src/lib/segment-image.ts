export const MAX_SEGMENT_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

export function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Only inert image data and credential-free HTTPS links may enter a backup. */
export function validateSegmentImage(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('段落配图格式无效。');
  if (value.startsWith('https:') && value.length <= 8192) {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password)
      return value;
  }
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (match && match[2].length <= Math.ceil(MAX_SEGMENT_IMAGE_BYTES / 3) * 4) {
    try {
      const header = Uint8Array.from(atob(match[2].slice(0, 24)), (char) =>
        char.charCodeAt(0),
      );
      const bytes =
        (match[2].length * 3) / 4 -
        (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
      if (
        match[2].length % 4 === 0 &&
        bytes <= MAX_SEGMENT_IMAGE_BYTES &&
        imageMime(header) === match[1]
      )
        return value;
    } catch {
      /* Invalid base64 is rejected below. */
    }
  }
  throw new Error(
    '配图需为 20 MB 以内的 PNG、JPEG、WebP 图片或有效 HTTPS 图片链接。',
  );
}

export async function imageDataUrl(
  blob: Pick<Blob, 'size' | 'arrayBuffer'>,
): Promise<string> {
  if (!blob.size || blob.size > MAX_SEGMENT_IMAGE_BYTES)
    throw new Error('配图不能超过 20 MB，请先缩小图片。');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = imageMime(bytes);
  if (!mime) throw new Error('配图只支持 PNG、JPEG 或 WebP 图片。');
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return `data:${mime};base64,${btoa(chunks.join(''))}`;
}
