// 거리 소품 배치를 확인한다: 종류별 개수, 골목(전봇대·전선), 횡단보도 끝(볼라드), 가게 앞(작은 소품)을 찍는다
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs)
// 실행: CHECK_GPU=1 node tools/check/props.mjs [지역, 기본 banwoldang]   → tools/check/out/props-<지역>-*.png
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, ROOT, OUT } from "./browser.mjs";

const region = process.argv[2] || "banwoldang";
const d = JSON.parse(readFileSync(join(ROOT, "data", region + ".json"), "utf8")), S = d.size;
const b = await openBrowser(9417);
await b.startRound(region, { seed: 5 });
await sleep(4000);
console.log("소품 개수", JSON.stringify((await b.ev("window.__play.scenery()")).props));
const shot = async (name, x, z, h, yaw, pitch) => { await b.ev(`window.__play.view(${x}, ${z}, ${h}, ${yaw}, ${pitch})`); await sleep(2500); console.log(name, await b.shot(`props-${region}-${name}`)); };
// 골목: 지도 가운데쪽 5~10m 길 가운데에서 길 방향으로
const inner = (p) => p[0] > 150 && p[1] > 150 && p[0] < S - 150 && p[1] < S - 150;
const alleys = d.scenery.roads.filter((r) => r.k === "car" && r.w >= 5 && r.w < 10 && !r.br && inner(r.p[0]));
for (const [k, r] of alleys.slice(0, 2).entries()) {
  const a = r.p[0], c = r.p[1], L = Math.hypot(c[0] - a[0], c[1] - a[1]), tx = (c[0] - a[0]) / L, tz = (c[1] - a[1]) / L;
  await shot(`alley${k + 1}`, a[0] + tx * 3, a[1] + tz * 3, 1.7, Math.atan2(-tx, -tz), 0.05);
}
// 횡단보도 끝: 큰길 횡단보도 앞에서 건너편을 본다
const xs = (await b.ev("window.__play.crossings")).filter((c) => inner([c.x, c.z])).sort((p, q) => q.w - p.w);
if (xs[0]) { const c = xs[0], n = [-c.tz, c.tx], r = c.w / 2 + 3; await shot("crossing", c.x + n[0] * r + c.tx * 3, c.z + n[1] * r + c.tz * 3, 1.7, Math.atan2(n[0], n[1]), -0.05); }
// 위에서 본 동네 (가게 앞 소품이 얼마나 보이는지)
await shot("above", S / 2, S / 2 + 40, 30, 0, -0.9);
b.close();
console.log(`스크린샷: ${OUT}`);
