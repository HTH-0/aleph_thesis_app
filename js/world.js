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
  return { ...d, walk, kind, landmarks };
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

function bfs(map, from) {
  const n = map.n;
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

  const minCells = Math.round(160 / map.cell);
  for (let target = Math.round(CONFIG.ROUTE_METERS / map.cell); target >= minCells; target = Math.floor(target * 0.85)) {
    const lo = Math.floor(target * (1 - CONFIG.ROUTE_TOLERANCE));
    const hi = Math.ceil(target * (1 + CONFIG.ROUTE_TOLERANCE));
    const routes = [];
    for (let attempt = 0; attempt < 60 && routes.length < 2; attempt++) {
      const goal = candidates[Math.floor(rng() * candidates.length)];
      const gp = cellCenter(map, goal);
      if (routes.some((rt) => Math.hypot(rt.goalPos.x - gp.x, rt.goalPos.z - gp.z) < 150)) continue;
      const dist = bfs(map, goal);
      // 직선으로는 가까운데 길로만 먼 경우(지도를 보면 바로 보이는 경우)를 뺀다
      const minStraight = target * map.cell * 0.55;
      const starts = candidates.filter((i) => {
        if (dist[i] < lo || dist[i] > hi) return false;
        const p = cellCenter(map, i);
        return Math.hypot(p.x - gp.x, p.z - gp.z) >= minStraight;
      });
      if (!starts.length) continue;
      const start = starts[Math.floor(rng() * starts.length)];
      const sp = cellCenter(map, start);
      if (routes.some((rt) => Math.hypot(rt.startPos.x - sp.x, rt.startPos.z - sp.z) < 150)) continue;
      routes.push({ start, goal, startPos: sp, goalPos: gp, shortestCells: dist[start], shortestMeters: dist[start] * map.cell });
    }
    if (routes.length === 2) return routes;
  }
  throw new Error("이 지도에서 비슷한 길이의 길 두 개를 찾지 못했습니다.");
}
