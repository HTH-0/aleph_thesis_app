// 외부 패키지 없이 Shapefile(.shp + .dbf)을 읽고, 한국 TM 좌표(EPSG:5186 등)를 위경도로 바꾼다.
// 지원: 점(1), 선(3), 면(5) 도형. 속성 인코딩은 .cpg 파일을 따르고, 없으면 EUC-KR로 읽는다.
import { readFileSync, existsSync, openSync, readSync, closeSync } from "node:fs";

export function readDbf(path, encoding) {
  const b = readFileSync(path);
  const n = b.readUInt32LE(4), headerLen = b.readUInt16LE(8), recLen = b.readUInt16LE(10);
  const fields = [];
  for (let off = 32; b[off] !== 0x0d && off < headerLen - 1; off += 32) {
    const name = b.toString("latin1", off, off + 11).replace(/\0.*$/, "");
    fields.push({ name, type: String.fromCharCode(b[off + 11]), len: b[off + 16] });
  }
  const dec = new TextDecoder(encoding);
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    let p = headerLen + i * recLen + 1;
    const row = {};
    for (const f of fields) {
      const raw = dec.decode(b.subarray(p, p + f.len)).trim();
      row[f.name] = f.type === "N" || f.type === "F" ? (raw === "" ? null : Number(raw)) : raw;
      p += f.len;
    }
    rows[i] = row;
  }
  return { fields, rows };
}

export function readShp(path) {
  const b = readFileSync(path);
  const shapes = [];
  let off = 100;
  while (off + 8 <= b.length) {
    const len = b.readInt32BE(off + 4) * 2;
    const c = off + 8;
    const type = b.readInt32LE(c);
    if (type === 0) shapes.push(null);
    else if (type === 1 || type === 11 || type === 21) shapes.push({ type: "point", pts: [[b.readDoubleLE(c + 4), b.readDoubleLE(c + 12)]] });
    else if ([3, 5, 13, 15, 23, 25].includes(type)) {
      const bbox = [b.readDoubleLE(c + 4), b.readDoubleLE(c + 12), b.readDoubleLE(c + 20), b.readDoubleLE(c + 28)];
      const np = b.readInt32LE(c + 36), nPts = b.readInt32LE(c + 40);
      const parts = [];
      for (let k = 0; k < np; k++) parts.push(b.readInt32LE(c + 44 + k * 4));
      const p0 = c + 44 + np * 4;
      const rings = [];
      for (let k = 0; k < np; k++) {
        const s = parts[k], e = k + 1 < np ? parts[k + 1] : nPts, ring = [];
        for (let j = s; j < e; j++) ring.push([b.readDoubleLE(p0 + j * 16), b.readDoubleLE(p0 + j * 16 + 8)]);
        rings.push(ring);
      }
      shapes.push({ type: type % 10 === 5 ? "polygon" : "line", bbox, rings });
    } else shapes.push(null);
    off = c + len;
  }
  return shapes;
}

// base: 확장자를 뺀 경로. 반환: [{ geom, props }]
export function readShapefile(base) {
  const cpg = existsSync(base + ".cpg") ? readFileSync(base + ".cpg", "latin1").trim().toLowerCase() : "";
  const enc = /utf-?8/.test(cpg) ? "utf-8" : /949|euc/.test(cpg) || !cpg ? "euc-kr" : cpg;
  const shapes = readShp(base + ".shp");
  const { fields, rows } = readDbf(base + ".dbf", enc);
  return { fields, encoding: enc, prj: existsSync(base + ".prj") ? readFileSync(base + ".prj", "latin1") : "", features: shapes.map((g, i) => ({ geom: g, props: rows[i] })) };
}

