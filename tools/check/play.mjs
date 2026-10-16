// 지역마다 두 판을 진행해서 결과 화면까지 가는지 검사하고, 판마다 화면을 찍는다
// 먼저 서버를 띄운다: node tools/check/serve.mjs
// 실행: node tools/check/play.mjs [지역1,지역2,... 기본 전체]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, ROOT, OUT } from "./browser.mjs";

const all = JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8")).map((r) => r.id);
const regions = process.argv[2] ? process.argv[2].split(",") : all;
const b = await openBrowser(9401);
const visible = () => b.ev(`[...document.querySelectorAll(".screen")].find(e => !e.hidden)?.id`);
let failed = 0;
for (const region of regions) {
  console.log(`[${region}]`);
  await b.startRound(region, { briefShot: `${region}-brief` });
  for (let round = 1; round <= 2; round++) {
    if (round === 2) { await b.ev(`document.getElementById("btn-go").click()`); await sleep(7000); await b.ev(`document.getElementById("play-overlay").click()`); await sleep(1500); }
    await b.key("KeyW", true); await sleep(4000); await b.key("KeyW", false); await sleep(1500);
    const hud = (await b.ev(`document.getElementById("play-hud").textContent`)) || "";
    const traffic = await b.ev(`window.__play && window.__play.traffic()`);
    console.log(`  ${round}판: ${hud.split("\n").find((l) => l.includes("fps")) || "fps ?"}, 거리 ${JSON.stringify(traffic)}`);
    await b.shot(`${region}-round${round}`);
    await b.key("KeyP", true); await b.key("KeyP", false);
    await sleep(1500);
  }
  const screen = await visible();
  if (screen !== "screen-result") failed++;
  console.log(`  마지막 화면: ${screen} / ${await b.ev(`document.getElementById("result-headline").textContent`)}`);
}
b.close();
console.log(`스크린샷: ${OUT}`);
process.exit(failed ? 1 : 0);
