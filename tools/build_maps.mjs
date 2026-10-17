// OpenStreetMap 데이터를 받아 게임용 지도(data/<id>.json)로 바꾼다.
// 지도 파일에는 이동 판정용 격자와, 화면에 그릴 건물·도로·녹지·나무가 함께 들어간다.
// 실행: node tools/build_maps.mjs            (모든 지역)
//       node tools/build_maps.mjs mokdong    (한 지역만, 여러 개는 쉼표로)
//       node tools/build_maps.mjs --fresh    (저장해 둔 OSM 원본 대신 Overpass에서 새로 받는다)
// 공공데이터(횡단보도, 보도 폭, 건물)는 참고자료/공공데이터/에 있어야 쓴다. 받는 방법은 tools/fetch_public.mjs와 README.md
// 지도 데이터: © OpenStreetMap contributors, ODbL 1.0
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { readShapefile, readShapefileWhere, tmFromPrj } from "./shapefile.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data");
// 공공데이터 원본 (저장소와 배포물에는 넣지 않는다. 출처는 참고자료/공공데이터/출처.txt)
const PUBLIC_DIR = join(ROOT, "참고자료", "공공데이터");
const OSM_CACHE = join(ROOT, "참고자료", "osm_cache");
const FRESH = process.argv.includes("--fresh");
const PUBLIC_CROSSWALKS = {
  seoul: { file: "seoul_crosswalk/A004_A", source: "서울시 교통안전시설물 횡단보도 정보 (서울 열린데이터광장, 공공누리 제1유형)" },
  daegu: { file: "daegu_crosswalk/A0043325", source: "대구광역시_횡단보도 (공공데이터포털)" },
};
// 국토교통부 GIS건물통합정보 (브이월드, 로그인해서 받는다). 받은 zip을 vworld_building/<도시>/에 풀어 둔다
const PUBLIC_BUILDINGS = {
  seoul: { file: "vworld_building/seoul/AL_D010_11_20261009", source: "국토교통부 GIS건물통합정보 서울특별시 (브이월드, 2026-10-09 기준, CC BY 저작자표시)" },
  daegu: { file: "vworld_building/daegu/AL_D010_27_20261009", source: "국토교통부 GIS건물통합정보 대구광역시 (브이월드, 2026-10-09 기준, CC BY 저작자표시)" },
};
const PUBLIC_SIDEWALKS = {
  seoul: { file: "seoul_sidewalk/sidewalk.json", source: "서울시 보도 통계자료 (서울 열린데이터광장, 공공누리 제1유형)" },
};

