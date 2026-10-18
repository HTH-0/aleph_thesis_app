// Sketchfab 차량 glb(참고자료/models/)를 게임용 glb(assets/cars/)로 정리한다. 헤드리스 Chrome 안에서 three.js로 읽고 다시 저장한다.
// 먼저: node tools/fetch_models.mjs 로 원본을 받고, 다른 터미널에서 node tools/check/serve.mjs (또는 review.mjs)를 띄운다.
// 실행: node tools/convert_cars.mjs            (변환하고 확인용 사진도 찍는다)
//       node tools/convert_cars.mjs --views    (사진만 찍는다: tools/check/out/cars-<이름>-front.png 등)
// 정리 내용: 재질별로 메시를 하나로 합침(그리기 호출 줄이기), 앞을 +Z로, 실제 길이에 맞춰 크기 조정, 바닥을 y=0, 텍스처는 색 지도만 512px 이하.
import { writeFileSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openBrowser, sleep, ROOT, OUT as SHOTS } from "./check/browser.mjs";

// length: 실제 길이(m). yaw: 원본의 앞을 +Z로 돌리는 각(2026-10-18 사진으로 확인). drop: 뺄 재질(정규식). paint: 차체 색을 바꿀 재질(정규식, 게임에서 차마다 색을 곱한다)
// wheels: 바퀴 노드 이름(정규식). 앞뒤 축으로 따로 남겨 게임에서 굴린다. 쏘울은 한 덩어리, 버스는 부품 이름이 없어 바퀴를 고를 수 없다
// cover: 텍스처에서 덮을 곳(원본 픽셀 좌표). 제조사 로고는 주변 어두운 색으로, 작가 표시가 있는 번호판은 글자 없는 흰 판으로 덮는다
export const CARS = {
  ioniq5: { length: 4.64, yaw: 0, paint: "Gravity_Gold", wheels: "SM_Wheel_", cover: [
    { mat: "M_Ioniq", rect: [474, 434, 232, 122, "#2b2d30"] }, // 현대 타원 로고
    { mat: "M_Ioniq", circle: [269, 742, 34, "#3a3c3f"] }, // 휠 가운데 로고
    { mat: "M_Ioniq", plate: [617, 712, 225, 295] }] }, // 작가 표시와 현대 로고가 있는 번호판
  soul: { length: 4.2, yaw: Math.PI / 2, cover: [
    { mat: ".", circle: [800, 160, 14, "#2b2b2b"] }, // 휠 가운데 로고
    { mat: ".", plate: [168, 955, 168, 50] }] }, // "SLOWPOLY.COM" 번호판
  tucson: { length: 4.48, yaw: 0, drop: "sits_leather|interior|panel", paint: "^metal$", wheels: "_[FB][LR]_wheel" }, // 앞 그릴의 현대 로고는 형상이라 덮지 못함(진행.md에 기록)
  lct3000: { length: 6.2, yaw: -Math.PI / 2, drop: "Interiors|Numberplates", wheels: "WheelStock_" }, // 미국 번호판은 뺀다
  milano95: { length: 3.95, yaw: -Math.PI / 2, drop: "Interiors|Numberplates", paint: "Bodymat", wheels: "WheelStock_" },
  bus: { length: 11, yaw: Math.PI },
};

const VIEWS = process.argv.includes("--views");
const OUT = join(ROOT, "assets", "cars");
const HOST = (process.env.APP_URL || "http://127.0.0.1:8765/index.html").replace(/\/index\.html$/, "");
const b = await openBrowser(9414);
await b.send("Page.navigate", { url: `${HOST}/tools/convert_cars.html` });
for (let i = 0; i < 40 && !(await b.ev("typeof window.prepare === 'function' && typeof THREE.GLTFExporter === 'function'")); i++) await sleep(500);
mkdirSync(OUT, { recursive: true });
for (const [name, spec] of Object.entries(CARS)) {
  const url = encodeURI(`/참고자료/models/${name}/${name}.glb`);
  const r = await b.ev(`prepare(${JSON.stringify({ ...spec, url })}).then(r => JSON.stringify(r)).catch(e => "ERR " + e.message)`);
  if (!r || r.startsWith("ERR")) { console.log("실패", name, r); continue; }
  const { info, views } = JSON.parse(r);
  for (const [v, data] of Object.entries(views)) writeFileSync(join(SHOTS, `cars-${name}-${v}.png`), Buffer.from(data.split(",")[1], "base64"));
  let line = `${name.padEnd(9)} 크기(폭·높이·길이) ${info.size.join(" × ")}m · 삼각형 ${Math.round(info.tris)} · 재질 ${info.materials.length}개(${info.materials.join(", ")})`;
  if (!VIEWS) {
    const file = join(OUT, name + ".glb");
    writeFileSync(file, Buffer.from(await b.ev("exportLast()"), "base64"));
    for (const step of ["weld", "quantize", "dedup", "prune"]) execFileSync("npx", ["-y", "@gltf-transform/cli@4.1.1", step, file, file], { stdio: "ignore" });
    // 출처 기록을 함께 둔다 (첫 화면 출처 목록과 README에 쓴다)
    const src = JSON.parse(readFileSync(join(ROOT, "참고자료", "models", name, "source.json"), "utf8"));
    writeFileSync(join(OUT, name + ".json"), JSON.stringify({ name: src.name, author: src.author, url: src.url, license: src.license, paint: spec.paint || null }, null, 1));
    line += ` → ${(statSync(file).size / 1e6).toFixed(2)}MB`;
  }
  console.log(line);
}
b.close();
console.log(`확인용 사진: ${SHOTS}/cars-*.png`);
