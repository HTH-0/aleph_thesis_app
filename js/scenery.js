// 지도 파일의 건물·도로·녹지·나무로 3D 거리 풍경을 만든다.
// 건물은 OSM 다각형을 실제 모양으로 세우고, 창문·간판·차선은 코드로 그린 텍스처로 붙인다.
// 좌표: x는 동쪽, z는 남쪽, 원점은 지도 북서쪽 모서리 (world.js와 같다)

const SCENERY = (() => {
  const FLOOR = 3.3, BAY = 3.2, SHOP_H = 4.2;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  // ---------- 코드로 그린 텍스처 (한 번만 만들고 판마다 다시 쓴다) ----------
  let TEX = null;
  function canvasTex(w, h, draw, aniso) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = aniso;
    return t;
  }
  function noise(g, w, h, amount, seed) {
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (hash(i * 0.37 + seed) - 0.5) * amount;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }
  const SIGN_COLORS = ["#d8342c", "#1f5fbf", "#f2c230", "#2e8b57", "#f07f1f", "#f4f1ea", "#7a2f8f", "#14324f"];

  function textures(renderer) {
    if (TEX) return TEX;
    const a = renderer.capabilities.getMaxAnisotropy();
    TEX = {
      // 창문 벽: 가로 4칸(칸당 3.2m) × 세로 4층(층당 3.3m)
      punched: canvasTex(512, 512, (g, w, h) => {
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
        noise(g, w, h, 10, 1);
        for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
          const x = fx * 128, y = fy * 128, r = hash(fx * 13 + fy * 7);
          g.fillStyle = "rgba(0,0,0,0.10)"; g.fillRect(x, y + 124, 128, 4);
          g.fillStyle = "#c9c4bb"; g.fillRect(x + 18, y + 28, 92, 72);
          const grd = g.createLinearGradient(0, y + 30, 0, y + 98);
          grd.addColorStop(0, r < 0.2 ? "#d8cdb4" : "#5a6d7e");
          grd.addColorStop(1, r < 0.2 ? "#b9ab8e" : "#2f3c48");
          g.fillStyle = grd; g.fillRect(x + 22, y + 32, 84, 64);
          g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x + 22, y + 32, 84, 10);
          g.fillStyle = "#c9c4bb"; g.fillRect(x + 62, y + 32, 4, 64);
          g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x + 16, y + 100, 96, 5);
        }
      }, a),
      // 띠창 벽: 층마다 가로로 길게 이어진 창
      ribbon: canvasTex(512, 512, (g, w, h) => {
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
        noise(g, w, h, 8, 2);
        for (let fy = 0; fy < 4; fy++) {
          const y = fy * 128;
          const grd = g.createLinearGradient(0, y + 40, 0, y + 104);
          grd.addColorStop(0, "#6b8193"); grd.addColorStop(1, "#2c3946");
          g.fillStyle = grd; g.fillRect(0, y + 40, w, 64);
          g.fillStyle = "rgba(255,255,255,0.16)"; g.fillRect(0, y + 40, w, 9);
          g.fillStyle = "#d4d0c8";
          for (let x = 0; x < w; x += 64) g.fillRect(x, y + 40, 5, 64);
          g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, y + 104, w, 4);
        }
      }, a),
      glass: canvasTex(256, 256, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, "#b9cfdc"); grd.addColorStop(0.5, "#86a3b6"); grd.addColorStop(1, "#a7bfcd");
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.fillStyle = "rgba(40,52,62,0.45)";
        for (let i = 0; i <= 4; i++) { g.fillRect(i * 64 - 2, 0, 4, h); g.fillRect(0, i * 64 - 2, w, 4); }
        for (let i = 0; i < 16; i++) if (hash(i * 5.1) < 0.3) { g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect((i % 4) * 64 + 2, Math.floor(i / 4) * 64 + 2, 60, 60); }
      }, a),
      // 1층 상가: 위쪽 간판 띠와 아래쪽 유리 진열창. 가로 4칸(칸당 4m), 높이 4.2m
      shop: canvasTex(512, 256, (g, w, h) => {
        g.fillStyle = "#3b3f44"; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 4; i++) {
          const x = i * 128, c = SIGN_COLORS[Math.floor(hash(i * 3.7 + 1) * SIGN_COLORS.length)];
          g.fillStyle = c; g.fillRect(x + 2, 8, 124, 58);
          g.fillStyle = c === "#f4f1ea" || c === "#f2c230" ? "#1b1b1b" : "#fbfaf6";
          const n = 3 + Math.floor(hash(i * 9.1) * 4);
          for (let k = 0; k < n; k++) g.fillRect(x + 14 + k * (100 / n), 24, 100 / n - 6, 26);
          const grd = g.createLinearGradient(0, 80, 0, 250);
          grd.addColorStop(0, "#7e95a6"); grd.addColorStop(1, "#24313c");
          g.fillStyle = grd; g.fillRect(x + 8, 80, 112, 170);
          g.fillStyle = "rgba(255,240,210,0.35)"; g.fillRect(x + 14, 160, 100, 90);
          g.fillStyle = "#8f9398"; g.fillRect(x + 62, 80, 4, 170);
        }
      }, a),
      roof: canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); noise(g, w, h, 26, 3);
        g.fillStyle = "rgba(0,0,0,0.08)"; for (let i = 0; i < 8; i++) g.fillRect(i * 32, 0, 2, h);
      }, a),
      paving: canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#a99f92"; g.fillRect(0, 0, w, h);
        for (let r = 0; r < 20; r++) for (let c = 0; c < 10; c++) {
          const v = hash(r * 31 + c * 7) * 14 - 7;
          g.fillStyle = `rgb(${170 + v},${160 + v},${148 + v})`;
          g.fillRect(c * 25.6 + (r % 2 ? 12.8 : 0), r * 12.8, 24.6, 11.8);
        }
        noise(g, w, h, 10, 4);
      }, a),
      plaza: canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#cfc8bd"; g.fillRect(0, 0, w, h);
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
          const v = hash(r * 17 + c * 3) * 16 - 8;
          g.fillStyle = `rgb(${205 + v},${198 + v},${187 + v})`; g.fillRect(c * 32 + 1, r * 32 + 1, 30, 30);
        }
        noise(g, w, h, 8, 5);
      }, a),
      asphalt: canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#45484c"; g.fillRect(0, 0, w, h); noise(g, w, h, 22, 6); }, a),
      grass: canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#6f8d4c"; g.fillRect(0, 0, w, h); noise(g, w, h, 34, 7); }, a),
      hedge: canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = "#4f7038"; g.fillRect(0, 0, w, h); noise(g, w, h, 60, 8);
        g.fillStyle = "#8d8577"; g.fillRect(0, h - 26, w, 26); // 화단 아래 돌 테두리
      }, a),
      // 공사 가림막: 판넬 4장(장당 2m × 2.4m). 흰 판에 파란 띠, 한국 공사장에서 흔한 문구를 적는다
      panel: canvasTex(1024, 512, (g, w, h) => {
        const words = ["공사중", "안전제일", "통행제한", "우회하세요"];
        for (let i = 0; i < 4; i++) {
          const x = i * 256;
          g.fillStyle = "#f3f4f1"; g.fillRect(x, 0, 256, h);
          g.fillStyle = "#1f4fa0"; g.fillRect(x, 18, 256, 22); g.fillRect(x, h - 120, 256, 120);
          g.fillStyle = "#2e8b57"; g.fillRect(x, h - 132, 256, 10);
          g.fillStyle = "#1f4fa0";
          g.font = "bold 50px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(words[i], x + 128, h * 0.42);
          g.fillStyle = "#ffffff"; g.font = "bold 26px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
          g.fillText("SAFETY FIRST", x + 128, h - 60);
          g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + 252, 0, 4, h); // 판넬 이음매
        }
        noise(g, w, h, 6, 9);
      }, a),
      // 노란색·검은색 사선 줄무늬 (1m에 한 쌍)
      stripes: canvasTex(128, 32, (g, w, h) => {
        g.fillStyle = "#f2c230"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#1d1d1d";
        for (let x = -h; x < w + h; x += 64) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 32, h); g.lineTo(x + 32 + h, 0); g.lineTo(x + h, 0); g.fill(); }
      }, a),
      // 라바콘: 주황 몸통에 흰 반사띠 두 줄 (위가 캔버스 위쪽)
      cone: canvasTex(16, 128, (g, w, h) => {
        g.fillStyle = "#f2611d"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#f4f4f0"; g.fillRect(0, h * 0.28, w, h * 0.13); g.fillRect(0, h * 0.55, w, h * 0.11);
      }, a),
    };
    TEX.ground = TEX.paving.clone();
    TEX.ground.needsUpdate = true;
    return TEX;
  }

  // ---------- 기하 버퍼 ----------
  const buf = () => ({ p: [], n: [], u: [], c: [] });
  function vtx(B, x, y, z, nx, ny, nz, u, v, col) { B.p.push(x, y, z); B.n.push(nx, ny, nz); B.u.push(u, v); B.c.push(col.r, col.g, col.b); }
  function toMesh(B, mat, cast) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(B.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(B.c, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = !!cast; m.receiveShadow = true;
    return m;
  }
  // 위를 향하는 평면 삼각형. 감기는 방향이 거꾸로면 바로잡는다.
  function triUp(B, a, b, c, y, s, col) {
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (cross < 0) { const t = b; b = c; c = t; }
    for (const q of [a, b, c]) vtx(B, q[0], y, q[1], 0, 1, 0, q[0] / s, -q[1] / s, col);
  }
  function quadUp(B, a, b, c, d, y, s, col) { triUp(B, a, b, c, y, s, col); triUp(B, a, c, d, y, s, col); }
  function polyUp(B, pts, y, s, col) {
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []); } catch (e) { return; }
    for (const t of tris) triUp(B, pts[t[0]], pts[t[1]], pts[t[2]], y, s, col);
  }
  function pointInPoly(x, z, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  // 바깥을 향하는 법선이 (dz, -dx)가 되도록 꼭짓점 순서를 맞춘다
  function orient(raw) {
    const pts = raw.slice();
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
    if (s < 0) pts.reverse();
    return { pts, area: Math.abs(s) / 2 };
  }
  // 벽: 칸 수와 층 수를 정수로 맞춰서 창문이 모서리에서 잘리지 않게 한다
  function addWalls(B, pts, y0, y1, col, bayW, perTileU, floorH, perTileV, seed, ao) {
    const nf = Math.max(1, Math.round((y1 - y0) / floorH));
    const cBottom = col.clone().multiplyScalar(ao);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = dz / len, nz = -dx / len;
      const u0 = Math.floor(hash(seed + i * 3.3) * 4) / 4, u1 = u0 + Math.max(1, Math.round(len / bayW)) / perTileU;
      const v1 = nf / perTileV;
      const put = (x, y, z, u, v, c) => vtx(B, x, y, z, nx, 0, nz, u, v, c);
      put(a[0], y0, a[1], u0, 0, cBottom); put(b[0], y1, b[1], u1, v1, col); put(b[0], y0, b[1], u1, 0, cBottom);
      put(a[0], y0, a[1], u0, 0, cBottom); put(a[0], y1, a[1], u0, v1, col); put(b[0], y1, b[1], u1, v1, col);
    }
  }

  // 세로로 선 사각형 한 장 (a에서 b까지, 높이 y0~y1)
  function vquad(B, a, b, y0, y1, u0, u1, col) {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len;
    const put = (x, y, z, u, v) => vtx(B, x, y, z, nx, 0, nz, u, v, col);
    put(a[0], y0, a[1], u0, 0); put(b[0], y1, b[1], u1, 1); put(b[0], y0, b[1], u1, 0);
    put(a[0], y0, a[1], u0, 0); put(a[0], y1, a[1], u0, 1); put(b[0], y1, b[1], u1, 1);
  }

  const MARGIN = 350; // 지도 밖으로 배경을 그리는 거리(m). tools/build_maps.mjs의 SCENERY_MARGIN과 같다
  const EDGE_BAND = 1.8; // 지도 가장자리에서 이 거리 안으로는 들어가지 못한다 (가림막과 라바콘이 서는 자리)

  const WALL_TINTS =["#ebe6dc", "#e0d9cb", "#d3cdc3", "#e8e3d8", "#cbc1b2", "#bcb1a2", "#dcd6ce", "#aca69d", "#c9d2d6", "#d9cbb5"];
  const BRICK = ["#9a5a44", "#8a5a46", "#a8735a"];
  const ROAD_LAYER = 0.04;

  // 공간 색인: 칸마다 그 칸에 걸친 물체 번호를 둔다 (충돌 검사와 나무 배치에 쓴다)
  function makeIndex(cellSize) {
    const cells = new Map();
    return {
      add(minx, minz, maxx, maxz, item) {
        for (let cz = Math.floor(minz / cellSize); cz <= Math.floor(maxz / cellSize); cz++)
          for (let cx = Math.floor(minx / cellSize); cx <= Math.floor(maxx / cellSize); cx++) {
            const k = cx + "," + cz;
            (cells.get(k) || cells.set(k, []).get(k)).push(item);
          }
      },
      at(x, z) { return cells.get(Math.floor(x / cellSize) + "," + Math.floor(z / cellSize)) || []; },
    };
  }

  // ---------- 장면 만들기 ----------
  // avoid: 나무를 세우지 않을 지점 [{x, z}] (출발점, 목적지)
  function build(scene, renderer, map, avoid) {
    const T = textures(renderer);
    const sc = map.scenery || { buildings: [], roads: [], green: [], trees: [] };
    const group = new THREE.Group();
    const size = map.size, n = map.n, cell = map.cell;
    const ONE = new THREE.Color(1, 1, 1);

    // 바닥: 지도 밖 배경까지 보도블록을 깐다
    const span = size + MARGIN * 2 + 100;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshStandardMaterial({ map: T.ground, roughness: 0.95 }));
    T.ground.repeat.set(span / 4, span / 4);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(size / 2, 0, size / 2);
    ground.receiveShadow = true;
    group.add(ground);

    // 건물
    const BP = buf(), BR = buf(), BG = buf(), BS = buf(), BROOF = buf();
    const solids = makeIndex(12); // 충돌용 건물 다각형
    const polys = [];
    sc.buildings.forEach((b, i) => {
      const { pts, area } = orient(b.p);
      const r = hash(i * 7.77);
      const isRoof = b.k === "roof", isChurch = b.k === "church", isLow = b.k === "low";
      const h = b.h;
      const tint = lin(isChurch ? BRICK[Math.floor(r * BRICK.length)] : WALL_TINTS[Math.floor(r * WALL_TINTS.length)]);
      if (isRoof) {
        addWalls(BROOF, pts, 3.4, h, lin("#9b9d9f"), BAY, 4, FLOOR, 4, i, 1);
      } else {
        const minx = Math.min(...pts.map((p) => p[0])), maxx = Math.max(...pts.map((p) => p[0]));
        const minz = Math.min(...pts.map((p) => p[1])), maxz = Math.max(...pts.map((p) => p[1]));
        const poly = { pts, minx, maxx, minz, maxz };
        polys.push(poly);
        solids.add(minx, minz, maxx, maxz, poly);
        if (h >= 45 && (b.m || r < 0.45)) {
          addWalls(BG, pts, 0, h, lin(["#cfe0ea", "#bcd0db", "#d9e2e6"][Math.floor(r * 3)]), 3, 4, FLOOR, 4, i, 0.8);
        } else {
          const hasShop = !isLow && !isChurch && b.k !== "apartments" && area > 40 && h > SHOP_H + 2;
          const target = r < 0.5 || isChurch || isLow ? BP : BR;
          if (hasShop) {
            addWalls(BS, pts, 0, SHOP_H, ONE, 4, 4, SHOP_H, 1, i, 0.78);
            addWalls(target, pts, SHOP_H, h, tint, BAY, 4, FLOOR, 4, i, 0.94);
          } else {
            addWalls(target, pts, 0, h, tint, BAY, 4, FLOOR, 4, i, 0.74);
          }
        }
      }
      // 지붕: 한국 옥상에서 흔한 초록 방수 페인트를 일부 섞는다
      polyUp(BROOF, pts, h, 8, lin(r < 0.3 ? "#6f9a7c" : r < 0.4 ? "#9aa3a8" : "#b4b1aa"));
    });

    // 막힌 땅: 넓게 이어진 곳은 저층 건물로 채우고, 걷는 칸과 맞닿은 나머지는 화단으로 막는다.
    // OSM에 작은 주택이 빠진 동네(서울 지역 등)에서도 거리가 비어 보이지 않게 한다.
    const blocked = (r, c) => r < 0 || c < 0 || r >= n || c >= n || map.kind[r * n + c] === 0;
    const filled = new Uint8Array(n * n);
    const LOT = Math.max(2, Math.round(10 / cell)); // 한 필지 약 10m
    for (let r0 = 0; r0 + LOT <= n; r0 += LOT) for (let c0 = 0; c0 + LOT <= n; c0 += LOT) {
      let all = true;
      for (let r = r0; r < r0 + LOT && all; r++) for (let c = c0; c < c0 + LOT && all; c++) if (!blocked(r, c)) all = false;
      if (!all) continue;
      for (let r = r0; r < r0 + LOT; r++) for (let c = c0; c < c0 + LOT; c++) filled[r * n + c] = 1;
      const k = r0 * 131 + c0;
      const floors = 2 + Math.floor(hash(k * 1.9) * 4);
      const x0 = c0 * cell + 0.3, x1 = (c0 + LOT) * cell - 0.3, z0 = r0 * cell + 0.3, z1 = (r0 + LOT) * cell - 0.3;
      const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; // (dz, -dx)가 바깥을 향하는 순서
      const h = floors * FLOOR + 0.6;
      const tint = lin(WALL_TINTS[Math.floor(hash(k) * WALL_TINTS.length)]);
      const edgeOpen = !blocked(r0 - 1, c0) || !blocked(r0 + LOT, c0) || !blocked(r0, c0 - 1) || !blocked(r0, c0 + LOT);
      if (edgeOpen && floors >= 3) {
        addWalls(BS, pts, 0, SHOP_H, ONE, 4, 4, SHOP_H, 1, k, 0.78);
        addWalls(hash(k * 3) < 0.5 ? BP : BR, pts, SHOP_H, h, tint, BAY, 4, FLOOR, 4, k, 0.94);
      } else {
        addWalls(hash(k * 3) < 0.5 ? BP : BR, pts, 0, h, tint, BAY, 4, FLOOR, 4, k, 0.74);
      }
      polyUp(BROOF, pts, h, 8, lin(hash(k * 5) < 0.3 ? "#6f9a7c" : "#b4b1aa"));
    }
    const isHedge = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!blocked(r, c) || filled[r * n + c]) continue;
      let touches = false;
      for (let dr = -1; dr <= 1 && !touches; dr++) for (let dc = -1; dc <= 1 && !touches; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < n && cc < n && map.kind[rr * n + cc] === 2) touches = true;
      }
      if (touches) isHedge[r * n + c] = 1;
    }
    // 화단 칸을 가로로 이어 붙이고, 아래 줄이 같은 폭이면 세로로도 합쳐서 상자 수를 줄인다
    const BHEDGE = buf(), BHEDGETOP = buf();
    const HEDGE_H = 1.1;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!isHedge[r * n + c]) continue;
      let c1 = c;
      while (c1 + 1 < n && isHedge[r * n + c1 + 1]) c1++;
      let r1 = r;
      const rowFull = (rr) => { for (let k = c; k <= c1; k++) if (!isHedge[rr * n + k]) return false; return true; };
      while (r1 + 1 < n && rowFull(r1 + 1)) r1++;
      for (let rr = r; rr <= r1; rr++) for (let k = c; k <= c1; k++) isHedge[rr * n + k] = 0;
      const x0 = c * cell, x1 = (c1 + 1) * cell, z0 = r * cell, z1 = (r1 + 1) * cell;
      const rect = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      addWalls(BHEDGE, rect, 0, HEDGE_H, ONE, 2, 1, HEDGE_H, 1, r * n + c, 0.8);
      polyUp(BHEDGETOP, rect, HEDGE_H, 5, ONE);
    }
    const dummy = new THREE.Object3D();

    // 도로
    const roads = sc.roads.map((r) => ({ ...r, pts: r.p }));
    const nodeUse = new Map();
    const keyOf = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
    for (const rd of roads) if (rd.k === "car") for (const p of rd.pts) {
      const k = keyOf(p), e = nodeUse.get(k) || { n: 0, w: 0 };
      e.n++; e.w = Math.max(e.w, rd.w); nodeUse.set(k, e);
    }
    for (const rd of roads) {
      rd.junctions = rd.pts.filter((p) => { const e = nodeUse.get(keyOf(p)); return e && e.n >= 2; })
        .map((p) => ({ x: p[0], z: p[1], trim: nodeUse.get(keyOf(p)).w / 2 + 2.5 }));
    }
    function sample(rd, step) {
      const out = [];
      let d = 0;
      const okAt = (x, z) => rd.junctions.every((J) => Math.hypot(J.x - x, J.z - z) > J.trim);
      for (let i = 0; i < rd.pts.length - 1; i++) {
        const a = rd.pts[i], b = rd.pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const tx = dx / len, tz = dz / len, k = Math.max(1, Math.ceil(len / step));
        for (let j = 0; j < k; j++) {
          const s = (j / k) * len, x = a[0] + tx * s, z = a[1] + tz * s;
          out.push({ x, z, tx, tz, d: d + s, ok: okAt(x, z) });
        }
        d += len;
        if (i === rd.pts.length - 2) out.push({ x: b[0], z: b[1], tx, tz, d, ok: okAt(b[0], b[1]) });
      }
      return out;
    }
    const off = (s, o) => [s.x - s.tz * o, s.z + s.tx * o];
    const BROAD = buf(), BPLAZA = buf(), BMARK = buf(), BGREEN = buf();
    const WHITE = lin("#e9e7e1"), YELLOW = lin("#e8b828"), CURB = lin("#cfcbc3");
    const treeSpots = [], lampSpots = [];
    function strip(S, o, width, y, col, dash) {
      for (let i = 0; i < S.length - 1; i++) {
        const s = S[i], t = S[i + 1];
        if (!s.ok || !t.ok) continue;
        if (dash && (s.d % 8) > 3.5) continue;
        quadUp(BMARK, off(s, o - width / 2), off(t, o - width / 2), off(t, o + width / 2), off(s, o + width / 2), y, 1, col);
      }
    }
    function crosswalk(s, w) {
      const L = 3.2;
      for (let o = -w / 2 + 1; o <= w / 2 - 1; o += 1) {
        const a = [s.x - s.tz * o - s.tx * L / 2, s.z + s.tx * o - s.tz * L / 2];
        const b = [s.x - s.tz * o + s.tx * L / 2, s.z + s.tx * o + s.tz * L / 2];
        const q = [-s.tz * 0.25, s.tx * 0.25];
        quadUp(BMARK, [a[0] - q[0], a[1] - q[1]], [b[0] - q[0], b[1] - q[1]], [b[0] + q[0], b[1] + q[1]], [a[0] + q[0], a[1] + q[1]], ROAD_LAYER + 0.03, 1, WHITE);
      }
    }
    const nearest = (S, d) => S.reduce((best, s) => (Math.abs(s.d - d) < Math.abs(best.d - d) ? s : best), S[0]);
    for (const rd of roads) {
      const plaza = rd.k === "plaza";
      const B = plaza ? BPLAZA : BROAD;
      const y = plaza ? 0.03 : ROAD_LAYER + Math.min(rd.w, 30) * 0.0005;
      const hw = rd.w / 2, s = plaza ? 4 : 6;
      for (let i = 0; i < rd.pts.length - 1; i++) {
        const a = rd.pts[i], b = rd.pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = (-dz / len) * hw, nz = (dx / len) * hw;
        quadUp(B, [a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz], y, s, ONE);
      }
      for (const p of rd.pts) { // 꺾이는 곳의 빈틈을 원으로 메운다
        for (let k = 0; k < 10; k++) {
          const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2;
          triUp(B, p, [p[0] + Math.cos(a0) * hw, p[1] + Math.sin(a0) * hw], [p[0] + Math.cos(a1) * hw, p[1] + Math.sin(a1) * hw], y, s, ONE);
        }
      }
      if (plaza) continue;
      const S = sample(rd, 2);
      strip(S, -hw, 0.35, ROAD_LAYER + 0.025, CURB, false);
      strip(S, hw, 0.35, ROAD_LAYER + 0.025, CURB, false);
      if (rd.w < 10) continue;
      // 한국 도로: 가운데 노란 겹선, 차로 사이 흰 점선, 교차로 앞 횡단보도
      strip(S, -0.2, 0.15, ROAD_LAYER + 0.03, YELLOW, false);
      strip(S, 0.2, 0.15, ROAD_LAYER + 0.03, YELLOW, false);
      const lanes = rd.ln || Math.max(2, Math.round((rd.w - 1.5) / 3.3));
      const perDir = Math.max(1, Math.floor(lanes / 2));
      const laneW = (hw - 0.5) / perDir;
      for (let j = 1; j < perDir; j++) { strip(S, j * laneW, 0.15, ROAD_LAYER + 0.03, WHITE, true); strip(S, -j * laneW, 0.15, ROAD_LAYER + 0.03, WHITE, true); }
      for (let i = 1; i < S.length; i++) {
        if (S[i].ok && !S[i - 1].ok) crosswalk(nearest(S, S[i].d - 2.4), rd.w);
        if (!S[i].ok && S[i - 1].ok) crosswalk(nearest(S, S[i - 1].d + 2.4), rd.w);
      }
      sample(rd, 9).forEach((sp, k) => {
        if (!sp.ok) return;
        for (const side of [-1, 1]) {
          treeSpots.push(off(sp, side * (hw + 1.6)));
          if (k % 3 === (side > 0 ? 0 : 1)) lampSpots.push({ p: off(sp, side * (hw + 0.5)), yaw: Math.atan2(sp.tx, sp.tz) + (side > 0 ? Math.PI : 0) });
        }
      });
    }

    // 녹지와 광장
    for (const g of sc.green) {
      const { pts, area } = orient(g.p);
      if (g.k === "water") continue; // 물은 아래에서 따로 그린다
      const isPlaza = g.k === "plaza" || g.k === "parking";
      if (isPlaza) { polyUp(BPLAZA, pts, 0.028, 4, ONE); continue; }
      polyUp(BGREEN, pts, 0.025, 5, ONE);
      if (!/park|garden|wood|forest|village_green|recreation_ground/.test(g.k)) continue;
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      const minx = Math.min(...xs), maxx = Math.max(...xs), minz = Math.min(...zs), maxz = Math.max(...zs);
      const count = Math.min(220, Math.floor(area / 120));
      for (let k = 0; k < count * 3 && k < 700; k++) {
        const x = minx + hash(k * 2.1 + area) * (maxx - minx), z = minz + hash(k * 3.7 + area) * (maxz - minz);
        if (pointInPoly(x, z, pts)) treeSpots.push([x, z]);
      }
    }
    for (const t of sc.trees) treeSpots.push(t);

    // ---------- 지도 밖 배경 ----------
    // OSM에 건물이 없는 바깥 빈 땅도 저층 건물로 채워서, 지도 밖이 허허벌판으로 보이지 않게 한다.
    // 길(차도 + 보도)과 공원·물 위에는 세우지 않는다.
    const roadIdx = makeIndex(20);
    for (const rd of roads) for (let i = 0; i < rd.pts.length - 1; i++) {
      const a = rd.pts[i], b = rd.pts[i + 1], pad = rd.w / 2 + 5;
      roadIdx.add(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, { a, b, pad });
    }
    const greenIdx = makeIndex(40);
    for (const g of sc.green) {
      const xs = g.p.map((p) => p[0]), zs = g.p.map((p) => p[1]);
      greenIdx.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), g.p);
    }
    const nearRoad = (x, z, extra) => roadIdx.at(x, z).some((s) => segDist2(x, z, s.a, s.b) < (s.pad + extra) ** 2);
    const onGreen = (x, z) => greenIdx.at(x, z).some((p) => pointInPoly(x, z, p));
    const onBuilding = (x, z) => solids.at(x, z).some((p) => x >= p.minx && x <= p.maxx && z >= p.minz && z <= p.maxz && pointInPoly(x, z, p.pts));
    const OLOT = 10;
    for (let z0 = -MARGIN; z0 < size + MARGIN; z0 += OLOT) for (let x0 = -MARGIN; x0 < size + MARGIN; x0 += OLOT) {
      const x1 = x0 + OLOT, z1 = z0 + OLOT;
      if (x1 > -2 && x0 < size + 2 && z1 > -2 && z0 < size + 2) continue; // 지도 안(과 가장자리)은 위에서 채웠다
      const cx = x0 + OLOT / 2, cz = z0 + OLOT / 2;
      if (nearRoad(cx, cz, 2)) continue;
      const probes = [[cx, cz], [x0 + 1, z0 + 1], [x1 - 1, z0 + 1], [x0 + 1, z1 - 1], [x1 - 1, z1 - 1]];
      if (probes.some(([x, z]) => onBuilding(x, z) || onGreen(x, z) || nearRoad(x, z, -3))) continue;
      const k = Math.round(x0 * 7.3 + z0 * 131.7);
      const r = hash(k * 1.9);
      const floors = r < 0.12 ? 8 + Math.floor(hash(k) * 10) : 2 + Math.floor(r * 4); // 가끔 높은 건물을 섞어 스카이라인을 만든다
      const pts = [[x0 + 0.4, z0 + 0.4], [x1 - 0.4, z0 + 0.4], [x1 - 0.4, z1 - 0.4], [x0 + 0.4, z1 - 0.4]];
      const h = floors * FLOOR + 0.6;
      const tint = lin(WALL_TINTS[Math.floor(hash(k * 2.7) * WALL_TINTS.length)]);
      if (nearRoad(cx, cz, 8) && floors <= 5) {
        addWalls(BS, pts, 0, SHOP_H, ONE, 4, 4, SHOP_H, 1, k, 0.78);
        addWalls(hash(k * 3) < 0.5 ? BP : BR, pts, SHOP_H, h, tint, BAY, 4, FLOOR, 4, k, 0.94);
      } else {
        addWalls(hash(k * 3) < 0.5 ? BP : BR, pts, 0, h, tint, BAY, 4, FLOOR, 4, k, 0.74);
      }
      polyUp(BROOF, pts, h, 8, lin(hash(k * 5) < 0.3 ? "#6f9a7c" : "#b4b1aa"));
    }

    // ---------- 지도 가장자리 가림막 ----------
    // 걷는 길이 지도 가장자리에 닿는 곳마다 공사 가림막을 세워 "공사 중이라 못 지나간다"는 것을 보여 준다.
    // 넓은 길은 흰·파란 가림막 판넬 + 앞쪽 줄무늬 바리케이드와 라바콘, 좁은 길은 줄무늬 바리케이드와 라바콘만 둔다.
    const BPANEL = buf(), BSTRIPE = buf(), BPOST = buf();
    const conePos = [], lampPos = [];
    const DARK = lin("#3b3e42");
    const exits = [];
    const edges = [
      { cellAt: (k) => k, along: (t) => [t, 0], inward: [0, 1] },                       // 북쪽
      { cellAt: (k) => (n - 1) * n + k, along: (t) => [t, size], inward: [0, -1] },     // 남쪽
      { cellAt: (k) => k * n, along: (t) => [0, t], inward: [1, 0] },                   // 서쪽
      { cellAt: (k) => k * n + n - 1, along: (t) => [size, t], inward: [-1, 0] },       // 동쪽
    ];
    for (const e of edges) {
      for (let k = 0; k < n; k++) {
        if (map.kind[e.cellAt(k)] !== 2) continue;
        let k1 = k;
        while (k1 + 1 < n && map.kind[e.cellAt(k1 + 1)] === 2) k1++;
        exits.push({ e, t0: k * cell, t1: (k1 + 1) * cell });
        k = k1;
      }
    }
    // 판넬과 기둥 한 줄: from~to를 따라 inward 방향으로 off만큼 들어간 곳에 세운다
    const line = (e, t0, t1, off) => [
      [e.along(t0)[0] + e.inward[0] * off, e.along(t0)[1] + e.inward[1] * off],
      [e.along(t1)[0] + e.inward[0] * off, e.along(t1)[1] + e.inward[1] * off],
    ];
    function postAt(p, h) {
      const s = 0.06;
      const pts = [[p[0] - s, p[1] - s], [p[0] + s, p[1] - s], [p[0] + s, p[1] + s], [p[0] - s, p[1] + s]];
      addWalls(BPOST, pts, 0, h, DARK, 1, 1, h, 1, 0, 1);
    }
    exits.forEach((x, i) => {
      const w = x.t1 - x.t0;
      // 가림막이 길 양쪽 끝의 건물·화단과 맞닿도록 1m씩 더 늘린다
      const t0 = x.t0 - 1, t1 = x.t1 + 1;
      if (w >= 6) {
        let [a, b] = line(x.e, t0, t1, 0.3);
        if ((b[1] - a[1]) * x.e.inward[0] - (b[0] - a[0]) * x.e.inward[1] < 0) [a, b] = [b, a];
        const panels = Math.max(1, Math.round((t1 - t0) / 2));
        vquad(BPANEL, a, b, 0.05, 2.4, (i % 4) / 4 + panels / 4, (i % 4) / 4, ONE);
        for (let p = 0; p <= panels; p++) postAt([a[0] + (b[0] - a[0]) * (p / panels), a[1] + (b[1] - a[1]) * (p / panels)], 2.5);
      }
      // 줄무늬 바리케이드: 판넬 앞(또는 좁은 길에서는 단독으로) 1.0m 안쪽에 두 줄
      const bw = w >= 6 ? Math.min(6, w * 0.6) : w + 2;
      const groups = w >= 6 ? Math.max(1, Math.round(w / 30)) : 1;
      for (let gi = 0; gi < groups; gi++) {
        const mid = x.t0 + (w / groups) * (gi + 0.5);
        const [c, d] = line(x.e, mid - bw / 2, mid + bw / 2, w >= 6 ? 1.0 : 0.6);
        for (const y of [0.55, 0.92]) vquad(BSTRIPE, c, d, y, y + 0.22, 0, bw, ONE);
        postAt(c, 1.15); postAt(d, 1.15);
        lampPos.push([c[0], c[1]], [d[0], d[1]]);
        // 라바콘: 바리케이드 앞에 2~4개를 조금씩 흐트러뜨려 놓는다
        const cones = Math.min(4, Math.max(1, Math.floor(bw / 1.5)));
        for (let k = 0; k < cones; k++) {
          const t = mid - bw / 2 + (bw / cones) * (k + 0.5) + (hash(i * 13 + gi * 7 + k) - 0.5) * 0.5;
          conePos.push(line(x.e, t, t, 1.4 + hash(i * 3 + k) * 0.2)[0]);
        }
      }
      // 긴 가림막에는 사이사이에 라바콘을 드문드문 둔다
      if (w >= 6) for (let t = x.t0 + 4; t < x.t1 - 4; t += 9 + hash(t) * 6) conePos.push(line(x.e, t, t, 1.3)[0]);
    });

    // 물(강, 호수)
    const BWATER = buf();
    for (const g of sc.green) if (g.k === "water") polyUp(BWATER, orient(g.p).pts, 0.03, 10, ONE);

    const poly = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
    const std = (map, extra) => new THREE.MeshStandardMaterial(Object.assign({ map, vertexColors: true, roughness: 0.9, metalness: 0 }, extra || {}));
    group.add(toMesh(BROAD, std(T.asphalt, Object.assign({ roughness: 0.85 }, poly))));
    group.add(toMesh(BPLAZA, std(T.plaza, poly)));
    group.add(toMesh(BGREEN, std(T.grass, Object.assign({ roughness: 1 }, poly))));
    group.add(toMesh(BHEDGE, std(T.hedge, { roughness: 1 }), true));
    group.add(toMesh(BHEDGETOP, std(T.grass, { roughness: 1 }), true));
    group.add(toMesh(BMARK,new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    group.add(toMesh(BP, std(T.punched), true));
    group.add(toMesh(BR, std(T.ribbon), true));
    group.add(toMesh(BG, std(T.glass, { roughness: 0.35 }), true));
    group.add(toMesh(BS, std(T.shop, { roughness: 0.6 }), true));
    group.add(toMesh(BROOF, std(T.roof, { roughness: 1 }), true));
    group.add(toMesh(BWATER, new THREE.MeshStandardMaterial({ color: lin("#5f8296"), roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    group.add(toMesh(BPANEL, std(T.panel, { side: THREE.DoubleSide, roughness: 0.7 }), true));
    group.add(toMesh(BSTRIPE, std(T.stripes, { side: THREE.DoubleSide, roughness: 0.6 }), true));
    group.add(toMesh(BPOST, std(null, { roughness: 0.8 }), true));

    // 라바콘과 바리케이드 위 경고등 (경고등은 천천히 깜빡인다)
    const coneGeo = new THREE.ConeGeometry(0.2, 0.72, 14, 1, true); coneGeo.translate(0, 0.4, 0);
    const baseGeo = new THREE.BoxGeometry(0.44, 0.05, 0.44); baseGeo.translate(0, 0.025, 0);
    const coneMesh = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ map: T.cone, roughness: 0.6 }), Math.max(1, conePos.length));
    const baseMesh = new THREE.InstancedMesh(baseGeo, new THREE.MeshStandardMaterial({ color: lin("#26282b"), roughness: 0.9 }), Math.max(1, conePos.length));
    coneMesh.count = baseMesh.count = conePos.length;
    const lampGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16); lampGeo.translate(0, 1.25, 0);
    const lampMat = new THREE.MeshStandardMaterial({ color: lin("#f2a12a"), emissive: lin("#ffb02e"), emissiveIntensity: 1.5, roughness: 0.4 });
    const warnMesh = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, lampPos.length));
    warnMesh.count = lampPos.length;
    {
      const m = new THREE.Object3D();
      conePos.forEach((p, i) => { m.position.set(p[0], 0, p[1]); m.rotation.set(0, hash(i) * 6.28, 0); m.updateMatrix(); coneMesh.setMatrixAt(i, m.matrix); baseMesh.setMatrixAt(i, m.matrix); });
      lampPos.forEach((p, i) => { m.position.set(p[0], 0, p[1]); m.rotation.set(0, 0, 0); m.updateMatrix(); warnMesh.setMatrixAt(i, m.matrix); });
    }
    coneMesh.castShadow = baseMesh.castShadow = true;
    group.add(coneMesh, baseMesh, warnMesh);

    // 가로수·가로등: 건물 안, 막힌 땅, 출발점·목적지 근처에는 세우지 않는다
    const insideSolid = (x, z) => solids.at(x, z).some((p) => x >= p.minx - 0.8 && x <= p.maxx + 0.8 && z >= p.minz - 0.8 && z <= p.maxz + 0.8 && pointInPoly(x, z, p.pts));
    const cellKind = (x, z) => {
      const c = Math.floor(x / cell), r = Math.floor(z / cell);
      return r < 0 || c < 0 || r >= n || c >= n ? -1 : map.kind[r * n + c];
    };
    const clearOf = (x, z) => (avoid || []).every((a) => Math.hypot(a.x - x, a.z - z) > 4);
    const okSpot = (x, z) => {
      const k = cellKind(x, z);
      return (k === 2 || k === -1) && !insideSolid(x, z) && clearOf(x, z);
    };
    const nearExit = (x, z) => exits.some(({ e, t0, t1 }) => {
      const [ax, az] = e.along((t0 + t1) / 2);
      return Math.hypot(ax - x, az - z) < (t1 - t0) / 2 + 3;
    });
    const trees = treeSpots.filter(([x, z]) => x > -250 && z > -250 && x < size + 250 && z < size + 250 && okSpot(x, z) && !nearExit(x, z));
    const obstacles = makeIndex(8);
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 3, 6); trunkGeo.translate(0, 1.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(2, 0); crownGeo.translate(0, 4.4, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: lin("#5b4a3c"), roughness: 1 }), Math.max(1, trees.length));
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), Math.max(1, trees.length));
    // 가을 은행나무처럼 일부는 노랗게 칠한다
    const greens = ["#5f8a45", "#6f9a4c", "#557d3f", "#7ea152", "#c8b03c", "#d9be45", "#8fa648"].map(lin);
    trunk.count = crown.count = trees.length;
    trees.forEach(([x, z], i) => {
      const s = 0.8 + hash(i * 1.7) * 0.5;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, hash(i) * 6.28, 0); dummy.scale.set(s, s * (0.9 + hash(i * 2.3) * 0.4), s);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix); crown.setMatrixAt(i, dummy.matrix);
      crown.setColorAt(i, greens[Math.floor(hash(i * 4.1) * greens.length)]);
      obstacles.add(x - 0.3, z - 0.3, x + 0.3, z + 0.3, { x, z, r: 0.3 });
    });
    trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true;
    group.add(trunk, crown);

    const lamps = lampSpots.filter(({ p }) => okSpot(p[0], p[1]));
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 8, 6); poleGeo.translate(0, 4, 0);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.2); armGeo.translate(0, 7.9, 1.0);
    const headGeo = new THREE.BoxGeometry(0.35, 0.18, 0.8); headGeo.translate(0, 7.8, 2.1);
    const metal = new THREE.MeshStandardMaterial({ color: lin("#5c6066"), roughness: 0.6, metalness: 0.3 });
    const lampN = Math.max(1, lamps.length);
    const pole = new THREE.InstancedMesh(poleGeo, metal, lampN);
    const arm = new THREE.InstancedMesh(armGeo, metal, lampN);
    const head = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: lin("#e9e2cc"), roughness: 0.5 }), lampN);
    pole.count = arm.count = head.count = lamps.length;
    lamps.forEach(({ p, yaw }, i) => {
      dummy.position.set(p[0], 0, p[1]); dummy.rotation.set(0, yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      pole.setMatrixAt(i, dummy.matrix); arm.setMatrixAt(i, dummy.matrix); head.setMatrixAt(i, dummy.matrix);
      obstacles.add(p[0] - 0.2, p[1] - 0.2, p[0] + 0.2, p[1] + 0.2, { x: p[0], z: p[1], r: 0.2 });
    });
    pole.castShadow = arm.castShadow = true;
    group.add(pole, arm, head);

    scene.add(group);

    // 원(플레이어)이 건물 벽이나 나무 기둥에 닿는지 검사한다
    function segDist2(px, pz, a, b) {
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2)) : 0;
      const qx = a[0] + dx * t - px, qz = a[1] + dz * t - pz;
      return qx * qx + qz * qz;
    }
    function hits(x, z, radius) {
      for (const p of solids.at(x, z)) {
        if (x < p.minx - radius || x > p.maxx + radius || z < p.minz - radius || z > p.maxz + radius) continue;
        if (pointInPoly(x, z, p.pts)) return true;
        for (let i = 0; i < p.pts.length; i++) if (segDist2(x, z, p.pts[i], p.pts[(i + 1) % p.pts.length]) < radius * radius) return true;
      }
      for (const o of obstacles.at(x, z)) if (Math.hypot(o.x - x, o.z - z) < o.r + radius) return true;
      return false;
    }

    // 매 프레임: 경고등 깜빡임
    function tick(now) {
      lampMat.emissiveIntensity = Math.sin(now * 0.004) > 0 ? 1.8 : 0.15;
    }
    // 가장자리 가림막 앞인지 (안내 문구를 띄울 때 쓴다)
    const nearEdge = (x, z) => x < EDGE_BAND + 1.2 || z < EDGE_BAND + 1.2 || x > size - EDGE_BAND - 1.2 || z > size - EDGE_BAND - 1.2;

    return { group, hits, tick, nearEdge, edgeBand: EDGE_BAND, stats: { buildings: polys.length, trees: trees.length, exits: exits.length },
      exits: exits.map(({ e, t0, t1 }) => { const [x, z] = e.along((t0 + t1) / 2); return { x, z, inward: e.inward, width: t1 - t0 }; }) };
  }

  // ---------- 하늘, 빛, 안개 ----------
  function atmosphere(scene, renderer, camera) {
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const HORIZON = 0xdfe7ec;
    scene.fog = new THREE.Fog(lin(HORIZON), CONFIG.FOG_NEAR, CONFIG.FOG_FAR);
    const skyR = camera.far * 0.9;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(skyR, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: { top: { value: lin(0x5f8fc9) }, horizon: { value: lin(HORIZON) }, bottom: { value: lin(0xc5ced4) } },
        vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;\n" +
          "void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.7)) : mix(horizon, bottom, min(-h * 4.0, 1.0));\n" +
          "gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}",
      })
    );
    sky.renderOrder = -10;
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(lin(0xd6e4f2), lin(0x7d7264), 0.85));
    const SUN_DIR = new THREE.Vector3(-0.55, 0.72, 0.42).normalize(); // 남서쪽 오후 햇빛
    const sun = new THREE.DirectionalLight(lin(0xfff0d6), 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.4;
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 600; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75;
    scene.add(sun, sun.target);

    // 그림자는 플레이어 주변만 촘촘하게 그린다
    return function update() {
      sky.position.copy(camera.position);
      sun.target.position.set(Math.round(camera.position.x / 4) * 4, 0, Math.round(camera.position.z / 4) * 4);
      sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 300);
    };
  }

  return { build, atmosphere };
})();
