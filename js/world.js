// 지도 데이터를 읽고, 소리 3개와 두 판의 출발점·목적지를 고른다.

async function loadRegion(id) {
  let res;
  try {
    res = await fetch(`data/${encodeURIComponent(id)}.json`);
  } catch (e) {
    throw new Error("지도 파일을 불러오지 못했습니다. 인터넷 연결이나 실행 방법을 확인해 주세요.");
  }
  if (!res.ok) throw new Error(`지도 파일이 없습니다 (data/${id}.json).`);
  const d = await res.json();
  if (!d || !Array.isArray(d.grid) || d.grid.length !== d.n) throw new Error("지도 파일 형식이 올바르지 않습니다.");

  const n = d.n;
  const walk = new Uint8Array(n * n);
  const kind = new Uint8Array(n * n); // 0 막힌 땅, 1 건물, 2 걷는 칸, 3 큰 차도(막힘)
  for (let r = 0; r < n; r++) {
    const row = d.grid[r];
    for (let c = 0; c < n; c++) {
      const ch = row[c];
      if (ch === ".") { walk[r * n + c] = 1; kind[r * n + c] = 2; }
      else if (ch === "#") kind[r * n + c] = 1;
      else if (ch === "=") kind[r * n + c] = 3;
    }
  }
  const m = CONFIG.LANDMARK_MARGIN;
  const landmarks = (d.landmarks || []).filter(
    (l) => SOUND_TYPES[l.type] && l.x > -m && l.z > -m && l.x < d.size + m && l.z < d.size + m
  );
  const map = { ...d, walk, kind, landmarks };
  // 지하도 출구 (data/underpass.json에 이 지역이 있을 때만)
  try {
    const r = await fetch("data/underpass.json");
    const all = r.ok ? await r.json() : {};
    if (all[id]) map.underpass = placeUnderpass(map, all[id]);
  } catch (e) { /* 지하도 없이 진행한다 */ }
  return map;
}

