import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { createGallery } from '../server/app.mjs';

async function start(directory) {
  const gallery = await createGallery(directory);
  const server = gallery.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    origin,
    request: (path, options) => fetch(origin + '/api/works' + path, options),
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      gallery.close();
    },
  };
}

function form(title, bytes, filename, mime) {
  const body = new FormData();
  body.set('title', title);
  body.set('artist', 'Testatelier');
  body.set('description', 'Ein Werk für die API-Prüfung.');
  if (bytes) body.set('media', new Blob([bytes], { type: mime }), filename);
  return body;
}

const png = await sharp({
  create: { width: 800, height: 400, channels: 3, background: '#8a674a' },
}).png().toBuffer();

// Container header for transport and byte-range assertions; no encoded video track.
const mp4Header = Buffer.from('000000186674797069736f6d0000020069736f6d6d703431', 'hex');

test('Werkverwaltung, Vorschau, Medienersatz, Range und Persistenz', async () => {
  await withGallery(async (gallery, directory, restart) => {
    const uploaded = await gallery.request('', { method: 'POST', body: form('Brauntöne', png, 'kunst.png', 'image/png') });
    assert.equal(uploaded.status, 201);
    const work = await uploaded.json();
    assert.equal(work.kind, 'image');
    assert.deepEqual([work.width, work.height], [640, 320]);
    const original = await fetch(gallery.origin + work.mediaUrl);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
    const preview = await fetch(gallery.origin + work.previewUrl);
    assert.equal(preview.headers.get('content-type'), 'image/webp');
    assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width, 640);

    gallery = await restart();
    assert.deepEqual(await (await gallery.request('')).json(), [work]);
    const edit = await gallery.request('/' + work.id, { method: 'PATCH', body: form('Neuer Titel') });
    const edited = await edit.json();
    assert.equal(edited.title, 'Neuer Titel');
    assert.equal(edited.mediaUrl, work.mediaUrl);

    const replacement = await gallery.request('/' + work.id, {
      method: 'PATCH', body: form('Film', mp4Header, 'kunst.mp4', 'video/mp4'),
    });
    assert.equal(replacement.status, 200);
    const video = await replacement.json();
    assert.equal(video.kind, 'video');
    assert.equal(video.previewUrl, null);
    assert.equal((await fetch(gallery.origin + work.mediaUrl)).status, 404);
    const range = await fetch(gallery.origin + video.mediaUrl, { headers: { Range: 'bytes=4-7' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 4-7/24');
    assert.equal(await range.text(), 'ftyp');
    const invalidRange = await fetch(gallery.origin + video.mediaUrl, { headers: { Range: 'bytes=99-100' } });
    assert.equal(invalidRange.status, 416);
    await invalidRange.text();

    const files = await readdir(join(directory, 'media'));
    assert.deepEqual(files, [basename(video.mediaUrl)]);
    const deletion = await gallery.request('/' + work.id, { method: 'DELETE' });
    assert.equal(deletion.status, 204);
    assert.deepEqual(await (await gallery.request('')).json(), []);
    assert.deepEqual(await readdir(join(directory, 'media')), []);
  });
});

test('Fehlerhafte und abgebrochene Uploads hinterlassen kein Werk', async () => {
  await withGallery(async (gallery, directory) => {
    const bad = await gallery.request('', { method: 'POST', body: form('Falsch', Buffer.from('kein Bild'), 'fake.png', 'image/png') });
    assert.equal(bad.status, 415);
    assert.match((await bad.json()).error, /JPEG/);
    const oversized = Buffer.concat([png, Buffer.alloc(25_000_001 - png.length)]);
    const large = await gallery.request('', { method: 'POST', body: form('Zu groß', oversized, 'gross.png', 'image/png') });
    assert.equal(large.status, 413);
    assert.match((await large.json()).error, /25 MB/);

    const partial = httpRequest(gallery.origin + '/api/works', {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=gallery-test' },
    });
    partial.on('error', () => {});
    const closed = once(partial, 'close').catch(() => {});
    partial.write('--gallery-test\r\nContent-Disposition: form-data; name="media"; filename="partial.png"\r\nContent-Type: image/png\r\n\r\n');
    partial.write(Buffer.alloc(64_000));
    await eventually(async () => assert.equal((await readdir(join(directory, 'uploads'))).length, 1));
    partial.destroy();
    await closed;
    await eventually(async () => assert.deepEqual(await readdir(join(directory, 'uploads')), []));
    assert.deepEqual(await (await gallery.request('')).json(), []);
    assert.deepEqual(await readdir(join(directory, 'media')), []);
  });
});

test('Neun Werke behalten ihre Reihenfolge; fehlendes Medium liefert 404', async () => {
  await withGallery(async (gallery, directory) => {
    const titles = Array.from({ length: 9 }, (_, index) => 'Werk ' + (index + 1));
    for (const title of titles) {
      const response = await gallery.request('', { method: 'POST', body: form(title, png, 'kunst.png', 'image/png') });
      assert.equal(response.status, 201);
      await response.json();
    }
    const works = await (await gallery.request('')).json();
    assert.deepEqual(works.map((work) => work.title), titles);
    await rm(join(directory, 'media', basename(works[0].mediaUrl)));
    const missing = await fetch(gallery.origin + works[0].mediaUrl);
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /nicht gefunden/);
  });
});

async function eventually(assertion) {
  for (let attempt = 0; ; attempt++) {
    try { await assertion(); return; }
    catch (error) {
      if (attempt >= 40) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function withGallery(run) {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'lichthof-test-'));
  let gallery;
  const restart = async () => {
    if (gallery) await gallery.close();
    gallery = await start(directory);
    return gallery;
  };
  try { await run(await restart(), directory, restart); }
  finally {
    if (gallery) await gallery.close();
    if (resolve(directory).startsWith(join(parent, 'lichthof-test-')) && resolve(directory) !== parent + sep) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
