// 지도 파일의 이동 판정 격자를 PNG로 그린다 (지도가 큰길로 끊기지 않았는지 눈으로 볼 때 쓴다)
// 실행: node tools/check/grid.mjs <지역>   → tools/check/out/<지역>-grid.png
// 색: 밝은 회색 걷는 칸, 회색 큰 차도, 진회색 건물, 검정 막힌 땅,
//     초록 큰길 공공 횡단보도, 파랑 골목 공공 횡단보도, 노랑 규칙 교차로, 빨강 규칙 횡단보도(OSM·중간)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { ROOT, OUT } from "./browser.mjs";

const id = process.argv[2] || "banwoldang";
const d = JSON.parse(readFileSync(join(ROOT, "data", id + ".json"), "utf8"));
const n = d.n, row = n * 3 + 1;
const col = { ".": [236, 235, 226], "=": [120, 122, 128], "#": [70, 70, 80], " ": [20, 22, 20] };
const raw = Buffer.alloc(row * n);
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) (col[d.grid[r][c]] || [255, 0, 255]).forEach((v, k) => (raw[r * row + 1 + c * 3 + k] = v));
const mark = (x, z, rgb) => {
  const c0 = Math.floor(x / d.cell), r0 = Math.floor(z / d.cell);
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    const r = r0 + dr, c = c0 + dc;
    if (r >= 0 && c >= 0 && r < n && c < n) rgb.forEach((v, k) => (raw[r * row + 1 + c * 3 + k] = v));
  }
};
for (const cw of d.scenery.crosswalks || []) mark(cw.x, cw.z, cw.wide ? [40, 200, 90] : [40, 120, 220]);
for (const [x, z] of d.scenery.junctionsOpen || []) mark(x, z, [255, 200, 0]);
for (const [x, z] of d.scenery.crossings || []) mark(x, z, [255, 60, 60]);

const crcTable = [...Array(256)].map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let x = 0xffffffff; for (const b of buf) x = crcTable[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
mkdirSync(OUT, { recursive: true });
const file = join(OUT, id + "-grid.png");
writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
const g = d.grid.join("");
console.log(`${file}\n걷는 칸 ${g.split(".").length - 1}, 큰 차도 칸 ${g.split("=").length - 1}, 횡단보도 출처: ${JSON.stringify(d.sources || {})}`);
