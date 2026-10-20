// 가로수 모델: EZ-Tree(MIT)로 만든 은행나무·느티나무·플라타너스 6그루(assets/trees/, 만드는 법은 tools/make_trees.mjs).
// 플레이어 주변(품질별 거리 안)의 나무만 입체 모델로 그리고, 나머지는 같은 나무를 옆에서 찍은 사진판 두 장을 엇갈려 세운다.
// 지역마다 나무가 2천 그루 안팎이라 모두 입체로 그리면 삼각형이 수천만 개가 된다.

const TREES = (() => {
  // 입체로 그릴 거리(m): 품질 낮음은 사진판만. 가까운 입체 나무는 잎을 겹쳐 그려서 무겁다
  // (2026-10-20 Intel UHD 630, 보통 품질: 나무 모델 없이 34~36fps, 60m 21~26fps, 35m 27~32fps, 20m 29~33fps)
  const NEAR_BY_QUALITY = { low: 0, medium: 25, high: 45 }, MAX_BY_QUALITY = { low: 0, medium: 10, high: 30 }, MAX_NEAR = 90;
  // 은행나무를 가장 많이 심는다 (대구·서울 가로수 가운데 가장 흔하다)
  const MIX = [["ginkgo", 0.5], ["zelkova", 0.3], ["plane", 0.2]];
  let promise = null, data = null;

  function load() {
    if (promise) return promise;
    if (!THREE.GLTFLoader) return (promise = Promise.reject(new Error("GLTFLoader가 없습니다")));
    const loader = new THREE.GLTFLoader(), tl = new THREE.TextureLoader();
    const tex = (url, srgb) => new Promise((ok, fail) => tl.load(url, (t) => { if (srgb) t.encoding = THREE.sRGBEncoding; ok(t); }, undefined, fail));
    promise = fetch("assets/trees/trees.json").then((r) => r.json()).then(async (info) => {
      const bark = await tex("assets/trees/bark.jpg", true);
      bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
      const leaves = {};
      for (const sp of new Set(info.trees.map((t) => t.species))) leaves[sp] = await tex(`assets/trees/${sp}_leaf.png`, true);
      const kinds = await Promise.all(info.trees.map(async (t) => {
        const [gltf, card] = await Promise.all([loader.loadAsync(`assets/trees/${t.id}.glb`), tex(`assets/trees/${t.id}_card.png`, true)]);
        gltf.scene.updateMatrixWorld(true);
        const parts = [];
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const leaf = /leaves/.test(o.material.name);
          // 잎은 겹쳐 그리는 면이 많아서, 화면 점마다 조명 계산이 가벼운 Lambert 재질을 쓴다
          const material = leaf
            ? new THREE.MeshLambertMaterial({ map: leaves[t.species], color: new THREE.Color(t.leafTint).convertSRGBToLinear(), alphaTest: 0.5, side: THREE.DoubleSide })
            : new THREE.MeshLambertMaterial({ map: bark, color: new THREE.Color(t.barkTint).convertSRGBToLinear() });
          // 꼭짓점이 압축돼 있어서(KHR_mesh_quantization) 그릴 때 부품 변환을 곱한다
          parts.push({ geometry: o.geometry, material, matrix: o.matrixWorld.clone() });
        });
        // 사진판: 가로 2h × 세로 2h(h = cardHalfWidth) 판 두 장을 직각으로 엇갈린다. 밑변이 땅에 닿는다
        const h = t.cardHalfWidth, g1 = new THREE.PlaneGeometry(2 * h, 2 * h); g1.translate(0, h, 0);
        const g2 = g1.clone(); g2.rotateY(Math.PI / 2);
        const cardGeo = new THREE.BufferGeometry(), a1 = g1.toNonIndexed(), a2 = g2.toNonIndexed();
        for (const k of ["position", "normal", "uv"]) {
          const x = a1.attributes[k], y = a2.attributes[k], arr = new Float32Array(x.array.length + y.array.length);
          arr.set(x.array); arr.set(y.array, x.array.length);
          cardGeo.setAttribute(k, new THREE.BufferAttribute(arr, x.itemSize));
        }
        const cardMat = new THREE.MeshLambertMaterial({ map: card, alphaTest: 0.5, side: THREE.DoubleSide });
        return { ...t, parts, cardGeo, cardMat };
      }));
      data = { kinds, source: info.source };
      return data;
    });
    return promise;
  }

  // spots: [[x, z], ...], hash: 0~1 해시. 반환: { update(x, z) → 입체·사진판을 바꿨으면 true, stats }
  function build(group, spots, hash) {
    const d = data;
    const byKind = d.kinds.map(() => []);
    const placed = spots.map(([x, z], i) => {
      const r = hash(i * 3.1), sp = (r < MIX[0][1] ? MIX[0] : r < MIX[0][1] + MIX[1][1] ? MIX[1] : MIX[2])[0];
      const variants = d.kinds.map((k, ki) => [k, ki]).filter(([k]) => k.species === sp);
      const ki = variants[Math.floor(hash(i * 5.7) * variants.length) % variants.length][1];
      const s = 0.85 + hash(i * 1.7) * 0.3;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i) * 6.28), new THREE.Vector3(s, s, s));
      byKind[ki].push(i);
      return { x, z, ki, m };
    });
    // 종류마다 사진판 하나, 입체 부품마다 하나씩 InstancedMesh
    const cards = d.kinds.map((k, ki) => {
      const im = new THREE.InstancedMesh(k.cardGeo, k.cardMat, Math.max(1, byKind[ki].length));
      im.count = 0; im.castShadow = true; im.receiveShadow = true; group.add(im); return im;
    });
    const near = d.kinds.map((k) => k.parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, MAX_NEAR);
      im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; group.add(im); return { im, p };
    }));
    const tmp = new THREE.Matrix4();
    let lastX = NaN, lastZ = NaN, nearCount = 0;
    function update(x, z) {
      // 8m 넘게 움직였을 때만 다시 고른다 (그림자 지도도 같은 때 다시 그린다)
      if (Math.hypot(x - lastX, z - lastZ) < 8) return false;
      lastX = x; lastZ = z;
      const RN = window.__treeNear ?? NEAR_BY_QUALITY[CONFIG.QUALITY] ?? 35; // 점검용으로 거리를 바꿀 수 있다
      const close = window.__nearOff ? [] : placed.map((t, i) => [i, (t.x - x) ** 2 + (t.z - z) ** 2]).filter(([, d2]) => d2 < RN * RN).sort((a, b) => a[1] - b[1]).slice(0, MAX_BY_QUALITY[CONFIG.QUALITY] ?? 10);
      const isNear = new Set(close.map(([i]) => i));
      nearCount = isNear.size;
      const nCard = cards.map(() => 0), nNear = near.map(() => 0);
      placed.forEach((t, i) => {
        if (isNear.has(i)) {
          for (const { im, p } of near[t.ki]) im.setMatrixAt(nNear[t.ki], tmp.multiplyMatrices(t.m, p.matrix));
          nNear[t.ki]++;
        } else cards[t.ki].setMatrixAt(nCard[t.ki]++, t.m);
      });
      cards.forEach((im, ki) => { im.count = nCard[ki]; im.instanceMatrix.needsUpdate = true; });
      near.forEach((list, ki) => list.forEach(({ im }) => { im.count = nNear[ki]; im.instanceMatrix.needsUpdate = true; }));
      return true;
    }
    return { update, stats: () => ({ trees: placed.length, near: nearCount }) };
  }

  return { load, ready: () => data, build };
})();
