// 차도마다 "양옆에 인도가 있다"는 게임의 가정을 데이터끼리 비교하고, 사람이 볼 확인 지점을 고른다.
// 증거: 큰길(10m 이상), 서울 보도 통계에 이름이 있는 길(rd.sw), 공공 횡단보도가 놓인 길. 증거가 없는 8m 미만 골목은 "인도 없음 추정".
// 실행: node tools/check/sidewalk.mjs [시드 수, 기본 20]   → 지역별 요약과 tools/check/out/sidewalk_points.json
// 검수 화면(tools/check/review.mjs)은 sidewalkReport()를 불러 쓴다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { ROOT, OUT } from "./browser.mjs";

const WIDE = 10, TIGHT = 1.2, STEP = 4, REACH = 6, PER_REGION = 10;

// 게임 코드(world.js)를 그대로 불러 경로를 만든다 (routes.mjs와 같은 방식)
const ctx = { console, Math, Uint8Array, Int32Array, Array, Error, JSON, encodeURIComponent, Number, Set };
ctx.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(join(ROOT, url), "utf8")) });
vm.createContext(ctx);
for (const f of ["js/config.js", "js/world.js"]) vm.runInContext(readFileSync(join(ROOT, f), "utf8").replace(/^const /gm, "var "), ctx);

function pip(x, z, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
const segD = (px, pz, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2)) : 0;
  return Math.hypot(a[0] + dx * t - px, a[1] + dz * t - pz);
};

