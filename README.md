# [미적분Ⅰ] 다항함수 모델링 수행평가 시스템 — 설치 가이드

VS Code에서 편집 → GitHub에 올림 → 버셀(Vercel)이 자동으로 사이트에 배포 → 답안은 수파베이스(Supabase)에 저장되는 구조입니다.

```
[VS Code에서 수정] → [GitHub에 커밋·푸시] → [버셀 자동 배포] → 학생·교사 접속
                                                     ↕
                                              [수파베이스: 답안 저장]
```

## 폴더 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 학생 응시 화면 + 교사 모니터링 화면 |
| `config.js` | 수파베이스 주소와 공개 키 (직접 입력) |
| `supabase/setup.sql` | 수파베이스에 한 번 실행하는 설정 SQL |
| `README.md` | 이 설치 가이드 |

---

## 1단계. 수파베이스 설정 (기존 프로젝트 사용)

### 1-1. 명렬표 열 이름 확인

1. 수파베이스 대시보드 → **Table Editor** → `students` 표를 엽니다.
2. 학년·반·번호·이름 열의 이름을 확인합니다.
3. `setup.sql`은 열 이름이 `grade`, `class`, `number`, `name`이라고 가정합니다. 다르면 `setup.sql`의 `calc_in_roster` 함수에서 ✏️ 표시된 4줄의 열 이름을 고칩니다.

### 1-2. 교사 이메일 넣기

`setup.sql`에서 아래 줄의 `teacher@example.com`을 선생님 이메일로 바꿉니다. 교사가 여러 명이면 줄을 더 추가합니다.

```sql
insert into public.calc_teachers (email) values ('teacher@example.com')
```

### 1-3. SQL 실행

1. 대시보드 → **SQL Editor** → **New query**
2. `setup.sql` 내용 전체를 붙여넣고 **Run**
3. "Success" 가 나오면 완료입니다. (여러 번 실행해도 안전합니다)

### 1-4. 교사 로그인 계정 만들기

1. 대시보드 → **Authentication** → **Users** → **Add user** → **Create new user**
2. 1-2에서 넣은 것과 **같은 이메일**과 비밀번호를 입력합니다.
3. **Auto Confirm User**(자동 인증)에 체크하고 만듭니다.

### 1-5. 아무나 가입하지 못하게 막기 (중요)

**Authentication** 설정에서 **Allow new users to sign up**(신규 가입 허용)을 끕니다.
(대시보드 버전에 따라 메뉴 위치·이름이 조금 다를 수 있습니다.)
교사 명단(`calc_teachers`)에 없는 계정은 로그인해도 답안을 볼 수 없지만, 가입 자체를 막아 두는 것이 안전합니다.

### 1-6. 연결 정보 복사

대시보드 → **Project Settings** → **API**(또는 Data API)에서 두 값을 복사합니다.

- **Project URL** → `config.js`의 `SUPABASE_URL`
- **anon public** 키 → `config.js`의 `SUPABASE_ANON_KEY`

> ⚠️ **service_role** 키는 절대 넣지 마세요. 모든 보안을 우회하는 관리자 키입니다.
> anon 키는 공개되어도 괜찮습니다. 학생은 이 키로 정해진 함수(시작·저장)만 실행할 수 있고 표를 직접 읽을 수 없습니다.

---

## 2단계. VS Code에서 열기

