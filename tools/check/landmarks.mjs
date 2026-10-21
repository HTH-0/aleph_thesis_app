// 상징 건물 확인: 지역마다 상징 건물(js/landmarks.js)을 거리 눈높이(걸을 수 있는 자리에서 그쪽을 보고)와 위에서 찍는다
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs)
// 실행: CHECK_GPU=1 node tools/check/landmarks.mjs [지역,…]   → tools/check/out/lm-<지역>-<번호>-<eye|above>.png
import { openBrowser, sleep } from "./browser.mjs";

let port = 9590;
for (const region of (process.argv[2] || "worldcup,banwoldang,seomun,jamsil").split(",")) {
  const b = await openBrowser(port++);
  await b.startRound(region, { seed: 5 });
  await sleep(4000);
  await b.ev("window.__play.freeze(true)");
  const list = await b.ev(`LANDMARKS.list(${JSON.stringify(region)})`);
  let k = 0;
  for (const lm of list) {
    k++;
    let tx, tz, R = [70, 100, 130, 160];
    if (lm.at) [tx, tz] = lm.at;
    else {
      // 멀리 있는 랜드마크는 지도 가운데에서 그쪽을 본다
      const c = await b.ev("({ c: window.__mapCenter || null })");
      tx = 420 + (lm.lon - 0) * 0; tz = 420; R = [0];
    }
    // 걸을 수 있는 자리(칸 종류 2) 가운데 상징 건물에서 R만큼 떨어진 곳을 찾는다
    let spot = null;
    for (const r of R) {
      for (let a = 0; a < 24 && !spot; a++) {
        const t = (a / 24) * Math.PI * 2, x = tx + Math.cos(t) * r, z = tz + Math.sin(t) * r;
        if (x < 20 || z < 20 || x > 820 || z > 820) continue;
        if (r === 0 || (await b.ev(`window.__play.kind(${x}, ${z})`)) === 2) spot = [x, z];
      }
      if (spot) break;
    }
    if (!spot) { console.log(lm.text || lm.name, "볼 자리를 못 찾음"); continue; }
    const yawTo = lm.at ? Math.atan2(-(tx - spot[0]), -(tz - spot[1])) : -Math.PI / 2; // 멀리 있는 것은 동쪽(+x)
    await b.ev(`window.__play.view(${spot[0]}, ${spot[1]}, 1.7, ${yawTo}, 0.15)`); await sleep(2500);
    console.log(lm.text || lm.name, await b.shot(`lm-${region}-${k}-eye`));
    if (lm.at) {
      await b.ev(`window.__play.view(${spot[0] + (spot[0] - tx) * 0.6}, ${spot[1] + (spot[1] - tz) * 0.6}, 45, ${yawTo}, -0.3)`); await sleep(2500);
      console.log(lm.text || lm.name, await b.shot(`lm-${region}-${k}-above`));
    }
  }
  b.close();
}
