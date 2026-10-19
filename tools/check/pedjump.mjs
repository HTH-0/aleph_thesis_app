// 행인이 한 프레임에 걷는 속도보다 크게 옮겨지는 횟수(순간이동)를 센다. 0이어야 한다
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs)
// 실행: CHECK_GPU=1 node tools/check/pedjump.mjs [지역1,지역2,... 기본 전체] [지점마다 관찰 초, 기본 20]
// 출발점과 횡단보도 세 곳(넓은 곳, 중간, 좁은 곳)으로 옮겨 가며 지켜본다. seen은 플레이어 시야 안 60m에서 일어난 것이다
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, ROOT } from "./browser.mjs";

const all = JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8")).map((r) => r.id);
const regions = process.argv[2] ? process.argv[2].split(",") : all;
const secs = Number(process.argv[3]) || 20;
const b = await openBrowser(9413);
const P = (expr) => b.ev(`window.__play.${expr}`);
let bad = 0;
for (const region of regions) {
  await b.startRound(region);
  const spots = (await P("crossings")).filter((c) => c.x > 60 && c.z > 60 && c.x < 780 && c.z < 780).sort((p, q) => q.w - p.w);
  const pick = [spots[0], spots[Math.floor(spots.length / 2)], spots[spots.length - 1]].filter(Boolean);
  const j0 = (await P("traffic()")).pedJumps;
  await sleep(secs * 1000);
  for (const c of pick) {
    const n = [-c.tz, c.tx], r = c.w / 2 + 3.5;
    await P(`teleport(${c.x + n[0] * r}, ${c.z + n[1] * r}, ${Math.atan2(n[0], n[1])})`);
    await sleep(secs * 1000);
  }
  const t = await P("traffic()"), j = t.pedJumps, perf = await P("perf()");
  const seen = j.seen - j0.seen, unseen = j.unseen - j0.unseen;
  console.log(`[${region}] 순간이동 시야 안 ${seen}회 · 시야 밖 ${unseen}회 (행인-프레임 ${j.frames - j0.frames}개) · 행인 ${t.peds} · 대기 ${t.waiting} · 건너는 중 ${t.crossing} · ${perf.fps}`);
  bad += seen + unseen;
}
b.close();
process.exitCode = bad ? 1 : 0;
