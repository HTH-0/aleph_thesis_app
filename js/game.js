// 한 판(지도 하나, 소리 있음/없음 하나)을 3D로 실행하고, 끝나면 기록을 돌려준다.
// 이동·충돌·안개·일시정지 방식은 논문 시뮬레이터(sim/trial.js)를 따른다.

const TEST_MODE = new URLSearchParams(location.search).get("test") === "1";

let _renderer = null;
function getRenderer(canvas) {
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  }
  _renderer.setSize(window.innerWidth, window.innerHeight);
  return _renderer;
}

// spec: { canvas, overlayEl, timerEl, hudEl, map, route, landmarks, soundscape, withSound }
function runRound(spec, onComplete) {
  const { canvas, overlayEl, timerEl, hudEl, map, route, landmarks, soundscape, withSound } = spec;
  const renderer = getRenderer(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.2, CONFIG.FOG_FAR + 400);
  const updateSky = SCENERY.atmosphere(scene, renderer, camera);
  const scenery = SCENERY.build(scene, renderer, map, [route.startPos, route.goalPos]);
  const traffic = TRAFFIC.create(scene, map, scenery);

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

  // 칸 판정: "." 걷는 칸과 "#" 건물 칸은 통과하고(건물은 실제 벽 모양으로 따로 막는다), 큰 차도와 그 밖의 땅은 막는다
  function isBlocked(x, z) {
    const e = scenery.edgeBand; // 지도 가장자리 가림막 앞까지만 갈 수 있다
    if (x < e || z < e || x > map.size - e || z > map.size - e) return true;
    const c = Math.floor(x / map.cell), r = Math.floor(z / map.cell);
    if (r < 0 || c < 0 || r >= map.n || c >= map.n) return true;
    const k = map.kind[r * map.n + c];
    return k === 0 || k === 3;
  }
  function canStandAt(x, z) {
    const rr = CONFIG.PLAYER_RADIUS;
    if (isBlocked(x - rr, z) || isBlocked(x + rr, z) || isBlocked(x, z - rr) || isBlocked(x, z + rr)) return false;
    return !scenery.hits(x, z, rr) && !traffic.hits(x, z, rr);
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
    // 포인터 잠금이 안 돼도 키보드로는 움직일 수 있다 (최신 브라우저는 실패를 Promise로 알린다)
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* 위와 같다 */ }
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

  // 테스트 모드 전용: 자동 점검 스크립트가 플레이어를 원하는 곳으로 옮길 수 있게 한다
  if (TEST_MODE) {
    window.__play = {
      exits: scenery.exits,
      traffic: () => traffic.stats(),
      peds: () => traffic.pedList(),
      freeze(on) { frozen = !!on; },
      crossings: scenery.crossings.map((c) => ({ x: c.x, z: c.z, tx: c.tx, tz: c.tz, w: c.w })),
      kind: (x, z) => scenery.kindAt(x, z),
      teleport(x, z, y) {
        // 나무나 벽과 겹치면 가까운 빈 자리로 옮긴다
        for (let r = 0; r < 6 && !canStandAt(x, z); r += 0.5) {
          const a = [0, 1.57, 3.14, 4.71].find((t) => canStandAt(x + Math.cos(t) * r, z + Math.sin(t) * r));
          if (a !== undefined) { x += Math.cos(a) * r; z += Math.sin(a) * r; break; }
        }
        camera.position.x = x; camera.position.z = z; yaw = y; pitch = 0;
      },
      // 높이 h(m)에서 내려다보기 (지붕·외벽 확인용). 다시 걷기 전에 teleport와 view(…, CONFIG.EYE_HEIGHT, …, 0)로 되돌린다
      view(x, z, h, y, p) { camera.position.set(x, h, z); yaw = y; pitch = p; },
      pos() { return { x: camera.position.x.toFixed(1), z: camera.position.z.toFixed(1), yaw: yaw.toFixed(2) }; },
      // 마지막 프레임의 그리기 호출 수와 삼각형 수 (fps가 60에서 막힐 때 무게를 비교하려고)
      perf() { return { fps: fpsText, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; },
    };
  }

  const toastEl = document.getElementById("play-toast");
  let toastTimer = null;
  function showToast() {
    if (!toastEl || !toastEl.hidden) return;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
  }

  let raf = null, lastT = performance.now();
  let frozen = false; // 테스트 모드에서 행인·차량을 멈춰 두고 찍을 때
  let fpsFrames = 0, fpsTime = 0, fpsText = "";

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
    clearTimeout(toastTimer);
    if (toastEl) toastEl.hidden = true;
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const mt of [].concat(o.material || [])) { if (mt.userData && mt.userData.ownMap && mt.map) mt.map.dispose(); mt.dispose(); } // 행인 모델은 재질이 여러 개다
    });
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
    fpsFrames++; fpsTime += dt;
    if (fpsTime >= 1) { fpsText = `${Math.round(fpsFrames / fpsTime)} fps`; fpsFrames = 0; fpsTime = 0; }
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
        // 가림막에 막혀 거의 못 움직였으면 안내 문구를 잠깐 띄운다
        if (Math.hypot(nx - cx, nz - cz) < Math.hypot(dx, dz) * 0.3 && scenery.nearEdge(cx, cz)) showToast();
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
        const ri = renderer.info.render;
        hudEl.textContent = [...lines, `목적지까지 직선 ${dg.toFixed(0)}m`, `${fpsText} · 그리기 ${ri.calls}회 · 삼각형 ${Math.round(ri.triangles / 1000)}k`, "P: 즉시 도착"].join("\n");
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
    updateSky();
    scenery.tick(now);
    if (!frozen) traffic.update(dt, now / 1000, camera.position);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(animate);
}
