import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import sharp from 'sharp';
import type { Logger } from 'pino';
import { validateUrl } from '@echos/shared';
import type { ProcessedContent } from '@echos/shared';

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const FETCH_TIMEOUT = 60000; // 60s
const ALLOWED_FORMATS = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'avif', 'tiff', 'bmp'];

export interface ImageMetadata {
  format: string;
  width: number;
  height: number;
  size: number;
  hasAlpha: boolean;
  space?: string;
  density?: number;
  exif?: unknown;
}

export interface ProcessedImage {
  buffer: Buffer;
  localPath: string;
  imageMetadata: ImageMetadata;
  title: string;
  content: string;
  metadata: Partial<{
    type: 'image';
    sourceUrl: string;
    imageMetadata: string;
  }>;
  embedText: string;
}

/**
 * Process an image from a URL or buffer
 */
export async function processImage(
  urlOrBuffer: string | Buffer,
  logger: Logger,
  filename?: string,
): Promise<ProcessedImage> {
  let buffer: Buffer;
  let sourceUrl: string | undefined;

  if (typeof urlOrBuffer === 'string') {
    const validatedUrl = validateUrl(urlOrBuffer);
    sourceUrl = validatedUrl;
    logger.info({ url: validatedUrl }, 'Processing image from URL');

    const response = await fetch(validatedUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: {
        'User-Agent': 'EchOS/1.0 (Knowledge Assistant)',
        Accept: 'image/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`URL does not point to an image (content-type: ${contentType})`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
      throw new Error('Image file too large (max 20MB)');
    }

    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    buffer = urlOrBuffer;
    logger.info('Processing image from buffer');
  }

  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('Image file too large (max 20MB)');
  }

  // Extract metadata using sharp
  const image = sharp(buffer);
  const metadata = await image.metadata();

  if (!metadata.format || !ALLOWED_FORMATS.includes(metadata.format)) {
    throw new Error(`Unsupported image format: ${metadata.format ?? 'unknown'}`);
  }

  const imageMetadata: ImageMetadata = {
    format: metadata.format,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    size: buffer.length,
    hasAlpha: metadata.hasAlpha ?? false,
  };

  if (metadata.space) imageMetadata.space = metadata.space;
  if (metadata.density) imageMetadata.density = metadata.density;
  if (metadata.exif) imageMetadata.exif = metadata.exif;

  // Generate a unique filename based on content hash
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const ext = `.${metadata.format}`;
  const localPath = filename ? filename : `${hash}${ext}`;

  logger.info(
    {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      size: buffer.length,
    },
    'Image processed',
  );

  // Generate a description for the image
  const title = filename?.replace(extname(filename), '') ?? `Image ${hash}`;
  const content = `Image file: ${metadata.format?.toUpperCase()} ${metadata.width}x${metadata.height}`;

  return {
    buffer,
    localPath,
    imageMetadata,
    title,
    content,
    metadata: {
      type: 'image' as const,
      ...(sourceUrl ? { sourceUrl } : {}),
      imageMetadata: JSON.stringify(imageMetadata),
    },
    embedText: `Image: ${title}. Format: ${metadata.format}, Dimensions: ${metadata.width}x${metadata.height}`,
  };
}

/**
 * Save image buffer to disk
 */
export async function saveImageToDisk(
  buffer: Buffer,
  baseDir: string,
  category: string,
  filename: string,
): Promise<string> {
  const categoryPath = join(baseDir, 'image', category);
  const filePath = join(categoryPath, filename);
  await writeFile(filePath, buffer);
  return filePath;
}
