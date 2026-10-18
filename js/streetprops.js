// 거리 소품: Poly Haven(CC0)과 Sketchfab(CC BY) 모델(assets/props/, 출처는 같은 이름의 .json).
// 한 번만 불러 두고, scenery.js가 지도마다 place()로 배치 규칙에 따라 놓는다. 종류·재질마다 InstancedMesh 하나.
// 원본 정리 방법(깨끗한 변형만 고르기, 색 바꾸기, 삼각형 줄이기)은 tools/convert_props.mjs.

const STREETPROPS = (() => {
  const IDS = ["aircon", "shutter_door", "shutter_window", "chair", "cafe_set", "crate", "box", "hand_truck", "plant", "planter", "pole_a", "pole_b",
    "utility_box_a", "utility_box_b", "hydrant", "trashbag", "bicycle", "bike_stand", "scooter", "cone", "bollard"];
  // 지도 하나에 놓을 최대 개수 (삼각형 수를 지키려고)
  const CAP = { aircon: 160, shutter_door: 30, shutter_window: 30, ground: 140, roadside: 60, pole: 55, bollard: 140 };
  // 가게 앞에 둘 것과 비중, 땅에서 차지하는 반지름(m)
  const GROUND = [["plant", 4, 0.35], ["chair", 3, 0.35], ["crate", 3, 0.3], ["box", 2, 0.3], ["trashbag", 3, 0.3], ["planter", 2, 0.45],
    ["cafe_set", 1, 0.9], ["hand_truck", 1, 0.4], ["bike", 2, 0.9], ["scooter", 2, 0.35]];
  let promise = null, data = null;

  function load() {
    if (promise) return promise;
    if (!THREE.GLTFLoader) return (promise = Promise.reject(new Error("GLTFLoader가 없습니다")));
    const loader = new THREE.GLTFLoader();
    promise = Promise.all(IDS.map((id) => loader.loadAsync(`assets/props/${id}.glb`).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const material = o.material.clone();
        material.metalness = Math.min(material.metalness, 0.3); // 주변 반사 지도가 없어 금속 면이 검게 보이지 않게
        parts.push({ geometry: o.geometry, material, matrix: o.matrixWorld.clone() }); // 압축된 꼭짓점이라 변환은 그릴 때 곱한다
      });
      const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
      return [id, { parts, size }];
    }))).then((list) => (data = Object.fromEntries(list)));
    return promise;
  }

  // ctx: { group, buildings: [{ pts, h, shop }], roads, crossings, conePos, kindAt, onCarway, clearOf, nearExit, addObstacle, hash, size, quality }
  // 반환: { counts, coneModel(소품 라바콘을 썼는지) }
  function place(ctx) {
    if (!data) return null;
    const { kindAt, hash } = ctx, walk = (x, z) => kindAt(x, z) === 2;
    const q = ctx.quality === "low" ? 0.4 : ctx.quality === "high" ? 1.3 : 1; // 그래픽 품질에 따라 개수 조절
    const items = {}; // 종류 → [{ x, y, z, yaw, s }]
    const counts = {};
    const put = (id, x, y, z, yaw, s = 1, sx = 1) => (items[id] = items[id] || []).push({ x, y, z, yaw, s, sx });
    const room = (key) => (counts[key] = counts[key] || 0) < CAP[key] * q;
    const inMap = (x, z) => x > 3 && z > 3 && x < ctx.size - 3 && z < ctx.size - 3;

    // ① 건물 벽: 걷는 칸을 향한 면에 실외기(2층 이상)·셔터(1층 상가), 가게 앞 땅에 작은 소품
    ctx.buildings.forEach((b, bi) => {
      const pts = b.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 3) continue;
        const tx = (c[0] - a[0]) / len, tz = (c[1] - a[1]) / len, nx = tz, nz = -tx; // 바깥을 향하는 법선 (scenery.js orient와 같은 감김)
        const yaw = Math.atan2(nx, nz);
        for (let s = 1.5; s < len - 1.5; s += 3) {
          const x = a[0] + tx * s, z = a[1] + tz * s;
          if (!inMap(x, z) || !walk(x + nx * 1.2, z + nz * 1.2)) continue; // 걷는 칸을 향한 벽만
          const r = hash(bi * 131.7 + i * 17.3 + s * 3.1);
          if (b.h >= 7 && r < 0.07 && room("aircon")) { // 실외기: 2층 이상 아무 층
            const floors = Math.max(1, Math.floor((b.h - 2) / 3.3)), f = 1 + Math.floor(hash(r * 991) * floors);
            put("aircon", x + nx * 0.2, f * 3.3 + 0.4, z + nz * 0.2, yaw); counts.aircon++;
          } else if (b.shop && r >= 0.07 && r < 0.12) { // 문 닫은 가게 셔터
            const id = hash(r * 77) < 0.5 ? "shutter_door" : "shutter_window";
            if (room(id)) { put(id, x + nx * 0.06, 0, z + nz * 0.06, yaw, 1, id === "shutter_door" ? 2 : 1.2); counts[id]++; }
          } else if (r >= 0.12 && r < 0.3 && room("ground") && walk(x + nx * 3.4, z + nz * 3.4) && !ctx.onCarway(x + nx * 0.8, z + nz * 0.8)) {
            // 가게 앞: 바깥으로 3.4m까지 걷는 칸이 남는 곳에만 (길을 막지 않게)
            let k = hash(r * 313) * GROUND.reduce((t, g) => t + g[1], 0), g = GROUND[0];
            for (const e of GROUND) if ((k -= e[1]) < 0) { g = e; break; }
            const [id, , rad] = g, d = 0.25 + rad, px = x + nx * d, pz = z + nz * d;
            if (!ctx.clearOf(px, pz)) continue;
            const jitter = (hash(r * 57) - 0.5) * 0.6;
            if (id === "bike") { // 거치대와 자전거 한두 대 (벽과 나란히)
              put("bike_stand", px, 0, pz, yaw + Math.PI / 2);
              const nb = 1 + Math.floor(hash(r * 7) * 2);
              for (let j = 0; j < nb; j++) put("bicycle", px + tx * (j - 0.5) * 0.7, 0, pz + tz * (j - 0.5) * 0.7, yaw + Math.PI / 2);
              ctx.addObstacle(px, pz, 0.9);
            } else {
              put(id, px, 0, pz, yaw + jitter);
              ctx.addObstacle(px, pz, rad);
            }
            counts.ground++;
          }
        }
      }
    });

    // ② 큰길 보도 가장자리: 분전함, 소화전 / ③ 골목: 건물 쪽으로 붙인 전봇대와 전선
    const poleLines = [];
    for (const rd of ctx.roads) {
      if (rd.k !== "car" || rd.br) continue;
      const hw = rd.w / 2, wide = rd.w >= 10, step = wide ? 34 : 40; // 골목 전봇대는 40m마다 (한 대에 삼각형 약 6천 개)
      let d = 0, n = 0;
      const side = [];
      for (let i = 0; i + 1 < rd.pts.length; i++) {
        const a = rd.pts[i], c = rd.pts[i + 1], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 0.01) continue;
        const tx = (c[0] - a[0]) / len, tz = (c[1] - a[1]) / len;
        for (let s = (step - (d % step)) % step; s < len; s += step) {
          const x = a[0] + tx * s, z = a[1] + tz * s, sg = n++ % 2 ? 1 : -1, nx = -tz * sg, nz = tx * sg;
          if (!inMap(x, z)) continue;
          if (wide) {
            const o = hw + 0.7, px = x + nx * o, pz = z + nz * o;
            if (!room("roadside") || !walk(px, pz) || !walk(x + nx * (o + 2.6), z + nz * (o + 2.6)) || ctx.onCarway(px, pz) || ctx.nearExit(px, pz) || !ctx.clearOf(px, pz)) continue;
            const r = hash(px * 3.1 + pz * 7.7), id = r < 0.45 ? "utility_box_a" : r < 0.7 ? "utility_box_b" : "hydrant";
            put(id, px, 0, pz, Math.atan2(-nx, -nz)); ctx.addObstacle(px, pz, id === "hydrant" ? 0.25 : 0.5); counts.roadside++;
          } else if (room("pole")) {
            // 길 가장자리에서 바깥으로 걷는 칸이 끝나는 곳(건물 선) 바로 안쪽
            let o = null;
            for (let k = hw + 0.3; k <= hw + 3; k += 0.4) { if (walk(x + nx * k, z + nz * k) && !ctx.onCarway(x + nx * k, z + nz * k)) o = k; else if (o !== null) break; }
            if (o === null || !walk(x - nx * 0.5, z - nz * 0.5) || ctx.nearExit(x + nx * o, z + nz * o) || !ctx.clearOf(x + nx * o, z + nz * o)) continue;
            const px = x + nx * o, pz = z + nz * o, id = hash(px + pz) < 0.4 ? "pole_a" : "pole_b";
            put(id, px, 0, pz, Math.atan2(tx, tz)); ctx.addObstacle(px, pz, 0.25); counts.pole++;
            side.push([px, pz]);
          }
        }
        d += len;
      }
      for (let k = 0; k + 1 < side.length; k++) if (Math.hypot(side[k + 1][0] - side[k][0], side[k + 1][1] - side[k][1]) < 70) poleLines.push([side[k], side[k + 1]]);
    }

    // ④ 횡단보도 양 끝 볼라드 (1.8m 간격이라 사람이 지나갈 수 있다)
    for (const c of ctx.crossings) {
      const nx = -c.tz, nz = c.tx;
      for (const sg of [-1, 1]) for (const k of [-1.8, 0, 1.8]) {
        if (!room("bollard")) break;
        const px = c.x + nx * sg * (c.w / 2 + 0.5) + c.tx * k, pz = c.z + nz * sg * (c.w / 2 + 0.5) + c.tz * k;
        if (!walk(px, pz) || ctx.onCarway(px, pz) || !ctx.clearOf(px, pz)) continue;
        put("bollard", px, 0, pz, 0); ctx.addObstacle(px, pz, 0.15); counts.bollard++;
      }
    }

    // ⑤ 지도 끝 공사 구간 라바콘을 모델로
    for (const [x, z] of ctx.conePos) put("cone", x, 0, z, hash(x * 13 + z) * 6.28);

    // 그리기: 종류·부품마다 InstancedMesh
    const m = new THREE.Matrix4(), base = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const [id, list] of Object.entries(items)) {
      const model = data[id];
      if (!model || !list.length) continue;
      for (const part of model.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((it, k) => {
          v.set(it.x, it.y, it.z); qt.setFromAxisAngle(up, it.yaw); sc.set(it.s * it.sx, it.s, it.s);
          base.compose(v, qt, sc); m.multiplyMatrices(base, part.matrix); im.setMatrixAt(k, m);
        });
        im.castShadow = id === "pole_a" || id === "pole_b"; // 작은 소품의 그림자는 거의 보이지 않아 그림자 계산에서 뺀다 (삼각형 수 절반)
        im.receiveShadow = true;
        im.frustumCulled = false; // 인스턴스가 지도 전체에 흩어져 있어 형상 경계로 자르면 안 된다
        ctx.group.add(im);
      }
    }
    // 전선: 전봇대 꼭대기끼리 처지게 잇는다
    if (poleLines.length) {
      const P = [];
      for (const [a, b] of poleLines) for (let k = 0; k < 8; k++) {
        const t0 = k / 8, t1 = (k + 1) / 8, sag = (t) => 8.3 - Math.sin(Math.PI * t) * 0.7;
        P.push(a[0] + (b[0] - a[0]) * t0, sag(t0), a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, sag(t1), a[1] + (b[1] - a[1]) * t1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      ctx.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2a2b2d })));
    }
    for (const [id, list] of Object.entries(items)) counts["n_" + id] = list.length;
    return { counts, coneModel: !!(items.cone && items.cone.length) };
  }

  return { load, ready: () => data, place };
})();