// 지하도 출구: OSM 출구 점 가까이 보도 위에 길이 5.6m × 폭 2.6m 입구를 큰길과 나란히 놓는다.
// 계단은 교차로 쪽으로 내려가고, 들어가는 쪽은 교차로 반대쪽 끝이다. 입구 앞 칸끼리는 지하로 이어진다(bfs의 map.links).
// 반환: { station, exits: [{ no, x, z, tx, tz, L, W, pts, mouth, spawn, cell }], cost(i, j) → 지하로 걷는 거리(m) }
const UNDERPASS_L = 5.6, UNDERPASS_W = 2.6;
function placeUnderpass(map, info) {
  const n = map.n, cell = map.cell;
  const kindAt = (x, z) => { const c = Math.floor(x / cell), r = Math.floor(z / cell); return r < 0 || c < 0 || r >= n || c >= n ? -1 : map.kind[r * n + c]; };
  const wide = [];
  for (const rd of (map.scenery && map.scenery.roads) || []) if (rd.k === "car" && rd.w >= CONFIG.WIDE_ROAD) for (let i = 0; i + 1 < rd.p.length; i++) wide.push({ a: rd.p[i], b: rd.p[i + 1] });
  const [cx, cz] = info.center;
  const exits = [];
  for (const e of info.exits) {
    // 가장 가까운 큰길 방향
    let best = null;
    for (const sg of wide) {
      const dx = sg.b[0] - sg.a[0], dz = sg.b[1] - sg.a[1], L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((e.x - sg.a[0]) * dx + (e.z - sg.a[1]) * dz) / L2));
      const d = Math.hypot(sg.a[0] + dx * t - e.x, sg.a[1] + dz * t - e.z);
      if (!best || d < best.d) best = { d, tx: dx / Math.sqrt(L2), tz: dz / Math.sqrt(L2) };
    }
    if (!best) continue;
    let { tx, tz } = best;
    // 들어가는 쪽(+t)이 교차로에서 멀어지는 쪽이 되게 한다
    if ((e.x - cx) * tx + (e.z - cz) * tz < 0) { tx = -tx; tz = -tz; }
    const nx = -tz, nz = tx;
    // 입구 바닥과 들어가는 앞 1.5m, 그리고 한쪽 옆 1.6m(사람이 지나갈 보도)가 걷는 칸인 자리를 출구 점에서 가까운 순으로 찾는다
    const fits = (x, z) => {
      for (let a = -UNDERPASS_L / 2; a <= UNDERPASS_L / 2 + 1.5; a += 0.7) for (let b = -UNDERPASS_W / 2; b <= UNDERPASS_W / 2; b += 0.65)
        if (kindAt(x + tx * a + nx * b, z + tz * a + nz * b) !== 2) return false;
      for (const side of [1, -1]) {
        let ok = true;
        for (let a = -UNDERPASS_L / 2; a <= UNDERPASS_L / 2 && ok; a += 0.7) for (let b = UNDERPASS_W / 2 + 0.4; b <= UNDERPASS_W / 2 + 1.6; b += 0.6)
          if (kindAt(x + tx * a + nx * b * side, z + tz * a + nz * b * side) !== 2) ok = false;
        if (ok) return true;
      }
      return false;
    };
    let spot = null;
    for (let r = 0; r <= 14 && !spot; r += 0.5) {
      const m = Math.max(1, Math.round(r * 4));
      for (let k = 0; k < m && !spot; k++) {
        const a = (k / m) * Math.PI * 2, x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
        if (fits(x, z) && exits.every((o) => Math.hypot(o.x - x, o.z - z) > 8)) spot = [x, z];
      }
    }
    if (!spot) continue;
    const [x, z] = spot, hl = UNDERPASS_L / 2, hw = UNDERPASS_W / 2;
    const P = (a, b) => [x + tx * a + nx * b, z + tz * a + nz * b];
    const pts = [P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)];
    const mouth = { x: x + tx * hl, z: z + tz * hl };
    const spawn = { x: x + tx * (hl + 1.6), z: z + tz * (hl + 1.6), yaw: Math.atan2(-tx, -tz) };
    exits.push({ no: e.no, x, z, tx, tz, L: UNDERPASS_L, W: UNDERPASS_W, pts, mouth, spawn, cell: Math.floor(spawn.z / cell) * n + Math.floor(spawn.x / cell) });
  }
  // 지하로 걷는 거리: 출구 사이 직선의 1.25배(통로가 꺾인다) + 계단 두 번(각 10m)
  const cost = (i, j) => Math.round(Math.hypot(exits[i].x - exits[j].x, exits[i].z - exits[j].z) * 1.25 + 20);
  // 입구 바닥 칸은 걷지 못하게 한다 (경로 계산이 입구 위를 지나가지 않게)
  const inPoly = (px, pz, P) => { let inside = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > pz) !== (b[1] > pz) && px < ((b[0] - a[0]) * (pz - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
  for (const ex of exits) {
    const xs = ex.pts.map((p) => p[0]), zs = ex.pts.map((p) => p[1]);
    for (let r = Math.floor(Math.min(...zs) / cell); r <= Math.floor(Math.max(...zs) / cell); r++)
      for (let c = Math.floor(Math.min(...xs) / cell); c <= Math.floor(Math.max(...xs) / cell); c++)
        if (inPoly((c + 0.5) * cell, (r + 0.5) * cell, ex.pts)) map.walk[r * n + c] = 0;
  }
  // 경로 계산용 연결: 입구 앞 칸 → 다른 입구 앞 칸 (칸 수)
  map.links = new Map();
  exits.forEach((a, i) => map.links.set(a.cell, exits.map((b, j) => (i === j ? null : [b.cell, Math.round(cost(i, j) / cell)])).filter(Boolean)));
  return { station: info.station, exits, cost };
}

// 간단한 시드 난수 (같은 시드면 같은 판이 나온다)
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function cellCenter(map, idx) {
  const r = Math.floor(idx / map.n), c = idx % map.n;
  return { x: c * map.cell + map.cell / 2, z: r * map.cell + map.cell / 2 };
}

// 칸 사이 거리(칸 수). 지하도(map.links)가 있으면 한 번에 여러 칸을 건너므로 거리별 묶음 순서로 처리한다
function bfs(map, from) {
  const n = map.n;
  if (map.links && map.links.size) return bfsLinked(map, from);
  const dist = new Int32Array(n * n).fill(-1);
  const q = new Int32Array(n * n);
  let head = 0, tail = 0;
  dist[from] = 0; q[tail++] = from;
  while (head < tail) {
    const cur = q[head++];
    const r = Math.floor(cur / n), c = cur % n;
    const nb = [r > 0 ? cur - n : -1, r < n - 1 ? cur + n : -1, c > 0 ? cur - 1 : -1, c < n - 1 ? cur + 1 : -1];
    for (const ni of nb) {
      if (ni >= 0 && map.walk[ni] && dist[ni] === -1) { dist[ni] = dist[cur] + 1; q[tail++] = ni; }
    }
  }
  return dist;
}

function bfsLinked(map, from) {
  const n = map.n, links = map.links;
  const dist = new Int32Array(n * n).fill(-1);
  const buckets = [[from]];
  dist[from] = 0;
  const reach = (i, d) => { if (dist[i] === -1 || dist[i] > d) { dist[i] = d; (buckets[d] || (buckets[d] = [])).push(i); } };
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (const cur of b) {
      if (dist[cur] !== d) continue;
      const r = Math.floor(cur / n), c = cur % n;
      if (r > 0 && map.walk[cur - n]) reach(cur - n, d + 1);
      if (r < n - 1 && map.walk[cur + n]) reach(cur + n, d + 1);
      if (c > 0 && map.walk[cur - 1]) reach(cur - 1, d + 1);
      if (c < n - 1 && map.walk[cur + 1]) reach(cur + 1, d + 1);
      const l = links.get(cur);
      if (l) for (const [to, w] of l) if (map.walk[to]) reach(to, d + w);
    }
    buckets[d] = null;
  }
  return dist;
}

