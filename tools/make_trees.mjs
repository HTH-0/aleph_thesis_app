// 가로수 모델을 만든다: EZ-Tree(MIT, https://github.com/dgreenheck/ez-tree)로 나무를 생성해 assets/trees/에 GLB와 사진판 PNG로 저장한다.
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs). 헤드리스 Chrome이 tools/trees/make_trees.html을 연다.
// 실행: node tools/make_trees.mjs
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { openBrowser, sleep, ROOT } from "./check/browser.mjs";

const OUT = join(ROOT, "assets", "trees");
// 종류마다 모양이 다른 두 그루 (seed)
const LIST = [["ginkgo", 7], ["ginkgo", 41], ["zelkova", 21], ["zelkova", 58], ["plane", 3], ["plane", 77]];
const base = (process.env.APP_URL || "http://127.0.0.1:8765/index.html").replace(/\/[^/]*$/, "");

mkdirSync(OUT, { recursive: true });
const b = await openBrowser(9431);
await b.send("Page.navigate", { url: `${base}/tools/trees/make_trees.html` });
for (let i = 0; i < 60 && !(await b.ev("!!window.READY")); i++) await sleep(500);
const info = [];
for (const [name, seed] of LIST) {
  const r = await b.ev(`window.make(${JSON.stringify(name)}, ${seed})`);
  if (!r) { console.log(name, seed, "실패"); continue; }
  const id = `${name}_${seed}`;
  writeFileSync(join(OUT, id + ".glb"), Buffer.from(r.glb, "base64"));
  writeFileSync(join(OUT, id + "_card.png"), Buffer.from(r.card, "base64"));
  // 잎은 종류마다 한 장, 나무껍질은 모두 같은 한 장
  if (r.leaf) writeFileSync(join(OUT, name + "_leaf.png"), Buffer.from(r.leaf, "base64"));
  if (r.bark) writeFileSync(join(OUT, "bark.jpg"), Buffer.from(r.bark, "base64"));
  info.push({ id, species: name, seed, height: r.height, triangles: r.tris, cardHalfWidth: +r.cardHalf.toFixed(2), leafTint: r.leafTint, barkTint: r.barkTint });
  // 꼭짓점 합치기·정밀도 줄이기 (행인·차 변환과 같은 도구)
  const f = join(OUT, id + ".glb");
  execSync(`npx --yes @gltf-transform/cli@4.1.1 weld "${f}" "${f}"`, { stdio: "ignore" });
  execSync(`npx --yes @gltf-transform/cli@4.1.1 quantize "${f}" "${f}"`, { stdio: "ignore" });
  console.log(id, `삼각형 ${r.tris}`, `GLB ${Math.round(statSync(join(OUT, id + ".glb")).size / 1024)}KB`);
}
writeFileSync(join(OUT, "trees.json"), JSON.stringify({
  source: "EZ-Tree 1.1.0 (Daniel Greenheck, MIT License, https://github.com/dgreenheck/ez-tree). 잎 텍스처는 EZ-Tree(MIT), 나무껍질 텍스처는 ambientCG(CC0)",
  made: "tools/make_trees.mjs", trees: info }, null, 1) + "\n");
b.close();
