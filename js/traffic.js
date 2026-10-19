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
    if (s <= 0) { const a = p[0], b = p[1]; return { x: a.x, z: a.z, y: a.y || 0, dx: b.x - a.x, dz: b.z - a.z }; }
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].d <= s) lo = mid; else hi = mid; }
    const a = p[lo], b = p[hi], seg = Math.max(0.001, b.d - a.d), t = Math.min(1, (s - a.d) / seg);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t, dx: b.x - a.x, dz: b.z - a.z };
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
      if (rd.br) continue; // 다리·고가 위 보도는 걷지 않는다 (사람은 지면에만 둔다)
      const hw = rd.w / 2;
      // 보도 폭(rd.sw, 서울 보도 통계)이 있으면 보도 가운데보다 조금 바깥쪽을 걷는다. 인도 없는 골목은 길 가장자리 안쪽을 걷는다
      const side = rd.sw && rd.w >= 5 ? hw + rd.sw * 0.7 : rd.w >= WIDE ? hw + 2.9 : rd.w < CONFIG.NO_SIDEWALK_BELOW ? Math.max(0.5, hw - 0.35) : hw + 0.6;
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
    // 차로는 교차로(폭 5m 이상 차도끼리 만나는 점)마다 끊고, 같은 교차로를 공유하는 차로끼리만 잇는다.
    // OSM은 길이 다른 길의 중간 점에 붙는 경우(T자 교차로)가 많아서, 길 끝끼리만 이으면 차가 막다른 길로 알고 사라지거나
    // 근처의 다른 길로 건너뛴다 (2026-10-18 측정: 교차로 통과만큼 사라짐이 많았고, 상암은 통과의 27%가 8m 넘게 건너뜀)
    const nodeKey = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
    const nodeUse = new Map();
    for (const rd of roads) if (rd.k === "car" && rd.w >= 5) for (const p of rd.pts) nodeUse.set(nodeKey(p), (nodeUse.get(nodeKey(p)) || 0) + 1);
    const lanes = [];
    let pieceId = 0;
    for (const rd of roads) {
      if (rd.k !== "car" || rd.w < 5) continue;
      const hw = rd.w / 2, wide = rd.w >= WIDE;
      const offs = [];
      if (wide) {
        const total = rd.ln || Math.max(2, Math.round((rd.w - 1.5) / 3.3));
        const perDir = Math.max(1, Math.floor(total / 2)), laneW = (hw - 0.5) / perDir;
        for (let j = 0; j < perDir; j++) offs.push(0.4 + (j + 0.5) * laneW);
      } else offs.push(rd.w / 4);
      const pieces = [];
      for (let k = 1, start = 0; k < rd.pts.length; k++) {
        if (k === rd.pts.length - 1 || nodeUse.get(nodeKey(rd.pts[k])) >= 2) { pieces.push(rd.pts.slice(start, k + 1)); start = k; }
      }
      for (const piece of pieces) {
        const id = pieceId++, head = piece[0], tail = piece[piece.length - 1];
        for (const [pts, from, to] of [[piece, head, tail], [piece.slice().reverse(), tail, head]]) for (const o of offs) {
          const S = offsetSamples(pts, o, 3);
          if (S.length < 2) continue;
          for (const p of S) p.y = rd.br ? scenery.deckY(rd, p.x, p.z) : 0; // 다리·고가 위는 그 높이로 달린다
          const lane = { pts: S, len: S[S.length - 1].d, wide, rd, stops: [], piece: id, from: nodeKey(from), to: nodeKey(to), node: { x: to[0], z: to[1] } };
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
    }
    const lanesFrom = new Map(); // 교차로 점 → 그 점에서 나가는 차로
    for (const ln of lanes) (lanesFrom.get(ln.from) || lanesFrom.set(ln.from, []).get(ln.from)).push(ln);
    // 차가 차도 노면 밖으로 나간 비율을 재려고 차도 구간을 칸마다 모은다 (테스트 모드 집계, tools/check/traffic.mjs)
    const RC = 10, roadCells = new Map();
    const segDist = (x, z, a, b) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
      return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
    };
    for (const rd of roads) if (rd.k === "car") for (let i = 0; i + 1 < rd.pts.length; i++) {
      const a = rd.pts[i], b = rd.pts[i + 1], hw = rd.w / 2, pad = hw + 1;
      for (let cz = Math.floor((Math.min(a[1], b[1]) - pad) / RC); cz <= Math.floor((Math.max(a[1], b[1]) + pad) / RC); cz++)
        for (let cx = Math.floor((Math.min(a[0], b[0]) - pad) / RC); cx <= Math.floor((Math.max(a[0], b[0]) + pad) / RC); cx++) {
          const k = cx + "," + cz;
          (roadCells.get(k) || roadCells.set(k, []).get(k)).push({ a, b, hw });
        }
    }
    const onRoad = (x, z, m) => (roadCells.get(Math.floor(x / RC) + "," + Math.floor(z / RC)) || []).some((s) => segDist(x, z, s.a, s.b) <= s.hw + m);
    // off: 차 가운데가 노면 밖(0.5m 여유), body: 차체 네 모서리 가운데 하나라도 노면 밖(연석을 넘음)
    const offRoad = { samples: 0, off: 0, body: 0, last: 0 };
    const joins = { n: 0, long: 0, noNext: 0 }; // 교차로에서 다음 차로로 넘어간 횟수, 그중 8m 넘게 건너뛴 횟수, 이어 갈 차로가 없어 사라진 횟수

    const lanePoints = makeIndex(20);
    lanes.forEach((ln, li) => {
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

    // 행인 모델(js/people.js)을 불러왔으면 상자 사람 대신 쓴다. 자리(slot)마다 사람과 옷이 정해져 있고,
    // 행인이 생길 때 빈 자리를 하나 받아 사라질 때 돌려준다. 걸을 때는 걷기 동작, 멈추면 서 있는 동작
    const crowd = (() => {
      const lib = typeof PEOPLE !== "undefined" && PEOPLE.ready();
      if (!lib) return null;
      const WALK_SPEED = 1.35; // 걷기 동작 한 번이 나타내는 걸음 속도(m/s). 실제 걸음 속도에 맞춰 동작 빠르기를 바꾼다
      const slots = [], free = [];
      for (let i = 0; i < CONFIG.PEOPLE_MODELS; i++) {
        const person = lib.people[i % lib.people.length], look = Math.floor(i / lib.people.length) % person.looks.length;
        const root = PEOPLE.makeOne(person, look);
        root.visible = false;
        group.add(root);
        const mixer = new THREE.AnimationMixer(root), set = lib.clips[person.g];
        slots.push({ root, mixer, walk: set.walk.map((c) => mixer.clipAction(c)), idle: set.idle.map((c) => mixer.clipAction(c)), cur: null, phone: root.userData.phone });
        free.push(i);
      }
      return {
        size: slots.length,
        rootOf: (i) => slots[i] && slots[i].root, // 테스트 확인용
        phoneOn: (i) => !!(slots[i] && slots[i].phone && slots[i].phone.visible),
        take() { return free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : -1; },
        release(i) { const s = slots[i]; if (!s) return; s.root.visible = false; s.mixer.stopAllAction(); s.cur = null; if (s.phone) s.phone.visible = false; free.push(i); },
        place(pd, dt) {
          const s = slots[pd.slot];
          s.root.visible = true;
          s.root.position.set(pd.x, 0, pd.z);
          s.root.rotation.y = pd.yaw;
          s.root.scale.setScalar(0.95 + (pd.h - 0.92) * 0.7); // 키 ±5%
          const want = pd.moving ? s.walk[pd.walkIdx % s.walk.length] : s.idle[pd.idleIdx % s.idle.length];
          if (want !== s.cur) {
            want.reset().play();
            if (s.cur) want.crossFadeFrom(s.cur, 0.35, false);
            else want.time = Math.random() * want.getClip().duration; // 처음에는 동작 시점을 사람마다 다르게
            s.cur = want;
            if (s.phone) s.phone.visible = /cell_phone/.test(want.getClip().name); // 휴대폰 동작일 때만 휴대폰을 든다
          }
          if (pd.moving) want.timeScale = pd.speed / WALK_SPEED;
          s.mixer.update(dt);
        },
      };
    })();
    const PED_MAX = crowd ? crowd.size : NPED;

    const NCAR = CONFIG.CARS;
    const CAR_COLORS = ["#f2f2f0", "#f2f2f0", "#f2f2f0", "#1a1b1d", "#1a1b1d", "#8e9297", "#b8bcc0", "#b8bcc0", "#283a5c", "#7a1f24"].map(lin);
    const BRAKE = new THREE.Color(1.0, 0.04, 0.03);
    const LAMP = new THREE.Vector3(0.7, 0.7, 1); // 모델 차의 브레이크등은 상자 차 등보다 작게 (둥근 뒷면 옆으로 비어져 나오지 않게)
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

    // 차량 모델(js/vehicles.js)을 불러왔으면 상자 차 대신 쓴다. 차종·재질마다 InstancedMesh 하나로 그린다
    const fleet = (() => {
      const lib = typeof VEHICLES !== "undefined" && VEHICLES.ready();
      if (!lib) return null;
      const types = lib.types.map((t) => ({ ...t, meshes: t.parts.map((p) => {
        const im = withColors(new THREE.InstancedMesh(p.geometry, p.material, NCAR), NCAR);
        im.count = 0; im.castShadow = true; im.frustumCulled = false; group.add(im);
        return { im, paint: p.paint, matrix: p.matrix, pivot: p.pivot, unpivot: p.unpivot };
      }) }));
      const byId = Object.fromEntries(types.map((t) => [t.id, t]));
      return {
        byId,
        // 길 종류(큰길/골목)에 맞춰 차종을 고른다
        pick(wide) {
          const key = wide ? "wide" : "alley", list = types.filter((t) => t.w[key] > 0);
          let r = Math.random() * list.reduce((a, t) => a + t.w[key], 0);
          for (const t of list) if ((r -= t.w[key]) < 0) return t;
          return list[0];
        },
        draw(cars, base, sign, tail) {
          const n = {};
          for (const t of types) n[t.id] = 0;
          let ns = 0, nt = 0;
          const local = new THREE.Matrix4(), m = new THREE.Matrix4(), spin = new THREE.Matrix4();
          for (const car of cars) {
            const t = byId[car.model], k = n[t.id]++;
            base(car);
            for (const { im, paint, matrix, pivot, unpivot } of t.meshes) {
              if (pivot) { // 바퀴: 굴러간 거리 / 반지름만큼 축(차의 X축)을 중심으로 돌린다
                spin.makeRotationX((car.roll || 0) / t.wheelR);
                m.multiplyMatrices(base.m, pivot).multiply(spin).multiply(unpivot).multiply(matrix);
              } else m.multiplyMatrices(base.m, matrix);
              im.setMatrixAt(k, m); if (paint) im.setColorAt(k, car.color);
            }
            if (car.taxi) { local.makeTranslation(0, t.height + 0.12 - 1.58, -0.3); m.multiplyMatrices(base.m, local); sign.setMatrixAt(ns++, m); } // 지붕 택시 표시등
            if (car.braking || car.v < 0.3) for (const sx of [-1, 1]) { // 서 있거나 속도를 줄이는 차는 브레이크등을 켠다
              local.makeTranslation(sx * t.halfW * t.tail[0], t.height * t.tail[1], -t.halfL + 0.06); local.scale(LAMP); m.multiplyMatrices(base.m, local); tail.setMatrixAt(nt, m); tail.setColorAt(nt++, BRAKE);
            }
          }
          for (const t of types) for (const { im } of t.meshes) { im.count = n[t.id]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
          sign.count = ns; sign.instanceMatrix.needsUpdate = true;
          tail.count = nt; tail.instanceMatrix.needsUpdate = true; if (tail.instanceColor) tail.instanceColor.needsUpdate = true;
        },
      };
    })();
    scene.add(group);

    // ---------- 상태 ----------
    const peds = [], cars = [];
    const R = CONFIG.NPC_RADIUS;
    const tmp = { m: new THREE.Matrix4(), base: new THREE.Matrix4(), local: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    function removePed(i) {
      if (crowd) crowd.release(peds[i].slot);
      peds.splice(i, 1);
    }
    function spawnPed(player, minDist) {
      const cands = pedPoints.near(player.x, player.z, R);
      for (let tries = 0; tries < 8 && cands.length; tries++) {
        const c = pick(cands);
        if (Math.hypot(c.x - player.x, c.z - player.z) < minDist) continue;
        // 판이 시작된 뒤에는 플레이어 시야 안 120m에 갑자기 나타나지 않게 한다 (뒤쪽이나 먼 곳에서 생긴다)
        if (updatePeds.started && inView(c.x, c.z, player, 120)) continue;
        const k = Math.random() * 1e6;
        const slot = crowd ? crowd.take() : -1;
        if (crowd && slot < 0) return false;
        peds.push({
          slot, walkIdx: Math.floor(Math.random() * 9), idleIdx: Math.floor(Math.random() * 9),
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
        const v = ln.wide ? CONFIG.CAR_SPEED * 0.6 : CONFIG.CAR_SPEED_ALLEY * 0.6, base = { lane: ln, s, v, x: p.x, z: p.z, y: p.y, yaw: Math.atan2(p.dx, p.dz), trans: null, braking: false };
        if (fleet) {
          const t = fleet.pick(ln.wide), taxi = !!t.taxi && Math.random() < (ln.wide ? 0.35 : 0.15); // 택시는 아이오닉 5를 주황으로
          cars.push({ ...base, model: t.id, type: t.id === "bus" ? "bus" : taxi ? "taxi" : "car", taxi, color: taxi ? TAXI : pick(CAR_COLORS), halfL: t.halfL, halfW: t.halfW });
          return true;
        }
        const r = Math.random();
        const type = ln.wide && r < 0.12 ? "bus" : r < 0.3 ? "taxi" : "car";
        cars.push({ ...base, type, color: type === "bus" ? pick(BUS) : type === "taxi" ? TAXI : pick(CAR_COLORS),
          halfL: type === "bus" ? 5.5 : 2.2, halfW: type === "bus" ? 1.25 : 0.9 });
        return true;
      }
      return false;
    }

    // 행인이 길 위 거리 s에서 서는 자리. 옆으로 비켜 걷는 폭(lat)은 길 방향 기준이라 돌아서도 옆으로 튀지 않는다
    function pedSpot(pd, s) {
      const p = along(pd.path, s), L = Math.hypot(p.dx, p.dz) || 1;
      return { x: p.x - (p.dz / L) * pd.lat, z: p.z + (p.dx / L) * pd.lat };
    }
    // 두 점 사이를 걸어서 갈 수 있는지 (1m 간격으로 걷는 칸인지 본다)
    function walkLine(a, b) {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
      for (let k = 1; k < n; k++) if (!walkable(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n)) return false;
      return true;
    }
    // 다른 길로 옮길 때는 순간이동하지 않고 그 길의 시작점까지 걸어간다(state "link")
    function linkTo(pd, path, s, dir) {
      pd.path = path; pd.s = s; pd.dir = dir;
      pd.link = pedSpot(pd, s); pd.state = "link";
    }
    // 행인: 길 끝에서 걸어서 이어지는 다른 길로 옮기거나, 없으면 되돌아선다
    function pedNextPath(pd) {
      const end = pd.dir > 0 ? pd.path.pts[pd.path.pts.length - 1] : pd.path.pts[0];
      const here = { x: pd.x, z: pd.z };
      const hx = Math.sin(pd.yaw), hz = Math.cos(pd.yaw);
      const opts = pedEnds.near(end.x, end.z, 8).filter((e) => pedPaths[e.pi] !== pd.path && walkLine(here, e));
      if (!opts.length) { pd.dir = -pd.dir; return; }
      // 거의 되돌아가는 방향은 피한다
      const fwd = opts.filter((e) => {
        const P = pedPaths[e.pi].pts, a = e.end === 0 ? P[0] : P[P.length - 1], b = e.end === 0 ? P[Math.min(2, P.length - 1)] : P[Math.max(0, P.length - 3)];
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return ((b.x - a.x) * hx + (b.z - a.z) * hz) / l > -0.3;
      });
      const o = pick(fwd.length ? fwd : opts);
      const path = pedPaths[o.pi];
      linkTo(pd, path, o.end === 0 ? 0 : path.len, o.end === 0 ? 1 : -1);
    }
    // 횡단보도를 건넌 뒤 가까운 보행로로 걸어가서 붙는다
    function attachNear(pd, x, z) {
      const near = pedPoints.near(x, z, 4);
      if (!near.length) return false;
      const c = near.reduce((b, q) => (Math.hypot(q.x - x, q.z - z) < Math.hypot(b.x - x, b.z - z) ? q : b), near[0]);
      linkTo(pd, pedPaths[c.pi], c.s, Math.random() < 0.5 ? 1 : -1);
      return true;
    }
    // 한 프레임에 걷는 속도의 step배 넘게 움직이지 않는다. 도착했으면 true
    function stepTo(pd, x, z, step) {
      const dx = x - pd.x, dz = z - pd.z, d = Math.hypot(dx, dz);
      if (d <= step) { pd.x = x; pd.z = z; return true; }
      pd.x += (dx / d) * step; pd.z += (dz / d) * step;
      return false;
    }
    // 몸 방향은 초당 약 1바퀴 빠르기로 돌린다 (길이 꺾이거나 돌아설 때 한 번에 휙 돌지 않게)
    function turnTo(pd, yaw, dt) {
      let d = yaw - pd.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const m = 6 * dt;
      pd.yaw += Math.max(-m, Math.min(m, d));
    }

    const pedJumps = { seen: 0, unseen: 0, frames: 0 }; // 점검용 순간이동 횟수 (seen: 플레이어 시야 안 60m)
    const view = { fx: 0, fz: -1 }; // 플레이어가 보는 방향 (게임이 update에 yaw로 넘긴다)
    // 플레이어 시야(앞쪽 약 140도) 안이고 d m 안이면 눈에 보이는 자리로 본다
    const inView = (x, z, player, d) => {
      const dx = x - player.x, dz = z - player.z, l = Math.hypot(dx, dz);
      return l < d && (dx * view.fx + dz * view.fz) / (l || 1) > -0.35;
    };
    function updatePeds(dt, t, player) {
      for (let i = peds.length - 1; i >= 0; i--) {
        const pd = peds[i];
        if (Math.hypot(pd.x - player.x, pd.z - player.z) > R + 20) { removePed(i); continue; }
        const ox = pd.x, oz = pd.z;
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
          if (pd.state === "walk") {
            // 길이 꺾이는 점에서는 옆 폭 때문에 자리가 조금 튀므로, 걷는 속도의 1.5배까지만 따라간다
            const sp = pedSpot(pd, pd.s), p = along(pd.path, pd.s);
            stepTo(pd, sp.x, sp.z, pd.speed * 1.5 * dt);
            turnTo(pd, Math.atan2(p.dx * pd.dir, p.dz * pd.dir), dt);
          }
        } else if (pd.state === "link") {
          // 다음 길의 시작점까지 걸어간다
          if (playerAhead) { /* 잠깐 기다린다 */ }
          else {
            const dx = pd.link.x - pd.x, dz = pd.link.z - pd.z;
            if (dx * dx + dz * dz > 0.01) turnTo(pd, Math.atan2(dx, dz), dt);
            if (stepTo(pd, pd.link.x, pd.link.z, pd.speed * dt)) { pd.state = "walk"; pd.link = null; }
            moving = true;
          }
        } else if (pd.state === "wait") {
          const sig = scenery.signalOf(pd.cross.c, t).ped;
          const f = pd.cross.from, to = pd.cross.to;
          moving = !stepTo(pd, f.x, f.z, pd.speed * dt);
          turnTo(pd, Math.atan2(to.x - f.x, to.z - f.z), dt);
          if (sig === "green") { pd.state = "cross"; pd.wait = 0; }
          else if ((pd.wait += dt) > 70) { pd.wait = 0; linkTo(pd, pd.path, pd.s, pd.dir); } // 오래 기다리면 원래 길로 걸어서 돌아간다
        } else if (pd.state === "cross") {
          const to = pd.cross.to;
          const dx = to.x - pd.x, dz = to.z - pd.z, d = Math.hypot(dx, dz);
          if (playerAhead) { /* 횡단보도 위에서는 잠깐 기다린다 */ }
          else if (d < 0.3) {
            if (!attachNear(pd, to.x, to.z)) { removePed(i); continue; }
            pd.lastEvent = pd.path.events.find((e) => e.c === pd.cross.c) || null;
          } else {
            stepTo(pd, to.x, to.z, pd.speed * 1.15 * dt);
            turnTo(pd, Math.atan2(dx, dz), dt);
            moving = true;
          }
        }
        if (moving) pd.phase += dt * pd.speed * 5.2;
        pd.moving = moving;
        // 점검용: 한 프레임에 걷는 속도보다 크게 옮겨진 횟수를 원인별로 센다
        if (Math.hypot(pd.x - ox, pd.z - oz) > pd.speed * 1.6 * dt + 0.02) pedJumps[inView(pd.x, pd.z, player, 60) ? "seen" : "unseen"]++;
        pedJumps.frames++;
      }
      while (peds.length < Math.min(PED_MAX, pedPaths.length * 3) && spawnPed(player, peds.length < PED_MAX * 0.6 && !updatePeds.started ? 8 : 35)) {}
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
        if (o === car || Math.abs((o.y || 0) - (car.y || 0)) > 2.5) continue; // 고가 위아래 차는 서로 막지 않는다
        const dx = o.x - car.x, dz = o.z - car.z;
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        const ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
        if (ahead > 0 && ahead < 30 && side < 1.8) stopAt(ahead - car.halfL - o.halfL - 2.5);
      }
      // 플레이어와 길 위의 행인
      const check = (x, z, r, edge) => {
        const dx = x - car.x, dz = z - car.z, fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        const ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
        if (!(ahead > 0 && ahead < 18 && side < car.halfW + r + 0.4)) return;
        // 인도 없는 골목 가장자리를 걷는 사람과 차체가 겹치지 않으면 서지 않고 천천히 옆을 지나간다
        if (edge && side > car.halfW + 0.2) { if (ahead < 8) limit = Math.min(limit, 1.5); return; }
        stopAt(ahead - car.halfL - r - 1.5);
      };
      if ((car.y || 0) < 2) { // 고가 위를 달리는 차는 아래의 사람 때문에 서지 않는다
        check(player.x, player.z, CONFIG.PLAYER_RADIUS);
        const alley = !ln.wide && ln.rd.w < CONFIG.NO_SIDEWALK_BELOW;
        for (const p of peds) if (p.state !== "wait" && Math.abs(p.x - car.x) < 20 && Math.abs(p.z - car.z) < 20) check(p.x, p.z, 0.3, alley);
      }
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
      const here = lanesFrom.get(ln.to) || [];
      const ahead = here.filter((l) => l.piece !== ln.piece);
      // 막다른 길이면 같은 길의 반대 차로로 돌아 나온다 (사라지지 않게)
      if (!ahead.length) { const back = here.filter((l) => l.piece === ln.piece); return back.length ? pick(back) : null; }
      const opts = ahead.filter((l) => turn(l) > -0.2); // 거의 되돌아가는 방향은 피한다
      let pool = opts.length ? opts : ahead;
      // 버스(11m)는 큰길로만 이어 가고 거의 직진한다. 골목으로 꺾으면 차체가 보도로 넘어간다 (2026-10-18 상암 측정 3.3~5.9%)
      const big = car.model === "bus";
      if (big) { const wide = pool.filter((l) => l.wide); if (wide.length) pool = wide; }
      // 곧게 이어지는 길을 더 자주 고른다
      const straight = pool.filter((l) => turn(l) > 0.8);
      return straight.length && Math.random() < (big ? 0.9 : 0.6) ? pick(straight) : pick(pool);
    }
    function updateCars(dt, t, player) {
      for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];
        if (Math.hypot(car.x - player.x, car.z - player.z) > R + 30) { cars.splice(i, 1); continue; }
        const target = car.trans ? Math.min(car.lane.wide ? CONFIG.CAR_SPEED : CONFIG.CAR_SPEED_ALLEY, 6) : carTarget(car, t, player);
        car.braking = target < car.v - 0.2;
        car.v += Math.max(-7 * dt, Math.min(2.5 * dt, target - car.v));
        if (car.v < 0) car.v = 0;
        car.roll = (car.roll || 0) + car.v * dt; // 바퀴를 굴린 거리 (교차로 곡선에서도)
        if (car.trans) {
          // 교차로: 지금 차로 끝에서 다음 차로 시작까지, 교차로 가운데 쪽으로 휘는 곡선(2차 베지에)을 따라간다
          const tr = car.trans;
          tr.t += (car.v * dt) / tr.len;
          if (tr.t >= 1) { car.trans = null; car.s = 0; }
          else {
            const t1 = tr.t, u = 1 - t1, { a, b, c } = tr;
            car.x = u * u * a.x + 2 * u * t1 * c.x + t1 * t1 * b.x;
            car.z = u * u * a.z + 2 * u * t1 * c.z + t1 * t1 * b.z;
            car.y = (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t1;
            const dx = 2 * u * (c.x - a.x) + 2 * t1 * (b.x - c.x), dz = 2 * u * (c.z - a.z) + 2 * t1 * (b.z - c.z);
            if (Math.hypot(dx, dz) > 1e-4) car.yaw = Math.atan2(dx, dz);
            continue;
          }
        }
        car.s += car.v * dt;
        if (car.s > car.lane.len) {
          const nl = nextLane(car);
          if (!nl) { joins.noNext++; cars.splice(i, 1); continue; }
          const a = car.lane.pts[car.lane.pts.length - 1], b = nl.pts[0], c = car.lane.node;
          car.lane = nl;
          const chord = Math.hypot(b.x - a.x, b.z - a.z);
          const len = (chord + Math.hypot(c.x - a.x, c.z - a.z) + Math.hypot(b.x - c.x, b.z - c.z)) / 2; // 곡선 길이 어림값
          joins.n++; if (chord > 8) joins.long++;
          if (chord > 0.5) { car.trans = { a, b, c, len, t: 0 }; continue; }
          car.s = 0;
        }
        const p = along(car.lane, car.s);
        car.x = p.x; car.z = p.z; car.y = p.y;
        car.yaw = Math.atan2(p.dx, p.dz);
      }
      while (cars.length < Math.min(NCAR, lanes.length * 2) && spawnCar(player, !updateCars.started ? 15 : 60)) {}
      updateCars.started = true;
    }

    // ---------- 그리기 ----------
    function draw(dt) {
      const { m, base, local, q, v, s, up } = tmp;
      let k = 0;
      if (crowd) for (const pd of peds) crowd.place(pd, dt);
      else for (const pd of peds) {
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

      if (fleet) {
        const place = (car) => { v.set(car.x, car.y || 0, car.z); q.setFromAxisAngle(up, car.yaw); s.set(1, 1, 1); base.compose(v, q, s); };
        place.m = base;
        fleet.draw(cars, place, C.sign, C.tail);
        for (const [key, im] of Object.entries(C)) if (key !== "sign" && key !== "tail") im.count = 0; // 상자 차는 쓰지 않는다
        return;
      }
      let nc = 0, nb = 0, nw = 0, nl = 0;
      const red = new THREE.Color(), WH = [[-0.8, 1.4], [0.8, 1.4], [-0.8, -1.4], [0.8, -1.4]], WB = [[-1.1, 3.8], [1.1, 3.8], [-1.1, -3.6], [1.1, -3.6]];
      for (const car of cars) {
        v.set(car.x, car.y || 0, car.z); q.setFromAxisAngle(up, car.yaw); s.set(1, 1, 1);
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

    function update(dt, t, player, yaw = 0) {
      view.fx = -Math.sin(yaw); view.fz = -Math.cos(yaw);
      updatePeds(dt, t, player);
      updateCars(dt, t, player);
      if (t - offRoad.last > 0.5) {
        offRoad.last = t;
        for (const car of cars) {
          offRoad.samples++;
          if (!onRoad(car.x, car.z, 0.5)) offRoad.off++;
          const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), l = car.halfL * 0.9, w = car.halfW;
          if ([[l, w], [l, -w], [-l, w], [-l, -w]].some(([a, s]) => !onRoad(car.x + fx * a - fz * s, car.z + fz * a + fx * s, 0))) offRoad.body++;
        }
      }
      draw(dt);
    }

    // 플레이어가 행인이나 차에 닿는지
    function hits(x, z, r) {
      for (const pd of peds) if (Math.abs(pd.x - x) < 1 && Math.abs(pd.z - z) < 1 && Math.hypot(pd.x - x, pd.z - z) < r + 0.28) return true;
      for (const car of cars) {
        const dx = x - car.x, dz = z - car.z;
        if (Math.abs(dx) > 7 || Math.abs(dz) > 7 || (car.y || 0) > 2) continue; // 머리 위 고가의 차와는 부딪히지 않는다
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        const lz = dx * fx + dz * fz, lx = -dx * fz + dz * fx;
        if (Math.abs(lz) < car.halfL + r && Math.abs(lx) < car.halfW + r) return true;
      }
      return false;
    }

    return { update, hits,
      // 테스트 모드용: 차 위치와 종류
      carList: () => cars.map((c) => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), y: +(c.y || 0).toFixed(1), yaw: +c.yaw.toFixed(2), model: c.model || c.type, taxi: !!c.taxi, v: +c.v.toFixed(1) })),
      // 테스트 모드용: 행인 위치와 상태 (가까이 가서 모양·동작을 찍을 때)
      pedList: () => peds.map((p) => {
        const r = crowd && crowd.rootOf(p.slot), w = new THREE.Vector3();
        if (r) r.children[0] && r.children[0].getWorldPosition(w);
        return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), yaw: +p.yaw.toFixed(2), state: p.state, moving: !!p.moving, model: crowd ? p.slot : -1, phone: !!(crowd && crowd.phoneOn(p.slot)),
          root: r ? [+r.position.x.toFixed(1), +r.position.z.toFixed(1), r.visible] : null, child: r ? [+w.x.toFixed(1), +w.y.toFixed(2), +w.z.toFixed(1)] : null };
      }),
      stats: () => ({ peds: peds.length, cars: cars.length, pedPaths: pedPaths.length, lanes: lanes.length, crossings: scenery.crossings.length,
        waiting: peds.filter((p) => p.state === "wait").length, crossing: peds.filter((p) => p.state === "cross").length, carsStopped: cars.filter((c) => c.v < 0.3).length,
        offRoadPct: offRoad.samples ? +((offRoad.off / offRoad.samples) * 100).toFixed(1) : 0,
        bodyOffPct: offRoad.samples ? +((offRoad.body / offRoad.samples) * 100).toFixed(1) : 0, offRoadSamples: offRoad.samples, joins: joins.n, longJoins: joins.long, deadEnds: joins.noNext, pedJumps: { ...pedJumps } }), };
  }

  return { create };
})();
