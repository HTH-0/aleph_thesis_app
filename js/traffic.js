// 행인과 차량. 플레이어 주변(CONFIG.NPC_RADIUS)에서만 움직이고, scenery.js의 신호등을 따른다.
// 행인은 보도·골목·광장을 걷다가 횡단보도에서 초록불을 기다려 건넌다.
// 차량은 차로를 따라 달리고, 빨간불·앞차·횡단보도의 사람·플레이어 앞에서 멈춘다. 소리는 내지 않는다.

const TRAFFIC = (() => {
  const hash = (n) => { const x = Math.sin(n * 91.7 + 17.3) * 43758.5453; return x - Math.floor(x); };
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 폴리라인을 step(m) 간격으로 나누고, 오른쪽으로 o(m)만큼 옮긴 점 목록을 만든다
  function offsetSamples(pts, o, step) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const tx = dx / len, tz = dz / len, k = Math.max(1, Math.round(len / step));
      for (let j = 0; j < k; j++) {
        const s = (j / k) * len;
        out.push({ x: a[0] + tx * s - tz * o, z: a[1] + tz * s + tx * o });
      }
      if (i === pts.length - 2) out.push({ x: b[0] - tz * o, z: b[1] + tx * o });
    }
    for (let i = 0; i < out.length; i++) out[i].d = i === 0 ? 0 : out[i - 1].d + Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
    return out;
  }
  // 경로 위 거리 s에서의 위치와 방향
  function along(path, s) {
    const p = path.pts;
    if (s <= 0) { const a = p[0], b = p[1]; return { x: a.x, z: a.z, dx: b.x - a.x, dz: b.z - a.z }; }
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].d <= s) lo = mid; else hi = mid; }
    const a = p[lo], b = p[hi], seg = Math.max(0.001, b.d - a.d), t = Math.min(1, (s - a.d) / seg);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: b.x - a.x, dz: b.z - a.z };
  }
  function makeIndex(size) {
    const cells = new Map();
    return {
      add(x, z, item) { const k = Math.floor(x / size) + "," + Math.floor(z / size); (cells.get(k) || cells.set(k, []).get(k)).push(item); },
      near(x, z, r) {
        const out = [];
        for (let cz = Math.floor((z - r) / size); cz <= Math.floor((z + r) / size); cz++)
          for (let cx = Math.floor((x - r) / size); cx <= Math.floor((x + r) / size); cx++) {
            const l = cells.get(cx + "," + cz);
            if (l) for (const it of l) if (Math.hypot(it.x - x, it.z - z) <= r) out.push(it);
          }
        return out;
      },
    };
  }

  function create(scene, map, scenery) {
    const roads = scenery.roads, kindAt = scenery.kindAt;
    const WIDE = CONFIG.WIDE_ROAD;
    const group = new THREE.Group();

    // ---------- 행인 길 ----------
    const walkable = (x, z) => kindAt(x, z) === 2 && !scenery.hits(x, z, 0.35);
    const pedPaths = [];
    for (const rd of roads) {
      const hw = rd.w / 2;
      // 보도 폭(rd.sw, 서울 보도 통계)이 있으면 보도 가운데보다 조금 바깥쪽을 걷는다
      const side = rd.sw && rd.w >= 5 ? hw + rd.sw * 0.7 : rd.w >= WIDE ? hw + 2.9 : rd.w >= 5 ? hw + 0.6 : 0;
      const offsets = rd.k === "plaza" ? [-hw / 2, hw / 2] : side ? [-side, side] : [];
      for (const o of offsets) {
        const S = offsetSamples(rd.pts, o, 2);
        let run = [];
        const flush = () => {
          if (run.length >= 6) {
            for (let i = 0; i < run.length; i++) run[i].d = i === 0 ? 0 : run[i - 1].d + Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z);
            pedPaths.push({ pts: run, len: run[run.length - 1].d, events: [] });
          }
          run = [];
        };
        for (const p of S) { if (walkable(p.x, p.z)) run.push({ x: p.x, z: p.z }); else flush(); }
        flush();
      }
    }
    const pedEnds = makeIndex(10), pedPoints = makeIndex(10);
    pedPaths.forEach((path, pi) => {
      pedEnds.add(path.pts[0].x, path.pts[0].z, { x: path.pts[0].x, z: path.pts[0].z, pi, end: 0 });
      const L = path.pts[path.pts.length - 1];
      pedEnds.add(L.x, L.z, { x: L.x, z: L.z, pi, end: 1 });
      path.pts.forEach((p, i) => { if (i % 2 === 0) pedPoints.add(p.x, p.z, { x: p.x, z: p.z, pi, s: p.d }); });
    });
    // 횡단보도 양 끝을 가까운 보행로 지점에 붙인다 (양 끝 모두 보행로가 있을 때만)
    for (const c of scenery.crossings) {
      const n = [-c.tz, c.tx], r = c.w / 2 + 2.9;
      const A = { x: c.x + n[0] * r, z: c.z + n[1] * r }, B = { x: c.x - n[0] * r, z: c.z - n[1] * r };
      const na = pedPoints.near(A.x, A.z, 3.5)[0], nb = pedPoints.near(B.x, B.z, 3.5)[0];
      if (!na || !nb) continue;
      pedPaths[na.pi].events.push({ s: na.s, c, from: A, to: B });
      pedPaths[nb.pi].events.push({ s: nb.s, c, from: B, to: A });
    }

    // ---------- 차로 ----------
    const lanes = [];
    for (const rd of roads) {
      if (rd.k !== "car" || rd.w < 5) continue;
      const hw = rd.w / 2, wide = rd.w >= WIDE;
      const offs = [];
      if (wide) {
        const total = rd.ln || Math.max(2, Math.round((rd.w - 1.5) / 3.3));
        const perDir = Math.max(1, Math.floor(total / 2)), laneW = (hw - 0.5) / perDir;
        for (let j = 0; j < perDir; j++) offs.push(0.4 + (j + 0.5) * laneW);
      } else offs.push(rd.w / 4);
      const fwd = rd.pts, back = rd.pts.slice().reverse();
      for (const [pts, sign] of [[fwd, 1], [back, -1]]) for (const o of offs) {
        const S = offsetSamples(pts, o, 3);
        if (S.length < 2) continue;
        const lane = { pts: S, len: S[S.length - 1].d, wide, rd, stops: [] };
        // 신호가 있는 횡단보도: 교차로로 들어가는 쪽만 멈춘다 (단독 횡단보도는 양쪽 다)
        for (const c of scenery.crossings) {
          if (c.rd !== rd) continue;
          let best = null, bd = 1e9;
          for (const p of S) { const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < bd) { bd = d; best = p; } }
          if (!best || bd > rd.w) continue;
          const i = S.indexOf(best), nx = S[Math.min(S.length - 1, i + 1)], pv = S[Math.max(0, i - 1)];
          const dir = [nx.x - pv.x, nx.z - pv.z];
          const approaching = c.node.solo || dir[0] * c.toJ[0] + dir[1] * c.toJ[1] > 0;
          lane.stops.push({ s: best.d, c, signal: approaching });
        }
        lane.stops.sort((a, b) => a.s - b.s);
        lanes.push(lane);
      }
    }
    const laneStarts = makeIndex(16), lanePoints = makeIndex(20);
    lanes.forEach((ln, li) => {
      laneStarts.add(ln.pts[0].x, ln.pts[0].z, { x: ln.pts[0].x, z: ln.pts[0].z, li });
      ln.pts.forEach((p, i) => { if (i % 3 === 0) lanePoints.add(p.x, p.z, { x: p.x, z: p.z, li, s: p.d }); });
    });

    // ---------- 모양 ----------
    const SHIRTS = ["#1f2a44", "#1b1b1d", "#c9b79a", "#7d7f83", "#e8e6e1", "#6b6a4f", "#6e2a33", "#3e5a7a", "#b5502c", "#d9d2c3"].map(lin);
    const PANTS = ["#18191b", "#2e3f5c", "#4a5e7d", "#b9ad94", "#5b5d61", "#2a2622"].map(lin);
    const SKIN = ["#e9c9a8", "#ddb894", "#d1a77f", "#f0d4b8"].map(lin);
    const HAIR = ["#141210", "#1d1612", "#2b1f17", "#5a5550", "#3a2a1e"].map(lin);
    const NPED = CONFIG.PEDESTRIANS;
    const mat = (o) => new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, roughness: 0.85 }, o));
    const torsoGeo = new THREE.BoxGeometry(0.42, 0.6, 0.24); torsoGeo.translate(0, 1.15, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.13, 1); headGeo.translate(0, 1.62, 0);
    const hairGeo = new THREE.SphereGeometry(0.138, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); hairGeo.translate(0, 1.64, -0.01);
    const legGeo = new THREE.BoxGeometry(0.15, 0.85, 0.17); legGeo.translate(0, -0.425, 0);
    const armGeo = new THREE.BoxGeometry(0.1, 0.58, 0.12); armGeo.translate(0, -0.29, 0);
    // instanceColor는 만들 때의 count 크기로 생기므로, count를 0으로 줄이기 전에 전체 크기로 미리 만든다
    const withColors = (im, n) => { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3); return im; };
    const mk = (geo) => { const m = withColors(new THREE.InstancedMesh(geo, mat(), NPED), NPED); m.count = 0; m.castShadow = true; m.frustumCulled = false; group.add(m); return m; };
    const P = { torso: mk(torsoGeo), head: mk(headGeo), hair: mk(hairGeo), legL: mk(legGeo), legR: mk(legGeo), armL: mk(armGeo), armR: mk(armGeo) };

    const NCAR = CONFIG.CARS;
    const CAR_COLORS = ["#f2f2f0", "#f2f2f0", "#f2f2f0", "#1a1b1d", "#1a1b1d", "#8e9297", "#b8bcc0", "#b8bcc0", "#283a5c", "#7a1f24"].map(lin);
    const TAXI = lin("#f07a1c"), BUS = ["#2a5caa", "#3a9d4c", "#c8352e"].map(lin);
    const busTex = (() => {
      const c = document.createElement("canvas"); c.width = 256; c.height = 128;
      const g = c.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 128);
      g.fillStyle = "#26313b"; g.fillRect(0, 34, 256, 46); // 창문 띠
      g.fillStyle = "#e8e8e4"; for (let x = 0; x < 256; x += 42) g.fillRect(x, 34, 4, 46);
      g.fillStyle = "#dcdcd6"; g.fillRect(0, 108, 256, 20);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
    })();
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.66, 4.4); bodyGeo.translate(0, 0.6, 0);
    const cabinGeo = new THREE.BoxGeometry(1.58, 0.56, 2.3); cabinGeo.translate(0, 1.2, -0.25);
    const signGeo = new THREE.BoxGeometry(0.62, 0.2, 0.28); signGeo.translate(0, 1.58, -0.2);
    const busGeo = new THREE.BoxGeometry(2.5, 2.9, 11); busGeo.translate(0, 1.75, 0);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12); wheelGeo.rotateZ(Math.PI / 2); wheelGeo.translate(0, 0.34, 0);
    const lightGeo = new THREE.BoxGeometry(0.34, 0.13, 0.05);
    const imk = (geo, m, count) => { const im = withColors(new THREE.InstancedMesh(geo, m, count), count); im.count = 0; im.castShadow = true; im.frustumCulled = false; group.add(im); return im; };
    const C = {
      body: imk(bodyGeo, mat({ roughness: 0.35, metalness: 0.3 }), NCAR),
      cabin: imk(cabinGeo, mat({ color: lin("#24303a"), roughness: 0.2, metalness: 0.4 }), NCAR),
      sign: imk(signGeo, mat({ color: lin("#f4f2ea"), emissive: lin("#3a3a30") }), NCAR),
      bus: imk(busGeo, mat({ map: busTex, roughness: 0.5 }), NCAR),
      wheel: imk(wheelGeo, mat({ color: lin("#1c1c1e"), roughness: 0.9 }), NCAR * 4),
      tail: imk(lightGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), NCAR * 2),
      head: imk(lightGeo, new THREE.MeshBasicMaterial({ color: lin("#fff6dc"), toneMapped: false }), NCAR * 2),
    };
    C.tail.castShadow = C.head.castShadow = false;
    scene.add(group);

    // ---------- 상태 ----------
    const peds = [], cars = [];
    const R = CONFIG.NPC_RADIUS;
    const tmp = { m: new THREE.Matrix4(), base: new THREE.Matrix4(), local: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    function spawnPed(player, minDist) {
      const cands = pedPoints.near(player.x, player.z, R);
      for (let tries = 0; tries < 8 && cands.length; tries++) {
        const c = pick(cands);
        if (Math.hypot(c.x - player.x, c.z - player.z) < minDist) continue;
        const k = Math.random() * 1e6;
        peds.push({
          path: pedPaths[c.pi], s: c.s, dir: Math.random() < 0.5 ? 1 : -1, speed: CONFIG.PED_SPEED * (0.8 + Math.random() * 0.4),
          lat: (Math.random() - 0.5) * 0.9, h: 0.92 + Math.random() * 0.14, phase: Math.random() * 6, state: "walk", wait: 0, blocked: 0, lastEvent: null,
          shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKIN), hair: Math.random() < 0.08 ? null : pick(HAIR), x: c.x, z: c.z, yaw: 0, seed: k,
        });
        return true;
      }
      return false;
    }
    function spawnCar(player, minDist) {
      // 큰길에 차가 더 많다: 4대 중 3대는 큰길에 둔다
      const all = lanePoints.near(player.x, player.z, R);
      const wideC = all.filter((c) => lanes[c.li].wide);
      const cands = wideC.length && Math.random() < 0.75 ? wideC : all;
      for (let tries = 0; tries < 10 && cands.length; tries++) {
        const c = pick(cands), ln = lanes[c.li];
        const s = c.s, p = along(ln, s);
        const d = Math.hypot(p.x - player.x, p.z - player.z);
        if (d > R || d < minDist) continue;
        if (cars.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 14)) continue;
        const r = Math.random();
        const type = ln.wide && r < 0.12 ? "bus" : r < 0.3 ? "taxi" : "car";
        cars.push({ lane: ln, s, v: ln.wide ? CONFIG.CAR_SPEED * 0.6 : CONFIG.CAR_SPEED_ALLEY * 0.6, type, color: type === "bus" ? pick(BUS) : type === "taxi" ? TAXI : pick(CAR_COLORS),
          halfL: type === "bus" ? 5.5 : 2.2, halfW: type === "bus" ? 1.25 : 0.9, x: p.x, z: p.z, yaw: Math.atan2(p.dx, p.dz), trans: null, braking: false });
        return true;
      }
      return false;
    }

    // 행인: 길 끝에서 이어지는 다른 길로 옮기거나 되돌아선다
    function pedNextPath(pd) {
      const end = pd.dir > 0 ? pd.path.pts[pd.path.pts.length - 1] : pd.path.pts[0];
      const opts = pedEnds.near(end.x, end.z, 8).filter((e) => pedPaths[e.pi] !== pd.path);
      if (!opts.length) { pd.dir = -pd.dir; return; }
      const o = pick(opts);
      pd.path = pedPaths[o.pi];
      pd.dir = o.end === 0 ? 1 : -1;
      pd.s = o.end === 0 ? 0 : pd.path.len;
    }
    function attachNear(pd, x, z) {
      const near = pedPoints.near(x, z, 4);
      if (!near.length) return false;
      const c = near.reduce((b, q) => (Math.hypot(q.x - x, q.z - z) < Math.hypot(b.x - x, b.z - z) ? q : b), near[0]);
      pd.path = pedPaths[c.pi]; pd.s = c.s; pd.dir = Math.random() < 0.5 ? 1 : -1;
      return true;
    }

    function updatePeds(dt, t, player) {
      for (let i = peds.length - 1; i >= 0; i--) {
        const pd = peds[i];
        if (Math.hypot(pd.x - player.x, pd.z - player.z) > R + 20) { peds.splice(i, 1); continue; }
        let moving = false;
        // 플레이어가 바로 앞에 있으면 멈추고, 오래 막히면 돌아선다
        const fx = Math.sin(pd.yaw), fz = Math.cos(pd.yaw);
        const px = player.x - pd.x, pz = player.z - pd.z, pdist = Math.hypot(px, pz);
        const playerAhead = pdist < 1.4 && px * fx + pz * fz > 0;
        if (pd.state === "walk") {
          if (playerAhead) {
            pd.blocked += dt;
            if (pd.blocked > 2.5) { pd.dir = -pd.dir; pd.blocked = 0; }
          } else {
            pd.blocked = 0;
            const prev = pd.s;
            pd.s += pd.dir * pd.speed * dt;
            moving = true;
            // 횡단보도 앞을 지나가면 가끔 건너기로 한다
            for (const ev of pd.path.events) {
              if (ev === pd.lastEvent) continue;
              if ((prev - ev.s) * (pd.s - ev.s) <= 0 && Math.random() < 0.45) {
                pd.state = "wait"; pd.cross = ev; pd.lastEvent = ev; pd.s = ev.s; moving = false;
                break;
              }
            }
            if (pd.s < 0 || pd.s > pd.path.len) { pd.s = Math.max(0, Math.min(pd.path.len, pd.s)); pedNextPath(pd); pd.lastEvent = null; }
          }
          const p = along(pd.path, pd.s);
          const L = Math.hypot(p.dx, p.dz) || 1;
          const dx = (p.dx / L) * pd.dir, dz = (p.dz / L) * pd.dir;
          pd.x = p.x - dz * pd.lat; pd.z = p.z + dx * pd.lat;
          pd.yaw = Math.atan2(dx, dz);
        } else if (pd.state === "wait") {
          const sig = scenery.signalOf(pd.cross.c, t).ped;
          const f = pd.cross.from, to = pd.cross.to;
          pd.x += (f.x - pd.x) * Math.min(1, dt * 2); pd.z += (f.z - pd.z) * Math.min(1, dt * 2);
          pd.yaw = Math.atan2(to.x - f.x, to.z - f.z);
          if (sig === "green") { pd.state = "cross"; pd.wait = 0; }
          else if ((pd.wait += dt) > 70) { pd.state = "walk"; pd.wait = 0; }
        } else if (pd.state === "cross") {
          const to = pd.cross.to;
          const dx = to.x - pd.x, dz = to.z - pd.z, d = Math.hypot(dx, dz);
          if (playerAhead) { /* 횡단보도 위에서는 잠깐 기다린다 */ }
          else if (d < 0.3) {
            pd.state = "walk";
            if (!attachNear(pd, to.x, to.z)) { peds.splice(i, 1); continue; }
            pd.lastEvent = pd.path.events.find((e) => e.c === pd.cross.c) || null;
          } else {
            const sp = pd.speed * 1.15 * dt;
            pd.x += (dx / d) * Math.min(sp, d); pd.z += (dz / d) * Math.min(sp, d);
            pd.yaw = Math.atan2(dx, dz);
            moving = true;
          }
        }
        if (moving) pd.phase += dt * pd.speed * 5.2;
        pd.moving = moving;
      }
      while (peds.length < Math.min(NPED, pedPaths.length * 3) && spawnPed(player, peds.length < NPED * 0.6 && !updatePeds.started ? 8 : 35)) {}
      updatePeds.started = true;
    }

    // 차량: 앞에 멈춰야 할 이유가 있는지 보고 목표 속도를 정한다
    function carTarget(car, t, player) {
      const ln = car.lane;
      const vmax = ln.wide ? CONFIG.CAR_SPEED : CONFIG.CAR_SPEED_ALLEY;
      let limit = vmax;
      const stopAt = (dist) => { limit = Math.min(limit, Math.max(0, (dist - 1) * 1.2)); };
      const front = car.s + car.halfL;
      // 신호와 횡단보도
      for (const st of ln.stops) {
        const dist = st.s - 3 - front;
        if (dist < -3 || dist > 35) continue;
        if (st.signal) {
          const sig = scenery.signalOf(st.c, t).car;
          if (sig === "red" || (sig === "yellow" && dist > 6)) { if (dist > -1) stopAt(dist); }
        }
        // 횡단보도 위에 사람이 있으면 양보한다
        const c = st.c, half = c.w / 2 + 0.5;
        const onCross = (x, z) => Math.abs((x - c.x) * c.tx + (z - c.z) * c.tz) < 2.6 && Math.abs(-(x - c.x) * c.tz + (z - c.z) * c.tx) < half;
        if (dist > -2 && (onCross(player.x, player.z) || peds.some((p) => p.state === "cross" && onCross(p.x, p.z)))) stopAt(Math.max(0, dist));
      }
      // 앞차
      for (const o of cars) {
        if (o === car) continue;
        const dx = o.x - car.x, dz = o.z - car.z;
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        const ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
        if (ahead > 0 && ahead < 30 && side < 1.8) stopAt(ahead - car.halfL - o.halfL - 2.5);
      }
      // 플레이어와 길 위의 행인
      const check = (x, z, r) => {
        const dx = x - car.x, dz = z - car.z, fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        const ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
        if (ahead > 0 && ahead < 18 && side < car.halfW + r + 0.4) stopAt(ahead - car.halfL - r - 1.5);
      };
      check(player.x, player.z, CONFIG.PLAYER_RADIUS);
      for (const p of peds) if (p.state !== "wait" && Math.abs(p.x - car.x) < 20 && Math.abs(p.z - car.z) < 20) check(p.x, p.z, 0.3);
      return limit;
    }
    function nextLane(car) {
      const ln = car.lane, end = ln.pts[ln.pts.length - 1], pre = ln.pts[Math.max(0, ln.pts.length - 3)];
      const hx = end.x - pre.x, hz = end.z - pre.z, hl = Math.hypot(hx, hz) || 1;
      // 다음 차로의 시작 방향과 지금 방향의 코사인 (1이면 직진, 0이면 직각으로 꺾음)
      const turn = (l) => {
        const a = l.pts[0], b = l.pts[Math.min(l.pts.length - 1, 2)];
        const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return ((b.x - a.x) * hx + (b.z - a.z) * hz) / (dl * hl);
      };
      const opts = laneStarts.near(end.x, end.z, 16).map((e) => lanes[e.li])
        .filter((l) => l !== ln && l.rd !== ln.rd && turn(l) > -0.2); // 유턴은 하지 않는다
      if (!opts.length) return null;
      // 곧게 이어지는 길을 더 자주 고른다
      const straight = opts.filter((l) => turn(l) > 0.8);
      return straight.length && Math.random() < 0.6 ? pick(straight) : pick(opts);
    }
    function updateCars(dt, t, player) {
      for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];
        if (Math.hypot(car.x - player.x, car.z - player.z) > R + 30) { cars.splice(i, 1); continue; }
        const target = car.trans ? Math.min(car.lane.wide ? CONFIG.CAR_SPEED : CONFIG.CAR_SPEED_ALLEY, 6) : carTarget(car, t, player);
        car.braking = target < car.v - 0.2;
        car.v += Math.max(-7 * dt, Math.min(2.5 * dt, target - car.v));
        if (car.v < 0) car.v = 0;
        if (car.trans) {
          // 교차로에서 다음 차로 시작점까지 곧게 이어 간다
          const tr = car.trans;
          tr.t += (car.v * dt) / tr.len;
          if (tr.t >= 1) { car.trans = null; car.s = 0; }
          else {
            car.x = tr.a.x + (tr.b.x - tr.a.x) * tr.t; car.z = tr.a.z + (tr.b.z - tr.a.z) * tr.t;
            const ty = Math.atan2(tr.b.x - tr.a.x, tr.b.z - tr.a.z);
            car.yaw = ty;
            continue;
          }
        }
        car.s += car.v * dt;
        if (car.s > car.lane.len) {
          const nl = nextLane(car);
          if (!nl) { cars.splice(i, 1); continue; }
          const a = car.lane.pts[car.lane.pts.length - 1], b = nl.pts[0];
          car.lane = nl;
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          if (len > 0.5) { car.trans = { a, b, len, t: 0 }; continue; }
          car.s = 0;
        }
        const p = along(car.lane, car.s);
        car.x = p.x; car.z = p.z;
        car.yaw = Math.atan2(p.dx, p.dz);
      }
      while (cars.length < Math.min(NCAR, lanes.length * 2) && spawnCar(player, !updateCars.started ? 15 : 60)) {}
      updateCars.started = true;
    }

    // ---------- 그리기 ----------
    function draw() {
      const { m, base, local, q, v, s, up } = tmp;
      let k = 0;
      for (const pd of peds) {
        v.set(pd.x, 0, pd.z); q.setFromAxisAngle(up, pd.yaw); s.set(pd.h, pd.h, pd.h);
        base.compose(v, q, s);
        P.torso.setMatrixAt(k, base); P.head.setMatrixAt(k, base);
        P.hair.setMatrixAt(k, pd.hair ? base : zero);
        const sw = pd.moving ? Math.sin(pd.phase) * 0.55 : 0;
        local.makeRotationX(sw).setPosition(-0.1, 0.85, 0); m.multiplyMatrices(base, local); P.legL.setMatrixAt(k, m);
        local.makeRotationX(-sw).setPosition(0.1, 0.85, 0); m.multiplyMatrices(base, local); P.legR.setMatrixAt(k, m);
        local.makeRotationX(-sw * 0.8).setPosition(-0.27, 1.43, 0); m.multiplyMatrices(base, local); P.armL.setMatrixAt(k, m);
        local.makeRotationX(sw * 0.8).setPosition(0.27, 1.43, 0); m.multiplyMatrices(base, local); P.armR.setMatrixAt(k, m);
        P.torso.setColorAt(k, pd.shirt); P.armL.setColorAt(k, pd.shirt); P.armR.setColorAt(k, pd.shirt);
        P.legL.setColorAt(k, pd.pants); P.legR.setColorAt(k, pd.pants);
        P.head.setColorAt(k, pd.skin); P.hair.setColorAt(k, pd.hair || pd.skin);
        k++;
      }
      for (const im of Object.values(P)) { im.count = k; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }

      let nc = 0, nb = 0, nw = 0, nl = 0;
      const red = new THREE.Color(), WH = [[-0.8, 1.4], [0.8, 1.4], [-0.8, -1.4], [0.8, -1.4]], WB = [[-1.1, 3.8], [1.1, 3.8], [-1.1, -3.6], [1.1, -3.6]];
      for (const car of cars) {
        v.set(car.x, 0, car.z); q.setFromAxisAngle(up, car.yaw); s.set(1, 1, 1);
        base.compose(v, q, s);
        if (car.type === "bus") {
          C.bus.setMatrixAt(nb, base); C.bus.setColorAt(nb, car.color); nb++;
        } else {
          C.body.setMatrixAt(nc, base); C.body.setColorAt(nc, car.color);
          C.cabin.setMatrixAt(nc, base);
          C.sign.setMatrixAt(nc, car.type === "taxi" ? base : zero);
          nc++;
        }
        for (const [wx, wz] of car.type === "bus" ? WB : WH) {
          local.makeTranslation(wx, 0, wz); m.multiplyMatrices(base, local); C.wheel.setMatrixAt(nw++, m);
        }
        red.setRGB(car.braking || car.v < 0.3 ? 1.0 : 0.45, 0.04, 0.03);
        const bz = car.halfL + 0.02, by = car.type === "bus" ? 0.8 : 0.72, bx = car.type === "bus" ? 0.95 : 0.65;
        for (const sx of [-bx, bx]) {
          local.makeTranslation(sx, by, -bz); m.multiplyMatrices(base, local); C.tail.setMatrixAt(nl, m); C.tail.setColorAt(nl, red);
          local.makeTranslation(sx, by, bz); m.multiplyMatrices(base, local); C.head.setMatrixAt(nl, m);
          nl++;
        }
      }
      C.body.count = C.cabin.count = C.sign.count = nc; C.bus.count = nb; C.wheel.count = nw; C.tail.count = C.head.count = nl;
      for (const im of Object.values(C)) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }

    function update(dt, t, player) {
      updatePeds(dt, t, player);
      updateCars(dt, t, player);
      draw();
    }

    // 플레이어가 행인이나 차에 닿는지
    function hits(x, z, r) {
      for (const pd of peds) if (Math.abs(pd.x - x) < 1 && Math.abs(pd.z - z) < 1 && Math.hypot(pd.x - x, pd.z - z) < r + 0.28) return true;
      for (const car of cars) {
        const dx = x - car.x, dz = z - car.z;
        if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        const lz = dx * fx + dz * fz, lx = -dx * fz + dz * fx;
        if (Math.abs(lz) < car.halfL + r && Math.abs(lx) < car.halfW + r) return true;
      }
      return false;
    }

    return { update, hits, stats: () => ({ peds: peds.length, cars: cars.length, pedPaths: pedPaths.length, lanes: lanes.length, crossings: scenery.crossings.length,
        waiting: peds.filter((p) => p.state === "wait").length, crossing: peds.filter((p) => p.state === "cross").length, carsStopped: cars.filter((c) => c.v < 0.3).length }), };
  }

  return { create };
})();