// 성격(group)이 다른 소리 3개를 고르고, 같은 종류가 여럿이면 서로 멀리 떨어진 곳을 고른다.
function pickLandmarks(map) {
  const byType = {};
  for (const l of map.landmarks) (byType[l.type] = byType[l.type] || []).push(l);
  const types = [];
  const usedGroups = new Set();
  for (const t of SOUND_PRIORITY) {
    if (byType[t] && !usedGroups.has(SOUND_TYPES[t].group) && types.length < 3) { types.push(t); usedGroups.add(SOUND_TYPES[t].group); }
  }
  for (const t of SOUND_PRIORITY) {
    if (byType[t] && !types.includes(t) && types.length < 3) types.push(t);
  }
  const chosen = [];
  // 지도 밖으로 벗어난 거리 (안에 있으면 0)
  const outside = (l) => Math.hypot(Math.max(0, -l.x, l.x - map.size), Math.max(0, -l.z, l.z - map.size));
  for (const t of types) {
    let best = null, bestScore = -Infinity;
    for (const l of byType[t]) {
      const minD = chosen.length ? Math.min(...chosen.map((o) => Math.hypot(o.x - l.x, o.z - l.z))) : 0;
      const score = minD - outside(l) * 3;
      if (score > bestScore) { bestScore = score; best = l; }
    }
    chosen.push(best);
  }
  return chosen;
}

