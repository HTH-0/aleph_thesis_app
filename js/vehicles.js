// 차량 모델: Sketchfab CC BY 모델 6종(assets/cars/, 출처는 같은 이름의 .json). 한 번만 불러 두고 traffic.js가 차종마다 한꺼번에 그린다(인스턴싱).
// 원본을 게임용으로 정리하는 방법(앞 방향, 길이, 재질 합치기, 로고 덮기)은 tools/convert_cars.mjs.

const VEHICLES = (() => {
  // w: 어디에 많이 둘지. 큰길은 버스·택시, 골목은 경차·트럭을 더 많이
  // tail: 브레이크등 위치 [차 폭 절반에 대한 비율, 차 높이에 대한 비율]. 경계 상자 폭에 사이드미러가 들어가서 안쪽으로 잡는다 (뒤에서 찍은 사진으로 맞춤)
  const TYPES = [
    { id: "ioniq5", w: { wide: 30, alley: 25 }, taxi: true, tail: [0.6, 0.6] },
    { id: "soul", w: { wide: 15, alley: 25 }, tail: [0.55, 0.6] },
    { id: "tucson", w: { wide: 15, alley: 10 }, tail: [0.5, 0.66] },
    { id: "milano95", w: { wide: 8, alley: 15 }, tail: [0.5, 0.66] },
    { id: "lct3000", w: { wide: 10, alley: 15 }, tail: [0.8, 0.25] },
    { id: "bus", w: { wide: 12, alley: 0 }, tail: [0.8, 0.3] },
  ];
  let promise = null, data = null;

  // 반환: { types: [{ id, parts: [{ geometry, material, paint, matrix }], halfL, halfW, height, w, taxi }] }
  function load() {
    if (promise) return promise;
    if (!THREE.GLTFLoader) return (promise = Promise.reject(new Error("GLTFLoader가 없습니다")));
    const loader = new THREE.GLTFLoader();
    promise = Promise.all(TYPES.map((t) => Promise.all([
      loader.loadAsync(`assets/cars/${t.id}.glb`),
      fetch(`assets/cars/${t.id}.json`).then((r) => r.json()),
    ]).then(([gltf, src]) => {
      const parts = [];
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        // 꼭짓점 좌표가 정수로 압축돼 있어서(KHR_mesh_quantization) 형상에 변환을 굽지 않고, 그릴 때 부품 변환(matrix)을 곱한다
        const geometry = o.geometry, matrix = o.matrixWorld.clone();
        const material = o.material.clone();
        // glTF는 금속도가 비면 1로 보는데, 주변 반사 지도가 없어서 금속 면이 검게 보인다
        material.metalness = Math.min(material.metalness, 0.35);
        const paint = !!(src.paint && new RegExp(src.paint).test(o.material.name));
        if (paint) { material.color.set(0xffffff); material.roughness = Math.min(material.roughness, 0.4); } // 차마다 색을 곱한다
        parts.push({ geometry, material, paint, matrix });
      });
      const size = box.getSize(new THREE.Vector3());
      return { ...t, parts, halfL: size.z / 2, halfW: size.x / 2, height: size.y, credit: src };
    }))).then((types) => (data = { types }));
    return promise;
  }

  return { load, ready: () => data, TYPES };
})();
