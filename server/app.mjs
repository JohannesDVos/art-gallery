import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { convertHeic } from './heic.mjs';

const MB = 1_000_000;
const imagePixelLimit = 64_000_000;
const heicBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const formats = {
  jpeg: ['image/jpeg', '.jpg'],
  png: ['image/png', '.png'],
  webp: ['image/webp', '.webp'],
  heic: ['image/webp', '.webp'],
  mp4: ['video/mp4', '.mp4'],
  webm: ['video/webm', '.webm'],
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function identify(path) {
  const header = Buffer.alloc(4096);
  const handle = await open(path);
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(header));
  } finally {
    await handle.close();
  }
  const bytes = header.subarray(0, bytesRead);
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12);
    if (heicBrands.has(brand)) return 'heic';
    const end = Math.min(bytes.length, bytes.readUInt32BE(0));
    for (let offset = 16; offset + 4 <= end; offset += 4) {
      if (heicBrands.has(bytes.toString('ascii', offset, offset + 4))) return 'heic';
    }
    if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash|MSNV|cmfc|cmfs)$/.test(brand)) return 'mp4';
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
      bytes.includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]))) return 'webm';
  throw new HttpError(415, 'Bitte wähle eine JPEG-, PNG-, WebP-, HEIC-, MP4- oder WebM-Datei.');
}

function field(body, name, limit, required = false) {
  const value = body?.[name] ?? '';
  if (typeof value !== 'string' || value.trim().length > limit) {
    throw new HttpError(400, 'Bitte überprüfe die Länge deiner Angaben.');
  }
  if (required && !value.trim()) throw new HttpError(400, 'Bitte gib einen Titel ein.');
  return value.trim();
}

function artwork(row) {
  const { id, title, artist, description, mime, media, width, height } = row;
  const kind = mime.startsWith('image/') ? 'image' : 'video';
  return {
    id, title, artist, description, kind, width, height,
    mediaUrl: `/api/works/${id}/media/${media}`,
    previewUrl: kind === 'image' ? `/api/works/${id}/preview/${media}` : null,
  };
}

