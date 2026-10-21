// 상징 건물: 지역마다 사람들이 알아보는 건물·시설을 일반 상자 대신 특징 있는 모습으로 그린다 (2026-10-21).
// 위치는 지도 좌표(m, x 동쪽·z 남쪽)의 한 점으로 정하고, 그 점을 품은 OSM·공공 건물 다각형을 쓴다. 높이는 공식 자료로 맞춘다.
// 이름 글자는 위치 안내 목적이며 회사·기관과 관계없다(첫 화면 출처 목록). 로고는 쓰지 않는다.
// 멀리 보이는 랜드마크(far)는 지도 밖 실제 위치에 있어 카메라가 그리는 거리(안개 끝) 밖이라,
// 같은 방향의 330m 앞에 크기를 줄여 그린다(보이는 각도는 같다). 모든 물체보다 먼저 그려서 가까운 건물이 가린다.

const LANDMARKS = (() => {
  const FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  const LIST = {
    // 서울월드컵경기장: 최고 높이 49.4m, 타원 304×279m (서울시설공단 시설개요). 안쪽 다각형(경기장 바닥)과 지붕 다각형은 숨긴다
    worldcup: [
      { type: "stadium", at: [264, 346], top: 49.4, hideInside: true },
      { type: "sign", at: [363, 658], text: "마포농수산물시장", color: "#1f5fbf" },
    ],
    // 더현대 대구: 지하 6층~지상 10층(2011 개점 보도), 백화점 층높이 약 5m로 50m
    banwoldang: [
      { type: "dept", at: [169, 286], height: 50, text: "더현대 대구" },
      { type: "sign", at: [102, 87], text: "약령시한의학박물관", color: "#6b3a1f" },
      { type: "sign", at: [703, 644], text: "봉산문화회관", color: "#2e5d4b" },
    ],
    // 서문시장: 2지구 상가(지하 3층~지상 4층, 2012 준공)와 1·4지구 아케이드 지붕
    seomun: [
      { type: "sign", at: [388, 449], text: "서문시장 2지구", color: "#b3261e", big: true },
      { type: "sign", at: [396, 379], text: "서문시장", color: "#b3261e", big: true, arcade: true },
      { type: "sign", at: [623, 357], text: "서문시장역", color: "#e07a1f" },
    ],
    // 잠실: 지도 안 서울 학생체육관(둥근 지붕), 동쪽 약 2km 롯데월드타워(555m, 123층)
    jamsil: [
      { type: "dome", at: [8, 290], text: "서울 학생체육관" },
      { type: "sign", at: [779, 298], text: "파인애플상가", color: "#c08a1a" },
      { type: "far", name: "롯데월드타워", lat: 37.51256, lon: 127.10253, height: 555, base: 87, top: 22 },
    ],
  };

  // 건물 번호 → { lm, role }: replace(직접 그림, 충돌은 그대로), decorate(그대로 그리고 간판만), hide(그리지 않음)
  function plan(map, buildings, pointInPoly) {
    const list = LIST[map.id] || [], out = new Map();
    for (const lm of list) {
      if (!lm.at) continue;
      const [x, z] = lm.at;
      // 그 점을 품은 건물 가운데 가장 넓은 것
      let best = -1, bestA = 0;
      buildings.forEach((b, i) => {
        if (!pointInPoly(x, z, b.p)) return;
        const a = area(b.p);
        if (a > bestA) { bestA = a; best = i; }
      });
      if (best < 0) continue;
      out.set(best, { lm, role: lm.type === "sign" ? "decorate" : "replace" });
      // 경기장: 바깥 다각형 안에 중심이 있는 다른 건물(경기장 바닥, 지붕)은 숨긴다
      if (lm.hideInside) {
        const outer = buildings[best].p;
        buildings.forEach((b, i) => {
          if (i === best) return;
          const cx = b.p.reduce((s, p) => s + p[0], 0) / b.p.length, cz = b.p.reduce((s, p) => s + p[1], 0) / b.p.length;
          if (pointInPoly(cx, cz, outer)) out.set(i, { lm, role: "hide" });
        });
      }
    }
    return out;
  }
  function area(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }

  function build(ctx) {
    const { group, map, built, buf, toMesh, std, T, addWalls, polyUp, vtx, lin, ONE, renderer, hash } = ctx;
    const aniso = renderer.capabilities.getMaxAnisotropy();
    const ticks = [];
    // 이름판 한 장(캔버스): 글자 수에 맞춘 가로 길이
    const plate = (text, bg, fg) => {
      const c = document.createElement("canvas"), h = 128, w = Math.max(256, Math.min(2048, 40 + text.length * 96));
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
      g.fillStyle = fg; g.font = `bold 84px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 4, w - 30);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso;
      return { t, aspect: w / h };
    };
    // 벽 a→b 바깥(법선 (dz, -dx)) 0.25m 앞에 붙인 판. 밖에서 볼 때 왼쪽에서 오른쪽으로 읽히게 u는 b에서 a로 간다
    const wallPlate = (a, b, y0, y1, tex, aspect) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 2) return null;
      const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, nx = tz, nz = -tx;
      const w = Math.min(L * 0.8, (y1 - y0) * aspect), m = L / 2, off = 0.25;
      const A = [a[0] + tx * (m - w / 2) + nx * off, a[1] + tz * (m - w / 2) + nz * off], B = [a[0] + tx * (m + w / 2) + nx * off, a[1] + tz * (m + w / 2) + nz * off];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([A[0], y0, A[1], B[0], y0, B[1], B[0], y1, B[1], A[0], y0, A[1], B[0], y1, B[1], A[0], y1, A[1]], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1], 2));
      g.computeVertexNormals();
      const m3 = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.5, emissive: 0x1a1a1a }));
      group.add(m3);
      return m3;
    };
    // 다각형의 긴 벽 n개 (긴 순)
    const longEdges = (pts, n) => pts.map((a, j) => { const b = pts[(j + 1) % pts.length]; return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) }; }).sort((p, q) => q.len - p.len).slice(0, n);
    const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

    for (const { sp, pts, h } of built) {
      const lm = sp.lm;
      if (lm.type === "stadium") stadium(pts, lm);
      else if (lm.type === "dept") dept(pts, lm);
      else if (lm.type === "dome") dome(pts, h, lm);
      else if (lm.type === "sign") {
        const p = plate(lm.text, lm.color || "#1f5fbf", "#ffffff");
        const hh = lm.arcade ? 4 : h;
        // 아케이드 지붕(높이 4m)은 지붕 가장자리 위에, 건물은 맨 위층 아래에 큰 판
        const y0 = lm.arcade ? hh + 0.2 : Math.max(3, hh - (lm.big ? 4.2 : 3.2)), y1 = lm.arcade ? hh + 2.4 : hh - 0.6;
        for (const e of longEdges(pts, lm.big ? 3 : 2)) wallPlate(e.a, e.b, y0, y1, p.t, p.aspect);
      }
    }
    for (const lm of LIST[map.id] || []) if (lm.type === "far") far(lm);
    if (map.rail) monorail(map.rail);
    return ticks.length ? (cam) => { for (const f of ticks) f(cam); } : null;

    // 경기장: 바깥 벽(관람석 뒤 벽), 바깥에서 안으로 내려가는 관람석, 경기장 잔디, 바깥 테두리에서 안쪽으로 뻗은 흰 막 지붕과 기둥
    function stadium(pts, lm) {
      const c = centroid(pts), top = lm.top, wallH = 24;
      const W = buf(), SEAT = buf(), ROOF = buf(), MAST = buf(), PITCH = buf();
      addWalls(W, pts, 0, wallH, lin("#d9dcde"), 6, 4, wallH / 3, 3, 7, 0.85);
      const inner = (p, k) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k];
      // 관람석: 바깥(높이 wallH) → 안쪽 0.58배(높이 3)로 내려가는 띠. v는 바깥에서 안쪽으로
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], ai = inner(a, 0.58), bi = inner(b, 0.58);
        const q = [[a, wallH, 0, 1], [b, wallH, 1, 1], [bi, 3, 1, 0], [ai, 3, 0, 0]];
        for (const k of [0, 1, 2, 0, 2, 3]) vtx(SEAT, q[k][0][0], q[k][1], q[k][0][1], 0, 1, 0, q[k][2] * 6, q[k][3] * 12, ONE);
      }
      // 잔디: 안쪽 0.58배 다각형
      polyUp(PITCH, pts.map((p) => inner(p, 0.58)), 0.08, 8, ONE);
      // 지붕: 바깥 테두리(높이 top - 5)에서 0.78배(높이 top - 2)까지 흰 막. 기둥은 바깥 테두리 12곳에서 최고 높이까지
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], ai = inner(a, 0.78), bi = inner(b, 0.78);
        const q = [[a, top - 5], [b, top - 5], [bi, top - 2], [ai, top - 2]];
        for (const k of [0, 1, 2, 0, 2, 3]) vtx(ROOF, q[k][0][0], q[k][1], q[k][0][1], 0, 1, 0, 0, 0, ONE);
      }
      const step = Math.max(1, Math.floor(pts.length / 12));
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i], d = 0.6, sq = [[p[0] - d, p[1] - d], [p[0] + d, p[1] - d], [p[0] + d, p[1] + d], [p[0] - d, p[1] + d]];
        addWalls(MAST, sq, wallH, top, lin("#f2f2ee"), 1, 1, top - wallH, 1, i, 0.95);
      }
      const seatTex = ctx.canvasTex(64, 128, (g, w, hh) => {
        for (let r = 0; r < 16; r++) { g.fillStyle = r % 2 ? "#c9473d" : "#b23a31"; g.fillRect(0, r * 8, w, 6); g.fillStyle = "#555a5e"; g.fillRect(0, r * 8 + 6, w, 2); }
        for (let r = 0; r < 16; r += 5) { g.fillStyle = "#2f62a8"; g.fillRect(0, r * 8, w, 6); }
      }, aniso);
      // 바깥 벽: 흰 세로 살과 그 사이 어두운 틈 (사무실 창문처럼 보이지 않게)
      const wallTex = ctx.canvasTex(128, 128, (g, w, hh) => { g.fillStyle = "#5a636b"; g.fillRect(0, 0, w, hh); g.fillStyle = "#f1f0ec"; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 22, hh); g.fillRect(0, 0, w, 14); g.fillRect(0, hh - 10, w, 10); }, aniso);
      group.add(toMesh(W, std(wallTex), true), toMesh(SEAT, std(seatTex, { side: THREE.DoubleSide }), true), toMesh(PITCH, std(T.grass, { roughness: 1 })));
      group.add(toMesh(MAST, std(null, { roughness: 0.4 }), true));
      const roof = toMesh(ROOF, new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }), true);
      group.add(roof);
    }

    // 백화점: 높이를 맞춘 유리 외벽에 층마다 흰 가로 띠, 긴 벽 두 곳 위쪽에 이름판
    function dept(pts, lm) {
      const H = lm.height, B = buf();
      const facade = ctx.canvasTex(256, 256, (g, w, hh) => {
        const grd = g.createLinearGradient(0, 0, w, hh); grd.addColorStop(0, "#9fb6c4"); grd.addColorStop(1, "#6f8696");
        g.fillStyle = grd; g.fillRect(0, 0, w, hh);
        g.fillStyle = "rgba(255,255,255,0.18)"; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, hh);
        g.fillStyle = "#e9e7e2"; g.fillRect(0, 0, w, 40); g.fillRect(0, 128, w, 40); // 층 띠 (두 층에 한 번 굵게)
      }, aniso);
      addWalls(B, pts, 0, H, ONE, 8, 1, 10, 1, 3, 0.9);
      group.add(toMesh(B, std(facade, { roughness: 0.35 }), true));
      const ROOF = buf(); polyUp(ROOF, pts, H, 8, lin("#b4b1aa")); group.add(toMesh(ROOF, std(T.roof), true));
      const p = plate(lm.text, "#2a2d31", "#f4f1ea");
      for (const e of longEdges(pts, 2)) wallPlate(e.a, e.b, H - 7, H - 2, p.t, p.aspect);
    }

    // 체육관: 벽 위에 낮은 둥근 지붕(바닥 모양을 감싸는 타원 반구를 납작하게), 이름판
    function dome(pts, h, lm) {
      const B = buf();
      addWalls(B, pts, 0, h, lin("#e3e0da"), BAY_W, 4, 3.3, 4, 5, 0.85);
      group.add(toMesh(B, std(T.punched), true));
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      const rx = (Math.max(...xs) - Math.min(...xs)) / 2, rz = (Math.max(...zs) - Math.min(...zs)) / 2;
      const g = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: lin("#b9c2c8"), roughness: 0.45, metalness: 0.3 }));
      m.position.set((Math.max(...xs) + Math.min(...xs)) / 2, h, (Math.max(...zs) + Math.min(...zs)) / 2);
      m.scale.set(rx * 0.92, Math.min(rx, rz) * 0.35, rz * 0.92);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      const p = plate(lm.text, "#1f3f73", "#ffffff");
      for (const e of longEdges(pts, 2)) wallPlate(e.a, e.b, Math.max(3, h - 3.5), h - 0.8, p.t, p.aspect);
    }

    // 고가 모노레일(대구 3호선): 길 가운데 T자 기둥(30m마다, 높이 10m), 그 위 콘크리트 선로 두 줄(폭 0.9m, 높이 1.6m, 간격 3.6m),
    // 역은 선로를 감싼 길이 60m 승강장 상자와 지붕. 기둥은 충돌 판정에 넣는다(pillarSpots)
    function monorail(rail) {
      const P = buf(), BEAM = buf(), ST = buf(), concrete = lin("#c9c7c1"), gray = lin("#a9a8a4");
      const BEAM_Y = 10.4;
      for (const line of rail.lines) {
        // 30m 간격으로 다시 나눈다
        const S = [];
        for (let i = 0; i + 1 < line.pts.length; i++) {
          const a = line.pts[i], b = line.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let t = 0; t < L; t += 3) S.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]);
        }
        S.push(line.pts[line.pts.length - 1]);
        const dirAt = (i) => { const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
        // 선로 두 줄: 3m 조각을 상자로
        for (let i = 0; i + 1 < S.length; i++) {
          const [tx, tz] = dirAt(i), nx = -tz, nz = tx;
          for (const o of [-1.8, 1.8]) {
            const a = [S[i][0] + nx * o, S[i][1] + nz * o], b = [S[i + 1][0] + nx * o, S[i + 1][1] + nz * o];
            const q = [[a[0] - nx * 0.45, a[1] - nz * 0.45], [b[0] - nx * 0.45, b[1] - nz * 0.45], [b[0] + nx * 0.45, b[1] + nz * 0.45], [a[0] + nx * 0.45, a[1] + nz * 0.45]];
            addWalls(BEAM, ctx.orient(q).pts, BEAM_Y, BEAM_Y + 1.6, concrete, 3, 1, 1.6, 1, i, 0.85);
            polyUp(BEAM, q, BEAM_Y + 1.6, 4, concrete);
            polyUp(BEAM, q, BEAM_Y, 4, gray);
          }
          // T자 기둥 (10칸 = 30m마다)
          if (i % 10 === 0) {
            const [x, z] = S[i], c = 0.8;
            addWalls(P, [[x - c, z - c], [x + c, z - c], [x + c, z + c], [x - c, z + c]], 0, BEAM_Y, concrete, 1.6, 1, BEAM_Y, 1, i, 0.8);
            const cross = [[x - nx * 2.8 - tx * 0.7, z - nz * 2.8 - tz * 0.7], [x + nx * 2.8 - tx * 0.7, z + nz * 2.8 - tz * 0.7], [x + nx * 2.8 + tx * 0.7, z + nz * 2.8 + tz * 0.7], [x - nx * 2.8 + tx * 0.7, z - nz * 2.8 + tz * 0.7]];
            addWalls(P, ctx.orient(cross).pts, BEAM_Y - 1.1, BEAM_Y, concrete, 2, 1, 1.1, 1, i, 0.85);
            polyUp(P, cross, BEAM_Y - 1.1, 4, gray);
            ctx.pillarSpots.push([x, z]);
          }
        }
        // 역: 선로에서 가장 가까운 점을 가운데로 60m × 16m 승강장(높이 9~15m)과 그 위 지붕
        for (const st of rail.stations) {
          let bi = -1, bd = 1e9;
          S.forEach((p, i) => { const d = Math.hypot(p[0] - st.x, p[1] - st.z); if (d < bd) { bd = d; bi = i; } });
          if (bd > 25) continue;
          const [x, z] = S[bi], [tx, tz] = dirAt(bi), nx = -tz, nz = tx;
          const box = (L, W) => ctx.orient([[x - tx * L - nx * W, z - tz * L - nz * W], [x + tx * L - nx * W, z + tz * L - nz * W], [x + tx * L + nx * W, z + tz * L + nz * W], [x - tx * L + nx * W, z - tz * L + nz * W]]).pts;
          addWalls(ST, box(30, 8), 8.6, 13.6, lin("#e7e5df"), 6, 1, 5, 1, bi, 0.85);
          polyUp(ST, box(30, 8), 8.6, 6, gray);
          polyUp(ST, box(31, 9), 15.2, 6, lin("#7f9db3"));
          const p = plate(st.name + "역", "#e07a1f", "#ffffff");
          const e = box(30, 8.05);
          wallPlate(e[0], e[1], 11.2, 13.2, p.t, p.aspect); wallPlate(e[2], e[3], 11.2, 13.2, p.t, p.aspect);
        }
      }
      const stationTex = ctx.canvasTex(256, 128, (g, w, hh) => { g.fillStyle = "#e9e7e2"; g.fillRect(0, 0, w, hh); const grd = g.createLinearGradient(0, 30, 0, 100); grd.addColorStop(0, "#7d96a8"); grd.addColorStop(1, "#3a4a57"); g.fillStyle = grd; g.fillRect(0, 30, w, 70); g.fillStyle = "#e9e7e2"; for (let x = 0; x < w; x += 64) g.fillRect(x, 30, 4, 70); }, aniso);
      group.add(toMesh(P, std(T.block), true), toMesh(BEAM, std(null, { roughness: 0.85 }), true), toMesh(ST, std(stationTex, { roughness: 0.5 }), true));
    }

    // 멀리 보이는 초고층: 끝으로 갈수록 가늘어지는 네모 기둥(유리). 안개색에 가깝게 칠하고 안개는 받지 않는다
    function far(lm) {
      const [lat0, lon0] = map.center, half = map.size / 2, mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
      const X = (lm.lon - lon0) * mx + half, Z = -(lm.lat - lat0) * 110540 + half;
      const g = new THREE.CylinderGeometry(lm.top / 2 * Math.SQRT2, lm.base / 2 * Math.SQRT2, lm.height, 4, 8);
      g.rotateY(Math.PI / 4); g.translate(0, lm.height / 2, 0);
      // 가운데가 조금 불룩한 곡선 (실제 타워처럼 위로 갈수록 부드럽게 좁아진다)
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / lm.height, k = 1 + 0.18 * Math.sin(Math.PI * Math.min(1, y * 1.1)) * (1 - y);
        pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k);
      }
      g.computeVertexNormals();
      // 안개 낀 날 멀리 보이는 유리 타워: 안개색(#dfe7ec)보다 조금 진한 회청색
      const mat = new THREE.MeshBasicMaterial({ color: lin("#8ea3b4"), fog: false, depthWrite: false });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = -5; mesh.frustumCulled = false;
      group.add(mesh);
      const D = 330;
      ticks.push((cam) => {
        const dx = X - cam.x, dz = Z - cam.z, d = Math.hypot(dx, dz) || 1, k = Math.min(1, D / d);
        mesh.position.set(cam.x + dx * k, 0, cam.z + dz * k);
        mesh.scale.setScalar(k);
      });
    }
  }
  const BAY_W = 3.2;

  return { plan, build, list: (id) => LIST[id] || [] };
})();
