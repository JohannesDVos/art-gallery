import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createGallery } from './app.mjs';

const development = process.argv.includes('--dev');
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const data = fileURLToPath(new URL('../data/', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ungültiger PORT.');

if (!development) {
  try { await access(new URL('../dist/index.html', import.meta.url)); }
  catch { console.error('Bitte zuerst npm.cmd run build ausführen.'); process.exit(1); }
}
const gallery = await createGallery(data);
if (development) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    server: {
      middlewareMode: true,
      hmr: false,
      fs: {
        allow: [root],
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/server/**', '**/test/**'],
      },
    },
  });
  gallery.app.use(vite.middlewares);
} else {
  gallery.app.use(express.static(dist));
}
const server = gallery.app.listen(port, '127.0.0.1', () => {
  console.log(`Lichthof: http://127.0.0.1:${port}`);
});
server.on('error', (error) => {
  gallery.close();
  console.error(error.code === 'EADDRINUSE' ? 'Der Port wird bereits verwendet.' : error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => {
    gallery.close();
    process.exit(0);
  }));
}
