# Workout OS

Codex가 훈련 계획과 리뷰를 만들고, PWA가 체육관에서 그 계획을 실행하고
기록하는 개인 운동 시스템입니다.

## 핵심 흐름

1. Codex에 "오늘 운동 만들어줘"라고 요청합니다.
2. Codex가 프로필, 체육관 장비, 최근 운동, InBody를 읽고
   `state/data/plans/current.json`을 갱신합니다.
3. PWA에서 프로그램을 새로고침하고 세트를 하나씩 기록합니다.
4. 기록은 브라우저에 즉시 저장되고, 로컬 서버가 연결되어 있으면
   `state/data/workouts/`에도 동기화됩니다.
5. 다음 프로그램과 주간·월간 리뷰는 이 파일 기록을 바탕으로 만들어집니다.

## 실행

```bash
npm run dev
```

컴퓨터에서는 `http://127.0.0.1:5002/`을 엽니다. 같은 Wi-Fi의 아이폰에서
사용할 주소는 서버 시작 메시지에 표시됩니다.

서버는 기본적으로 이 컴퓨터에서만 접근할 수 있게 열립니다. 같은 Wi-Fi의
다른 기기에서 테스트할 때만 명시적으로 네트워크에 노출합니다.

```bash
HOST=0.0.0.0 npm run dev
```

런타임 데이터는 기본적으로 Git에서 제외된 `state/`에 저장됩니다. 운영 환경에서는 `WORKOUT_STATIC_ROOT`, `WORKOUT_STATE_ROOT`, `WORKOUT_DATA_DIR`,
`WORKOUT_INBODY_DIR`로 앱 코드와 영구 데이터를 분리할 수 있습니다.
Cloudflare Tunnel 뒤에서는 서버를 `127.0.0.1`에만 바인딩하고
`REQUIRE_ORIGIN=true`, `REQUIRE_CF_ACCESS=true`를 사용합니다.

## Codex에 요청하는 문장

당일 프로그램:

> 오늘 운동 만들어줘. 가능한 시간은 70분이고 컨디션은 보통이야.
> 저장된 기록과 현재 체육관 장비를 사용해서 current plan까지 갱신해줘.

주간 리뷰:

> 최근 4주와 이번 주를 비교해서 진행 상태를 리뷰하고, 다음 주 프로그램에서
> 바꿀 변수 하나를 정해줘.

InBody 추가 후:

> 새 InBody 파일까지 포함해서 장기 추세를 리뷰해줘. 단일 측정값보다 여러
> 측정 방향과 운동 수행 기록을 우선해줘.

## 데이터 위치

- `state/data/profile.json`: 목표, 운동 가능 일수, 세션 시간, 통증·부상 메모
- `state/data/gyms/current.json`: 현재 체육관과 장비 상태
- `state/data/plans/current.json`: PWA가 표시할 현재 프로그램
- `state/data/plans/YYYY-MM-DD.json`: 날짜별 프로그램 스냅샷
- `state/data/workouts/`: PWA에서 동기화된 운동 기록
- `state/inbody/`: 원본 및 추가 InBody CSV

`state/`는 운영 데이터이며 Git에 커밋하거나 배포 아카이브에 포함하지 않습니다.
맥미니에서는 저장소와 같은 작업공간 안의 `state/`를 앱 서버와 Codex가 함께
사용합니다. 맥북은 코드 개발과 배포만 담당할 수 있습니다.

브라우저 우측 상단이 "파일 저장됨"이면 Codex가 다음 요청에서 읽을 수 있는
상태입니다. "이 기기에 저장"이면 기록은 안전하게 브라우저에 남지만,
서버 재연결 후 동기화해야 Codex가 읽을 수 있습니다.

## 검증

```bash
npm test
npm run validate:data
npm run build
```

## 문서

- [AGENTS.md](./AGENTS.md): Codex 작업 규칙과 당일 프로그램 생성 절차
- [DESIGN.md](./DESIGN.md): Apple 스타일을 운동 앱에 맞게 번역한 디자인 규칙
- [docs/COACHING_PROTOCOL.md](./docs/COACHING_PROTOCOL.md): 프로그램 생성과 리뷰 규칙
- [docs/PROJECT_PLAN.md](./docs/PROJECT_PLAN.md): 제품 설계와 확장 방향
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md): 맥미니 배포·운영 구조

## PWA와 아이폰

앱 셸은 오프라인 캐시와 홈 화면 모드를 지원합니다. 다만 아이폰에서 완전한
PWA 설치와 서비스 워커를 사용하려면 HTTPS 주소가 필요합니다. 현재 로컬
파일 동기화 방식은 같은 네트워크의 개발 서버를 전제로 하며, 외부에서도
항상 쓰려면 다음 단계에서 인증된 백엔드 저장소를 붙이는 편이 좋습니다.
