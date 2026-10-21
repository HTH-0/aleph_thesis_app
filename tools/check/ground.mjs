// 길바닥 확인: 큰길 횡단보도 앞 보도(점자블록·연석), 골목(가장자리 선·색 포장), 위에서 본 거리를 찍는다
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs)
// 실행: CHECK_GPU=1 node tools/check/ground.mjs [태그, 기본 now] [지역,…]   → tools/check/out/ground-<태그>-<지역>-<장면>.png
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, ROOT } from "./browser.mjs";

const tag = process.argv[2] || "now";
let port = 9540;
for (const region of (process.argv[3] || "banwoldang,jamsil").split(",")) {
  const d = JSON.parse(readFileSync(join(ROOT, "data", region + ".json"), "utf8")), S = d.size;
  const inner = (x, z) => x > 150 && z > 150 && x < S - 150 && z < S - 150;
  const b = await openBrowser(port++);
  await b.startRound(region, { seed: 5 });
  await sleep(4000);
  await b.ev("window.__play.freeze(true)");
  const shot = async (name, x, z, h, yaw, pitch) => { await b.ev(`window.__play.view(${x}, ${z}, ${h}, ${yaw}, ${pitch})`); await sleep(2500); console.log(await b.shot(`ground-${tag}-${region}-${name}`)); };
  // 큰길 횡단보도 끝에서 보도를 따라 본다 (발밑에 횡단보도 앞 점자블록, 앞쪽에 보도·연석)
  const xs = (await b.ev("window.__play.crossings")).filter((c) => inner(c.x, c.z) && c.w >= 14).sort((p, q) => q.w - p.w);
  if (xs[0]) {
    const c = xs[0], nx = -c.tz, nz = c.tx, r = c.w / 2 + 2.5;
    await shot("sidewalk", c.x + nx * r - c.tx * 2, c.z + nz * r - c.tz * 2, 1.7, Math.atan2(-c.tx, -c.tz) + 0.35, -0.3);
    await shot("crossing", c.x + nx * (r + 3), c.z + nz * (r + 3), 1.7, Math.atan2(nx, nz), -0.35);
  }
  // 골목: 지도 가운데쪽 폭 5~8m 길 (인도 없는 골목)
  const alleys = d.scenery.roads.filter((rd) => rd.k === "car" && rd.w >= 5 && rd.w < 8 && !rd.br && inner(rd.p[0][0], rd.p[0][1]));
  for (const [k, rd] of alleys.slice(0, 2).entries()) {
    const a = rd.p[0], q = rd.p[1], L = Math.hypot(q[0] - a[0], q[1] - a[1]), tx = (q[0] - a[0]) / L, tz = (q[1] - a[1]) / L;
    await shot(`alley${k + 1}`, a[0] + tx * 3, a[1] + tz * 3, 1.7, Math.atan2(-tx, -tz), -0.15);
  }
  await shot("above", S / 2, S / 2 + 25, 22, 0, -0.85);
  b.close();
}
