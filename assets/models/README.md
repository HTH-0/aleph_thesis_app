# 3D 모델

게임 거리에 놓는 소품과 주차 차량이다. `tools/models/build_models.mjs`가 원본(1k glTF)을 받아, 녹·낙서 변형 부품을 빼고, 삼각형을 줄이고, 텍스처를 색상 지도 하나(512px)로 줄여 만든다. 원본은 저장소에 넣지 않는다(`참고자료/models_raw/`).

모두 [Poly Haven](https://polyhaven.com) 모델이며 라이선스는 **CC0**(출처 표기 의무 없음, 자유 이용)다. 그래도 아래에 만든 사람을 적어 둔다.

| 파일 | Poly Haven 자산 | 만든 사람 | 게임에서 쓰는 곳 |
|---|---|---|---|
| `aircon.glb` | [Exterior Aircon Unit](https://polyhaven.com/a/exterior_aircon_unit) (녹슨 변형 뺌) | Monsta3D | 저층 주택 벽 |
| `utility_box.glb` | [Utility Box 01](https://polyhaven.com/a/utility_box_01) | James Ray Cock | 주택 벽 |
| `utility_box_big.glb` | [Utility Box 02](https://polyhaven.com/a/utility_box_02) | James Ray Cock | 큰길 보도 |
| `trashbag.glb` | [Trashbag](https://polyhaven.com/a/trashbag) (종량제 봉투 색으로 칠함) | Benny Weimer | 주택 모퉁이 |
| `crate.glb` | [Plastic Crate 02](https://polyhaven.com/a/plastic_crate_02) | Fabi_G | 가게 앞 |
| `cardboard.glb` | [Cardboard Box 01](https://polyhaven.com/a/cardboard_box_01) | Rahul Chaudhary | 가게 앞 |
| `hand_truck.glb` | [Hand Truck](https://polyhaven.com/a/hand_truck) | Mutanzom3D | 주택 벽 |
| `planter.glb` | [Planter Box 01](https://polyhaven.com/a/planter_box_01) | James Ray Cock | 가게 앞 |
| `potted_plant.glb` | [Potted Plant 02](https://polyhaven.com/a/potted_plant_02) | Rico Cilliers | 가게 앞 |
| `chair.glb` | [Plastic Monobloc Chair 01](https://polyhaven.com/a/plastic_monobloc_chair_01) | Kuutti Siitonen | 가게 앞 |
| `table_set.glb` | [Outdoor Table Chair Set 01](https://polyhaven.com/a/outdoor_table_chair_set_01) | James Ray Cock | 넓은 가게 앞 |
| `hydrant.glb` | [Fire Hydrant](https://polyhaven.com/a/fire_hydrant) (낡은 변형 뺌) | Gonçalo Felício | 큰길 보도 |
| `covered_car.glb` | [Covered Car](https://polyhaven.com/a/covered_car) | MP | 좁은 골목 주차 |
| `shutter.glb` | [Rollershutter Door](https://polyhaven.com/a/rollershutter_door) (낙서 변형 뺌) | MP | 문 닫은 가게 |

다시 만들기: `cd tools/models && npm install && node build_models.mjs` (이름을 쉼표로 주면 그 모델만).
배치 규칙은 `js/scenery.js`의 "거리 소품과 주차 차량", 불러오기는 `js/props.js`. 주소 끝에 `?noprops=1`을 붙이면 소품 없이 연다.
