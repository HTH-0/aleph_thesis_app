// 한 판(지도 하나, 소리 있음/없음 하나)을 3D로 실행하고, 끝나면 기록을 돌려준다.
// 이동·충돌·안개·일시정지 방식은 논문 시뮬레이터(sim/trial.js)를 따른다.

const TEST_MODE = new URLSearchParams(location.search).get("test") === "1";

let _renderer = null;
function getRenderer(canvas) {
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
  _renderer.setSize(window.innerWidth, window.innerHeight);
  return _renderer;
}

function hash01(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// 걷는 칸에 맞닿은 칸만 벽으로 그린다 (전체를 그리면 너무 무겁다)
function buildWalls(scene, map) {
  const n = map.n, cell = map.cell;
  const buildingCells = [], hedgeCells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (map.walk[i]) continue;
      let touches = false;
      for (let dr = -1; dr <= 1 && !touches; dr++) {
        for (let dc = -1; dc <= 1 && !touches; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < n && cc < n && map.walk[rr * n + cc]) touches = true;
        }
      }
      // 지도 가장자리도 막아 둔다
      if (!touches && (r === 0 || c === 0 || r === n - 1 || c === n - 1)) touches = true;
      if (!touches) continue;
      (map.kind[i] === 1 ? buildingCells : hedgeCells).push(i);
    }
  }
  // 지도 가장자리의 걷는 칸 바깥에도 벽이 필요하다: 이동 판정에서 지도 밖은 막힘으로 처리한다.

  const box = new THREE.BoxGeometry(cell, 1, cell);
  box.translate(0, 0.5, 0);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const bMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), buildingCells.length);
  buildingCells.forEach((i, k) => {
    const r = Math.floor(i / n), c = i % n;
    const h = 9 + Math.floor(hash01(Math.floor(r / 6) * 977 + Math.floor(c / 6)) * 4) * 3;
    dummy.position.set(c * cell + cell / 2, 0, r * cell + cell / 2);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    bMesh.setMatrixAt(k, dummy.matrix);
    const tone = 0.78 + hash01(i) * 0.08;
    color.setRGB(tone, tone * 0.97, tone * 0.92);
    bMesh.setColorAt(k, color);
  });
  scene.add(bMesh);

  const hMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), hedgeCells.length);
  hedgeCells.forEach((i, k) => {
    const r = Math.floor(i / n), c = i % n;
    dummy.position.set(c * cell + cell / 2, 0, r * cell + cell / 2);
    dummy.scale.set(1, 2.6, 1);
    dummy.updateMatrix();
    hMesh.setMatrixAt(k, dummy.matrix);
    const g = 0.42 + hash01(i * 7) * 0.08;
    color.setRGB(g * 0.75, g, g * 0.7);
    hMesh.setColorAt(k, color);
  });
  scene.add(hMesh);

  // 가로등: 벽에 맞닿은 걷는 칸 몇 곳에 세워서, 넓은 길에서도 움직이는 느낌이 나게 한다
  const lampCells = [];
  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      const i = r * n + c;
      if (!map.walk[i] || hash01(i * 3.1) > 0.06) continue;
      if (!map.walk[i - 1] || !map.walk[i + 1] || !map.walk[i - n] || !map.walk[i + n]) lampCells.push(i);
    }
  }
  const pole = new THREE.CylinderGeometry(0.12, 0.15, 5, 6);
  pole.translate(0, 2.5, 0);
  const head = new THREE.BoxGeometry(0.5, 0.25, 1.2);
  head.translate(0, 5, 0);
  const poleMesh = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0x4a4d52 }), lampCells.length);
  const headMesh = new THREE.InstancedMesh(head, new THREE.MeshLambertMaterial({ color: 0xf2e6b8 }), lampCells.length);
  lampCells.forEach((i, k) => {
    const r = Math.floor(i / n), c = i % n;
    dummy.position.set(c * cell + cell / 2, 0, r * cell + cell / 2);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.y = hash01(i) * Math.PI;
    dummy.updateMatrix();
    poleMesh.setMatrixAt(k, dummy.matrix);
    headMesh.setMatrixAt(k, dummy.matrix);
  });
  scene.add(poleMesh, headMesh);
}

