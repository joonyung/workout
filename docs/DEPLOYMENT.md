# Mac mini 배포 가이드

## 현재 운영 구성

- 코드 개발·Git·배포: MacBook Pro의 이 저장소
- 원격 코칭 작업: Mac mini의 동일 Git 저장소 checkout
- 배포 서버: SSH 별칭 `macmini`
- 공개 주소: `https://workout.joonyung.work`
- 프로세스 관리: macOS `launchd` (`com.joonyung.workout`)
- 앱 서버: 맥미니 `127.0.0.1:5002`
- 외부 연결: 기존 Cloudflare Tunnel `macmini-ssh`
- 접근 제어: Cloudflare Access의 소유자 이메일 + MFA

Cloudflare Access, DNS, Tunnel ingress는 이미 설정되어 있다. 일반 재배포 때
수정하지 않는다.

```text
Phone ChatGPT -> Codex Remote -> Mac mini checkout -> state/data
                                                    -> app server
Internet -> Cloudflare Access -> Cloudflare Tunnel ----^
MacBook Pro ----------- SSH code deployment ------------^
```

## 일반 배포

MacBook 프로젝트 루트에서 실행한다.

```bash
npm run deploy:macmini
```

이 명령은 로컬 코드 테스트와 빌드, 맥미니 운영 데이터 검증을 수행하고 새 릴리스를 전송한 뒤
`current` 심볼릭 링크를 교체한다. 새 서버의 헬스체크가 실패하면 이전
릴리스로 자동 롤백한다.

배포 후 확인:

```bash
ssh macmini 'curl --fail http://127.0.0.1:5002/api/health'
curl -I https://workout.joonyung.work
```

두 번째 명령은 인증되지 않은 터미널 요청이므로 Cloudflare Access 로그인으로
향하는 `302` 응답이 정상이다. 브라우저에서는 인증 후 앱 상단의 `파일 저장됨`
상태를 확인한다.

## 맥미니 파일 구조

```text
/Users/joonyung/Services/workout/
  .git/                     # 원격 저장소 연결 후 동일 코드 checkout
  AGENTS.md                 # Codex Remote 작업 지침
  docs/                     # 코칭 및 운영 규칙
  current -> releases/<release-id>
  releases/<release-id>/    # 변경하지 않는 앱 릴리스
  state/data/               # 프로필, 계획, 운동 기록
  state/inbody/             # InBody 원본
  logs/
```

코드와 상태 데이터는 같은 작업공간에 있지만 Git 추적은 분리되어 있다.
`state/`, `releases/`, `logs/`, `current`는 `.gitignore` 대상이다. 배포는
`state/`를 전송하거나 덮어쓰지 않으며, 맥미니에 운영 상태가 없으면 실패한다.
`current` 내부 파일은 직접 수정하지 않는다.

## Codex Remote

맥미니의 `/Users/joonyung/Services/workout`을 Remote 프로젝트로 선택한다.
Codex는 저장소의 `AGENTS.md`와 코칭 프로토콜을 읽고 같은 작업공간의
`state/`를 사용한다.

오늘 운동 생성 시 변경 대상은 다음 두 파일이다.

```text
state/data/plans/YYYY-MM-DD.json
state/data/plans/current.json
```

변경 후 맥미니에서 `npm run validate:data`를 실행한다. 앱은 시작 또는
새로고침할 때 `current.json`을 다시 읽으므로 코드 배포는 필요 없다.

## 장애 점검

```bash
ssh macmini 'launchctl print gui/$(id -u)/com.joonyung.workout'
ssh macmini 'tail -n 100 /Users/joonyung/Services/workout/logs/server-error.log'
ssh macmini 'ls -lt /Users/joonyung/Services/workout/releases | head'
```

배포 실패 시 먼저 서버 로그와 `current` 링크를 확인한다. 수동 롤백이
필요하면 이전 릴리스를 가리키도록 `current`를 변경하고 LaunchAgent를
재시작한다. 데이터가 있는 `state/`는 롤백하거나 삭제하지 않는다.

## 보안 불변 조건

- 앱 서버는 `127.0.0.1`에만 바인딩한다.
- `REQUIRE_CF_ACCESS=true`와 `REQUIRE_ORIGIN=true`를 유지한다.
- Tunnel의 `workout.joonyung.work` ingress는 catch-all 규칙보다 앞에 둔다.
- Access 정책을 `Everyone`으로 변경하지 않는다.
- Cloudflare Access를 제거하기 전에 DNS/Tunnel 공개 경로부터 차단한다.
- `state/`를 Git에 강제로 추가하거나 배포 아카이브에 포함하지 않는다.

현재처럼 단일 Node 프로세스와 파일 저장소를 사용하는 동안은 Docker보다
`launchd`를 유지한다. 여러 서비스나 데이터베이스를 함께 운영하게 될 때
Docker Compose 전환을 다시 검토한다.
