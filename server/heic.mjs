import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

export async function convertHeic(input, output, pixelLimit) {
  const { default: module } = await import('libheif-js/wasm-bundle.js');
  const heif = await module;
  const decoder = new heif.HeifDecoder();
  let images = [];
  try {
    images = decoder.decode(await readFile(input));
    const [image] = images;
    if (!image) throw new Error('HEIC enthält kein lesbares Bild.');
    const width = image.get_width();
    const height = image.get_height();
    if (!Number.isSafeInteger(width * height) || width < 1 || height < 1 || width * height > pixelLimit) {
      throw new Error('Ungültige HEIC-Bildgröße.');
    }
    const pixels = await new Promise((resolve, reject) => {
      const data = new Uint8ClampedArray(width * height * 4);
      image.display({ data, width, height }, (result) => {
        if (result) resolve(result.data);
        else reject(new Error('HEIC konnte nicht dekodiert werden.'));
      });
    });
    await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
      raw: { width, height, channels: 4 },
      limitInputPixels: pixelLimit,
    }).webp({ quality: 92 }).toFile(output);
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder) heif.heif_context_free(decoder.decoder);
  }
}
