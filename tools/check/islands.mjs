// 차도와 보도 자리인데 걷는 영역에서 빠진 칸(끊겨서 지워진 길)을 센다.
// 지도 생성은 가장 큰 연결 영역만 남기므로, 큰길·횡단보도 위치가 어긋나 떨어져 나간 길은 막힌 땅(화단)이 된다.
// 실행: node tools/check/islands.mjs [지역,지역]   (지역을 빼면 모두)
// 지도 가장자리 20m 안에 걸친 덩어리는 가림막 때문에 생기는 것이라 "가장자리"로 따로 센다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./browser.mjs";

const only = process.argv[2] ? process.argv[2].split(",") : null;
const EDGE = 20, MIN_CELLS = 25;
for (const { id, name } of JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8"))) {
  if (only && !only.includes(id)) continue;
  const d = JSON.parse(readFileSync(join(ROOT, "data", id + ".json"), "utf8"));
  const n = d.n, C = d.cell, g = d.grid;
  // 차도 + 보도 띠 (tools/build_maps.mjs와 같은 폭)
  const band = new Uint8Array(n * n);
  for (const rd of d.scenery.roads) {
    if (rd.k !== "car" || rd.br) continue;
    const hw = rd.w / 2 + (rd.sw || (rd.w >= 10 ? 4 : 2));
    for (let i = 0; i + 1 < rd.p.length; i++) {
      const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.01) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
      for (let r = Math.max(0, Math.floor((Math.min(z1, z2) - hw) / C)); r <= Math.min(n - 1, Math.floor((Math.max(z1, z2) + hw) / C)); r++)
        for (let c = Math.max(0, Math.floor((Math.min(x1, x2) - hw) / C)); c <= Math.min(n - 1, Math.floor((Math.max(x1, x2) + hw) / C)); c++) {
          const px = c * C + C / 2, pz = r * C + C / 2, t = Math.max(0, Math.min(L, (px - x1) * tx + (pz - z1) * tz));
          if (Math.hypot(x1 + tx * t - px, z1 + tz * t - pz) <= hw) band[r * n + c] = 1;
        }
    }
  }
  const lost = (i) => band[i] && g[Math.floor(i / n)][i % n] === " ";
  let free = 0, dropped = 0;
  for (let i = 0; i < n * n; i++) {
    const ch = g[Math.floor(i / n)][i % n];
    if (!band[i] || ch === "#" || ch === "=") continue;
    free++;
    if (ch === " ") dropped++;
  }
  const seen = new Uint8Array(n * n), inner = [], edge = [];
  for (let i = 0; i < n * n; i++) {
    if (seen[i] || !lost(i)) continue;
    const st = [i]; seen[i] = 1;
    let cnt = 0, sx = 0, sz = 0, atEdge = false;
    while (st.length) {
      const cur = st.pop(), r = Math.floor(cur / n), c = cur % n;
      cnt++; sx += c; sz += r;
      if (Math.min(r, c, n - 1 - r, n - 1 - c) * C < EDGE) atEdge = true;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc, ni = nr * n + nc;
        if (nr >= 0 && nc >= 0 && nr < n && nc < n && !seen[ni] && lost(ni)) { seen[ni] = 1; st.push(ni); }
      }
    }
    if (cnt >= MIN_CELLS) (atEdge ? edge : inner).push({ m2: cnt * C * C, x: Math.round((sx / cnt) * C), z: Math.round((sz / cnt) * C) });
  }
  inner.sort((a, b) => b.m2 - a.m2);
  const innerM2 = inner.reduce((s, k) => s + k.m2, 0), edgeM2 = edge.reduce((s, k) => s + k.m2, 0);
  console.log(`${name.padEnd(5)} 지워진 길 ${((dropped / free) * 100).toFixed(1)}%  안쪽 덩어리 ${inner.length}개 ${innerM2}㎡, 가장자리 ${edge.length}개 ${edgeM2}㎡` +
    (inner.length ? `  큰 순서(x,z): ${inner.slice(0, 4).map((k) => `${k.m2}㎡(${k.x},${k.z})`).join(" ")}` : ""));
}