export async function createGallery(dataDirectory) {
  const data = resolve(dataDirectory);
  const media = join(data, 'media');
  const temporary = join(data, 'uploads');
  await mkdir(media, { recursive: true });
  await mkdir(temporary, { recursive: true });
  const db = new DatabaseSync(join(data, 'gallery.sqlite'));
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS works (
      position INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, artist TEXT NOT NULL,
      description TEXT NOT NULL, media TEXT NOT NULL, mime TEXT NOT NULL,
      width INTEGER, height INTEGER
    ) STRICT
  `);

  const find = db.prepare('SELECT * FROM works WHERE id = ?');
  const lookup = (id) => {
    const row = find.get(id);
    if (!row) throw new HttpError(404, 'Dieses Kunstwerk wurde nicht gefunden.');
    return row;
  };
  const remove = async (path) => {
    for (let attempt = 0; ; attempt++) {
      try { await rm(path, { force: true }); return; }
      catch (error) {
        if (attempt < 3 && ['EBUSY', 'EPERM'].includes(error.code)) {
          await delay(25 * (attempt + 1));
          continue;
        }
        console.error('Datei konnte nicht entfernt werden:', error.message);
        return;
      }
    }
  };
  const removeMedia = async (filename) => {
    await Promise.all([
      remove(join(media, filename)),
      remove(join(media, filename + '.webp')),
      remove(join(media, filename + '.heic')),
    ]);
  };
  const upload = multer({
    dest: temporary,
    limits: { fileSize: 250 * MB, files: 1, fields: 3, fieldSize: 24_000, parts: 5 },
  }).single('media');

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.get('host') ?? '') ||
        req.get('sec-fetch-site') === 'cross-site' ||
        (req.get('origin') && req.get('origin') !== `http://${req.get('host')}`)) {
      return res.status(403).json({ error: 'Dieser Zugriff ist nur lokal möglich.' });
    }
    next();
  });
  app.get('/api/works', (_req, res) => {
    res.json(db.prepare('SELECT * FROM works ORDER BY position').all().map(artwork));
  });
  app.get('/api/works/:id', (req, res) => res.json(artwork(lookup(req.params.id))));
  app.get('/api/works/:id/:variant/:filename', (req, res, next) => {
    const row = lookup(req.params.id);
    const preview = req.params.variant === 'preview';
    if (req.params.filename !== row.media ||
        (preview ? !row.mime.startsWith('image/') : req.params.variant !== 'media')) {
      throw new HttpError(404, 'Die Mediendatei wurde nicht gefunden.');
    }
    res.type(preview ? 'image/webp' : row.mime);
    res.sendFile(row.media + (preview ? '.webp' : ''), { root: media }, (error) => {
      if (error && !res.headersSent) next(error.status === 404 ?
        new HttpError(404, 'Die Mediendatei wurde nicht gefunden.') : error);
    });
  });

  async function save(req, res) {
    let newName;
    let committed = false;
    try {
      const title = field(req.body, 'title', 160, true);
      const artist = field(req.body, 'artist', 160);
      const description = field(req.body, 'description', 4000);
      const id = req.params.id ?? randomUUID();
      if (!req.file && !req.params.id) throw new HttpError(400, 'Bitte wähle eine Mediendatei.');
      let newMedia;
      if (req.file) {
        const type = await identify(req.file.path);
        const [mime, extension] = formats[type];
        const isImage = mime.startsWith('image/');
        if (isImage && req.file.size > 25 * MB) throw new HttpError(413, 'Bilder dürfen höchstens 25 MB groß sein.');
        newName = randomUUID() + extension;
        let width = null;
        let height = null;
        const output = join(media, newName);
        if (isImage) {
          try {
            if (type === 'heic') await convertHeic(req.file.path, output, imagePixelLimit);
            const previewInput = await readFile(type === 'heic' ? output : req.file.path);
            const result = await sharp(previewInput, { limitInputPixels: imagePixelLimit })
              .autoOrient().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 83 }).toFile(join(media, newName + '.webp'));
            ({ width, height } = result);
          } catch (error) {
            if (['ENOSPC', 'EACCES', 'EPERM', 'EIO'].includes(error.code)) throw error;
            throw new HttpError(415, type === 'heic'
              ? 'Das HEIC-Bild konnte nicht gelesen werden oder hat zu viele Pixel.'
              : 'Das Bild konnte nicht gelesen werden oder hat zu viele Pixel.');
          }
        }
        if (req.aborted || res.destroyed) return;
        await rename(req.file.path, type === 'heic' ? output + '.heic' : output);
        newMedia = { media: newName, mime, width, height };
      }
      if (req.aborted || res.destroyed) return;
      const old = req.params.id ? lookup(id) : null;
      const { media: filename, mime, width, height } = newMedia ?? old;
      if (old) {
        db.prepare('UPDATE works SET title=?, artist=?, description=?, media=?, mime=?, width=?, height=? WHERE id=?')
          .run(title, artist, description, filename, mime, width, height, id);
      } else {
        db.prepare('INSERT INTO works (title, artist, description, media, mime, width, height, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(title, artist, description, filename, mime, width, height, id);
      }
      committed = true;
      const saved = artwork(lookup(id));
      if (old && newName) await removeMedia(old.media);
      res.status(old ? 200 : 201).json(saved);
    } finally {
      if (req.file) await remove(req.file.path);
      if (newName && !committed) await removeMedia(newName);
    }
  }

  app.post('/api/works', upload, save);
  app.patch('/api/works/:id', upload, save);
  app.delete('/api/works/:id', async (req, res) => {
    const row = lookup(req.params.id);
    db.prepare('DELETE FROM works WHERE id = ?').run(row.id);
    await removeMedia(row.media);
    res.status(204).end();
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Dieser Endpunkt wurde nicht gefunden.' }));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (res.destroyed) return;
    if (error instanceof multer.MulterError) {
      const size = error.code === 'LIMIT_FILE_SIZE';
      return res.status(size ? 413 : 400).json({
        error: size ? 'Videos dürfen höchstens 250 MB groß sein.' : 'Bitte übermittle genau eine Datei und gültige Angaben.',
      });
    }
    const status = error instanceof HttpError ? error.status : error.status === 416 ? 416 : 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'Der Vorgang konnte nicht abgeschlossen werden.' : error.message });
  });
  return { app, close: () => db.close() };
}
