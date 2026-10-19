// 거리 소품과 주차 차량 3D 모델(assets/models/*.glb). 페이지를 열 때 한 번 불러 두고, 판마다 InstancedMesh로 놓는다.
// 모델이 없거나 불러오지 못하면 소품 없이 그대로 진행한다(게임 판정에는 영향이 없다).
// 출처: assets/models/README.md (Poly Haven, CC0)

const PROPS = (() => {
  const NAMES = ["aircon", "utility_box", "utility_box_big", "trashbag", "crate", "cardboard", "hand_truck", "planter",
    "potted_plant", "chair", "table_set", "hydrant", "covered_car", "shutter"];
  // 봉투 색은 텍스처 대신 종량제 봉투 색으로 칠한다
  const UNTEXTURED = { trashbag: ["#f2f1ec", "#ece6c8", "#e8eef2", "#f2f1ec"] };
  let promise = null;

  // 모델마다 { parts: [{ geometry, material }], size: Vector3 }. 바닥 가운데가 원점이 되게 옮겨 둔다
  function load() {
    if (promise) return promise;
    promise = new Promise((resolve) => {
      const out = new Map();
      // ?noprops=1 이면 소품 없이 (느린 PC 확인용)
      if (!THREE.GLTFLoader || /[?&]noprops=1/.test(location.search)) { resolve(out); return; }
      const loader = new THREE.GLTFLoader();
      let left = NAMES.length;
      const done = () => { if (--left === 0) resolve(out); };
      for (const name of NAMES) {
        loader.load(`assets/models/${name}.glb`, (gltf) => {
          const root = gltf.scene;
          root.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
          const shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
          const parts = [];
          root.traverse((o) => {
            if (!o.isMesh) return;
            const g = o.geometry.clone();
            g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(shift, o.matrixWorld));
            let mat = o.material;
            if (UNTEXTURED[name]) mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
            parts.push({ geometry: g, material: mat });
          });
          out.set(name, { parts, size: box.getSize(new THREE.Vector3()) });
          done();
        }, undefined, () => done());
      }
    });
    return promise;
  }

  // items: [{ name, x, z, yaw, sx, sy, sz }] → 모델마다 InstancedMesh를 group에 더한다
  function place(group, items, models) {
    const byName = new Map();
    for (const it of items) if (models.has(it.name)) (byName.get(it.name) || byName.set(it.name, []).get(it.name)).push(it);
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    let count = 0;
    for (const [name, list] of byName) {
      const m = models.get(name), tints = UNTEXTURED[name];
      for (const part of m.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((it, i) => {
          dummy.position.set(it.x, 0, it.z); dummy.rotation.set(0, it.yaw, 0); dummy.scale.set(it.sx || 1, it.sy || 1, it.sz || 1);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          if (tints) im.setColorAt(i, col.set(tints[i % tints.length]).convertSRGBToLinear());
        });
        im.castShadow = name === "covered_car" || name === "table_set" || name === "hand_truck";
        im.receiveShadow = true;
        group.add(im);
      }
      count += list.length;
    }
    return count;
  }

  return { load, place, sizeOf: (models, name) => (models.get(name) ? models.get(name).size : null) };
})();
// 첫 화면에 있는 동안 미리 받아 둔다 (합계 약 2MB)
PROPS.load();
