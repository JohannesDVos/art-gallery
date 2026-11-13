import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { worksPerRoom, type Work } from './works';

const movement = new Map([
  ['KeyW', 'forward'], ['ArrowUp', 'forward'], ['KeyS', 'back'], ['ArrowDown', 'back'],
  ['KeyA', 'left'], ['ArrowLeft', 'left'], ['KeyD', 'right'], ['ArrowRight', 'right'],
]);

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function timber() {
  return canvasTexture(1024, 1024, (ctx) => {
    for (let row = 0; row < 22; row++) {
      const y = row * 48;
      for (let column = -1; column < 4; column++) {
        const x = column * 320 + (row * 127) % 320;
        const tone = (row * 31 + (column + 1) * 13) % 20;
        ctx.fillStyle = `rgb(${181 + tone}, ${143 + tone}, ${108 + tone})`;
        ctx.fillRect(x, y, 320, 48);
        ctx.strokeStyle = '#6d4b392e';
        ctx.strokeRect(x + .5, y + .5, 320, 48);
        for (let i = 0; i < 13; i++) {
          ctx.strokeStyle = i % 2 ? '#80543518' : '#fbe3be33';
          ctx.beginPath();
          ctx.moveTo(x + 3, y + 3 + i * 3);
          ctx.bezierCurveTo(x + 60, y + i * 3, x + 180, y + i * 3 + 9, x + 317, y + i * 3 + 3);
          ctx.stroke();
        }
      }
    }
  });
}

function roomWall() {
  return canvasTexture(1024, 384, (ctx) => {
    const base = ctx.createLinearGradient(0, 0, 0, 384);
    base.addColorStop(0, '#dbd4c7');
    base.addColorStop(.48, '#eee9df');
    base.addColorStop(1, '#cdc5b7');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1024, 384);
    for (const x of [180, 512, 844]) {
      const light = ctx.createRadialGradient(x, 145, 3, x, 145, 175);
      light.addColorStop(0, '#fffaf0');
      light.addColorStop(1, '#fffaf000');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, 1024, 384);
    }
  });
}

interface Props {
  works: Work[];
  room: number;
  paused: boolean;
  openWork: (work: Work) => void;
  fallback: () => void;
}