// 지역 목록. center는 지도 가운데, half는 지도 한 변의 절반(m), gu는 보도 통계에서 먼저 볼 관리 자치구.
export const REGIONS = [
  { id: "mokdong", city: "seoul", name: "목동", desc: "서울 · 목동야구장 · 아파트 단지", center: [37.5310, 126.8790], half: 420, gu: ["양천구"] },
  { id: "jamsil", city: "seoul", name: "잠실", desc: "서울 · 잠실종합운동장 · 아파트 단지", center: [37.5110, 127.0800], half: 420, gu: ["송파구"] },
  { id: "gocheok", city: "seoul", name: "고척", desc: "서울 · 고척스카이돔 · 구로 골목", center: [37.4985, 126.8660], half: 420, gu: ["구로구", "양천구"] },
  { id: "worldcup", city: "seoul", name: "상암", desc: "서울 · 서울월드컵경기장 · 성산동", center: [37.5675, 126.8990], half: 420, gu: ["마포구"] },
  { id: "banwoldang", city: "daegu", name: "반월당", desc: "대구 · 반월당역 · 더현대 대구", center: [35.8655, 128.5934], half: 420 },
  { id: "dongseongro", city: "daegu", name: "동성로", desc: "대구 · 동성로 · 국채보상운동기념공원", center: [35.8690, 128.6010], half: 420 },
  { id: "seomun", city: "daegu", name: "서문시장", desc: "대구 · 서문시장 · 대신동", center: [35.8691, 128.5800], half: 420 },
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
const WIDE_ROAD = 10; // 이 폭(m) 이상인 차도는 걸어서 들어갈 수 없고, 교차로 앞 횡단보도로만 건넌다 (js/config.js의 WIDE_ROAD와 같다)
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

const pubCache = {};
function publicCrosswalks(region, toXZ, size) {
  const src = PUBLIC_CROSSWALKS[region.city];
  if (!src) return null;
  const base = join(PUBLIC_DIR, src.file);
  if (!existsSync(base + ".shp")) { console.warn(`[${region.id}] 공공 횡단보도 파일이 없어 규칙 횡단보도만 씁니다: ${base}.shp`); return null; }
  if (!pubCache[region.city]) {
    const shp = readShapefile(base), toLL = tmFromPrj(shp.prj);
    pubCache[region.city] = shp.features.filter((ft) => ft.geom && ft.geom.rings && ft.geom.rings[0].length >= 3)
      .map((ft) => ft.geom.rings[0].map(([x, y]) => toLL(x, y)));
  }
  const out = [];
  for (const ring of pubCache[region.city]) {
    const pts = ring.map(([lon, lat]) => toXZ({ lon, lat }));
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    if (cx > -50 && cz > -50 && cx < size + 50 && cz < size + 50) out.push(pts);
  }
  return out;
}

// GIS건물통합정보에서 지도와 배경 범위(SCENERY_MARGIN)의 건물을 읽는다. 파일이 없으면 null
// 열(브이월드 AL_D010 명세 순서): A9 건축물용도명, A11 건축물구조명, A13 사용승인일자, A16 높이(m),
//   A24 건물명, A25 건물동명, A26 지상층수, A27 지하층수
// 구조는 외벽을 고르는 데만 쓰므로 몇 갈래로 줄인다: w 목구조, b 벽돌, k 블록·석조, s 철골(공장·창고 패널), 그 밖은 철근콘크리트
const structClass = (s) => (/목구조/.test(s) ? "w" : /벽돌/.test(s) ? "b" : /블록|석조|조적/.test(s) ? "k" : /철골/.test(s) && !/콘크리트/.test(s) ? "s" : "");
// 아파트 동 이름: "101동", "A동", "상가동"처럼 벽에 써 붙일 만한 것만 쓴다 ("주건축물제1동" 같은 대장 표기는 뺀다)
const dongLabel = (s) => (/^([0-9]{1,4}|[A-Z]|상가|관리)동$/.test(s) ? s : /^[0-9]{3,4}$/.test(s) ? s + "동" : "");
function publicBuildings(region, toXZ) {
  const src = PUBLIC_BUILDINGS[region.city];
  if (!src) return null;
  const base = join(PUBLIC_DIR, src.file);
  if (!existsSync(base + ".shp")) { console.warn(`[${region.id}] 건물 공공데이터가 없어 OSM 건물만 씁니다: ${base}.shp`); return null; }
  const toLL = tmFromPrj(readFileSync(base + ".prj", "latin1"));
  const [s, w, n, e] = bboxOf(region, SCENERY_MARGIN);
  const shp = readShapefileWhere(base, (bb) => {
    const [lon, lat] = toLL((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
    return lat > s && lat < n && lon > w && lon < e;
  }, ["A9", "A11", "A13", "A16", "A24", "A25", "A26", "A27"]);
  const out = [];
  for (const ft of shp.features) {
    const p = ft.props, floors = Number(p.A26) || 0, under = Number(p.A27) || 0, height = Number(p.A16) || 0;
    if (!floors && under && !height) continue; // 지하에만 있는 시설
    for (const ring of ft.geom.rings) {
      if (ringArea(ring) > 0) continue; // Shapefile 바깥 고리는 시계 방향이다 (반시계는 안쪽 구멍)
      const pts = ring.map(([x, y]) => { const [lon, lat] = toLL(x, y); return toXZ({ lon, lat }); });
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      const a = Math.abs(ringArea(pts));
      if (pts.length < 3 || a < 6) continue;
      const year = Number(String(p.A13 || "").slice(0, 4));
      out.push({ pts, a, floors, height, use: p.A9 || "", name: p.A24 || "", seed: ft.idx,
        st: structClass(p.A11 || ""), year: year > 1900 && year < 2100 ? year : 0, dong: dongLabel((p.A25 || "").replace(/\s/g, "")) });
    }
  }
  return out;
}

// 서울 보도 통계(노선명별 보도 폭)를 읽어 노선명 → 보도 폭(m) 표를 만든다. 서울이 아니거나 파일이 없으면 null
const sidewalkCache = {};
function sidewalkWidths(region) {
  const src = PUBLIC_SIDEWALKS[region.city];
  if (!src) return null;
  const file = join(PUBLIC_DIR, src.file);
  if (!existsSync(file)) { console.warn(`[${region.id}] 보도 통계 파일이 없어 보도 폭을 기본값으로 씁니다: ${file}`); return null; }
  // 긴 길은 구간마다 폭이 크게 다르므로, 그 지역 관리 자치구(region.gu)의 구간이 있으면 그것만 쓴다
  const rows = sidewalkCache[region.city] || (sidewalkCache[region.city] = JSON.parse(readFileSync(file, "utf8")).filter((r) => !r.kind || r.kind.includes("보도")));
  const all = new Map(), local = new Map();
  for (const r of rows) {
    (all.get(r.name) || all.set(r.name, []).get(r.name)).push(r.width);
    if ((region.gu || []).includes(r.gu)) (local.get(r.name) || local.set(r.name, []).get(r.name)).push(r.width);
  }
  const table = new Map();
  for (const [name, ws] of all) {
    const use = (local.get(name) || ws).sort((a, b) => a - b);
    table.set(name, Math.round(Math.max(1.5, Math.min(8, use[Math.floor(use.length / 2)])) * 10) / 10);
  }
  return table;
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
  node[highway=crossing](${bb});
);
out geom;`;
  // 받은 OSM 원본은 참고자료/osm_cache/에 저장해 두고 다시 쓴다 (서버 오류로 멈추지 않고, 같은 원본으로 다시 만들 수 있게).
  // 새로 받으려면 --fresh를 붙인다
  const cacheFile = join(OSM_CACHE, `${region.id}.json`);
  let data;
  if (!FRESH && existsSync(cacheFile)) {
    data = JSON.parse(readFileSync(cacheFile, "utf8"));
    console.log(`[${region.id}] OSM 원본: ${cacheFile} (${data.osm3s?.timestamp_osm_base || "시각 모름"})`);
  } else {
    console.log(`[${region.id}] Overpass 요청`);
    data = await overpass(query);
    mkdirSync(OSM_CACHE, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(data));
  }

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
  const water = new Uint8Array(N * N);
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

  const buildings = [], roads = [], green = [], trees = [], landmarks = [], crossings = [];
  const carMeta = new Map();
  let measured = 0;
  // OSM 건물은 먼저 모아 두고, 공공 건물과 맞춘 뒤에 그린다 (아래 "건물 합치기")
  const osmBuildings = [];
  function addBuilding(pts, t, id) {
    const a = Math.abs(ringArea(pts));
    if (a < 6) return;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (!inside(cx, cz, SCENERY_MARGIN)) return;
    osmBuildings.push({ pts, t, id, a });
  }
  // gov: 공공데이터 건물이면 1 (지도 파일에서 OSM 건물과 구분한다)
  // extra: 공공 건물의 겉모습 정보 { st 구조, y 사용승인 연도, dn 동 이름, nm 단지 이름 } (있는 것만)
  function pushBuilding(pts, h, kind, m, gov, extra) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const p = inside(cx, cz, 0) ? pts : pts.map(([x, z]) => [Math.round(x * 2) / 2, Math.round(z * 2) / 2]);
    if (m) measured++;
    buildings.push({ p, h: Math.round(h * 10) / 10, k: kind, m: m ? 1 : 0, ...(gov ? { g: 1 } : {}), ...(extra || {}) });
    if (kind !== "roof") fillPolygon(pts, building); // 지붕만 있는 구조물(주유소 캐노피 등)은 밑으로 걸어 다닐 수 있다
  }

  for (const el of data.elements) {
    const t = el.tags || {};
    const geom = el.geometry ? el.geometry.map(toXZ) : null;

    if (el.type === "way" && t.highway && geom && t.tunnel !== "yes" && !(Number(t.layer) < 0)) {
      if (ROAD_WIDTH[t.highway]) {
        const lanes = num(t.lanes);
        const w = num(t.width) || (lanes ? lanes * 3.3 + 1.5 : ROAD_WIDTH[t.highway]);
        const bridge = (t.bridge && t.bridge !== "no") || Number(t.layer) > 0;
        const rd = { p: geom, w: Math.round(w * 10) / 10, k: "car", ln: lanes || 0, ...(bridge ? { br: 1 } : {}) };
        roads.push(rd);
        carMeta.set(rd, { name: t.name || "", type: t.highway, fixed: !!num(t.width) }); // 폭 보정과 보도 폭에 쓴다 (지도 파일에는 넣지 않는다)
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
        fillPolygon(pts, g === "water" ? water : area); // 공원, 광장, 주차장은 걸어 다닐 수 있다
      }
      if (t.natural === "tree_row") for (const p of geom) trees.push(p);
    }
    if (el.type === "node" && t.highway === "crossing") crossings.push(toXZ(el));
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

  // ---------- 건물 합치기: 공공데이터(GIS건물통합정보)와 OSM ----------
  // 같은 건물(겹치는 넓이가 작은 쪽의 50% 이상)이면 모양은 공공데이터를 쓴다. 층수는 건축물대장 → OSM → 추정 순서다.
  // 한 건물의 모양과 높이는 한 출처에서만 가져온다(CC BY 공공데이터와 ODbL을 한 레코드에 섞지 않는다):
  //  공공 건물에 층수가 있으면 공공 건물, 없고 겹치는 OSM 건물에 층수 기록이 있으면 OSM 건물, 둘 다 없으면 공공 모양에 추정 높이.
  const gov = publicBuildings(region, toXZ);
  const bstat = { gov: 0, osm: 0, matched: 0, govOnly: 0, osmOnly: 0, osmKept: 0, govDropped: 0, onRoad: 0, floorGap: [] };
  if (!gov) {
    for (const o of osmBuildings) {
      const kind = buildingKind(o.t);
      const { h, measured: m } = kind === "roof" ? { h: 4, measured: false } : buildingHeight(o.t, o.a, o.id);
      pushBuilding(o.pts, h, kind, m, false);
    }
    bstat.osm = bstat.osmOnly = osmBuildings.length;
  } else {
    const bboxOf = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    const inPoly = (x, z, pts) => {
      let ins = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, zi] = pts[i], [xj, zj] = pts[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
      }
      return ins;
    };
    const BIN = 40, bins = new Map();
    osmBuildings.forEach((o, i) => {
      o.bb = bboxOf(o.pts);
      for (let bx = Math.floor(o.bb[0] / BIN); bx <= Math.floor(o.bb[2] / BIN); bx++)
        for (let bz = Math.floor(o.bb[1] / BIN); bz <= Math.floor(o.bb[3] / BIN); bz++) (bins.get(bx + "," + bz) || bins.set(bx + "," + bz, []).get(bx + "," + bz)).push(i);
    });
    // 겹치는 넓이: 두 bbox가 겹치는 칸을 촘촘히 찍어 센다
    const overlap = (g, o) => {
      const x0 = Math.max(g.bb[0], o.bb[0]), z0 = Math.max(g.bb[1], o.bb[1]), x1 = Math.min(g.bb[2], o.bb[2]), z1 = Math.min(g.bb[3], o.bb[3]);
      if (x0 >= x1 || z0 >= z1) return 0;
      const st = Math.min(g.a, o.a) < 60 ? 0.5 : 1;
      let n = 0;
      for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) if (inPoly(x, z, g.pts) && inPoly(x, z, o.pts)) n++;
      return n * st * st;
    };
    // 차도 중심선을 4m 넘게 덮는 공공 건물은 쓰지 않는다. 두 데이터의 골목 위치가 어긋났거나 길 위를 덮은 아케이드라서,
    // 그대로 세우면 OSM 골목이 막혀 걷는 영역이 끊긴다
    const roadPts = new Map();
    for (const rd of roads) {
      if (rd.k !== "car" || rd.br) continue;
      for (let i = 0; i + 1 < rd.p.length; i++) {
        const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
        for (let t = 0; t <= L; t += 1) {
          const x = x1 + ((x2 - x1) * t) / Math.max(L, 0.01), z = z1 + ((z2 - z1) * t) / Math.max(L, 0.01);
          const k = Math.floor(x / BIN) + "," + Math.floor(z / BIN);
          (roadPts.get(k) || roadPts.set(k, []).get(k)).push([x, z]);
        }
      }
    }
    let onRoad = 0;
    const govAll = gov.length;
    for (let gi = gov.length - 1; gi >= 0; gi--) {
      const g = gov[gi], bb = bboxOf(g.pts);
      let n = 0;
      for (let bx = Math.floor(bb[0] / BIN); bx <= Math.floor(bb[2] / BIN) && n < 4; bx++)
        for (let bz = Math.floor(bb[1] / BIN); bz <= Math.floor(bb[3] / BIN) && n < 4; bz++)
          for (const [x, z] of roadPts.get(bx + "," + bz) || []) if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && inPoly(x, z, g.pts) && ++n >= 4) break;
      if (n >= 4) { gov.splice(gi, 1); onRoad++; }
    }
    const cover = new Float64Array(osmBuildings.length); // OSM 건물마다 공공 건물이 덮은 넓이
    for (const g of gov) {
      g.bb = bboxOf(g.pts);
      const cand = new Set();
      for (let bx = Math.floor(g.bb[0] / BIN); bx <= Math.floor(g.bb[2] / BIN); bx++)
        for (let bz = Math.floor(g.bb[1] / BIN); bz <= Math.floor(g.bb[3] / BIN); bz++) for (const i of bins.get(bx + "," + bz) || []) cand.add(i);
      g.ov = [...cand].map((i) => ({ i, v: overlap(g, osmBuildings[i]) })).filter((x) => x.v > 0);
      for (const x of g.ov) cover[x.i] += x.v;
    }
    // OSM 건물은 공공 건물들이 그 넓이의 절반 이상을 덮을 때만 공공 건물로 바꾼다.
    // (큰 OSM 고층 건물 발밑의 작은 공공 부속 건물 하나 때문에 고층 건물이 사라지지 않게)
    const covered = osmBuildings.map((o, i) => cover[i] >= 0.5 * o.a);
    const state = new Uint8Array(osmBuildings.length); // 0 OSM 건물로 그림, 1 공공 건물로 바뀜
    osmBuildings.forEach((_, i) => { if (covered[i]) state[i] = 1; });
    let dropped = 0;
    // 목구조 저층 건물은 "wood"(기와 경사지붕 주택)로 그린다. 대구 원도심에 많다
    const govKind = (g) => (/교회|성당/.test(g.name) || g.use === "종교시설" ? "church" : g.use === "공동주택" ? "apartments"
      : g.st === "w" && (g.floors || 1) <= 2 && g.a < 400 ? "wood" : g.use === "단독주택" && g.floors > 0 && g.floors <= 2 ? "low" : "other");
    const looks = (g, kind) => {
      const x = {};
      if (g.st) x.st = g.st;
      if (g.year) x.y = g.year;
      if (kind === "apartments" && g.dong) x.dn = g.dong;
      if (kind === "apartments" && g.name && g.name.length <= 14) x.nm = g.name;
      return x;
    };
    const emit = (g, est) => {
      const kind = govKind(g);
      // 높이: 층수가 있으면 실제 높이(m)를 쓰되, 층수와 맞지 않는 값(층당 2.4m 미만이나 7m 초과)은 층수로 계산한다
      if (!est) {
        const fromFloors = g.floors * FLOOR + 1;
        const h = g.height > 0 && g.height / g.floors >= 2.4 && g.height / g.floors <= 7 ? g.height + 0.6 : fromFloors;
        return pushBuilding(g.pts, h, kind, true, true, looks(g, kind));
      }
      if (g.height > 0) return pushBuilding(g.pts, g.height, kind, true, true, looks(g, kind));
      const { h } = buildingHeight({ building: kind === "apartments" ? "apartments" : kind === "low" || kind === "wood" ? "house" : "yes" }, g.a, g.seed);
      pushBuilding(g.pts, h, kind, false, true, looks(g, kind));
    };
    for (const g of gov) {
      // 덮이지 않은(그대로 남는) OSM 건물 안에 절반 넘게 들어가 있으면 그리지 않는다 (겹쳐 그리지 않게)
      if (g.ov.some((x) => x.v >= 0.5 * g.a && !covered[x.i])) { dropped++; continue; }
      // 서로 절반 넘게 겹치면 같은 건물이다
      const same = g.ov.find((x) => x.v >= 0.5 * g.a && x.v >= 0.5 * osmBuildings[x.i].a);
      if (same) bstat.matched++;
      if (g.floors > 0) {
        emit(g, false);
        const o = same && osmBuildings[same.i], lv = o && num(o.t["building:levels"]);
        if (lv && Math.abs(lv - g.floors) > 3) bstat.floorGap.push({ name: g.name || o.t.name || "", gov: g.floors, osm: lv, x: Math.round(g.pts[0][0]), z: Math.round(g.pts[0][1]) });
        continue;
      }
      // 층수가 없고, 같은 건물이 OSM에 층수 기록과 함께 있으면 OSM 건물을 쓴다
      if (same && buildingHeight(osmBuildings[same.i].t, osmBuildings[same.i].a, osmBuildings[same.i].id).measured) { state[same.i] = 0; bstat.osmKept++; continue; }
      emit(g, true);
    }
    // 공공데이터로 바뀌지 않은 OSM 건물
    osmBuildings.forEach((o, i) => {
      if (state[i] === 1) return;
      const kind = buildingKind(o.t);
      const { h, measured: m } = kind === "roof" ? { h: 4, measured: false } : buildingHeight(o.t, o.a, o.id);
      pushBuilding(o.pts, h, kind, m, false);
    });
    bstat.gov = govAll; bstat.onRoad = onRoad; bstat.osm = osmBuildings.length;
    bstat.govOnly = gov.filter((g) => !g.ov.length).length;
    bstat.osmOnly = osmBuildings.filter((_, i) => cover[i] === 0).length;
    bstat.govDropped = dropped;
  }

  // ---------- 차도 폭과 보도 폭 ----------
  // OSM에 width 태그가 없는 차도는 공공 횡단보도 도형이 그 차도를 가로지르는 길이(연석에서 연석까지)로 폭을 다시 정한다.
  // 두 줄 차도처럼 횡단보도 하나가 여러 차도를 건너면, 각 점을 가장 가까운 차도에 나눠 센다.
  // 같은 이름·종류의 차도는 한 길이 여러 조각으로 나뉜 것이므로, 횡단보도가 없는 조각도 그 길의 값을 쓴다.
  const pub = publicCrosswalks(region, toXZ, size);
  const carRoads = roads.filter((rd) => rd.k === "car");
  const segs = [];
  for (const rd of carRoads) for (let i = 0; i + 1 < rd.p.length; i++) {
    const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
    if (L >= 0.01) segs.push({ rd, x1, z1, L, tx: (x2 - x1) / L, tz: (z2 - z1) / L });
  }
  const nearestSeg = (x, z, list = segs) => {
    let best = null, bd = Infinity;
    for (const s of list) {
      const t = Math.max(0, Math.min(s.L, (x - s.x1) * s.tx + (z - s.z1) * s.tz));
      const d = Math.hypot(s.x1 + s.tx * t - x, s.z1 + s.tz * t - z);
      if (d < bd) { bd = d; best = s; }
    }
    return { s: best, d: bd };
  };
  const inRing = (px, pz, ring) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  };
  const samples = new Map(); // 차도 → 잰 폭 목록
  for (const ring of pub || []) {
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const { s: main, d } = nearestSeg(cx, cz);
    if (!main || d > main.rd.w / 2 + 6) continue; // 차도 위가 아니다
    const local = segs.filter((s) => Math.abs(s.x1 - cx) < s.L + 60 && Math.abs(s.z1 - cz) < s.L + 60);
    const count = new Map();
    for (let k = -40; k <= 40; k += 0.5) {
      const px = cx - main.tz * k, pz = cz + main.tx * k;
      if (!inRing(px, pz, ring)) continue;
      const own = nearestSeg(px, pz, local).s.rd;
      count.set(own, (count.get(own) || 0) + 0.5);
    }
    for (const [rd, len] of count) if (len >= 3) (samples.get(rd) || samples.set(rd, []).get(rd)).push(len);
  }
  const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const byName = new Map();
  for (const [rd, list] of samples) {
    const m = carMeta.get(rd);
    if (m.name) (byName.get(m.type + "|" + m.name) || byName.set(m.type + "|" + m.name, []).get(m.type + "|" + m.name)).push(...list);
  }
  let widthMeasured = 0, widthByName = 0;
  for (const rd of carRoads) {
    const m = carMeta.get(rd);
    if (m.fixed) continue;
    let list = samples.get(rd), own = true;
    if (!list && m.name) { list = byName.get(m.type + "|" + m.name); own = false; }
    if (!list) continue;
    // 횡단보도가 연석 밖으로 조금 나오거나 일부만 덮는 경우가 있어, 원래 추정값의 0.5~1.8배 안으로 묶는다
    let w = Math.max(3, rd.w * 0.5, Math.min(rd.w * 1.8, median(list)));
    // 큰 차도(막힘)인지 아닌지는 바꾸지 않는다. 교차로 횡단보도는 회전 차로까지 덮어 길게 재지기도 해서,
    // 단지 안 골목이 큰 차도로 바뀌어 걷는 영역이 끊기거나, 큰길이 아무 데서나 건너는 길로 바뀌는 것을 막는다
    w = rd.w >= WIDE_ROAD ? Math.max(WIDE_ROAD, w) : Math.min(WIDE_ROAD - 0.5, w);
    // 교차로는 폭 5m 이상 차도끼리 만나는 곳만 세므로(js/scenery.js도 같다), 5m 이상이던 길은 5m 밑으로 내리지 않는다
    if (rd.w >= 5) w = Math.max(5, w);
    rd.w = Math.round(w * 10) / 10;
    rd.wm = 1; // 공공 횡단보도로 잰 폭
    if (own) widthMeasured++; else widthByName++;
  }
  // 보도 폭: 서울은 보도 통계의 노선명별 폭(가운값), 나머지는 큰길 SIDEWALK, 그 밖의 길 SIDEWALK / 2
  const walkWidth = sidewalkWidths(region);
  let sidewalkMatched = 0;
  for (const rd of carRoads) {
    const m = carMeta.get(rd), sw = walkWidth && m.name ? walkWidth.get(m.name) : null;
    if (sw) { rd.sw = sw; sidewalkMatched++; }
    stampLine(rd.p, rd.w / 2 + (rd.sw || (rd.w >= WIDE_ROAD ? SIDEWALK : SIDEWALK / 2)));
  }

  // 가게 앞 공간: 보도 폭은 추정값이라, 실제 위치에 선 건물과 보도 사이에 좁은 틈이 남는다.
  // 걷는 영역에서 4m 안이면서 건물에서도 4m 안인 빈칸(물 제외)은 건물 앞 공간으로 보고 걸을 수 있게 한다
  const FRONT = Math.round(4 / CELL);
  const near = (src) => {
    const out = new Uint8Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!src[r * N + c]) continue;
      for (let dr = -FRONT; dr <= FRONT; dr++) for (let dc = -FRONT; dc <= FRONT; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < N && cc < N && dr * dr + dc * dc <= FRONT * FRONT) out[rr * N + cc] = 1;
      }
    }
    return out;
  };
  const walkOpen = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) walkOpen[i] = area[i] && !building[i] ? 1 : 0;
  const nearWalk = near(walkOpen), nearBuilding = near(building);
  let frontage = 0;
  for (let i = 0; i < N * N; i++) if (!area[i] && !building[i] && !water[i] && nearWalk[i] && nearBuilding[i]) { area[i] = 1; frontage++; }

  // ---------- 큰 차도와 횡단보도 ----------
  // 큰 차도(폭 WIDE_ROAD 이상)의 차로 칸은 막는다. 건널 수 있는 곳은 다음 순서로 정한다.
  //  1) 공공데이터 횡단보도(서울시·대구시 횡단보도 도형): 실제 위치와 모양 그대로 연다.
  //  2) 규칙 횡단보도(교차로, OSM 횡단보도, 220m 넘게 건널 곳이 없는 큰길의 중간):
  //     공공데이터가 있으면, 실제 횡단보도가 근처에 없고 그 자리를 열어야 걷는 영역이 끊기지 않을 때만 연다.
  //     공공데이터가 없으면 모두 연다. js/scenery.js는 여기서 정한 횡단보도만 그린다.
  const carway = new Uint8Array(N * N);
  const keyOf = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
  const nodeUse = new Map();
  // 교차로는 폭 5m 이상 차도끼리 만나는 곳만 센다 (주차장 진입로 같은 서비스 도로는 빼서 횡단보도가 너무 많아지지 않게 한다)
  for (const rd of roads) if (rd.k === "car" && rd.w >= 5) for (const p of rd.p) {
    const e = nodeUse.get(keyOf(p)) || { n: 0, w: 0, p };
    e.n++; e.w = Math.max(e.w, rd.w); nodeUse.set(keyOf(p), e);
  }
  const junctions = [...nodeUse.values()].filter((e) => e.n >= 2).map((e) => ({ x: e.p[0], z: e.p[1], r: e.w / 2 + 2.5 }));
  const MAX_GAP = 220;
  const DUAL = 20; // 상하행이 따로 그려진 큰길(두 줄 차도)도 함께 열리도록, 횡단보도는 이 거리(m) 안의 나란한 차도까지 연다
  const wideRoads = roads.filter((rd) => rd.k === "car" && rd.w >= WIDE_ROAD && !rd.br);

  // 큰 차도 칸
  for (const rd of wideRoads) {
    const hw = rd.w / 2 - 0.2;
    for (let i = 0; i + 1 < rd.p.length; i++) {
      const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1];
      const L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.01) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
      const minX = Math.min(x1, x2) - hw, maxX = Math.max(x1, x2) + hw, minZ = Math.min(z1, z2) - hw, maxZ = Math.max(z1, z2) + hw;
      for (let r = Math.max(0, Math.floor(minZ / CELL)); r <= Math.min(N - 1, Math.floor(maxZ / CELL)); r++) {
        for (let c = Math.max(0, Math.floor(minX / CELL)); c <= Math.min(N - 1, Math.floor(maxX / CELL)); c++) {
          const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
          const t = Math.max(0, Math.min(L, (px - x1) * tx + (pz - z1) * tz));
          if (Math.hypot(x1 + tx * t - px, z1 + tz * t - pz) <= hw) carway[r * N + c] = 1;
        }
      }
    }
  }

  // 1) 공공데이터 횡단보도: 가장 가까운 차도의 방향에 맞춘 사각형(길 방향 길이 L, 길을 가로지르는 길이 W)으로 정리한다
  const hasPublic = pub !== null;
  const crosswalks = [];
  const pubOpen = new Uint8Array(N * N);
  for (const ring of pub || []) {
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    let best = null, wideBest = null;
    for (const rd of roads) {
      if (rd.k !== "car") continue;
      for (let i = 0; i + 1 < rd.p.length; i++) {
        const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
        if (L < 0.01) continue;
        const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
        const t = Math.max(0, Math.min(L, (cx - x1) * tx + (cz - z1) * tz));
        const d = Math.hypot(x1 + tx * t - cx, z1 + tz * t - cz);
        if (!best || d - rd.w / 2 < best.d - best.w / 2) best = { d, tx, tz, w: rd.w };
        // 큰 차도 위에 걸쳐 있으면 옆 골목보다 큰 차도의 횡단보도로 본다 (교차로에서는 둘 다 가깝다)
        if (rd.w >= WIDE_ROAD && !rd.br && d <= rd.w / 2 + 1 && (!wideBest || d < wideBest.d)) wideBest = { d, tx, tz, w: rd.w };
      }
    }
    if (wideBest) best = wideBest;
    if (!best || best.d > best.w / 2 + 4) continue; // 차도 위가 아니다 (주차장 안 등)
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ring) {
      const a = (x - cx) * best.tx + (z - cz) * best.tz, b = -(x - cx) * best.tz + (z - cz) * best.tx;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
    const r1 = (v) => Math.round(v * 10) / 10;
    crosswalks.push({ x: r1(cx + best.tx * am - best.tz * bm), z: r1(cz + best.tz * am + best.tx * bm), tx: +best.tx.toFixed(4), tz: +best.tz.toFixed(4),
      L: r1(Math.max(2, a1 - a0)), W: r1(Math.max(3, b1 - b0)), ...(best.w >= WIDE_ROAD ? { wide: 1 } : {}) });
    if (best.w < WIDE_ROAD) continue;
    // 도형 안(과 가장자리 0.6m) 칸을 연다
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    for (let r = Math.max(0, Math.floor((Math.min(...zs) - 1) / CELL)); r <= Math.min(N - 1, Math.floor((Math.max(...zs) + 1) / CELL)); r++) {
      for (let c = Math.max(0, Math.floor((Math.min(...xs) - 1) / CELL)); c <= Math.min(N - 1, Math.floor((Math.max(...xs) + 1) / CELL)); c++) {
        const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
        let ins = false, near = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, zi] = ring[i], [xj, zj] = ring[j];
          if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) ins = !ins;
          const dx = xj - xi, dz = zj - zi, LL = dx * dx + dz * dz;
          const t = LL > 0 ? Math.max(0, Math.min(1, ((px - xi) * dx + (pz - zi) * dz) / LL)) : 0;
          if (Math.hypot(xi + dx * t - px, zi + dz * t - pz) < 0.6) near = true;
        }
        if (ins || near) pubOpen[r * N + c] = 1;
      }
    }
  }
  // 큰 차도를 실제로 여는 공공 횡단보도만 센다 (골목 횡단보도가 가까이 있다고 큰길 교차로를 비워 두지 않게)
  const nearPub = (x, z, r) => crosswalks.some((c) => c.wide && Math.hypot(c.x - x, c.z - z) < r);
  // 공공 횡단보도 도형이 차도 폭 일부만 덮거나 두 줄 차도의 한쪽에만 있을 수 있으므로,
  // 같은 줄 위의 큰 차도 칸(DUAL 안의 나란한 차도 포함)을 횡단보도 폭만큼 함께 연다
  for (const cw of crosswalks) {
    if (!cw.wide) continue;
    const halfL = Math.max(1.5, cw.L / 2);
    for (const rd of wideRoads) for (let i = 0; i + 1 < rd.p.length; i++) {
      const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.01) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
      const along = (cw.x - x1) * tx + (cw.z - z1) * tz, across = Math.abs(-(cw.x - x1) * tz + (cw.z - z1) * tx);
      if (along < -halfL || along > L + halfL || across > rd.w / 2 + DUAL) continue;
      const ox = x1 + tx * along, oz = z1 + tz * along, hw = rd.w / 2 + 1;
      for (let r = Math.max(0, Math.floor((oz - hw - halfL) / CELL)); r <= Math.min(N - 1, Math.floor((oz + hw + halfL) / CELL)); r++)
        for (let c = Math.max(0, Math.floor((ox - hw - halfL) / CELL)); c <= Math.min(N - 1, Math.floor((ox + hw + halfL) / CELL)); c++) {
          const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
          if (Math.abs((px - ox) * cw.tx + (pz - oz) * cw.tz) < halfL && Math.abs(-(px - ox) * cw.tz + (pz - oz) * cw.tx) < hw && carway[r * N + c]) pubOpen[r * N + c] = 1;
        }
    }
  }

  // 2) 규칙 횡단보도 후보: 교차로 앞 원, OSM 횡단보도와 중간 횡단보도의 띠
  for (const rd of wideRoads) {
    const cum = [0];
    for (let i = 1; i < rd.p.length; i++) cum.push(cum[i - 1] + Math.hypot(rd.p[i][0] - rd.p[i - 1][0], rd.p[i][1] - rd.p[i - 1][1]));
    const at = (d) => {
      let i = 1;
      while (i < rd.p.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / Math.max(0.01, cum[i] - cum[i - 1]);
      return [rd.p[i - 1][0] + (rd.p[i][0] - rd.p[i - 1][0]) * t, rd.p[i - 1][1] + (rd.p[i][1] - rd.p[i - 1][1]) * t];
    };
    const opens = [0, cum[cum.length - 1]];
    rd.p.forEach((p, i) => { const e = nodeUse.get(keyOf(p)); if (e && e.n >= 2) opens.push(cum[i]); });
    const pts = [...crossings, ...crosswalks.filter((c) => c.wide).map((c) => [c.x, c.z])];
    for (const c of pts) for (let i = 1; i < rd.p.length; i++) {
      const [x1, z1] = rd.p[i - 1], [x2, z2] = rd.p[i], L = cum[i] - cum[i - 1];
      if (L < 0.01) continue;
      const along = ((c[0] - x1) * (x2 - x1) + (c[1] - z1) * (z2 - z1)) / L;
      const across = Math.abs((-(c[0] - x1) * (z2 - z1) + (c[1] - z1) * (x2 - x1)) / L);
      if (along >= 0 && along <= L && across < rd.w / 2 + DUAL) opens.push(cum[i - 1] + along);
    }
    opens.sort((a, b) => a - b);
    for (let k = 1; k < opens.length; k++) {
      const gap = opens[k] - opens[k - 1];
      if (gap <= MAX_GAP) continue;
      const parts = Math.ceil(gap / (MAX_GAP * 0.9));
      for (let q = 1; q < parts; q++) {
        const p = at(opens[k - 1] + (gap * q) / parts);
        if (inside(p[0], p[1], -20)) crossings.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
      }
    }
  }
  const cands = [];
  const cellsWhere = (x, z, R, test) => {
    const out = [];
    for (let r = Math.max(0, Math.floor((z - R) / CELL)); r <= Math.min(N - 1, Math.floor((z + R) / CELL)); r++)
      for (let c = Math.max(0, Math.floor((x - R) / CELL)); c <= Math.min(N - 1, Math.floor((x + R) / CELL)); c++) {
        const i = r * N + c;
        if (carway[i] && test(c * CELL + CELL / 2, r * CELL + CELL / 2)) out.push(i);
      }
    return out;
  };
  for (const j of junctions) {
    if (hasPublic && nearPub(j.x, j.z, 35)) continue; // 실제 횡단보도가 있는 교차로는 그것을 쓴다
    const cells = cellsWhere(j.x, j.z, j.r, (px, pz) => Math.hypot(j.x - px, j.z - pz) < j.r);
    if (cells.length) cands.push({ kind: "junction", p: [j.x, j.z], cells });
  }
  for (const cp of crossings) {
    if (hasPublic && nearPub(cp[0], cp[1], 25)) continue;
    const strips = [];
    for (const rd of wideRoads) for (let i = 0; i + 1 < rd.p.length; i++) {
      const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.01) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
      const along = (cp[0] - x1) * tx + (cp[1] - z1) * tz, across = Math.abs(-(cp[0] - x1) * tz + (cp[1] - z1) * tx);
      if (along >= 0 && along <= L && across < rd.w / 2 + DUAL) strips.push({ x: x1 + tx * along, z: z1 + tz * along, tx, tz, hw: rd.w / 2 + 1 });
    }
    const cells = cellsWhere(cp[0], cp[1], 50, (px, pz) => strips.some((o) => Math.abs((px - o.x) * o.tx + (pz - o.z) * o.tz) < 2 && Math.abs(-(px - o.x) * o.tz + (pz - o.z) * o.tx) < o.hw));
    if (cells.length) cands.push({ kind: "crossing", p: cp, cells });
  }

  // 공공 횡단보도 자리를 열고, 규칙 후보는 (공공데이터가 있으면) 끊긴 걷는 영역을 이을 때만 연다
  for (let i = 0; i < N * N; i++) if (pubOpen[i]) carway[i] = 0;
  const usedJunctions = [], usedCrossings = [];
  const applyCand = (cd) => {
    for (const i of cd.cells) carway[i] = 0;
    (cd.kind === "junction" ? usedJunctions : usedCrossings).push(cd.p);
  };
  if (!hasPublic) cands.forEach(applyCand);
  else {
    const base = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) base[i] = area[i] && !building[i] && !carway[i] ? 1 : 0;
    const lab = new Int32Array(N * N).fill(-1), size0 = [];
    for (let i = 0; i < N * N; i++) {
      if (!base[i] || lab[i] !== -1) continue;
      const k = size0.length, st = [i]; lab[i] = k; let cnt = 0;
      while (st.length) {
        const cur = st.pop(); cnt++;
        const r = Math.floor(cur / N), c = cur % N;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
          const ni = nr * N + nc;
          if (base[ni] && lab[ni] === -1) { lab[ni] = k; st.push(ni); }
        }
      }
      size0.push(cnt);
    }
    const parent = size0.map((_, k) => k), total = size0.slice();
    const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    for (const cd of cands) {
      const roots = new Set();
      for (const i of cd.cells) {
        const r = Math.floor(i / N), c = i % N;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
          const l = lab[nr * N + nc];
          if (l >= 0) roots.add(find(l));
        }
      }
      if ([...roots].filter((k) => total[k] >= 300).length < 2) continue; // 이미 이어진 곳이면 열지 않는다
      applyCand(cd);
      const [first, ...rest] = [...roots];
      for (const k of rest) { parent[k] = first; total[first] += total[k]; }
    }
  }
  crossings.length = 0;
  crossings.push(...usedCrossings);

  // 걷는 칸 = 걸을 수 있는 영역이면서 건물 안도, 큰 차도도 아닌 칸. 가장 큰 연결 영역만 남긴다.
  const walk = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) walk[i] = area[i] && !building[i] && !carway[i] ? 1 : 0;
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

  // 칸 문자: "." 걷는 칸, "#" 건물, "=" 큰 차도(막힘), " " 그 밖의 막힌 땅
  const rows = [];
  for (let r = 0; r < N; r++) {
    let row = "";
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      row += walk[i] && comp[i] === best ? "." : building[i] ? "#" : carway[i] ? "=" : " ";
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
    scenery: { buildings, roads, green, trees, crossings, crosswalks, junctionsOpen: usedJunctions, crosswalkSource: hasPublic ? "public" : "rule" },
    sources: {
      crosswalks: hasPublic ? PUBLIC_CROSSWALKS[region.city].source : "규칙(교차로·OSM·중간 횡단보도)",
      crosswalkCounts: { public: crosswalks.length, publicOnWideRoads: crosswalks.filter((c) => c.wide).length, ruleJunctions: usedJunctions.length, ruleCrossings: usedCrossings.length },
      roadWidth: hasPublic ? "OSM width 태그, 없으면 공공 횡단보도 길이로 잰 값, 둘 다 없으면 도로 종류별 추정" : "OSM width·lanes 태그, 없으면 도로 종류별 추정",
      roadWidthCounts: { carRoads: carRoads.length, measured: widthMeasured, sameName: widthByName },
      sidewalk: walkWidth ? PUBLIC_SIDEWALKS[region.city].source : "추정(큰길 4m, 그 밖의 길 2m)",
      sidewalkMatched,
      frontageCells: frontage,
      buildings: gov ? `${PUBLIC_BUILDINGS[region.city].source}, © OpenStreetMap contributors (출처별로 따로 저장, g: 1이 공공데이터)` : "© OpenStreetMap contributors",
      buildingCounts: { gov: bstat.gov, osm: bstat.osm, matched: bstat.matched, govOnly: bstat.govOnly, osmOnly: bstat.osmOnly, osmKeptForFloors: bstat.osmKept, govInsideOsm: bstat.govDropped, govOnRoad: bstat.onRoad, floorGapOver3: bstat.floorGap.length },
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${region.id}.json`), JSON.stringify(out));
  const counts = merged.reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {});
  if (gov) {
    console.log(`[${region.id}] 건물 공공 ${bstat.gov}(같은 건물 ${bstat.matched}, 공공만 ${bstat.govOnly}, OSM 건물 안이라 뺌 ${bstat.govDropped}, 차도 위라 뺌 ${bstat.onRoad}) / OSM ${bstat.osm}(OSM만 ${bstat.osmOnly}, 층수 때문에 OSM으로 남김 ${bstat.osmKept})`);
    if (bstat.floorGap.length) console.log(`[${region.id}] 층수가 3층 넘게 다른 건물 ${bstat.floorGap.length}개:`, bstat.floorGap.slice(0, 8).map((f) => `${f.name || "(이름 없음)"} 공공 ${f.gov}층/OSM ${f.osm}층 (${f.x},${f.z})`).join(", "));
  }
  console.log(`[${region.id}] 걷는 칸 ${bestSize}/${N * N}, 건물 ${buildings.length}(층수 기록 ${measured}), 도로 ${roads.length}, 횡단보도 공공 ${crosswalks.length}(큰길 ${crosswalks.filter((c) => c.wide).length}) + 규칙 교차로 ${usedJunctions.length} + 규칙 띠 ${usedCrossings.length}, 차도 폭 실측 ${widthMeasured}+같은 길 ${widthByName}/${carRoads.length}, 보도 폭 ${sidewalkMatched}, 가게 앞 ${frontage}칸, 랜드마크`, counts);
}

const ids = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = ids ? ids.split(",") : null;
for (const region of REGIONS.filter((r) => !only || only.includes(r.id))) {
  const cached = !FRESH && existsSync(join(OSM_CACHE, `${region.id}.json`));
  await buildRegion(region);
  if (!cached) await new Promise((r) => setTimeout(r, 3000)); // Overpass 서버에 연달아 요청하지 않는다
}
writeFileSync(
  join(OUT_DIR, "regions.json"),
  JSON.stringify(REGIONS.map(({ id, name, desc, city }) => ({ id, name, desc, city })))
);
