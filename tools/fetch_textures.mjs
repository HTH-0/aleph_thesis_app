// 바닥·벽 사진 텍스처(Poly Haven, CC0)를 공식 API로 받아 게임용으로 줄인다.
// 원본(1k 색 지도)은 참고자료/polyhaven/textures/에, 게임용(512px JPEG)은 assets/textures/<이름>.jpg와 출처 .json에 둔다.
// 실행: node tools/fetch_textures.mjs   (줄이기는 macOS에서는 sips, 윈도우에서는 PowerShell System.Drawing을 쓴다)
// 게임에서는 js/scenery.js가 사진의 밝기 무늬만 쓰고 색은 지금처럼 건물·길마다 곱한다.
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "참고자료", "polyhaven", "textures"), OUT = join(ROOT, "assets", "textures");
// 이름: 쓰는 곳
export const TEXTURES = {
  asphalt_02: "차도",
  square_concrete_pavers: "보도·바닥",
  red_brick_03: "벽돌 벽",
  white_plaster_02: "미장 벽, 지붕",
  concrete_wall_003: "블록·콘크리트 벽, 다리",
  rectangular_facade_tiles: "타일 외벽(상가)",
  concrete_tiles_02: "보도(회색 직사각 블록, 2026-10-21)",
  granite_tile_04: "광장·연석(화강석, 2026-10-21)",
};

const UA = { "User-Agent": "sound-walk-textures" };
mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });
let total = 0;
for (const id of Object.keys(TEXTURES)) {
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`, { headers: UA })).json();
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();
  const f = files.Diffuse && files.Diffuse["1k"] && files.Diffuse["1k"].jpg;
  if (!f) { console.log("색 지도 없음", id); continue; }
  const src = join(SRC, id + ".jpg"), dest = join(OUT, id + ".jpg");
  if (!existsSync(src)) writeFileSync(src, Buffer.from(await (await fetch(f.url, { headers: UA })).arrayBuffer()));
  if (process.platform === "darwin") execFileSync("sips", ["-Z", "512", "-s", "format", "jpeg", "-s", "formatOptions", "82", src, "--out", dest], { stdio: "ignore" });
  else execFileSync("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile($env:TEX_SRC); $b=New-Object System.Drawing.Bitmap $i,512,512; $e=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|?{$_.MimeType -eq 'image/jpeg'}; $p=New-Object System.Drawing.Imaging.EncoderParameters 1; $p.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),82L; $b.Save($env:TEX_DEST,$e,$p); $i.Dispose(); $b.Dispose()"], { stdio: "ignore", env: { ...process.env, TEX_SRC: src, TEX_DEST: dest } });
  const meters = (info.dimensions || [1000])[0] / 1000; // 사진 한 장이 덮는 실제 크기
  writeFileSync(join(OUT, id + ".json"), JSON.stringify({ name: info.name, author: Object.keys(info.authors || {}).join(", "), url: `https://polyhaven.com/a/${id}`, license: "CC0", meters: Math.round(meters * 100) / 100 }, null, 1));
  total += statSync(dest).size;
  console.log(`${id.padEnd(26)} ${TEXTURES[id].padEnd(14)} ${meters.toFixed(1)}m · ${(statSync(dest).size / 1e3).toFixed(0)}KB · ${Object.keys(info.authors || {}).join(", ")}`);
}
console.log(`합계 ${(total / 1e6).toFixed(2)}MB → ${OUT}`);
