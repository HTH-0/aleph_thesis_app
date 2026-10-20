// 주차된 차: 달리는 차와 같은 모델(js/vehicles.js)을 골목 한쪽과 주차장에 세운다. 버스는 세우지 않는다.
// 골목(폭 5~8m, 양 끝이 교차로)에 차를 세우면 그 골목은 반대쪽 한 차로만 쓰는 일방통행이 된다(rd.parked = 1, js/traffic.js가 읽는다).
// 세운 차는 충돌 판정에 들어가서 플레이어와 행인 길(js/traffic.js)이 피해 간다.

const PARKED = (() => {
  const COLORS = ["#f2f2f0", "#f2f2f0", "#f2f2f0", "#1a1b1d", "#1a1b1d", "#8e9297", "#b8bcc0", "#283a5c", "#7a1f24", "#d8d2c4"];
  const ALLEY_SHARE = 0.45;    // 조건에 맞는 골목 가운데 차를 세울 비율
  const END_GAP = 9;           // 교차로·길 끝에서 띄울 거리(m)
  const SHOW = 110;            // 플레이어 주변 이 거리(m) 안의 차만 그린다
  const MAX_SHOWN = { low: 20, medium: 45, high: 90 }; // 한 번에 그리는 최대 대수 (한 대가 삼각형 약 4천 개)

  // ctx: { group, roads, green, crossings, kindAt, onCarway, nearExit, blocked(x, z, r), addObstacle(x, z, r), hash, pointInPoly, quality, size }
  // 반환: { count, alleys, update(x, z) → 그린 차를 바꿨으면 true }
  function place(ctx) {
    const V = typeof VEHICLES !== "undefined" && VEHICLES.ready();
    if (!V) return null;
    const types = V.types.filter((t) => t.id !== "bus");
    const lin = (h) => new THREE.Color(h).convertSRGBToLinear();
    const cars = []; // { type, x, z, yaw, color }
    const scale = ctx.quality === "low" ? 0.5 : ctx.quality === "high" ? 1.2 : 1;
    const inMap = (x, z) => x > 10 && z > 10 && x < ctx.size - 10 && z < ctx.size - 10; // 지도 밖 배경에는 세우지 않는다
    const fits = (x, z, yaw, t, allowCarway) => {
      if (!inMap(x, z)) return false;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      for (const a of [-t.halfL, 0, t.halfL]) for (const s of [-t.halfW, t.halfW]) {
        const px = x + fx * a + fz * s, pz = z + fz * a - fx * s;
        const k = ctx.kindAt(px, pz);
        if (k !== 2 && k !== -1) return false;
        if (!allowCarway && ctx.onCarway(px, pz)) return false;
      }
      if (ctx.nearExit(x, z)) return false;
      if (ctx.crossings.some((c) => Math.hypot(c.x - x, c.z - z) < c.w / 2 + 6)) return false;
      for (const a of [-t.halfL * 0.6, 0, t.halfL * 0.6]) if (ctx.blocked(x + fx * a, z + fz * a, t.halfW)) return false;
      return true;
    };
    const pick = (k) => types[Math.floor(ctx.hash(k * 7.3) * types.length) % types.length];
    const color = (k) => lin(COLORS[Math.floor(ctx.hash(k * 3.9) * COLORS.length) % COLORS.length]);

    // 1) 골목 한쪽: 길 방향의 오른쪽 가장자리에 붙여 세운다
    const nodeUse = new Map(), key = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
    for (const rd of ctx.roads) if (rd.k === "car" && rd.w >= 5) for (const p of rd.pts) nodeUse.set(key(p), (nodeUse.get(key(p)) || 0) + 1);
    ctx.roads.forEach((rd, ri) => {
      if (rd.k !== "car" || rd.br || rd.w < 5 || rd.w >= CONFIG.NO_SIDEWALK_BELOW) return;
      const P = rd.pts, ends = [P[0], P[P.length - 1]];
      if (ends.some((e) => (nodeUse.get(key(e)) || 0) < 2)) return; // 막다른 길은 일방통행으로 만들 수 없다
      if (ctx.hash(ri * 11.3) > ALLEY_SHARE * scale) return;
      // 길 전체 길이와 거리별 점
      const seg = [];
      let L = 0;
      for (let i = 0; i + 1 < P.length; i++) { const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); seg.push({ a: P[i], b: P[i + 1], s: L, l }); L += l; }
      if (L < 2 * END_GAP + 10) return;
      const at = (s) => { const g = seg.find((q) => s <= q.s + q.l) || seg[seg.length - 1]; const t = (s - g.s) / (g.l || 1); const tx = (g.b[0] - g.a[0]) / (g.l || 1), tz = (g.b[1] - g.a[1]) / (g.l || 1); return { x: g.a[0] + (g.b[0] - g.a[0]) * t, z: g.a[1] + (g.b[1] - g.a[1]) * t, tx, tz }; };
      const here = [];
      // 2~3대씩 무리 지어 세우고, 무리 사이는 비운다
      for (let s = END_GAP, k = 0; s < L - END_GAP; k++) {
        const t = pick(ri * 31 + k), len = 2 * t.halfL + 0.8;
        if (ctx.hash(ri * 13 + k * 1.7) < 0.35) { s += len + 4; continue; }
        const p = at(s + len / 2), o = rd.w / 2 + 0.6 - t.halfW; // 골목 아스팔트는 차도 폭보다 양쪽 1m 넓게 그린다(js/scenery.js), 차 바깥 면을 그 가장자리 0.4m 안에
        const x = p.x - p.tz * o, z = p.z + p.tx * o, yaw = Math.atan2(p.tx, p.tz) + (ctx.hash(ri + k * 2.9) < 0.5 ? 0 : Math.PI);
        if (fits(x, z, yaw, t, true)) here.push({ type: t, x, z, yaw, color: color(ri * 17 + k), alley: true });
        s += len;
      }
      if (here.length >= 2) { rd.parked = 1; cars.push(...here); }
    });

    // 2) 주차장: 영역의 가장 긴 변 방향으로 줄지어 세운다 (줄 사이에 통로)
    for (const [gi, g] of ctx.green.entries()) {
      if (g.k !== "parking") continue;
      const pts = g.p;
      let best = null;
      for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (!best || l > best.l) best = { a: pts[i], b: pts[i + 1], l }; }
      if (!best) continue;
      const ux = (best.b[0] - best.a[0]) / best.l, uz = (best.b[1] - best.a[1]) / best.l, vx = -uz, vz = ux;
      let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
      for (const q of pts) { const u = (q[0] - best.a[0]) * ux + (q[1] - best.a[1]) * uz, v = (q[0] - best.a[0]) * vx + (q[1] - best.a[1]) * vz; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
      // 차는 v 방향(긴 변에 직각)으로 세운다: 칸 폭 2.6m, 줄 깊이 5.5m, 두 줄마다 통로 6m
      let k = 0;
      for (let v = minV + 3, row = 0; v < maxV - 2.5; v += row % 2 === 0 ? 5.5 : 5.5 + 6, row++) {
        for (let u = minU + 1.6; u < maxU - 1.3; u += 2.6, k++) {
          if (ctx.hash(gi * 97 + k * 1.3) > 0.45 * Math.min(1, scale)) continue;
          const x = best.a[0] + ux * u + vx * v, z = best.a[1] + uz * u + vz * v;
          if (!ctx.pointInPoly(x, z, pts)) continue;
          const t = pick(gi * 53 + k), yaw = Math.atan2(vx, vz) + (row % 2 ? Math.PI : 0);
          if (fits(x, z, yaw, t, false)) cars.push({ type: t, x, z, yaw, color: color(gi * 41 + k) });
        }
      }
    }

    // 충돌 판정: 차 길이 방향으로 원 세 개
    for (const c of cars) {
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), r = c.type.halfW;
      for (const a of [-c.type.halfL + r, 0, c.type.halfL - r]) ctx.addObstacle(c.x + fx * a, c.z + fz * a, r);
    }
    // 그리기: 차종·부품마다 InstancedMesh. 충돌 판정은 모든 차에 넣고, 그림은 플레이어 주변 차만 넣는다
    const cap = MAX_SHOWN[ctx.quality] || MAX_SHOWN.medium;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const c of cars) c.base = new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), q.setFromAxisAngle(up, c.yaw), one);
    const meshes = types.map((t) => t.parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, cap);
      im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      ctx.group.add(im); return { im, p };
    }));
    let lastX = NaN, lastZ = NaN;
    function update(x, z) {
      if (Math.hypot(x - lastX, z - lastZ) < 8) return false;
      lastX = x; lastZ = z;
      const shown = cars.map((c) => [c, (c.x - x) ** 2 + (c.z - z) ** 2]).filter(([, d2]) => d2 < SHOW * SHOW).sort((a, b) => a[1] - b[1]).slice(0, cap);
      const n = types.map(() => 0);
      for (const [c] of shown) {
        const ti = types.indexOf(c.type);
        for (const { im, p } of meshes[ti]) {
          im.setMatrixAt(n[ti], m.multiplyMatrices(c.base, p.matrix));
          if (p.paint) im.setColorAt(n[ti], c.color);
        }
        n[ti]++;
      }
      meshes.forEach((list, ti) => list.forEach(({ im }) => { im.count = n[ti]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }));
      return true;
    }
    // 점검용: 골목에 세운 첫 차와 주차장에 세운 첫 차 자리
    const sample = (alley) => { const c = cars.find((q) => !!q.alley === alley); return c ? { x: +c.x.toFixed(1), z: +c.z.toFixed(1), yaw: +c.yaw.toFixed(2) } : null; };
    return { count: cars.length, alleys: ctx.roads.filter((r) => r.parked).length, update, samples: { alley: sample(true), lot: sample(false) } };
  }

  return { place };
})();
