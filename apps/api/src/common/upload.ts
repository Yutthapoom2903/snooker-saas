import { BadRequestException } from '@nestjs/common';
import { mkdirSync, unlink } from 'fs';
import { diskStorage } from 'multer';
import { basename, dirname, extname, join } from 'path';
import { randomToken } from './util';

export const UPLOAD_ROOT = join(process.cwd(), 'uploads');

const IMAGE_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/** Multer options for an image saved under uploads/<folder>/<random>.<ext>. */
export function imageUpload(folder: string, maxMb = 5) {
  const dir = join(UPLOAD_ROOT, folder);
  mkdirSync(dir, { recursive: true });
  return {
    storage: diskStorage({
      destination: dir,
      // Extension comes from the validated MIME type, never from the client filename.
      filename: (_req, file, cb) => cb(null, `${randomToken(12)}${IMAGE_EXT[file.mimetype] ?? extname('.bin')}`),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) => {
      if (!IMAGE_EXT[file.mimetype]) return cb(new BadRequestException('รองรับเฉพาะ PNG, JPG, WEBP'), false);
      cb(null, true);
    },
  };
}

/** Delete a file we stored, given its public "/uploads/<folder>/<name>" URL. Never follows other paths. */
export function removeUpload(url: string | null | undefined) {
  if (!url?.startsWith('/uploads/')) return;
  const folder = basename(dirname(url));
  const name = basename(url);
  if (!/^[a-z]+$/.test(folder) || !/^[\w-]+\.(png|jpg|webp)$/.test(name)) return;
  unlink(join(UPLOAD_ROOT, folder, name), () => undefined);
}