// 두 판의 출발점·목적지를 고른다. 두 판의 최단경로 길이는 거의 같게 맞춘다.
function pickRoutes(map, landmarks, rng) {
  const n = map.n;
  const edge = Math.ceil(16 / map.cell);
  const candidates = [];
  // 출발점·목적지는 주변 칸도 모두 걷는 칸인 곳에서 고른다 (건물 벽에 붙어 시작하지 않게)
  const open = (i) => map.walk[i] && map.walk[i - 1] && map.walk[i + 1] && map.walk[i - n] && map.walk[i + n] &&
    map.walk[i - n - 1] && map.walk[i - n + 1] && map.walk[i + n - 1] && map.walk[i + n + 1];
  for (let r = edge; r < n - edge; r++) {
    for (let c = edge; c < n - edge; c++) {
      const i = r * n + c;
      if (!open(i)) continue;
      const p = cellCenter(map, i);
      if (landmarks.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < CONFIG.GOAL_MIN_DIST_FROM_LANDMARK)) continue;
      candidates.push(i);
    }
  }
  if (candidates.length < 10) throw new Error("이 지도에서는 길을 만들 수 없습니다.");

  // 소리가 단서가 되도록 출발점·목적지를 고른다 (단계 0이 가장 엄격하고, 두 판을 못 만들면 한 단계씩 푼다)
  //  near: 출발점·목적지에서 이 거리(m) 안에는 소리 장소가 없다 (바로 옆이면 소리로 찾을 필요가 없다)
  //  goalR, goalN, spread: 목적지에서 goalR(m) 안에 소리 장소가 goalN개 이상이고, 목적지에서 본 방향이 spread(도) 넘게 벌어진다
  //                        (두 소리의 크기·방향을 견주어 목적지 자리를 가늠할 수 있게)
  //  corridor: 소리 장소 하나 이상이 출발점과 목적지를 잇는 선에서 이 거리(m) 안에 있다 (가는 길에 소리를 지난다)
  const RULES = [
    { near: 60, goalR: 300, goalN: 2, spread: 60, corridor: 150 },
    { near: 60, goalR: 300, goalN: 2, spread: 60, corridor: 0 },
    { near: 60, goalR: 400, goalN: 2, spread: 40, corridor: 0 },
    { near: 60, goalR: 400, goalN: 1, spread: 0, corridor: 0 },
    { near: CONFIG.GOAL_MIN_DIST_FROM_LANDMARK, goalR: 0, goalN: 0, spread: 0, corridor: 0 },
  ];
  const nearSound = (p, d) => landmarks.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < d);
  const goalOK = (p, R) => {
    const ang = landmarks.filter((l) => Math.hypot(l.x - p.x, l.z - p.z) <= R.goalR).map((l) => Math.atan2(l.x - p.x, l.z - p.z));
    if (ang.length < R.goalN) return false;
    if (!R.spread) return true;
    for (let i = 0; i < ang.length; i++) for (let j = i + 1; j < ang.length; j++) {
      const d = Math.abs(Math.atan2(Math.sin(ang[i] - ang[j]), Math.cos(ang[i] - ang[j]))) * 180 / Math.PI;
      if (d >= R.spread) return true;
    }
    return false;
  };
  const segDist = (l, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((l.x - a.x) * dx + (l.z - a.z) * dz) / L2));
    return Math.hypot(a.x + dx * t - l.x, a.z + dz * t - l.z);
  };
  const minCells = Math.round(160 / map.cell);
  for (let level = 0; level < RULES.length; level++) {
    const R = RULES[level];
    const goals = candidates.filter((i) => { const p = cellCenter(map, i); return !nearSound(p, R.near) && goalOK(p, R); });
    if (goals.length < 5) continue;
    for (let target = Math.round(CONFIG.ROUTE_METERS / map.cell); target >= minCells; target = Math.floor(target * 0.85)) {
      const lo = Math.floor(target * (1 - CONFIG.ROUTE_TOLERANCE));
      const hi = Math.ceil(target * (1 + CONFIG.ROUTE_TOLERANCE));
      const routes = [];
      for (let attempt = 0; attempt < 60 && routes.length < 2; attempt++) {
        const goal = goals[Math.floor(rng() * goals.length)];
        const gp = cellCenter(map, goal);
        if (routes.some((rt) => Math.hypot(rt.goalPos.x - gp.x, rt.goalPos.z - gp.z) < 150)) continue;
        const dist = bfs(map, goal);
        // 직선으로는 가까운데 길로만 먼 경우(지도를 보면 바로 보이는 경우)를 뺀다
        const minStraight = target * map.cell * 0.55;
        const starts = candidates.filter((i) => {
          if (dist[i] < lo || dist[i] > hi) return false;
          const p = cellCenter(map, i);
          if (Math.hypot(p.x - gp.x, p.z - gp.z) < minStraight || nearSound(p, R.near)) return false;
          return !R.corridor || landmarks.some((l) => segDist(l, p, gp) <= R.corridor);
        });
        if (!starts.length) continue;
        const start = starts[Math.floor(rng() * starts.length)];
        const sp = cellCenter(map, start);
        if (routes.some((rt) => Math.hypot(rt.startPos.x - sp.x, rt.startPos.z - sp.z) < 150)) continue;
        routes.push({ start, goal, startPos: sp, goalPos: gp, shortestCells: dist[start], shortestMeters: dist[start] * map.cell, soundRule: level });
      }
      if (routes.length === 2) return routes;
    }
  }
  throw new Error("이 지도에서 비슷한 길이의 길 두 개를 찾지 못했습니다.");
}
