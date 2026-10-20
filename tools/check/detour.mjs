// 크게 돌아가는 곳 찾기: 직선 30~70m인 두 걷는 지점을 걸어서 가면 4배 넘게 먼 쌍을 찾고,
// 두 점을 잇는 직선이 무엇을 가로지르는지로 나눈다.
//  - "차도만": 큰 차도(막힌 차도 칸)만 가로지른다 → 횡단보도가 빠졌을 수 있다 (사람이 확인할 곳)
//  - "건물·막힌 땅": 건물 블록이나 막힌 땅을 가로지른다 → 실제로도 돌아가는 곳일 가능성이 크다
// 차도만 가로지르는 쌍은 큰 차도를 건너는 자리(직선과 차도의 가운데)로 20m 단위로 묶고, PNG에 빨간 원으로 표시한다.
// 실행: node tools/check/detour.mjs [지역,…]   → tools/check/out/detour-<지역>.png, 표는 화면에 찍는다
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { ROOT, OUT } from "./browser.mjs";

const ctx = { console, Math, Uint8Array, Int32Array, Array, Error, JSON, encodeURIComponent, Number, Set, Map };
ctx.fetch = async (url) => { try { return { ok: true, json: async () => JSON.parse(readFileSync(join(ROOT, url), "utf8")) }; } catch (e) { return { ok: false }; } };
vm.createContext(ctx);
for (const f of ["js/config.js", "js/world.js"]) vm.runInContext(readFileSync(join(ROOT, f), "utf8").replace(/^const /gm, "var "), ctx);

// 작은 PNG 쓰기 (RGB)
function png(w, h, rgb) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const regions = (process.argv[2] || "jamsil,worldcup,banwoldang,seomun").split(",");
mkdirSync(OUT, { recursive: true });
const report = {};
for (const id of regions) {
  const map = await ctx.loadRegion(id);
  const n = map.n, cell = map.cell;
  const pts = [];
  for (let r = 10; r < n - 10; r += 10) for (let c = 10; c < n - 10; c += 10) if (map.walk[r * n + c]) pts.push(r * n + c);
  const pairs = [];
  for (const a of pts) {
    const dist = ctx.bfs(map, a);
    const ar = Math.floor(a / n), ac = a % n;
    for (const b of pts) {
      if (b <= a) continue;
      const br = Math.floor(b / n), bc = b % n, s = Math.hypot(ar - br, ac - bc) * cell;
      if (s < 30 || s > 70 || dist[b] < 0) continue;
      const w = dist[b] * cell;
      if (w <= s * 4) continue;
      // 직선이 가로지르는 칸
      let car = 0, solid = 0, mid = null;
      const k = Math.ceil(s / 0.5);
      for (let i = 1; i < k; i++) {
        const x = (ac + 0.5 + ((bc - ac) * i) / k) * cell, z = (ar + 0.5 + ((br - ar) * i) / k) * cell;
        const t = map.kind[Math.floor(z / cell) * n + Math.floor(x / cell)];
        if (t === 3) { car++; if (!mid) mid = [x, z]; } else if (t === 0 || t === 1) solid++;
      }
      pairs.push({ a: [ac * cell, ar * cell], b: [bc * cell, br * cell], s: Math.round(s), w, kind: solid > 2 ? "block" : car ? "road" : "other", mid });
    }
  }
  // 차도만 가로지르는 쌍을 건너는 자리로 묶는다
  const spots = [];
  for (const p of pairs.filter((q) => q.kind === "road")) {
    const sp = spots.find((o) => Math.hypot(o.x - p.mid[0], o.z - p.mid[1]) < 20);
    if (sp) { sp.n++; sp.worst = Math.max(sp.worst, p.w / p.s); } else spots.push({ x: p.mid[0], z: p.mid[1], n: 1, worst: p.w / p.s, ex: p });
  }
  spots.sort((a, b) => b.n * b.worst - a.n * a.worst);
  const cnt = (k) => pairs.filter((p) => p.kind === k).length;
  console.log(`[${id}] 4배 넘게 돌아가는 쌍 ${pairs.length} (차도만 ${cnt("road")}, 건물·막힌 땅 ${cnt("block")}, 그 밖 ${cnt("other")}) · 차도를 건너는 자리 ${spots.length}곳`);
  spots.slice(0, 12).forEach((s, i) => console.log(`  ${i + 1}. (${Math.round(s.x)}, ${Math.round(s.z)}) 쌍 ${s.n} · 최대 ${s.worst.toFixed(1)}배 · 예: (${s.ex.a}) → (${s.ex.b}) 직선 ${s.ex.s}m 걸어서 ${s.ex.w}m`));
  report[id] = { pairs: pairs.length, road: cnt("road"), block: cnt("block"), spots: spots.map((s) => ({ x: Math.round(s.x), z: Math.round(s.z), n: s.n, worst: +s.worst.toFixed(1) })) };
  // 그림: 걷는 칸 밝게, 막힌 차도 회색, 건물 짙게, 지하도 출구 파랑, 차도를 건너는 자리 빨간 원(번호 순으로 크게)
  const W = n, rgb = Buffer.alloc(W * W * 3);
  for (let i = 0; i < n * n; i++) { const k = map.kind[i], c = k === 2 ? (map.walk[i] ? [236, 235, 226] : [200, 200, 230]) : k === 3 ? [112, 114, 118] : k === 1 ? [139, 140, 156] : [58, 61, 56]; rgb.set(c, i * 3); }
  const dot = (x, z, r, c) => { const cx = Math.round(x / cell), cz = Math.round(z / cell); for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const d = Math.hypot(dx, dz); if (d > r || d < r - 1.6) continue; const px = cx + dx, pz = cz + dz; if (px >= 0 && pz >= 0 && px < W && pz < W) rgb.set(c, (pz * W + px) * 3); } };
  for (const e of (map.underpass && map.underpass.exits) || []) for (let r = 1; r <= 3; r++) dot(e.x, e.z, r, [47, 111, 208]);
  spots.forEach((s, i) => dot(s.x, s.z, i < 12 ? 9 : 5, [220, 40, 40]));
  writeFileSync(join(OUT, `detour-${id}.png`), png(W, W, rgb));
}
writeFileSync(join(OUT, "detour.json"), JSON.stringify(report, null, 1));
console.log(`그림: ${OUT}\\detour-<지역>.png`);