// 반환: { summary, roads: [{ i, cls, kind, reason }], points: [{ id, kind, x, z, lat, lon, tx, tz, w, reason, use }] }
// cls: yes 증거 있음, no 인도 없음 추정, unsure 8~10m 애매 / kind: narrow, mid, cw(횡단보도만 있는 좁은 길)
export async function sidewalkReport(id, seeds = 20) {
  const d = JSON.parse(readFileSync(join(ROOT, "data", id + ".json"), "utf8"));
  const map = await ctx.loadRegion(id);
  const n = d.n, C = d.cell, S = d.size;
  const [lat0, lon0] = d.center, half = S / 2, mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toLL = (x, z) => [lat0 - (z - half) / 110540, lon0 + (x - half) / mx];

  // 건물 색인 (지붕만 있는 구조물은 뺀다)
  const BIN = 20, bins = new Map();
  for (const b of d.scenery.buildings) {
    if (b.k === "roof") continue;
    const xs = b.p.map((p) => p[0]), zs = b.p.map((p) => p[1]);
    const bb = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    if (bb[2] < -10 || bb[3] < -10 || bb[0] > S + 10 || bb[1] > S + 10) continue;
    const o = { p: b.p, bb };
    for (let bx = Math.floor(bb[0] / BIN); bx <= Math.floor(bb[2] / BIN); bx++)
      for (let bz = Math.floor(bb[1] / BIN); bz <= Math.floor(bb[3] / BIN); bz++) (bins.get(bx + "," + bz) || bins.set(bx + "," + bz, []).get(bx + "," + bz)).push(o);
  }
  const inBuilding = (x, z) => (bins.get(Math.floor(x / BIN) + "," + Math.floor(z / BIN)) || []).some((o) => x >= o.bb[0] && x <= o.bb[2] && z >= o.bb[1] && z <= o.bb[3] && pip(x, z, o.p));

  // 게임 경로가 지나는 칸 (시드마다 두 판, BFS 최단경로). 사람이 볼 곳은 경로가 자주 지나는 길부터 고른다
  const use = new Uint16Array(n * n);
  const lm = ctx.pickLandmarks(map);
  for (let seed = 1; seed <= seeds; seed++) {
    let rs;
    try { rs = ctx.pickRoutes(map, lm, ctx.makeRng(seed)); } catch { continue; }
    for (const r of rs) {
      const dist = ctx.bfs(map, r.goal);
      let cur = r.start;
      while (dist[cur] > 0) {
        use[cur]++;
        const rr = Math.floor(cur / n), cc = cur % n;
        const nb = [rr > 0 ? cur - n : -1, rr < n - 1 ? cur + n : -1, cc > 0 ? cur - 1 : -1, cc < n - 1 ? cur + 1 : -1];
        cur = nb.find((q) => q >= 0 && dist[q] === dist[cur] - 1);
      }
    }
  }

  const cws = (d.scenery.crosswalks || []).filter((c) => !c.wide);
  const len = { yes: 0, no: 0, unsure: 0 }, why = { wide: 0, stats: 0, crosswalk: 0 };
  const roads = [], cands = [];
  d.scenery.roads.forEach((rd, i) => {
    if (rd.k !== "car" || rd.br) return;
    const hw = rd.w / 2;
    // 지도 안 표본점: 길을 따라 STEP m마다, 양쪽으로 연석에서 바깥으로 첫 건물까지의 거리
    const samples = [];
    for (let k = 0; k + 1 < rd.p.length; k++) {
      const a = rd.p[k], b = rd.p[k + 1], sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (sl < 0.01) continue;
      const tx = (b[0] - a[0]) / sl, tz = (b[1] - a[1]) / sl;
      for (let s = 0; s < sl; s += STEP) {
        const x = a[0] + tx * s, z = a[1] + tz * s;
        if (x < 20 || z < 20 || x > S - 20 || z > S - 20) continue;
        const gaps = [-1, 1].map((side) => {
          for (let g = 0; g <= REACH; g += 0.5) if (inBuilding(x - tz * side * (hw + g), z + tx * side * (hw + g))) return g;
          return REACH + 1;
        });
        const c = Math.floor(x / C), r = Math.floor(z / C), reach = Math.ceil(hw / C) + 1;
        let u = 0;
        for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < n && cc < n) u = Math.max(u, use[rr * n + cc]);
        }
        samples.push({ x, z, tx, tz, gaps, u });
      }
    }
    if (!samples.length) return;
    const pct = (f) => Math.round((samples.filter(f).length / samples.length) * 100);
    const shape = `건물 붙음(한쪽 이상) ${pct((s) => s.gaps[0] < TIGHT || s.gaps[1] < TIGHT)}%, 양쪽 2m 이상 빔 ${pct((s) => s.gaps[0] >= 2 && s.gaps[1] >= 2)}%`;
    const hasCw = cws.some((c) => rd.p.some((_, k) => k + 1 < rd.p.length && segD(c.x, c.z, rd.p[k], rd.p[k + 1]) < hw + 2));
    let cls, reason, kind = null;
    if (rd.w >= WIDE) { cls = "yes"; reason = "큰길(10m 이상)"; why.wide++; }
    else if (rd.sw) { cls = "yes"; reason = `서울 보도 통계(보도 ${rd.sw}m)`; why.stats++; }
    else if (hasCw) { cls = "yes"; reason = `공공 횡단보도가 놓인 길(폭 ${rd.w}m)`; why.crosswalk++; if (rd.w < 8) kind = "cw"; }
    else if (rd.w < 8) { cls = "no"; reason = `폭 ${rd.w}m 골목, 인도 증거 없음 / ${shape}`; kind = "narrow"; }
    else { cls = "unsure"; reason = `폭 ${rd.w}m, 인도 증거 없음 / ${shape}`; kind = "mid"; }
    len[cls] += samples.length * STEP;
    roads.push({ i, cls, kind, reason });
    if (kind) {
      const top = samples.reduce((b, s) => (s.u > b.u ? s : b), samples[0]);
      cands.push({ road: i, kind, w: rd.w, reason, use: top.u, x: Math.round(top.x), z: Math.round(top.z), tx: +top.tx.toFixed(3), tz: +top.tz.toFixed(3), len: samples.length * STEP });
    }
  });
  cands.sort((a, b) => b.use - a.use || b.len - a.len);
  // 지역당 10곳: 좁은 골목 5, 8~10m 길 3, 횡단보도만 있는 좁은 길 2 (모자라면 다른 종류로 채운다)
  const picked = [];
  const take = (kind, k) => {
    for (const c of cands) {
      if (picked.length >= PER_REGION || k <= 0) return;
      if ((kind && c.kind !== kind) || c.use === 0 || picked.includes(c)) continue;
      if (picked.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 60)) continue;
      picked.push(c); k--;
    }
  };
  take("narrow", 5); take("mid", 3); take("cw", 2); take(null, PER_REGION);
  const points = picked.map((c, k) => {
    const [lat, lon] = toLL(c.x, c.z);
    return { id: `${id}-${k + 1}`, ...c, lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
  });
  const km = (m) => +(m / 1000).toFixed(1);
  return { summary: { id, name: d.name, km: { yes: km(len.yes), no: km(len.no), unsure: km(len.unsure) }, yesWhy: why }, roads, points };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seeds = Number(process.argv[2]) || 20;
  const all = {};
  for (const { id } of JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8"))) {
    const r = await sidewalkReport(id, seeds);
    const s = r.summary;
    console.log(`${s.name.padEnd(5)} 인도 있음 ${s.km.yes}km (큰길 ${s.yesWhy.wide}, 보도통계 ${s.yesWhy.stats}, 횡단보도 ${s.yesWhy.crosswalk}) | 인도 없음 추정(8m 미만) ${s.km.no}km | 애매(8~10m) ${s.km.unsure}km | 확인 지점 ${r.points.length}`);
    all[id] = r.points;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "sidewalk_points.json"), JSON.stringify(all, null, 1));
  console.log("확인 지점:", join(OUT, "sidewalk_points.json"));
}
