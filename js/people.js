// 행인 모델: Microsoft Rocketbox Avatar Library(MIT 라이선스)에서 고른 동아시아인 6명.
// 한 번만 불러 두고(첫 화면에서 게임을 시작할 때), 판마다 복제해 traffic.js가 행인으로 쓴다.
// 같은 사람도 옷 색을 바꾼 텍스처로 여러 사람처럼 보이게 한다: 피부색 픽셀은 그대로 두고, 나머지(옷) 픽셀만
// 명암을 살린 채 한국 거리에 흔한 색으로 칠한다. 원본 FBX를 웹용으로 바꾸는 방법은 tools/convert_people.mjs.

const PEOPLE = (() => {
  const FILES = [
    { id: "Business_Female_03", g: "f" }, { id: "Business_Male_02", g: "m" }, { id: "Chef_Female_01", g: "f" },
    { id: "Female_Adult_03", g: "f" }, { id: "Male_Adult_09", g: "m" }, { id: "Male_Adult_10", g: "m" },
  ];
  // 옷 색: [진한 쪽, 밝은 쪽]. 원본 옷에서 어두운 부분과 밝은 부분(대개 바지·윗옷)을 따로 칠한다
  const OUTFITS = [
    ["#1f2a44", "#d9d2c3"], ["#1b1b1d", "#8a8d91"], ["#3a3b3f", "#c8b79a"], ["#2e3f5c", "#e9e6df"],
    ["#5b5d61", "#3e5a7a"], ["#2a2622", "#9c8f6c"], ["#18191b", "#6e2a33"], ["#4a5e7d", "#b9ad94"], ["#5f6450", "#ece8de"],
  ];
  const VARIANTS = 3; // 사람마다 원본 + 옷 색 변형 3개
  const MAX_SKIN = 0.35; // 몸 텍스처에서 피부로 판정된 블록이 이보다 많으면 옷 색 변형을 만들지 않는다
  // 사람마다 다른 판정 기준 (2026-10-18 텍스처를 보고 정함)
  // maxSkin: 민소매처럼 피부가 넓게 드러난 옷은 피부 비율이 높아도 옷과 구별되므로 상한을 올린다
  // minSat: 피부색과 비슷한 회갈색 정장은 채도((최대-최소)/최대)가 낮은 색을 피부에서 뺀다
  // skinAreas: minSat을 쓰지 않을 텍스처 구역 [x0, y0, x1, y1] (0~1, 손·다리처럼 채도가 낮은 피부가 있는 곳)
  const PERSON = {
    Female_Adult_03: { maxSkin: 0.6 },
    Business_Female_03: { minSat: 0.38, skinAreas: [[0, 0.7, 0.32, 1], [0.68, 0.7, 1, 1], [0, 0, 0.31, 0.3], [0.69, 0, 1, 0.3]] },
  };
  const skinShares = {}; // 사람별 피부 판정 비율 (테스트 확인용)
  let promise = null, data = null;

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // 피부로 볼 색 (널리 쓰는 RGB 규칙)
  // 피부는 빨강 > 초록 ≥ 파랑 쪽이다(자홍·보라 옷이 피부로 잡히지 않게 초록 ≥ 파랑을 요구)
  const isSkin = (r, g, b, minSat) => r > 95 && g > 40 && b > 20 && r > g && g >= b && r - g > 15 && Math.max(r, g, b) - Math.min(r, g, b) > Math.max(15, r * (minSat || 0));

  function recolor(image, outfit, seed) {
    const c = document.createElement("canvas");
    c.width = image.width; c.height = image.height;
    const g = c.getContext("2d");
    g.drawImage(image, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height), d = px.data, W = c.width, H = c.height, rule = PERSON[seed] || {};
    // 피부 판정은 8px 블록 다수결로 한다. 픽셀마다 판정하면 피부색과 비슷한 옷(갈색 재킷 등)의 밝은 주름만 다시 칠해져 얼룩이 생긴다
    const B = 8, bw = Math.ceil(W / B), keep = new Uint8Array(bw * Math.ceil(H / B));
    for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
      let skin = 0, all = 0;
      const u = bx / W, v = by / H, sat = (rule.skinAreas || []).some((a) => u >= a[0] && v >= a[1] && u < a[2] && v < a[3]) ? 0 : rule.minSat;
      for (let y = by; y < Math.min(H, by + B); y++) for (let x = bx; x < Math.min(W, bx + B); x++) { const i = (y * W + x) * 4; all++; if (isSkin(d[i], d[i + 1], d[i + 2], sat)) skin++; }
      keep[(by / B) * bw + bx / B] = skin * 2 > all ? 1 : 0;
    }
    // 주변 8블록 가운데 피부가 3개 미만인 외딴 피부 블록은 옷으로 본다 (옷 위에 갈색 점이 남지 않게)
    const bh = Math.ceil(H / B), lone = [];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!keep[y * bw + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && keep[(y + dy) * bw + x + dx]) n++;
      if (n < 3) lone.push(y * bw + x);
    }
    for (const k of lone) keep[k] = 0;
    const kept = (i) => { const p = i / 4, x = p % W, y = (p - x) / W; return keep[Math.floor(y / B) * bw + Math.floor(x / B)]; };
    // 옷이 피부색과 비슷하면(갈색·베이지 정장) 피부와 옷을 나눌 수 없어 얼룩이 생기므로 바꾸지 않는다
    const skinShare = keep.reduce((a, v) => a + v, 0) / keep.length;
    skinShares[seed] = +skinShare.toFixed(2);
    if (skinShare > (rule.maxSkin || MAX_SKIN)) return null;
    // 옷 픽셀의 밝기 가운데값으로 진한 쪽과 밝은 쪽을 나눈다
    const ys = [];
    for (let i = 0; i < d.length; i += 64) if (!kept(i)) ys.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    ys.sort((a, b) => a - b);
    const mid = ys[Math.floor(ys.length / 2)] || 128;
    const lo = ys[Math.floor(ys.length / 4)] || 64, hi = ys[Math.floor((ys.length * 3) / 4)] || 192;
    const [dark, light] = outfit.map(hex);
    // 원래 옷이 한 가지 색(정장 등)이면 둘로 나누지 않고 진한 색 하나로 칠한다. 나누면 주름 명암을 따라 얼룩이 생긴다
    const twoTone = hi - lo > 70;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (kept(i)) continue;
      const y = 0.299 * r + 0.587 * gg + 0.114 * b;
      const [col, ref] = !twoTone ? [dark, mid] : y < mid ? [dark, lo] : [light, hi];
      const k = Math.max(0.35, Math.min(1.5, y / Math.max(8, ref))); // 원래 명암(주름, 무늬)을 비율로 살린다
      d[i] = Math.min(255, col[0] * k); d[i + 1] = Math.min(255, col[1] * k); d[i + 2] = Math.min(255, col[2] * k);
    }
    g.putImageData(px, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false; t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // 반환: { people: [{ id, g, scene, looks: [몸 재질 바꾸기용 텍스처 목록] }], clips: { m: { walk, idle }, f: { walk, idle } } }
  function load() {
    if (promise) return promise;
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return (promise = Promise.reject(new Error("GLTFLoader가 없습니다")));
    const loader = new THREE.GLTFLoader();
    promise = Promise.all(FILES.map((f) => loader.loadAsync(`assets/people/${f.id}.glb`).then((gltf) => ({ ...f, gltf })))).then((items) => {
      const clips = { m: { walk: [], idle: [] }, f: { walk: [], idle: [] } };
      const people = items.map((it, n) => {
        for (const c of it.gltf.animations) clips[it.g][/walk/.test(c.name) ? "walk" : "idle"].push(c);
        let body = null;
        it.gltf.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (/_body$/.test(m.name) && m.map) body = m; });
        const looks = [null];
        for (let v = 0; body && v < VARIANTS; v++) {
          const t = recolor(body.map.image, OUTFITS[(n * VARIANTS + v) % OUTFITS.length], it.id);
          if (!t) break; // 옷이 피부색과 비슷한 사람은 원본만 쓴다
          looks.push(t);
        }
        return { id: it.id, g: it.g, scene: it.gltf.scene, bodyName: body && body.name, looks };
      });
      // 동작은 남녀 대표 한 명의 파일에 들어 있다. 다른 사람에게 없는 노드(Bip01_Footsteps 같은 보조 노드)의 트랙은 지운다.
      // three.js는 트랙 대상 노드를 못 찾으면 모델 맨 위 노드에 적용해서, 사람이 지도 밖으로 옮겨진다 (2026-10-18 확인)
      const common = people.map((p) => { const s = new Set(); p.scene.traverse((o) => s.add(o.name)); return s; })
        .reduce((a, s) => new Set([...a].filter((n) => s.has(n))));
      for (const set of Object.values(clips)) for (const list of Object.values(set)) for (const c of list)
        c.tracks = c.tracks.filter((t) => common.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
      // 걷기 동작은 몸 중심(Bip01)이 한 주기마다 앞으로 1.2~1.6m 나아갔다가 주기가 끝나면 처음 자리로 돌아간다(루트 모션).
      // 게임이 사람을 직접 옮기므로 그 전진분(처음과 끝 사이의 수평 이동)을 빼고, 빠진 거리로 동작 한 주기의 걸음 속도를 구한다.
      // 빼지 않으면 사람이 1초쯤 앞으로 미끄러지다 뒤로 튀기를 되풀이한다 (2026-10-19 사용자 확인)
      const hip = people[0].scene.getObjectByName("Bip01");
      const unit = hip && hip.parent ? hip.parent.getWorldScale(new THREE.Vector3()).x : 1;
      for (const set of Object.values(clips)) for (const c of set.walk) {
        const tr = c.tracks.find((t) => t.name === "Bip01.position");
        if (!tr) continue;
        const v = tr.values, T = tr.times, n = T.length, dur = T[n - 1] - T[0] || 1;
        const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2];
        for (let k = 0; k < n; k++) {
          const f = (T[k] - T[0]) / dur;
          v[k * 3] -= dx * f; v[k * 3 + 2] -= dz * f;
        }
        c.userData = { speed: (Math.hypot(dx, dz) * unit) / dur }; // m/s (키 배율 1 기준)
      }
      data = { people, clips };
      return data;
    });
    return promise;
  }

  // 손 뼈 기준 휴대폰 위치(m)와 회전(라디안). 손 뼈의 X축이 손가락 쪽이다 (사진으로 맞춤)
  let PHONE_AT = [0.09, 0.0, 0.0], PHONE_ROT = [0, 0, 0];
  // 휴대폰을 보는 동작(*_cell_phone_*)일 때 오른손에 쥐여 주는 휴대폰 (검은 판, 화면은 약간 밝게)
  let phoneParts = null;
  function phoneMesh() {
    if (!phoneParts) {
      const geo = new THREE.BoxGeometry(0.075, 0.009, 0.155); // 폭 7.5cm, 두께 0.9cm, 길이 15.5cm
      phoneParts = { geo, mats: [0x18191b, 0x18191b, 0x3b4a5c, 0x18191b, 0x18191b, 0x18191b].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 })) };
    }
    return new THREE.Mesh(phoneParts.geo, phoneParts.mats);
  }

  // 복제 한 명. look: 0이면 원본 옷, 1~이면 바꾼 옷
  // root.userData.phone: 오른손에 붙인 휴대폰 (traffic.js가 휴대폰 동작일 때만 보이게 한다)
  function makeOne(person, look) {
    const root = THREE.SkeletonUtils.clone(person.scene);
    const hand = root.getObjectByName("Bip01_R_Hand");
    if (hand) {
      root.updateMatrixWorld(true);
      const ws = hand.getWorldScale(new THREE.Vector3());
      const phone = phoneMesh();
      phone.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z); // 뼈에 남은 크기 배율을 되돌려 실제 크기로
      phone.position.set(PHONE_AT[0] / ws.x, PHONE_AT[1] / ws.y, PHONE_AT[2] / ws.z);
      phone.rotation.set(PHONE_ROT[0], PHONE_ROT[1], PHONE_ROT[2]);
      phone.visible = false;
      hand.add(phone);
      root.userData.phone = phone;
    }
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // 걷는 동작으로 바뀐 자세는 원래 경계 상자를 벗어날 수 있다
      if (look && person.looks[look]) o.material = [].concat(o.material).map((m) => {
        if (m.name !== person.bodyName) return m;
        person.lookMats = person.lookMats || {};
        return (person.lookMats[look] = person.lookMats[look] || Object.assign(m.clone(), { map: person.looks[look] })); // 같은 옷은 재질을 나눠 쓴다
      });
      if (Array.isArray(o.material) && o.material.length === 1) o.material = o.material[0];
    });
    return root;
  }

  return { load, ready: () => data, makeOne, FILES, skinShares, setPhone: (at, rot) => { PHONE_AT = at; PHONE_ROT = rot; } };
})();
