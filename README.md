# 글로벌 금리 · 크레딧 대시보드

Bloomberg 데이터벤더 추출물(254개 시계열 · 2001-12-03 ~ 2026-07-28)을 탐색하는
정적 대시보드입니다. 빌드 도구도, 외부 라이브러리도 없습니다 — 차트는 캔버스에
직접 그립니다.

> **이 저장소에는 데이터가 없습니다.**
> 원본 워크북은 라이선스가 있는 벤더 자료라서 private
> [`pauldhe/Data`](https://github.com/pauldhe/Data) 저장소에만 보관합니다.
> 이 저장소는 public이므로 워크북에서 파생된 어떤 파일도 커밋하지 않으며,
> `data/` 전체가 `.gitignore` 대상입니다. 아래 절차로 로컬에서 빌드하십시오.

## 실행

```bash
pip install openpyxl

# 1) private Data 저장소를 이 저장소 옆에 클론
git clone https://github.com/pauldhe/Data ../Data

# 2) 대시보드용 JSON 생성 (data/ 아래, git 추적 제외)
python scripts/build_data.py --workbook ../Data/data/raw/data_bb.xlsx

# 3) 로컬 서버로 열기 — file:// 로 열면 브라우저가 fetch를 차단합니다
python -m http.server 8000
# http://localhost:8000
```

### 실제 데이터 없이 둘러보기

```bash
python scripts/make_demo_data.py                          # 합성 워크북 생성
python scripts/build_data.py --workbook data/demo_bb.xlsx
python -m http.server 8000
```

난수로 만든 값이며 실제 시장 데이터가 아닙니다. 데모로 빌드하면 대시보드 상단에
경고 배너가 표시됩니다.

## 화면

| 탭 | 내용 |
| --- | --- |
| **개요** | 254개 지표의 최종값과 1일·1주·1개월·3개월·연초대비·1년 변화, 1년 추이 스파크라인. 분류 필터·검색·정렬 지원 |
| **차트** | 최대 8개 시계열 중첩. 기간 선택(3개월~전체), 기준시점 100 환산, 크로스헤어 툴팁 |
| **수익률 곡선** | 국가별 국채 기간구조. 기준일과 1년 전·3년 전 비교 |
| **데이터 품질** | 수록 현황, 커버리지 낮은 지표, 해석 시 유의사항 |

## 설계 노트

**금리는 bp, 지수·환율은 %.** 수익률의 퍼센트 변화율은 의미가 없으므로 계산하지
않습니다. 어느 쪽을 쓸지는 시계열의 단위가 결정합니다.

**축이 감당할 수 없으면 알려줍니다.** 4.6% 금리와 1,467원 환율을 한 축에 그리면
금리는 바닥에 눌린 직선이 됩니다. 선택한 지표 중 하나라도 세로축의 8% 미만을
차지하면 경고와 함께 "기준시점 100으로 환산"을 안내합니다.

**원본의 결함을 숨기지 않습니다.** 마지막 행이 직전 영업일과 83% 동일한 장 마감
전 스냅샷이라는 점, 값이 전혀 없는 지표, 완전히 중복된 시계열은 모두 배너나
태그로 표시됩니다. 자세한 내용은 private Data 저장소의 `docs/data_quality.md`를
참고하십시오.

**매크로 지표는 발표일에만 변합니다.** 영업일마다 값이 있지만 실제로는 계단형이라
일간 변동성·상관계수는 의미가 없습니다. 개요에서 `발표시 갱신` 태그로 구분됩니다.

## 구조

```
index.html              대시보드 셸
assets/app.js           상태·렌더링·캔버스 차트 (의존성 없음)
assets/styles.css       라이트/다크 테마
scripts/build_data.py   워크북 → data/ JSON 번들
scripts/make_demo_data.py  합성 워크북 생성기
docs/DATA.md            data/ JSON 스키마와 규약
```

`data/` JSON의 정확한 형태는 [`docs/DATA.md`](docs/DATA.md)에 정리되어 있습니다.
