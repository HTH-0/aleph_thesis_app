// OpenStreetMap 데이터를 받아 게임용 지도(data/<id>.json)로 바꾼다.
// 지도 파일에는 이동 판정용 격자와, 화면에 그릴 건물·도로·녹지·나무가 함께 들어간다.
// 실행: node tools/build_maps.mjs            (모든 지역)
//       node tools/build_maps.mjs mokdong    (한 지역만, 여러 개는 쉼표로)
// 지도 데이터: © OpenStreetMap contributors, ODbL 1.0
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data");

// 지역 목록. center는 지도 가운데, half는 지도 한 변의 절반(m).
export const REGIONS = [
  { id: "mokdong", name: "목동", desc: "서울 · 목동야구장 · 아파트 단지", center: [37.5310, 126.8790], half: 420 },
  { id: "jamsil", name: "잠실", desc: "서울 · 잠실종합운동장 · 아파트 단지", center: [37.5110, 127.0800], half: 420 },
  { id: "gocheok", name: "고척", desc: "서울 · 고척스카이돔 · 구로 골목", center: [37.4985, 126.8660], half: 420 },
  { id: "worldcup", name: "상암", desc: "서울 · 서울월드컵경기장 · 성산동", center: [37.5675, 126.8990], half: 420 },
  { id: "banwoldang", name: "반월당", desc: "대구 · 반월당역 · 더현대 대구", center: [35.8655, 128.5934], half: 420 },
  { id: "dongseongro", name: "동성로", desc: "대구 · 동성로 · 국채보상운동기념공원", center: [35.8690, 128.6010], half: 420 },
  { id: "seomun", name: "서문시장", desc: "대구 · 서문시장 · 대신동", center: [35.8691, 128.5800], half: 420 },
];

const CELL = 2; // 격자 한 칸(m)
const LANDMARK_MARGIN = 200; // 지도 밖이라도 이 거리(m) 안의 장소는 소리 후보로 쓴다
const SCENERY_MARGIN = 350; // 지도 밖이라도 이 거리(m) 안의 건물·도로·녹지는 배경으로 그린다 (안개가 끝나는 거리보다 조금 넓게)
const FLOOR = 3.3; // 층 높이(m)

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// 차도 종류별 기본 폭(m). lanes 태그가 있으면 차로 수로 계산한다.
const ROAD_WIDTH = {
  primary: 22, secondary: 20, tertiary: 13,
  primary_link: 8, secondary_link: 8, tertiary_link: 8, trunk: 22, trunk_link: 8,
  residential: 7, unclassified: 7, living_street: 6, road: 6, service: 4.5,
};
// 걷는 길(그리지 않고 걷는 영역에만 넣는다)의 폭(m)
const PATH_WIDTH = { footway: 3, path: 3, cycleway: 3, steps: 3, track: 3, corridor: 3 };
const SIDEWALK = 4; // 차도 양쪽 보도 폭(m)
const LOW_TYPES = new Set(["house", "detached", "hut", "shed", "garage", "garages", "kiosk", "toilets", "bungalow"]);