1. 받은 폴더의 압축을 풀고, VS Code → **파일 → 폴더 열기**로 엽니다.
2. `config.js`에 1-6의 두 값을 붙여넣고 저장합니다.
3. (선택) 확장 프로그램 **Live Server**를 설치하면 `index.html`에서 마우스 오른쪽 → **Open with Live Server**로 바로 미리 볼 수 있습니다.
    - 파일을 더블클릭해서 여는 방식(file://)은 config.js 등이 제대로 안 불러와질 수 있으니 Live Server를 쓰세요.

---

## 3단계. GitHub에 올리기

1. VS Code 왼쪽 **소스 제어**(가지 모양 아이콘) → **Publish to GitHub**(또는 Initialize Repository → 커밋 → Publish Branch)
2. GitHub 로그인 창이 뜨면 로그인합니다.
3. 저장소 종류는 **Private(비공개)** 를 권장합니다.
4. 이후 수정할 때마다:
    - 소스 제어에서 변경 내용 메시지 입력 → **커밋(✓)** → **변경 내용 동기화(Sync/Push)**

> Git이 설치되어 있지 않다는 메시지가 나오면 git-scm.com에서 Git을 먼저 설치하세요.

---

## 4단계. 버셀(Vercel)로 배포

1. vercel.com → GitHub 계정으로 로그인
2. **Add New → Project** → 3단계에서 만든 저장소 **Import**
3. **Framework Preset**은 **Other**, 나머지 설정은 그대로 두고 **Deploy**
4. 완료되면 `https://○○○.vercel.app` 주소가 생깁니다. 이 주소를 학생에게 안내합니다.
5. 이후에는 VS Code에서 커밋·푸시만 하면 **버셀이 자동으로 다시 배포**합니다. (1분 정도 소요)

---

## 5단계. 시험 전 점검 (꼭 해 보세요)

- [ ] 학생 화면: 명렬표에 있는 학생 정보로 시작 → 데이터 입력 → 오른쪽 위에 "저장됨" 표시 확인
- [ ] 명렬표에 없는 이름으로 시작 → "명렬표에 없는 정보" 안내 확인
- [ ] 다른 브라우저에서 같은 학생으로 시작 → "다른 기기" 안내 확인
- [ ] 교사 모니터링 → 이메일 로그인 → 학생 목록·자동 채점·PDF 출력 확인
- [ ] 산출물 검토 창의 **기기 초기화** 후 다른 기기에서 이어서 응시되는지 확인
- [ ] 점검이 끝나면 테스트 기록 삭제 (교사 화면 **데이터 초기화**, 또는 SQL Editor에서 아래 실행)

```sql
delete from public.calculus_submissions where name = '테스트할 때 쓴 이름';
```

---

## 운영 안내

### 학생 응시 규칙 (서버가 직접 확인)

- **시작 확인:** 명렬표(`students`)에 있는 학년·반·번호·이름만 시작할 수 있습니다.
- **기기 제한:** 처음 시작한 기기(브라우저)에서만 이어서 할 수 있습니다. 기기를 바꿔야 하면 교사가 **기기 초기화**를 누릅니다. 답안과 남은 시간은 그대로 유지됩니다.
- **제한시간:** 45분은 **처음 시작한 서버 시각** 기준입니다. 새로고침·시크릿 창으로 늘릴 수 없고, 마감 후 90초가 지나면 서버가 저장을 거부합니다.
- **제출 후 잠금:** 제출하면 더 이상 수정·저장되지 않습니다.
- **자동 저장:** 입력하고 1초 남짓 지나면 자동 저장됩니다. 인터넷이 끊기면 기기에 임시 보관했다가 5초마다 다시 보냅니다.

### 시험 시간 바꾸기

SQL Editor에서 실행합니다. 예를 들어 50분으로 바꾸려면:

```sql
create or replace function public.calc_limit_minutes() returns int language sql immutable as $$ select 50 $$;
```

### 교사 추가

1-4처럼 Authentication에서 계정을 만들고, SQL Editor에서 실행합니다.

```sql
insert into public.calc_teachers (email) values ('새교사@학교.kr');
```

### 문제 해결

| 증상 | 원인과 해결 |
|---|---|
| 첫 화면에 "config.js 설정이 없습니다" | config.js에 URL·키를 넣지 않았거나 오타 → 1-6 다시 확인 |
| 학생: "명렬표에 없는 정보" | 입력 오타, 또는 students 열 이름이 달라 확인 실패 → 1-1 확인 |
| 학생: "다른 기기에서 시작한 기록" | 교사 화면 → 해당 학생 → **기기 초기화** |
| 학생: "저장 실패 · 재시도 중" | 학교 인터넷 문제. 연결되면 자동으로 다시 저장됨 |
| 교사: "교사로 등록되지 않은 계정" | `calc_teachers` 표에 그 이메일을 추가 |
| 교사: 로그인 실패 | Authentication → Users에서 계정·비밀번호 확인 (Auto Confirm 여부) |
| 화면 디자인이 깨짐 | 학교망에서 cdn.tailwindcss.com 차단 가능성 → CSS 파일 방식으로 변경 필요 |