// 큰 Shapefile(GIS건물통합정보처럼 .dbf가 1GB를 넘는 것)에서 keep(bbox)가 참인 도형만 읽는다.
// .dbf는 통째로 올리지 않고, 고른 행의 필요한 열(fieldNames)만 골라 읽는다. 반환: [{ geom, props }]
export function readShapefileWhere(base, keep, fieldNames) {
  const b = readFileSync(base + ".shp");
  const picked = [];
  let off = 100, idx = 0;
  while (off + 8 <= b.length) {
    const len = b.readInt32BE(off + 4) * 2, c = off + 8, type = b.readInt32LE(c);
    if ([5, 15, 25].includes(type)) {
      const bbox = [b.readDoubleLE(c + 4), b.readDoubleLE(c + 12), b.readDoubleLE(c + 20), b.readDoubleLE(c + 28)];
      if (keep(bbox)) {
        const np = b.readInt32LE(c + 36), nPts = b.readInt32LE(c + 40), p0 = c + 44 + np * 4, rings = [];
        for (let k = 0; k < np; k++) {
          const s = b.readInt32LE(c + 44 + k * 4), e = k + 1 < np ? b.readInt32LE(c + 48 + k * 4) : nPts, ring = [];
          for (let j = s; j < e; j++) ring.push([b.readDoubleLE(p0 + j * 16), b.readDoubleLE(p0 + j * 16 + 8)]);
          rings.push(ring);
        }
        picked.push({ idx, geom: { type: "polygon", bbox, rings } });
      }
    }
    off = c + len; idx++;
  }
  const cpg = existsSync(base + ".cpg") ? readFileSync(base + ".cpg", "latin1").trim().toLowerCase() : "";
  const dec = new TextDecoder(/utf-?8/.test(cpg) ? "utf-8" : "euc-kr");
  const fd = openSync(base + ".dbf", "r");
  try {
    const head = Buffer.alloc(32);
    readSync(fd, head, 0, 32, 0);
    const headerLen = head.readUInt16LE(8), recLen = head.readUInt16LE(10);
    const hb = Buffer.alloc(headerLen);
    readSync(fd, hb, 0, headerLen, 0);
    const fields = [];
    let pos = 1;
    for (let o = 32; hb[o] !== 0x0d && o < headerLen - 1; o += 32) {
      const f = { name: hb.toString("latin1", o, o + 11).replace(/\0.*$/, ""), type: String.fromCharCode(hb[o + 11]), len: hb[o + 16], pos };
      pos += f.len;
      fields.push(f);
    }
    const want = fields.filter((f) => !fieldNames || fieldNames.includes(f.name));
    const rec = Buffer.alloc(recLen);
    for (const p of picked) {
      readSync(fd, rec, 0, recLen, headerLen + p.idx * recLen);
      const props = {};
      for (const f of want) {
        const raw = dec.decode(rec.subarray(f.pos, f.pos + f.len)).replace(/\0/g, "").trim();
        props[f.name] = f.type === "N" || f.type === "F" ? (raw === "" ? null : Number(raw)) : raw;
      }
      p.props = props;
    }
  } finally {
    closeSync(fd);
  }
  return { prj: existsSync(base + ".prj") ? readFileSync(base + ".prj", "latin1") : "", features: picked };
}

// 횡메르카토르 역변환 (GRS80). .prj의 원점·축척·가산값을 읽어서 쓴다.
export function tmFromPrj(prj) {
  const num = (name) => { const m = prj.match(new RegExp(`PARAMETER\\["${name}",\\s*(-?[\\d.]+)\\]`, "i")); return m ? Number(m[1]) : null; };
  const lon0 = num("Central_Meridian"), lat0 = num("Latitude_Of_Origin"), k0 = num("Scale_Factor") ?? 1;
  const FE = num("False_Easting"), FN = num("False_Northing");
  if (lon0 === null || lat0 === null || FE === null || FN === null || !/Transverse_Mercator/i.test(prj)) throw new Error("지원하지 않는 좌표계입니다: " + prj.slice(0, 80));
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const rad = Math.PI / 180;
  const M = (phi) => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const M0 = M(lat0 * rad);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  return function toLonLat(x, y) {
    const Mv = M0 + (y - FN) / k0;
    const mu = Mv / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
    const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
    const N1 = a / Math.sqrt(1 - e2 * s * s), R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
    const C1 = ep2 * c * c, T1 = t * t, D = (x - FE) / (N1 * k0);
    const lat = phi1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = lon0 * rad + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
    return [lon / rad, lat / rad];
  };
}