// spec: { canvas, overlayEl, timerEl, hudEl, map, route, landmarks, soundscape, withSound }
function runRound(spec, onComplete) {
  const { canvas, overlayEl, timerEl, hudEl, map, route, landmarks, soundscape, withSound } = spec;
  const renderer = getRenderer(canvas);

  const scene = new THREE.Scene();
  const sky = 0xc9ced6;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f7a, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.45);
  sun.position.set(0.4, 1, 0.3);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

  // 바닥: 걷는 칸은 아스팔트, 길 가장자리는 보도블록 색으로 칠한 지도 텍스처
  const tex = document.createElement("canvas");
  tex.width = tex.height = map.n;
  const tctx = tex.getContext("2d");
  const img = tctx.createImageData(map.n, map.n);
  for (let i = 0; i < map.n * map.n; i++) {
    const r = Math.floor(i / map.n), c = i % map.n;
    let v = [110, 112, 108];
    if (map.walk[i]) {
      const edge = (c > 0 && !map.walk[i - 1]) || (c < map.n - 1 && !map.walk[i + 1]) ||
        (r > 0 && !map.walk[i - map.n]) || (r < map.n - 1 && !map.walk[i + map.n]);
      v = edge ? [176, 170, 160] : [128, 130, 134];
    }
    img.data.set([...v, 255], i * 4);
  }
  tctx.putImageData(img, 0, 0);
  const groundTex = new THREE.CanvasTexture(tex);
  groundTex.magFilter = THREE.NearestFilter;
  groundTex.minFilter = THREE.LinearFilter;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.size, map.size),
    new THREE.MeshLambertMaterial({ map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.size / 2, 0, map.size / 2);
  scene.add(ground);

  buildWalls(scene, map);

  // 목적지: 안개 안으로 들어와야 보이는 금색 기둥
  const goal = route.goalPos;
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 8, 16),
    new THREE.MeshBasicMaterial({ color: 0xffc94a })
  );
  pillar.position.set(goal.x, 4, goal.z);
  scene.add(pillar);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CONFIG.GOAL_RADIUS - 0.5, CONFIG.GOAL_RADIUS, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc94a, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(goal.x, 0.05, goal.z);
  scene.add(ring);

  camera.position.set(route.startPos.x, CONFIG.EYE_HEIGHT, route.startPos.z);
  // 처음에는 목적지 쪽이 아니라 걸을 수 있는 방향 중 하나를 보게 한다
  let yaw = 0, pitch = 0;
  {
    const dirs = [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]];
    const open = dirs.filter(([dx, dz]) => canStandAt(camera.position.x + dx * map.cell, camera.position.z + dz * map.cell));
    if (open.length) yaw = open[Math.floor(Math.random() * open.length)][2];
  }

  function isBlocked(x, z) {
    const c = Math.floor(x / map.cell), r = Math.floor(z / map.cell);
    if (r < 0 || c < 0 || r >= map.n || c >= map.n) return true;
    return !map.walk[r * map.n + c];
  }
  function canStandAt(x, z) {
    const rr = CONFIG.PLAYER_RADIUS;
    return !isBlocked(x - rr, z) && !isBlocked(x + rr, z) && !isBlocked(x, z - rr) && !isBlocked(x, z + rr);
  }

  const keys = {};
  const onKeyDown = (e) => {
    keys[e.code] = true;
    if (TEST_MODE && e.code === "KeyP" && started && !finished) finish("arrived");
  };
  const onKeyUp = (e) => { keys[e.code] = false; };
  const onMouseMove = (e) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * CONFIG.LOOK_SENSITIVITY;
    pitch -= e.movementY * CONFIG.LOOK_SENSITIVITY;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
  };
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousemove", onMouseMove);
  window.addEventListener("resize", onResize);

  let started = false, finished = false, paused = false;
  let startTime = 0, pauseStartedAt = 0, distance = 0;

  const msgEl = overlayEl.querySelector("[data-msg]");
  const giveUpBtn = overlayEl.querySelector("[data-giveup]");
  msgEl.textContent = "화면을 클릭하면 출발합니다";
  giveUpBtn.hidden = true;
  overlayEl.classList.remove("hidden");

  async function onOverlayClick(e) {
    if (e.target === giveUpBtn || finished) return;
    overlayEl.classList.add("hidden");
    try { canvas.requestPointerLock(); } catch (err) { /* 포인터 잠금이 안 돼도 키보드로는 움직일 수 있다 */ }
    if (!started) {
      started = true;
      if (withSound) {
        try { await soundscape.start(landmarks); } catch (err) { console.warn(err); }
      }
      startTime = performance.now();
    } else if (paused) {
      startTime += performance.now() - pauseStartedAt;
      paused = false;
    }
  }
  function onGiveUp(e) {
    e.stopPropagation();
    finish("gaveup");
  }
  overlayEl.addEventListener("click", onOverlayClick);
  giveUpBtn.addEventListener("click", onGiveUp);

  // Esc 등으로 포인터 잠금이 풀리면 멈추고, 이어하기·포기를 고르게 한다
  function onPointerLockChange() {
    if (document.pointerLockElement === canvas) return;
    if (started && !finished && !paused) {
      paused = true;
      pauseStartedAt = performance.now();
      msgEl.textContent = "잠시 멈췄습니다. 클릭하면 이어서 진행합니다";
      giveUpBtn.hidden = false;
      overlayEl.classList.remove("hidden");
    }
  }
  document.addEventListener("pointerlockchange", onPointerLockChange);

  let raf = null, lastT = performance.now();

  function cleanup() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("pointerlockchange", onPointerLockChange);
    overlayEl.removeEventListener("click", onOverlayClick);
    giveUpBtn.removeEventListener("click", onGiveUp);
    if (raf) cancelAnimationFrame(raf);
    soundscape.stopAll();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    overlayEl.classList.add("hidden");
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    groundTex.dispose();
  }

  function finish(outcome) {
    if (finished) return;
    finished = true;
    const endedAt = paused ? pauseStartedAt : performance.now();
    const elapsed = started ? (endedAt - startTime) / 1000 : 0;
    cleanup();
    onComplete({
      outcome, // "arrived" | "timeout" | "gaveup"
      elapsedSec: Number(Math.min(elapsed, CONFIG.ROUND_TIMEOUT_SEC).toFixed(1)),
      distance: Math.round(distance),
      shortestMeters: route.shortestMeters,
      withSound,
    });
  }

  function animate(now) {
    raf = requestAnimationFrame(animate);
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    pillar.rotation.y += dt;

    if (started && !finished && !paused) {
      const speed = keys.ShiftLeft || keys.ShiftRight ? CONFIG.RUN_SPEED : CONFIG.MOVE_SPEED;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = -fz, rz = fx; // 오른쪽 방향
      let dx = 0, dz = 0;
      if (keys.KeyW || keys.ArrowUp) { dx += fx; dz += fz; }
      if (keys.KeyS || keys.ArrowDown) { dx -= fx; dz -= fz; }
      if (keys.KeyA) { dx -= rx; dz -= rz; }
      if (keys.KeyD) { dx += rx; dz += rz; }
      if (keys.ArrowLeft) yaw += 1.8 * dt;
      if (keys.ArrowRight) yaw -= 1.8 * dt;
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        dx = (dx / len) * speed * dt;
        dz = (dz / len) * speed * dt;
        const cx = camera.position.x, cz = camera.position.z;
        let nx = cx, nz = cz;
        if (canStandAt(cx + dx, cz)) nx = cx + dx;
        if (canStandAt(nx, cz + dz)) nz = cz + dz;
        distance += Math.hypot(nx - cx, nz - cz);
        camera.position.x = nx;
        camera.position.z = nz;
      }
      if (withSound) soundscape.updateListener(camera);

      const elapsed = (now - startTime) / 1000;
      const left = Math.max(0, CONFIG.ROUND_TIMEOUT_SEC - elapsed);
      timerEl.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;

      if (hudEl && TEST_MODE) {
        const lines = withSound
          ? landmarks.map((l) => {
              const d = Math.hypot(camera.position.x - l.x, camera.position.z - l.z);
              return `${SOUND_TYPES[l.type].label}: ${d.toFixed(0)}m / 음량 ${(linearGain(d) * 100).toFixed(0)}%`;
            })
          : ["(소리 없음)"];
        const dg = Math.hypot(camera.position.x - goal.x, camera.position.z - goal.z);
        hudEl.textContent = [...lines, `목적지까지 직선 ${dg.toFixed(0)}m`, "P: 즉시 도착"].join("\n");
      }

      if (Math.hypot(camera.position.x - goal.x, camera.position.z - goal.z) < CONFIG.GOAL_RADIUS) {
        finish("arrived");
        return;
      }
      if (elapsed > CONFIG.ROUND_TIMEOUT_SEC) {
        finish("timeout");
        return;
      }
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(animate);
}