function bboxOf(region, extra = 0) {
  const [lat, lon] = region.center;
  const h = region.half + extra;
  const dLat = h / 110540;
  const dLon = h / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sound-walk-map-builder" },
          body: "data=" + encodeURIComponent(query),
        });
        const text = await res.text();
        if (res.ok && text.trimStart().startsWith("{")) return JSON.parse(text);
        lastErr = new Error(`${url} -> ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw lastErr;
}

function classifyLandmark(t) {
  if (t.leisure === "stadium") return "stadium";
  if (t.landuse === "construction" || t.building === "construction") return "construction";
  if (t.amenity === "place_of_worship" && t.religion === "christian") return "church";
  if (t.amenity === "place_of_worship" && t.religion === "buddhist") return "temple";
  if (t.amenity === "fountain") return "fountain";
  if (t.leisure === "playground") return "playground";
  if (t.amenity === "marketplace") return "market";
  return null;
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 0~1 사이의 고정 난수 (같은 OSM id면 항상 같은 값)
function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function ringArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// 층수 기록이 없으면 용도와 바닥 면적으로 높이를 추정한다
function buildingHeight(t, area, seed) {
  const h = num(t.height);
  if (h) return { h, measured: true };
  const lv = num(t["building:levels"]);
  if (lv) return { h: lv * FLOOR + 1, measured: true };
  const r = hash01(seed);
  const b = t.building;
  let floors;
  if (LOW_TYPES.has(b)) floors = 1 + (r < 0.45 ? 1 : 0);
  else if (b === "apartments") floors = 12 + Math.floor(r * 13);
  else if (b === "church" || b === "cathedral" || b === "chapel") floors = 3;
  else if (area < 60) floors = 1 + Math.floor(r * 2);
  else if (area < 160) floors = 2 + Math.floor(r * 3);
  else if (area < 450) floors = 3 + Math.floor(r * 4);
  else if (area < 1300) floors = 5 + Math.floor(r * 6);
  else floors = 8 + Math.floor(r * 9);
  return { h: floors * FLOOR + 0.8, measured: false };
}

function buildingKind(t) {
  const b = t.building;
  if (b === "roof") return "roof";
  if (b === "church" || b === "cathedral" || b === "chapel" || /성당|교회/.test(t.name || "")) return "church";
  if (b === "apartments") return "apartments";
  if (LOW_TYPES.has(b)) return "low";
  return "other";
}

async function buildRegion(region) {
  const box = (extra) => bboxOf(region, extra).join(",");
  const bb = box(0), sbb = box(SCENERY_MARGIN), lbb = box(LANDMARK_MARGIN);
  const query = `[out:json][timeout:180];
(
  way[highway](${sbb});
  way[building](${sbb});
  relation[building](${sbb});
  way[leisure~"^(park|garden|pitch|playground)$"](${sbb});
  way[landuse~"^(grass|park|forest|recreation_ground|village_green)$"](${sbb});
  way[natural~"^(wood|scrub|grassland)$"](${sbb});
  way[waterway=river](${sbb});
  way[natural=water](${sbb});
  way[place=square](${bb});
  way[amenity=parking](${bb});
  node[natural=tree](${bb});
  way[natural=tree_row](${bb});
  nwr[leisure=stadium](${lbb});
  nwr[landuse=construction](${lbb});
  nwr[building=construction](${lbb});
  nwr[amenity=place_of_worship](${lbb});
  nwr[amenity=fountain](${lbb});
  nwr[leisure=playground](${lbb});
  nwr[amenity=marketplace](${lbb});
);
out geom;`;
  console.log(`[${region.id}] Overpass 요청`);
  const data = await overpass(query);

  const [lat0, lon0] = region.center;
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const size = region.half * 2;
  const N = Math.round(size / CELL);
  // 지도 좌표: x는 동쪽(+), z는 남쪽(+), 원점은 지도 북서쪽 모서리
  const toXZ = (p) => [
    Math.round(((p.lon - lon0) * mx + region.half) * 10) / 10,
    Math.round((-(p.lat - lat0) * 110540 + region.half) * 10) / 10,
  ];
  const inside = (x, z, m) => x > -m && z > -m && x < size + m && z < size + m;

  const area = new Uint8Array(N * N); // 걸을 수 있는 영역(건물을 빼기 전)
  const building = new Uint8Array(N * N);

  function stampDisk(x, z, radius) {
    const c0 = Math.floor((x - radius) / CELL), c1 = Math.floor((x + radius) / CELL);
    const r0 = Math.floor((z - radius) / CELL), r1 = Math.floor((z + radius) / CELL);
    for (let r = Math.max(0, r0); r <= Math.min(N - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(N - 1, c1); c++) {
        const cx = c * CELL + CELL / 2, cz = r * CELL + CELL / 2;
        if ((cx - x) ** 2 + (cz - z) ** 2 <= radius * radius) area[r * N + c] = 1;
      }
    }
  }
  function stampLine(geom, radius) {
    for (let i = 0; i + 1 < geom.length; i++) {
      const [x1, z1] = geom[i], [x2, z2] = geom[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (CELL / 2)));
      for (let k = 0; k <= steps; k++) stampDisk(x1 + ((x2 - x1) * k) / steps, z1 + ((z2 - z1) * k) / steps, radius);
    }
  }
  function fillPolygon(pts, target) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    for (let r = Math.max(0, Math.floor(minZ / CELL)); r <= Math.min(N - 1, Math.floor(maxZ / CELL)); r++) {
      for (let c = Math.max(0, Math.floor(minX / CELL)); c <= Math.min(N - 1, Math.floor(maxX / CELL)); c++) {
        const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
        let ins = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, zi] = pts[i], [xj, zj] = pts[j];
          if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) ins = !ins;
        }
        if (ins) target[r * N + c] = 1;
      }
    }
  }
  const closeRing = (geom) => {
    const pts = geom.slice();
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts.length >= 3 ? pts : null;
  };

  const buildings = [], roads = [], green = [], trees = [], landmarks = [];
  let measured = 0;
  function addBuilding(pts, t, id) {
    const a = Math.abs(ringArea(pts));
    if (a < 6) return;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (!inside(cx, cz, SCENERY_MARGIN)) return;
    const kind = buildingKind(t);
    const { h, measured: m } = kind === "roof" ? { h: 4, measured: false } : buildingHeight(t, a, id);
    if (m) measured++;
    const out = !inside(cx, cz, 0);
    const p = out ? pts.map(([x, z]) => [Math.round(x * 2) / 2, Math.round(z * 2) / 2]) : pts;
    buildings.push({ p, h: Math.round(h * 10) / 10, k: kind, m: m ? 1 : 0 });
    if (kind !== "roof") fillPolygon(pts, building); // 지붕만 있는 구조물(주유소 캐노피 등)은 밑으로 걸어 다닐 수 있다
  }

  for (const el of data.elements) {
    const t = el.tags || {};
    const geom = el.geometry ? el.geometry.map(toXZ) : null;

    if (el.type === "way" && t.highway && geom && t.tunnel !== "yes" && !(Number(t.layer) < 0)) {
      if (ROAD_WIDTH[t.highway]) {
        const lanes = num(t.lanes);
        const w = num(t.width) || (lanes ? lanes * 3.3 + 1.5 : ROAD_WIDTH[t.highway]);
        roads.push({ p: geom, w: Math.round(w * 10) / 10, k: "car", ln: lanes || 0 });
        stampLine(geom, w / 2 + (w >= 10 ? SIDEWALK : SIDEWALK / 2));
      } else if (t.highway === "pedestrian") {
        const w = num(t.width) || 10;
        if (t.area === "yes" && closeRing(geom)) { green.push({ p: closeRing(geom), k: "plaza" }); fillPolygon(closeRing(geom), area); }
        else { roads.push({ p: geom, w, k: "plaza", ln: 0 }); stampLine(geom, w / 2 + 1); }
      } else if (PATH_WIDTH[t.highway]) {
        stampLine(geom, PATH_WIDTH[t.highway] / 2 + 0.5);
      }
    }
    if (t.building && geom && el.type === "way") {
      const pts = closeRing(geom);
      if (pts) addBuilding(pts, t, el.id);
    }
    if (t.building && el.type === "relation" && el.members) {
      for (const m of el.members) {
        if (m.role !== "outer" || !m.geometry) continue;
        const pts = closeRing(m.geometry.map(toXZ));
        if (pts) addBuilding(pts, t, el.id + m.ref);
      }
    }
    if (el.type === "way" && geom && !t.building && !t.highway) {
      const pts = closeRing(geom);
      const g = t.natural === "water" ? "water" : t.leisure || t.landuse || t.natural || (t.place === "square" ? "plaza" : null) || (t.amenity === "parking" ? "parking" : null);
      if (pts && g && g !== "tree_row" && !t.waterway) {
        green.push({ p: pts, k: g });
        if (g !== "water") fillPolygon(pts, area); // 공원, 광장, 주차장은 걸어 다닐 수 있다
      }
      if (t.natural === "tree_row") for (const p of geom) trees.push(p);
    }
    if (el.type === "node" && t.natural === "tree") {
      const p = toXZ(el);
      if (inside(p[0], p[1], 0)) trees.push(p);
    }

    const type = classifyLandmark(t);
    if (type) {
      let x, z;
      if (el.type === "node") [x, z] = toXZ(el);
      else if (geom && geom.length) {
        x = geom.reduce((a, p) => a + p[0], 0) / geom.length;
        z = geom.reduce((a, p) => a + p[1], 0) / geom.length;
      } else if (el.bounds) {
        [x, z] = toXZ({ lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lon: (el.bounds.minlon + el.bounds.maxlon) / 2 });
      } else continue;
      if (inside(x, z, LANDMARK_MARGIN)) landmarks.push({ type, name: t.name || null, x: Math.round(x), z: Math.round(z), osm: `${el.type}/${el.id}` });
    }
  }

  // 걷는 칸 = 걸을 수 있는 영역이면서 건물 안이 아닌 칸. 가장 큰 연결 영역만 남긴다.
  const walk = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) walk[i] = area[i] && !building[i] ? 1 : 0;
  const comp = new Int32Array(N * N).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < N * N; i++) {
    if (!walk[i] || comp[i] !== -1) continue;
    const stack = [i]; comp[i] = id; let count = 0;
    while (stack.length) {
      const cur = stack.pop(); count++;
      const r = Math.floor(cur / N), c = cur % N;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
        const ni = nr * N + nc;
        if (walk[ni] && comp[ni] === -1) { comp[ni] = id; stack.push(ni); }
      }
    }
    if (count > bestSize) { bestSize = count; best = id; }
    id++;
  }

  // 칸 문자: "." 걷는 칸, "#" 건물, " " 그 밖의 막힌 땅
  const rows = [];
  for (let r = 0; r < N; r++) {
    let row = "";
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      row += walk[i] && comp[i] === best ? "." : building[i] ? "#" : " ";
    }
    rows.push(row);
  }

  // 같은 장소가 여러 요소로 들어온 경우(노드+면) 30m 안의 같은 종류는 하나로 합친다
  const merged = [];
  for (const lm of landmarks) {
    if (!merged.some((m) => m.type === lm.type && Math.hypot(m.x - lm.x, m.z - lm.z) < 30)) merged.push(lm);
  }

  const out = {
    id: region.id, name: region.name, desc: region.desc,
    center: region.center, size, cell: CELL, n: N,
    attribution: "© OpenStreetMap contributors (ODbL)",
    builtAt: new Date().toISOString().slice(0, 10),
    grid: rows, landmarks: merged,
    scenery: { buildings, roads, green, trees },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${region.id}.json`), JSON.stringify(out));
  const counts = merged.reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {});
  console.log(`[${region.id}] 걷는 칸 ${bestSize}/${N * N}, 건물 ${buildings.length}(층수 기록 ${measured}), 도로 ${roads.length}, 랜드마크`, counts);
}

const only = process.argv[2] ? process.argv[2].split(",") : null;
for (const region of REGIONS.filter((r) => !only || only.includes(r.id))) {
  await buildRegion(region);
  await new Promise((r) => setTimeout(r, 3000)); // Overpass 서버에 연달아 요청하지 않는다
}
writeFileSync(
  join(OUT_DIR, "regions.json"),
  JSON.stringify(REGIONS.map(({ id, name, desc }) => ({ id, name, desc })))
);