export default function Room({ works, room, paused, openWork, fallback }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sceneApi = useRef<{ enter: () => void; stop: () => void; reset: () => void } | null>(null);
  const touchMovement = useRef(new Set<string>());
  const [active, setActive] = useState(false);
  const [locked, setLocked] = useState(false);
  const [hint, setHint] = useState('');
  const [touch, setTouch] = useState(() => matchMedia('(pointer: coarse)').matches);
  const handlers = useRef({ openWork, fallback, paused });
  useEffect(() => {
    handlers.current = { openWork, fallback, paused };
    if (paused) sceneApi.current?.stop();
  }, [openWork, fallback, paused]);

  useEffect(() => {
    const mount = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      handlers.current.fallback();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    mount.append(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e2dbd0');
    const camera = new THREE.PerspectiveCamera(62, 1, .06, 38);
    camera.rotation.order = 'YXZ';
    const reset = () => {
      camera.position.set(.65, 1.68, 4.4);
      camera.rotation.set(.025, -.11, 0);
    };
    reset();

    const material = (color: string, map?: THREE.Texture) => new THREE.MeshBasicMaterial({ color, map });
    const box = (parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const wood = timber();
    wood.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), material('#ffffff', wood));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    box(scene, 14.2, .15, 12.2, material('#e1dbcf'), 0, 4.3, 0);
    const walls = material('#ffffff', roomWall());
    const trim = material('#b6aa98');
    const tracks = material('#a29b8d');
    const lamps = material('#fff9e9');
    for (const [x, z, angle, width] of [[0, -6, 0, 14], [-7, 0, Math.PI / 2, 12], [7, 0, -Math.PI / 2, 12], [0, 6, Math.PI, 14]]) {
      const wall = new THREE.Group();
      wall.position.set(x, 0, z);
      wall.rotation.y = angle;
      scene.add(wall);
      box(wall, width + .08, 4.25, .1, walls, 0, 2.125, -.05);
      box(wall, width, .095, .075, trim, 0, .05, .03);
      box(wall, width * .76, .025, .045, tracks, 0, 4.16, 1.3);
      for (const lightX of [-3.55, 0, 3.55]) {
        box(wall, .23, .11, .22, lamps, lightX, 4.09, 1.3);
      }
    }
    const bench = new THREE.Group();
    scene.add(bench);
    box(bench, 2.2, .15, .63, material('#9c7255'), 0, .54, -.4);
    for (const x of [-.79, .79]) box(bench, .12, .48, .49, material('#6c574a'), x, .24, -.4);
    const targets: THREE.Object3D[] = [];
    const extraTextures = new Set<THREE.Texture>();
    const frame = material('#524436');
    const matte = material('#f7f2e8');
    const shadow = material('#a79e8e');
    const loader = new THREE.TextureLoader();
    let disposed = false;
    const slots = [
      [-4.15, -5.94, 0], [0, -5.94, 0], [4.15, -5.94, 0],
      [-6.94, -2.4, Math.PI / 2], [6.94, -2.4, -Math.PI / 2],
      [-6.94, 2, Math.PI / 2], [6.94, 2, -Math.PI / 2], [0, 5.94, Math.PI],
    ];
    works.slice(room * worksPerRoom, (room + 1) * worksPerRoom).forEach((work, index) => {
      const [x, z, angle] = slots[index];
      const group = new THREE.Group();
      group.position.set(x, 1.91, z);
      group.rotation.y = angle;
      group.userData.work = work;
      scene.add(group);
      targets.push(group);
      const aspect = work.width && work.height ? work.width / work.height : 1.54;
      const width = Math.min(2.68, 1.83 * aspect);
      const height = width / aspect;
      box(group, width + .24, height + .23, .025, shadow, .043, -.045, .005);
      box(group, width + .21, height + .21, .08, frame, 0, 0, .042);
      box(group, width + .14, height + .14, .02, matte, 0, 0, .09);
      const cover = canvasTexture(512, 320, (ctx) => {
        ctx.fillStyle = '#364a42';
        ctx.fillRect(0, 0, 512, 320);
        ctx.fillStyle = '#f7f2e8';
        ctx.textAlign = 'center';
        ctx.font = '48px Georgia';
        ctx.fillText(work.kind === 'video' ? '▶' : '—', 256, 157);
        ctx.font = '19px sans-serif';
        ctx.fillText(work.kind === 'video' ? 'VIDEO' : 'BILD', 256, 205);
      });
      extraTextures.add(cover);
      const surface = material('#ffffff', cover);
      box(group, width, height, .01, surface, 0, 0, .109);
      if (work.previewUrl) {
        const texture = loader.load(work.previewUrl, (loaded) => {
          if (disposed) { loaded.dispose(); return; }
          loaded.colorSpace = THREE.SRGBColorSpace;
          surface.map = loaded;
          surface.needsUpdate = true;
        }, undefined, () => {});
        extraTextures.add(texture);
      }
      const label = canvasTexture(512, 134, (ctx) => {
        ctx.fillStyle = '#f9f5ea';
        ctx.fillRect(0, 0, 512, 134);
        ctx.fillStyle = '#29352c';
        ctx.font = '30px Georgia';
        ctx.fillText(work.title, 18, 56, 476);
        ctx.font = '21px sans-serif';
        ctx.fillText(work.artist || (work.kind === 'video' ? 'Video' : 'Bild'), 18, 100, 476);
      });
      extraTextures.add(label);
      box(group, .84, .22, .01, material('#ffffff', label), 0, -height / 2 - .28, .044);
    });

    const pressed = new Set<string>();
    const mouse = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    let engaged = false;
    let frameId = 0;
    let last = performance.now();
    let gesture: { id: number; x: number; y: number; distance: number } | null = null;
    const touchKeys = touchMovement.current;
    function stop() {
      engaged = false;
      gesture = null;
      pressed.clear();
      touchKeys.clear();
      setActive(false);
      setLocked(false);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }
    function enter() {
      if (handlers.current.paused) return;
      engaged = true;
      setActive(true);
      if (!matchMedia('(pointer: coarse)').matches && canvas.requestPointerLock) {
        try { void canvas.requestPointerLock()?.catch(() => {}); } catch { /* Drag remains available. */ }
      }
    }
    sceneApi.current = { enter, stop, reset };
    function look(dx: number, dy: number) {
      camera.rotation.y -= dx * .0027;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dy * .0027, -1.22, 1.22);
    }
    function aimedWork(x: number, y: number) {
      camera.updateMatrixWorld();
      mouse.set(x, y);
      ray.setFromCamera(mouse, camera);
      return ray.intersectObjects(targets, true)[0]?.object.parent?.userData.work as Work | undefined;
    }
    function pick(x: number, y: number) {
      if (handlers.current.paused) return;
      const hit = aimedWork(x, y);
      if (hit) {
        stop();
        handlers.current.openWork(hit);
      }
    }
    const keys = (event: KeyboardEvent) => {
      if (event.type === 'keyup') { pressed.delete(event.code); return; }
      if (!engaged || handlers.current.paused) return;
      if (event.code === 'Escape') stop();
      if (event.code === 'Enter' && document.pointerLockElement === canvas) { event.preventDefault(); pick(0, 0); }
      if (movement.has(event.code)) {
        event.preventDefault();
        pressed.add(event.code);
      }
    };
    let wasLocked = false;
    const lockChange = () => {
      const locked = document.pointerLockElement === canvas;
      if (locked && (!engaged || handlers.current.paused)) {
        document.exitPointerLock();
        return;
      }
      setLocked(locked);
      if (wasLocked && !locked) stop();
      wasLocked = locked;
    };
    const move = (event: MouseEvent) => {
      if (engaged && document.pointerLockElement === canvas) look(event.movementX, event.movementY);
    };
    const lockedPress = (event: MouseEvent) => {
      if (event.button !== 0 || !engaged || document.pointerLockElement !== canvas) return;
      event.preventDefault();
      pick(0, 0);
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || handlers.current.paused || document.pointerLockElement === canvas) return;
      if (event.pointerType === 'touch') setTouch(true);
      canvas.setPointerCapture(event.pointerId);
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    };
    const drag = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId || document.pointerLockElement === canvas) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      gesture = { id: gesture.id, x: event.clientX, y: event.clientY, distance: gesture.distance + Math.hypot(dx, dy) };
      if (engaged) look(dx, dy);
    };
    const up = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const tap = event.type === 'pointerup' && gesture.distance < 7 &&
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 7;
      gesture = null;
      if (!tap || document.pointerLockElement === canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * 2 - 1;
      const y = 1 - (event.clientY - rect.top) / rect.height * 2;
      if (Math.abs(x) <= 1 && Math.abs(y) <= 1) pick(x, y);
    };
    const resize = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = mount;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight, false);
    });
    const contextLost = (event: Event) => {
      event.preventDefault();
      stop();
      handlers.current.fallback();
    };
    resize.observe(mount);
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    window.addEventListener('blur', stop);
    document.addEventListener('pointerlockchange', lockChange);
    document.addEventListener('mousemove', move);
    document.addEventListener('mousedown', lockedPress);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', drag);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('webglcontextlost', contextLost);
    setHint('');
    let targetTitle = '';
    function animate(now: number) {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min((now - last) / 1000, .05);
      last = now;
      if (engaged && !handlers.current.paused) {
        const directions = new Set([...touchKeys, ...Array.from(pressed, (key) => movement.get(key))]);
        const forward = Number(directions.has('forward')) - Number(directions.has('back'));
        const right = Number(directions.has('right')) - Number(directions.has('left'));
        const yaw = camera.rotation.y;
        const speed = dt * 3.45 / Math.max(1, Math.hypot(forward, right));
        const x = THREE.MathUtils.clamp(camera.position.x + (right * Math.cos(yaw) - forward * Math.sin(yaw)) * speed, -6.64, 6.64);
        const z = THREE.MathUtils.clamp(camera.position.z - (forward * Math.cos(yaw) + right * Math.sin(yaw)) * speed, -5.64, 5.64);
        const blocked = (px: number, pz: number) => Math.abs(px) < 1.36 && Math.abs(pz + .4) < .57;
        if (!blocked(x, camera.position.z)) camera.position.x = x;
        if (!blocked(camera.position.x, z)) camera.position.z = z;
      }
      renderer.render(scene, camera);
      const title = document.pointerLockElement === canvas ? aimedWork(0, 0)?.title ?? '' : '';
      if (title !== targetTitle) {
        targetTitle = title;
        setHint(title);
      }
    }
    frameId = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      stop();
      sceneApi.current = null;
      cancelAnimationFrame(frameId);
      resize.disconnect();
      window.removeEventListener('keydown', keys);
      window.removeEventListener('keyup', keys);
      window.removeEventListener('blur', stop);
      document.removeEventListener('pointerlockchange', lockChange);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mousedown', lockedPress);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', drag);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('webglcontextlost', contextLost);
      const materials = new Set<THREE.MeshBasicMaterial>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          materials.add(object.material);
        }
      });
      for (const mat of materials) { mat.map?.dispose(); mat.dispose(); }
      for (const texture of extraTextures) texture.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [works, room]);

  return <div className="room">
    <div ref={host} className="room-canvas" aria-label="Begehbarer Ausstellungsraum" />
    {locked && <div className="aim" aria-hidden="true"><span />{hint && <strong>{hint} öffnen</strong>}</div>}
    <div className="room-toolbar">
      {active
        ? <button className="room-button" onClick={() => sceneApi.current?.stop()}>Rundgang beenden</button>
        : <button className="room-button" onClick={() => sceneApi.current?.enter()}>Raum betreten <span aria-hidden="true">↗</span></button>}
      <button className="room-button reset" aria-label="Ansicht zurücksetzen" onClick={() => sceneApi.current?.reset()}>↺</button>
    </div>
    {active && touch && <div className="touch-pad" aria-label="Bewegung">
      {([['forward', '↑', 'Vorwärts'], ['left', '←', 'Links'], ['back', '↓', 'Rückwärts'], ['right', '→', 'Rechts']] as const)
        .map(([direction, symbol, label]) => <button key={direction} className={direction} aria-label={label}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); touchMovement.current.add(direction); }}
          onLostPointerCapture={() => touchMovement.current.delete(direction)}
          onKeyDown={() => touchMovement.current.add(direction)}
          onKeyUp={() => touchMovement.current.delete(direction)}
          onBlur={() => touchMovement.current.delete(direction)}>{symbol}</button>)}
    </div>}
  </div>;
}
