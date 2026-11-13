import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorText, request, worksPerRoom, type Work } from './works';
import './style.css';

const Room = lazy(() => import('./Room'));
const accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.webm';
const isHeic = (file: File) => /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type);
const mediaType = (file: File) => {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (isHeic(file)) return 'image';
  if (extension && ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'image';
  if (extension && ['mp4', 'webm'].includes(extension)) return 'video';
  return '';
};

function Icon({ name }: { name: 'arch' | 'grid' | 'plus' | 'image' | 'film' | 'upload' }) {
  const paths = {
    arch: 'M5 20V11a7 7 0 0 1 14 0v9M9 20v-9a3 3 0 0 1 6 0v9M3 20h18',
    grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
    plus: 'M12 5v14M5 12h14',
    image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M16 9h.01',
    film: 'M4 5h16v14H4z M10 9l5 3-5 3z',
    upload: 'M12 16V4m-4 4 4-4 4 4M5 16v4h14v-4',
  };
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

function Modal({ title, close, children, wide = false, busy = false }: {
  title: string; close: () => void; children: ReactNode; wide?: boolean; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.showModal();
    return () => { node.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className={wide ? 'dialog wide' : 'dialog'} aria-labelledby="dialog-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <header className="dialog-header">
      <h2 id="dialog-title">{title}</h2>
      <button className="icon-button" aria-label="Schließen" disabled={busy} onClick={close}>×</button>
    </header>
    {children}
  </dialog>;
}

function Preview({ work }: { work: Work }) {
  const [failed, setFailed] = useState(false);
  return work.previewUrl && !failed
    ? <img src={work.previewUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <div className="media-symbol"><Icon name={work.kind === 'video' ? 'film' : 'image'} /><span>{work.kind === 'video' ? 'Video' : 'Vorschau nicht verfügbar'}</span></div>;
}

function Editor({ work, close, saved }: { work?: Work; close: () => void; saved: (work: Work) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    if (!file || isHeic(file)) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function select(files: FileList | null) {
    if (!files?.length || busy) return;
    const candidate = files[0];
    const kind = mediaType(candidate);
    const limit = kind === 'image' ? 25 : 250;
    setPreviewError(false);
    if (files.length !== 1 || !kind || !candidate.size || candidate.size > limit * 1_000_000) {
      setFile(null);
      setError(files.length !== 1 ? 'Bitte wähle genau eine Datei.' : !kind || !candidate.size
        ? 'Bitte wähle eine JPEG-, PNG-, WebP-, HEIC-, MP4- oder WebM-Datei.'
        : `Die Datei darf höchstens ${limit} MB groß sein.`);
      return;
    }
    setFile(candidate);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (previewError || (!file && !work)) { setError('Bitte wähle eine Datei, die dein Browser öffnen kann.'); return; }
    const body = new FormData(event.currentTarget);
    if (file) body.set('media', file);
    setBusy(true);
    setError('');
    try {
      saved(await request<Work>(work ? '/' + work.id : '', { method: work ? 'PATCH' : 'POST', body }));
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  }

  return <Modal title={work ? 'Kunstwerk bearbeiten' : 'Kunstwerk hinzufügen'} close={close} busy={busy}>
    <form onSubmit={submit} className="editor">
      <fieldset disabled={busy}>
        <label className={dragging ? 'dropzone dragging' : 'dropzone'}
          onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); select(event.dataTransfer.files); }}>
          <input type="file" accept={accept} aria-label={work ? 'Medium ersetzen' : 'Mediendatei auswählen'}
            onChange={(event) => { select(event.currentTarget.files); event.currentTarget.value = ''; }} />
          <Icon name="upload" />
          <strong>{file?.name ?? (work ? 'Medium ersetzen' : 'Datei auswählen oder hier ablegen')}</strong>
          <small>JPEG, PNG, WebP, HEIC bis 25 MB · MP4, WebM bis 250 MB</small>
        </label>
        {file && isHeic(file) && <p>Die Vorschau für HEIC wird beim Speichern erstellt.</p>}
        {file && !isHeic(file) && preview && <div className="upload-preview">
          {mediaType(file) === 'image'
            ? <img key={preview} src={preview} alt="Vorschau der ausgewählten Datei" onError={() => setPreviewError(true)} />
            : <video key={preview} src={preview} muted playsInline preload="metadata" onError={() => setPreviewError(true)} />}
        </div>}
        <label>Titel <input autoFocus name="title" required maxLength={160} defaultValue={work?.title} /></label>
        <label>Künstler / Künstlerin <span className="optional">optional</span><input name="artist" maxLength={160} defaultValue={work?.artist} /></label>
        <label>Beschreibung <span className="optional">optional</span><textarea name="description" rows={3} maxLength={4000} defaultValue={work?.description} /></label>
      </fieldset>
      {previewError && <p className="error" role="alert">Diese Datei kann im Browser nicht geöffnet werden.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Abbrechen</button>
        <button className="primary" disabled={busy || previewError}>{busy ? 'Wird gespeichert …' : work ? 'Speichern' : 'Werk hinzufügen'}</button>
      </div>
    </form>
  </Modal>;
}

function Detail({ work, close, edit, deleted }: { work: Work; close: () => void; edit: () => void; deleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState(false);
  async function remove() {
    setBusy(true);
    setError('');
    try { await request('/' + work.id, { method: 'DELETE' }); deleted(); }
    catch (cause) { setError(errorText(cause)); setBusy(false); }
  }
  return <Modal title={work.title} close={close} wide busy={busy}>
    <div className="detail-media">
      {mediaError ? <p role="alert">Das Medium fehlt oder kann in diesem Browser nicht geöffnet werden.</p> : work.kind === 'image'
        ? <img src={work.mediaUrl} alt={work.title} onError={() => setMediaError(true)} />
        : <video src={work.mediaUrl} controls playsInline preload="metadata" aria-label={work.title} onError={() => setMediaError(true)} />}
    </div>
    {work.artist && <p className="detail-artist">{work.artist}</p>}
    {work.description && <p className="description">{work.description}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {confirm ? <div className="delete-confirm">
      <p>„{work.title}“ dauerhaft aus der Sammlung löschen?</p>
      <div className="actions">
        <button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>Behalten</button>
        <button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Wird gelöscht …' : 'Endgültig löschen'}</button>
      </div>
    </div> : <div className="actions">
      <button className="text-button" onClick={() => setConfirm(true)}>Löschen</button>
      <button className="secondary" onClick={edit}>Bearbeiten</button>
    </div>}
  </Modal>;
}

type Panel = { kind: 'add' } | { kind: 'detail' | 'edit'; work: Work } | null;

function App() {
  const [works, setWorks] = useState<Work[]>([]);
  const [view, setView] = useState<'room' | 'grid'>('room');
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [coarse, setCoarse] = useState(() => matchMedia('(pointer: coarse)').matches);
  const pages = Math.max(1, Math.ceil(works.length / worksPerRoom));
  const room = Math.min(page, pages - 1);
  const fallback = useCallback(() => { setUnavailable(true); setView('grid'); }, []);
  const openWork = useCallback((work: Work) => setPanel({ kind: 'detail', work }), []);
  const add = () => setPanel({ kind: 'add' });
  const close = () => setPanel(null);
  const refresh = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    try { setWorks(await request<Work[]>()); }
    catch (cause) { setLoadError(errorText(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const query = matchMedia('(pointer: coarse)');
    const change = () => setCoarse(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  function saved(work: Work) {
    const index = works.findIndex((existing) => existing.id === work.id);
    if (index < 0) {
      setWorks([...works, work]);
      setPage(Math.floor(works.length / worksPerRoom));
    } else setWorks(works.map((existing) => existing.id === work.id ? work : existing));
    setNotice(index < 0 ? 'Kunstwerk hinzugefügt.' : 'Änderungen gespeichert.');
    close();
  }
  function deleted(work: Work) {
    const remaining = works.filter((existing) => existing.id !== work.id);
    setWorks(remaining);
    setPage(Math.min(room, Math.max(0, Math.ceil(remaining.length / worksPerRoom) - 1)));
    setNotice('Kunstwerk gelöscht.');
    close();
  }

  return <>
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand"><img src="/mark.svg" alt="" /><div><strong>Lichthof</strong><small>PRIVATE KUNSTGALERIE</small></div></div>
        <button className="primary" onClick={add} disabled={loading || !!loadError}><Icon name="plus" /> Kunstwerk hinzufügen</button>
      </div>
    </header>
    <main>
      <section className="intro">
        <h1>Die Galerie<span>.</span></h1>
        <div className="view-toggle" aria-label="Ansicht">
          <button disabled={unavailable} aria-pressed={view === 'room'} onClick={() => setView('room')}><Icon name="arch" /> Rundgang</button>
          <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Icon name="grid" /> Alle Werke</button>
        </div>
      </section>
      {loadError && <div className="load-error"><p role="alert">{loadError}</p><button className="secondary" onClick={() => void refresh()}>Erneut versuchen</button></div>}
      {view === 'room' && <section aria-label="Virtueller Rundgang" className="room-section">
        <Suspense fallback={<div className="room room-loading" role="status">Ausstellungsraum wird geladen …</div>}>
          <Room works={works} room={room} paused={panel !== null} openWork={openWork} fallback={fallback} />
        </Suspense>
        <div className="room-info">
          <div className="room-status"><strong>Ausstellungsraum {String(room + 1).padStart(2, '0')}</strong>
            <span>{coarse ? 'Wischen zum Umschauen · Tippen zum Öffnen' : 'WASD / Pfeiltasten zum Gehen · Im Rundgang auf ein Werk zielen und klicken · Esc zum Verlassen'}</span></div>
          {pages > 1 && <nav className="paging" aria-label="Ausstellungsräume">
            <button className="icon-button" aria-label="Vorheriger Raum" disabled={room === 0} onClick={() => setPage(room - 1)}>←</button>
            <span aria-live="polite">{room + 1} / {pages}</span>
            <button className="icon-button" aria-label="Nächster Raum" disabled={room + 1 === pages} onClick={() => setPage(room + 1)}>→</button>
          </nav>}
        </div>
      </section>}
      {view === 'grid' && <section aria-label="Alle Werke">
        {unavailable && <p className="fallback-note">Der 3D-Rundgang ist in diesem Browser nicht verfügbar. Hier findest du alle Werke.</p>}
        <p className="collection-count">{works.length} {works.length === 1 ? 'Werk' : 'Werke'}</p>
        <div className="grid">
          {works.map((work) => <button className="work-card" key={work.id} onClick={() => openWork(work)}>
            <div className="card-preview"><Preview key={work.previewUrl ?? work.id} work={work} /></div>
            <div className="card-caption"><div><strong>{work.title}</strong><span>{work.artist || (work.kind === 'video' ? 'Video' : 'Bild')}</span></div><span aria-hidden="true">↗</span></div>
          </button>)}
        </div>
      </section>}
      {!works.length && !loading && !loadError && <section className="empty">
        <div className="empty-icon"><Icon name="image" /></div>
        <div><h2>Platz für dein erstes Werk</h2><p>Füge ein Bild oder Video hinzu. Es bekommt automatisch einen Platz im Raum.</p></div>
        <button className="secondary" onClick={add}>Erstes Werk hinzufügen <span aria-hidden="true">↗</span></button>
      </section>}
    </main>
    <div className="notice" role="status">{notice && <span>{notice}</span>}</div>
    {panel?.kind === 'add' && <Editor close={close} saved={saved} />}
    {panel?.kind === 'edit' && <Editor key={panel.work.id} work={panel.work} close={() => openWork(panel.work)} saved={saved} />}
    {panel?.kind === 'detail' && <Detail key={panel.work.id} work={panel.work} close={close}
      edit={() => setPanel({ kind: 'edit', work: panel.work })} deleted={() => deleted(panel.work)} />}
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
