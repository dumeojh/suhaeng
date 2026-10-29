// =====================================================================
// 회차 관리 패널 (교사용)
//  · 첫 화면(calculus/?teacher): 모든 회차 + 새 회차 만들기
//  · 각 회차 교사 화면(calculus/r1/?teacher 등): 그 회차만
// 사용: ExamAdmin.mount(요소, 수파베이스클라이언트, { examId: 1, pageBase: '../' })
// =====================================================================
(function () {
  const CLASSES = [1, 2, 3, 4, 5, 6];   // 반 목록 (반이 늘면 여기만 고치면 됩니다)

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGE_RE = /^[A-Za-z0-9_-]+$/;

  let sb = null, root = null, opts = {}, exams = [], makeups = [], stats = {};
  let lastSig = '', poll = null;
  // 로그인한 교사 (mount의 options.me = { role, classes }). 없으면 예전처럼 모든 반
  let panelOpen = null;  // 관리자 계정 패널을 펼쳐 둔 상태 기억
  let accounts = null;   // 관리자: 가입된 계정 목록 [{email, role, classes, has_account, last_sign_in}]
  let owners = null;   // [{email, role, classes}] — 선생님별 담당 반 (add_teacher_classes.sql 미실행이면 null)
  const isAdmin = () => !opts.me || opts.me.role === 'admin';
  const sameEmail = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  // 내 담당 반: 서버의 최신 배정을 우선 (관리자가 바꿨을 수 있으므로)
  function myClasses() {
    if (isAdmin()) return CLASSES;
    const row = owners && owners.find(o => sameEmail(o.email, opts.me.email));
    const list = row ? row.classes : opts.me.classes;
    return CLASSES.filter(c => (list || []).map(Number).includes(c));
  }
  const ownerOf = c => owners && owners.find(o => o.role === 'teacher' && (o.classes || []).map(Number).includes(c));
  const shortEmail = e => String(e || '').split('@')[0];
  const NOT_MINE = '담당 반이 아닌 학생(반)은 관리할 수 없습니다. (관리자 계정으로 처리하세요)';
  const errMsg = e => {
    const m = String((e && e.message) || e);
    if (m.includes('NOT_MY_CLASS')) return NOT_MINE;
    const t = m.match(/CLASS_TAKEN:([\d,]+)/);
    if (t) return `${t[1].split(',').join('·')}반은 이미 다른 선생님이 담당하고 있습니다. 화면을 새로고침해 확인하세요.`;
    return m;
  };
  const POLL_MS = 15000;   // 다른 선생님이 반을 열고 닫은 것을 15초마다 반영

  function setupError(e) {
    root.innerHTML = `<div class="p-4 rounded-xl border-2 border-red-300 bg-red-50 text-sm text-red-700">
      <p class="font-bold"><i class="fa-solid fa-plug-circle-xmark mr-1"></i>회차 정보를 불러오지 못했습니다.</p>
      <p class="text-xs mt-1">수파베이스 SQL Editor에서 <b>add_exams.sql</b>을 실행했는지 확인하세요. (${esc(e && e.message)})</p></div>`;
  }

  async function load(silent) {
    if (!root) return;
    let q = sb.from('calc_exams').select('*').order('id');
    if (opts.examId) q = q.eq('id', opts.examId);
    let mq = sb.from('calc_makeup').select('*').order('added_at');
    if (opts.examId) mq = mq.eq('exam_id', opts.examId);
    const [ex, mk, ow] = await Promise.all([q, mq, sb.rpc('calc_class_owners')]);
    owners = ow.error ? null : (Array.isArray(ow.data) ? ow.data : []);
    accounts = null;
    if (opts.me && isAdmin()) {
      const ac = await sb.rpc('calc_accounts');
      accounts = ac.error ? null : (Array.isArray(ac.data) ? ac.data : []);
    }
    if (ex.error || mk.error) { if (!silent) setupError(ex.error || mk.error); return; }
    exams = ex.data || [];
    makeups = mk.data || [];
    stats = {};
    if (!opts.examId) {
      const { data } = await sb.from('calculus_submissions').select('exam_id, submitted');
      (data || []).forEach(r => {
        const s = stats[r.exam_id] || (stats[r.exam_id] = { started: 0, submitted: 0 });
        s.started++; if (r.submitted) s.submitted++;
      });
    }
    const sig = JSON.stringify([exams, makeups, stats, owners, accounts]);
    if (silent && sig === lastSig) return;   // 바뀐 것이 없으면 화면을 다시 그리지 않음
    lastSig = sig;
    render();
    if (opts.onChange) opts.onChange(exams);
  }

  // 자동 새로고침: 선생님이 입력 중이거나 '새 회차 만들기'를 펼쳐 둔 때는 건너뜀
  function busy() {
    if (!root || !root.isConnected || root.offsetParent === null) return true;
    if (document.visibilityState !== 'visible') return true;
    if (root.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return true;
    if (root.querySelector('details.new-exam-box[open]')) return true;
    return [...root.querySelectorAll('form input')].some(i => i.value && !i.defaultValue);
  }
  function startPoll() {
    if (poll) clearInterval(poll);
    poll = setInterval(() => { if (!busy()) load(true); }, POLL_MS);
  }

  // 같은 반이 여러 회차에 동시에 열려 있으면 알려 줌 (학생이 첫 화면에서 회차를 골라야 함)
  async function overlapWarning(exam) {
    const { data } = await sb.from('calc_exams').select('id, open_classes');
    const dup = (exam.open_classes || []).map(c => {
      const others = (data || []).filter(o => o.id !== exam.id && (o.open_classes || []).includes(c)).map(o => `${o.id}회차`);
      return others.length ? `${c}반(${others.join('·')})` : null;
    }).filter(Boolean);
    return dup;
  }

  function examCard(e) {
    const open = new Set(e.open_classes || []);
    const mine = makeups.filter(m => m.exam_id === e.id);
    const st = stats[e.id];
    const href = (opts.pageBase || '') + e.page + '/?teacher';
    const mineC = myClasses();
    const otherOpen = (e.open_classes || []).filter(c => !mineC.includes(c));
    const classBtn = c => {
      const on = open.has(c);
      return `<button type="button" data-act="toggle" data-exam="${e.id}" data-class="${c}"
        class="px-3 py-1.5 rounded-lg border-2 text-sm font-bold transition-all ${on
          ? 'bg-emerald-600 border-emerald-600 text-white shadow'
          : 'bg-white border-slate-300 text-slate-500 hover:border-emerald-400'}">
        ${c}반 <span class="text-[11px] font-semibold ${on ? 'text-emerald-100' : 'text-slate-400'}">${on ? '열림' : '닫힘'}</span></button>`;
    };
    return `
      <div class="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span class="px-2 py-0.5 rounded bg-indigo-600 text-white text-xs font-bold">${e.id}회차</span>
            <span class="ml-1 font-bold text-slate-900">${esc(e.title)}</span>
            <p class="text-xs text-slate-500 mt-1">제한 시간 ${e.limit_minutes}분 · 문항 페이지 <span class="font-mono">calculus/${esc(e.page)}/</span>
              ${st ? ` · 응시 ${st.started}명 (제출 ${st.submitted}명)` : ''}</p>
          </div>
          <div class="flex items-center gap-2">
            ${isAdmin() ? `<button type="button" data-act="edit" data-exam="${e.id}" class="px-2.5 py-1 text-xs font-semibold rounded-lg border bg-white hover:bg-slate-50 text-slate-600">
              <i class="fa-solid fa-pen mr-1"></i>이름·시간 수정</button>` : ''}
            ${opts.examId ? '' : `<a href="${esc(href)}" class="px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">
              <i class="fa-solid fa-chalkboard-user mr-1"></i>이 회차 모니터링·채점</a>`}
          </div>
        </div>

        <div class="space-y-1.5">
          <p class="text-xs font-bold text-slate-700">반별 응시 열기 <span class="font-normal text-slate-500">— 눌러서 열기/닫기. 닫아도 이미 시작한 학생은 남은 시간 동안 계속 응시합니다.</span></p>
          <div class="flex flex-wrap items-center gap-2">
            ${mineC.map(classBtn).join('')}
            <span class="w-px h-7 bg-slate-200 mx-1"></span>
            <button type="button" data-act="all-open" data-exam="${e.id}" class="text-xs font-semibold text-emerald-700 hover:underline">${isAdmin() ? '모두 열기' : '내 반 모두 열기'}</button>
            <button type="button" data-act="all-close" data-exam="${e.id}" class="text-xs font-semibold text-slate-500 hover:underline">${isAdmin() ? '모두 닫기' : '내 반 모두 닫기'}</button>
          </div>
          ${!isAdmin() ? `<p class="text-[11px] text-slate-500">다른 선생님 담당 반: ${otherOpen.length ? `<b class="text-emerald-700">${otherOpen.join('·')}반 열림</b>` : '열린 반 없음'} (변경은 담당 선생님·관리자만)</p>` : ''}
          <p class="overlap-note hidden text-xs font-semibold text-amber-700" data-exam="${e.id}"></p>
        </div>

        <div class="space-y-1.5 pt-2 border-t">
          <p class="text-xs font-bold text-slate-700">결석생 개별 응시 허용 <span class="font-normal text-slate-500">— 반이 닫혀 있어도 이 학생은 이 회차를 볼 수 있습니다.${isAdmin() ? '' : ` (담당 ${mineC.join('·')}반 학생만)`}</span></p>
          <div class="flex flex-wrap gap-1.5">
            ${mine.length ? mine.map(m => `
              <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-900">
                ${m.grade}학년 ${m.class_no}반 ${m.num}번 ${esc(m.name)}
                <button type="button" data-act="mk-del" data-exam="${e.id}" data-key="${esc(m.student_key)}" title="허용 취소" class="text-sky-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
              </span>`).join('') : '<span class="text-xs text-slate-400">없음</span>'}
          </div>
          <form data-act="mk-add" data-exam="${e.id}" class="flex flex-wrap items-center gap-1.5">
            <input name="g" type="number" placeholder="학년" class="w-14 p-1.5 border rounded text-xs text-center" required>
            <input name="c" type="number" placeholder="반" class="w-12 p-1.5 border rounded text-xs text-center" required>
            <input name="n" type="number" placeholder="번호" class="w-14 p-1.5 border rounded text-xs text-center" required>
            <input name="name" type="text" placeholder="이름" class="w-24 p-1.5 border rounded text-xs text-center" required>
            <button class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"><i class="fa-solid fa-user-plus mr-1"></i>허용</button>
          </form>
        </div>
      </div>`;
  }

  function newExamForm() {
    const next = exams.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    return `
      <details class="new-exam-box border border-dashed border-indigo-300 rounded-xl p-4 bg-indigo-50/40">
        <summary class="cursor-pointer text-sm font-bold text-indigo-800"><i class="fa-solid fa-plus mr-1"></i>새 회차 만들기</summary>
        <form data-act="new-exam" class="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 items-end text-xs">
          <label class="space-y-1"><span class="font-semibold text-slate-600">회차 번호</span>
            <input name="id" type="number" min="1" max="99" value="${next}" class="w-full p-2 border rounded" required></label>
          <label class="space-y-1 col-span-2"><span class="font-semibold text-slate-600">회차 이름 (학생에게 보임)</span>
            <input name="title" type="text" placeholder="예: 도함수를 이용한 최적화 문제" class="w-full p-2 border rounded" required></label>
          <label class="space-y-1"><span class="font-semibold text-slate-600">문항 폴더</span>
            <input name="page" type="text" value="r${next}" class="w-full p-2 border rounded font-mono" required></label>
          <label class="space-y-1"><span class="font-semibold text-slate-600">제한 시간(분)</span>
            <input name="min" type="number" min="1" max="180" value="45" class="w-full p-2 border rounded" required></label>
          <p class="col-span-2 md:col-span-4 text-[11px] text-slate-500">문항 폴더(예: <span class="font-mono">calculus/r${next}/index.html</span>)를 깃허브에 먼저 올리세요. 새 회차는 모든 반이 <b>닫힌 상태</b>로 만들어집니다.</p>
          <button class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold">만들기</button>
        </form>
      </details>`;
  }

  // ===== 담당 반 =====
  function ownerPanel() {
    if (!owners || !opts.me) return '';
    if (isAdmin()) return accountsPanel();
    const mine = myClasses();
    const btn = c => {
      const o = ownerOf(c), isMine = mine.includes(c);
      if (o && !isMine) return `<button type="button" disabled title="${esc(o.email)} 선생님 담당"
          class="px-3 py-1.5 rounded-lg border-2 border-slate-200 bg-slate-100 text-slate-400 text-sm font-bold cursor-not-allowed">
          ${c}반 <span class="block text-[10px] font-semibold">${esc(shortEmail(o.email))}</span></button>`;
      return `<button type="button" data-act="claim" data-class="${c}"
          class="px-3 py-1.5 rounded-lg border-2 text-sm font-bold ${isMine ? 'bg-indigo-600 border-indigo-600 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-400'}">
          ${c}반 <span class="block text-[10px] font-semibold ${isMine ? 'text-indigo-100' : 'text-slate-400'}">${isMine ? '내 반' : '선택 가능'}</span></button>`;
    };
    return `<div class="border-2 ${mine.length ? 'border-slate-200 bg-slate-50' : 'border-amber-400 bg-amber-50'} rounded-xl p-3 space-y-2">
      <p class="text-sm font-bold text-slate-800"><i class="fa-solid fa-user-check text-indigo-600 mr-1"></i>내 담당 반
        <span class="font-normal text-xs text-slate-500">— 눌러서 고르거나 빼세요. 다른 선생님이 고른 반(회색)은 고를 수 없습니다.</span></p>
      ${mine.length ? '' : '<p class="text-xs font-bold text-amber-800"><i class="fa-solid fa-hand-point-down mr-1"></i>먼저 담당 반을 고르세요. 고른 반의 학생만 보이고 관리할 수 있습니다.</p>'}
      <div class="flex flex-wrap gap-2">${CLASSES.map(btn).join('')}</div>
      ${mineChanged() ? '<p class="text-xs font-bold text-rose-600"><i class="fa-solid fa-rotate mr-1"></i>담당 반이 바뀌었습니다. 아래 학생 현황에 반영하려면 페이지를 새로고침하세요.</p>' : ''}
    </div>`;
  }
  // ===== 관리자: 선생님 계정·담당 반 =====
  const ROLE_TXT = { admin: '관리자', teacher: '담당 교사', '': '권한 없음' };
  function accountsPanel() {
    if (!accounts) return legacyAdminPanel();
    const none = CLASSES.filter(c => !ownerOf(c));
    const fmt = t => t ? new Date(t).toLocaleDateString() : '로그인 기록 없음';
    const chip = (a, c) => {
      const o = ownerOf(c), mine = (a.classes || []).map(Number).includes(c);
      const other = o && !sameEmail(o.email, a.email);
      return `<button type="button" data-act="assign" data-email="${esc(a.email)}" data-class="${c}" ${other ? 'disabled' : ''}
          title="${other ? esc(o.email) + ' 선생님 담당' : mine ? '눌러서 빼기' : '눌러서 담당 지정'}"
          class="w-9 py-1 rounded border text-[11px] font-bold ${mine ? 'bg-indigo-600 border-indigo-600 text-white'
          : other ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed' : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-400'}">${c}반</button>`;
    };
    const row = a => {
      const role = a.role || '';
      const me = opts.me && sameEmail(a.email, opts.me.email);
      return `<tr class="${role ? '' : 'text-slate-400'}">
        <td class="p-2"><span class="font-semibold ${role ? 'text-slate-800' : ''}">${esc(a.email)}</span>${me ? ' <span class="px-1 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold">나</span>' : ''}
          ${a.has_account ? '' : '<span class="block text-[10px] text-rose-600 font-bold">로그인 계정 없음 (Authentication에 가입되지 않은 이메일)</span>'}</td>
        <td class="p-2"><select data-email="${esc(a.email)}" class="role-sel p-1 border rounded text-xs ${role === 'admin' ? 'font-bold text-indigo-700' : role === 'teacher' ? 'font-bold text-emerald-700' : ''}" ${me ? 'disabled title="내 계정의 관리자 권한은 여기서 바꿀 수 없습니다"' : ''}>
          ${['', 'teacher', 'admin'].map(r => `<option value="${r || 'none'}" ${role === r ? 'selected' : ''}>${ROLE_TXT[r]}</option>`).join('')}</select></td>
        <td class="p-2">${role === 'teacher' ? `<div class="flex flex-wrap gap-1">${CLASSES.map(c => chip(a, c)).join('')}</div>`
          : role === 'admin' ? '<span class="text-indigo-700 font-semibold">모든 반</span>' : '-'}</td>
        <td class="p-2 text-slate-500 whitespace-nowrap">${a.has_account ? fmt(a.last_sign_in) : ''}</td></tr>`;
    };
    const teachers = accounts.filter(a => a.role === 'teacher');
    const open = panelOpen === null ? (none.length > 0 || !teachers.length) : panelOpen;
    return `<details class="acct-panel border border-slate-200 rounded-xl p-3 bg-slate-50" ${open ? 'open' : ''}>
      <summary class="cursor-pointer text-sm font-bold text-slate-800"><i class="fa-solid fa-user-gear text-indigo-600 mr-1"></i>선생님 계정·담당 반 (관리자)
        <span class="font-normal text-xs text-slate-500">— ${teachers.map(t => `${esc(shortEmail(t.email))}: ${(t.classes || []).length ? t.classes.join('·') + '반' : '없음'}`).join(' / ') || '담당 교사 없음'}
        ${none.length ? ` · <b class="text-rose-600">미지정 ${none.join('·')}반</b>` : ''}</span></summary>
      <div class="mt-3 overflow-x-auto bg-white rounded-lg border">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-100 text-slate-600"><tr><th class="p-2">계정(이메일)</th><th class="p-2">권한</th><th class="p-2">담당 반</th><th class="p-2">최근 로그인</th></tr></thead>
          <tbody class="divide-y divide-slate-100">${accounts.map(row).join('')}</tbody></table></div>
      <p class="mt-2 text-[11px] text-slate-500 leading-relaxed">
        · 수파베이스 <b>Authentication &gt; Users</b>에 가입된 계정이 모두 나옵니다. 새 선생님은 거기서 계정을 만든 뒤 여기서 <b>담당 교사</b>로 바꾸세요.<br>
        · 담당 반은 여기서 눌러 정하거나, 선생님이 로그인해서 [내 담당 반]에서 직접 고를 수 있습니다. 한 반은 한 선생님만 담당합니다.<br>
        · <b>관리자</b>는 모든 반 + 새 회차·제한 시간·명렬표를 관리합니다. <b>권한 없음</b> 계정은 교사 화면에 들어올 수 없습니다.</p>
    </details>`;
  }

  // add_teacher_accounts.sql 실행 전: 담당 교사 목록만으로 반 배정
  function legacyAdminPanel() {
    const teachers = owners.filter(o => o.role === 'teacher');
    const row = c => {
      const o = ownerOf(c);
      return `<label class="flex items-center gap-1.5 text-xs"><span class="w-9 font-bold text-slate-700">${c}반</span>
        <select data-class="${c}" class="owner-sel p-1 border rounded text-xs ${o ? '' : 'text-rose-600 font-bold'}">
          <option value="">미지정</option>
          ${teachers.map(t => `<option value="${esc(t.email)}" ${o && sameEmail(o.email, t.email) ? 'selected' : ''}>${esc(t.email)}</option>`).join('')}
        </select></label>`;
    };
    return `<div class="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-2">
      <p class="text-sm font-bold text-slate-800"><i class="fa-solid fa-user-gear text-indigo-600 mr-1"></i>담당 반 배정 (관리자)</p>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-2">${CLASSES.map(row).join('')}</div>
      <p class="text-[11px] text-amber-700">가입된 계정을 보고 권한을 정하려면 수파베이스에서 add_teacher_accounts.sql을 실행하세요.</p></div>`;
  }

  async function setRole(email, role) {
    const a = accounts.find(x => sameEmail(x.email, email));
    const label = { none: '권한 없음', teacher: '담당 교사', admin: '관리자' }[role];
    const warn = role === 'none' ? '\n※ 이 계정은 교사 화면에 들어올 수 없게 되고, 담당 반도 비워집니다.'
      : role === 'admin' ? '\n※ 관리자는 모든 반과 새 회차·제한 시간·명렬표를 관리할 수 있습니다. 담당 반은 비워집니다.' : '';
    if (!confirm(`${email} 계정을 '${label}'(으)로 바꿀까요?` + warn +
      (a && !a.has_account ? '\n※ 이 이메일은 아직 Authentication에 가입되어 있지 않아 로그인할 수 없습니다.' : ''))) return load();
    const { error } = await sb.rpc('calc_set_role', { p_email: email, p_role: role });
    if (error) {
      const m = String(error.message || '');
      alert(m.includes('SELF_DEMOTE') ? '내 계정의 관리자 권한은 스스로 바꿀 수 없습니다. 다른 관리자 계정에서 바꾸세요.'
        : m.includes('LAST_ADMIN') ? '관리자가 최소 1명은 있어야 합니다.' : '권한 변경 실패: ' + errMsg(error));
    }
    load();
  }

  async function toggleAssign(email, c) {
    const a = accounts.find(x => sameEmail(x.email, email));
    if (!a) return;
    const has = (a.classes || []).map(Number).includes(c);
    const next = has ? a.classes.filter(x => Number(x) !== c) : [...new Set([...(a.classes || []), c])].sort((x, y) => x - y);
    if (has) {
      const openIn = exams.filter(e => (e.open_classes || []).includes(c)).map(e => `${e.id}회차`);
      if (openIn.length && !confirm(`${c}반은 지금 ${openIn.join('·')}에 열려 있습니다. ${email} 선생님의 담당에서 뺄까요?`)) return;
    }
    const { error } = await sb.rpc('calc_admin_set_classes', { p_email: a.email, p_classes: next });
    if (error) alert('담당 반 변경 실패: ' + errMsg(error));
    load();
  }

  // 이 페이지를 연 뒤 담당 반이 바뀌었는지 (관리자가 바꾼 경우)
  function mineChanged() {
    if (isAdmin() || !owners) return false;
    return myClasses().join(',') !== CLASSES.filter(c => (opts.me.classes || []).map(Number).includes(c)).join(',');
  }

  async function claim(c) {
    const mine = myClasses(), has = mine.includes(c);
    const next = has ? mine.filter(x => x !== c) : [...mine, c].sort((a, b) => a - b);
    if (has) {
      const openIn = exams.filter(e => (e.open_classes || []).includes(c)).map(e => `${e.id}회차`);
      if (!confirm(`${c}반을 내 담당에서 뺄까요?` + (openIn.length ? `\n※ ${c}반은 지금 ${openIn.join('·')}에 열려 있습니다. 담당에서 빼면 그 반 학생을 관리할 수 없게 됩니다.` : ''))) return;
    }
    const { error } = await sb.rpc('calc_claim_classes', { p_classes: next });
    if (error) { alert('담당 반 변경 실패: ' + errMsg(error)); return load(); }
    location.reload();   // 학생 현황·명렬표를 새 담당 반 기준으로 다시 불러옴
  }

  async function assign(c, email) {
    const prev = ownerOf(c);
    const target = email && owners.find(o => sameEmail(o.email, email));
    if (prev && target && sameEmail(prev.email, target.email)) return;
    if (!confirm(`${c}반 담당을 ${prev ? prev.email : '미지정'} → ${target ? target.email : '미지정'} 으로 바꿀까요?`)) return load();
    if (prev) {
      const { error } = await sb.rpc('calc_admin_set_classes', { p_email: prev.email, p_classes: prev.classes.filter(x => Number(x) !== c) });
      if (error) { alert('변경 실패: ' + errMsg(error)); return load(); }
    }
    if (target) {
      const { error } = await sb.rpc('calc_admin_set_classes', { p_email: target.email, p_classes: [...new Set([...(target.classes || []), c])].sort((a, b) => a - b) });
      if (error) { alert('변경 실패: ' + errMsg(error)); return load(); }
    }
    load();
  }

  function render() {
    root.innerHTML = `
      <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-slate-800"><i class="fa-solid fa-layer-group text-indigo-600 mr-1.5"></i>${opts.examId ? '이 회차 응시 관리' : '회차 관리'}</h3>
          <button type="button" data-act="reload" class="text-xs text-indigo-600 font-semibold hover:underline"><i class="fa-solid fa-rotate mr-0.5"></i>새로고침</button>
        </div>
        ${ownerPanel()}
        ${exams.length ? exams.map(examCard).join('') : '<p class="text-sm text-slate-400">회차가 없습니다.</p>'}
        ${opts.examId || !isAdmin() ? '' : newExamForm()}
      </div>`;
    const ap = root.querySelector('details.acct-panel');
    if (ap) ap.addEventListener('toggle', () => { panelOpen = ap.open; });
    exams.forEach(async e => {
      const dup = await overlapWarning(e);
      const el = root.querySelector(`.overlap-note[data-exam="${e.id}"]`);
      if (el && dup.length) {
        el.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i>${esc(dup.join(', '))}에도 열려 있습니다. 해당 반 학생은 첫 화면에서 회차를 골라 들어갑니다.`;
        el.classList.remove('hidden');
      }
    });
  }

  // 지정한 반만 열거나 닫음 (다른 선생님이 연 반은 건드리지 않음)
  async function setClasses(id, classes, open) {
    let { error } = await sb.rpc('calc_set_classes', { p_exam: id, p_classes: classes, p_open: open });
    if (error && (error.code === 'PGRST202' || /calc_set_classes/.test(String(error.message)))) {
      // add_class_toggle.sql을 아직 실행하지 않은 경우: 서버의 최신 목록을 읽어서 바꿈
      const cur = await sb.from('calc_exams').select('open_classes').eq('id', id).single();
      if (cur.error) { error = cur.error; }
      else {
        const set = new Set(cur.data.open_classes || []);
        classes.forEach(c => open ? set.add(c) : set.delete(c));
        ({ error } = await sb.from('calc_exams').update({ open_classes: [...set].sort((a, b) => a - b) }).eq('id', id));
      }
    }
    if (error) alert('변경 실패: ' + errMsg(error));
    await load();
  }

  async function freshOpen(id) {
    const { data } = await sb.from('calc_exams').select('open_classes').eq('id', id).single();
    return (data && data.open_classes) || [];
  }

  async function onClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act, id = Number(b.dataset.exam);
    const e = exams.find(x => x.id === id);
    if (act === 'reload') return load();
    if (act === 'claim') return claim(Number(b.dataset.class));
    if (act === 'assign') return toggleAssign(b.dataset.email, Number(b.dataset.class));
    if (!e) return;
    if (act === 'toggle') {
      // 화면에 보이는 상태의 반대로 바꿈 (열림 → 닫기, 닫힘 → 열기)
      const c = Number(b.dataset.class), isOpen = (e.open_classes || []).includes(c);
      if (!myClasses().includes(c)) { alert(NOT_MINE); return; }
      return setClasses(id, [c], !isOpen);
    }
    if (act === 'all-open') {
      const mc = myClasses();
      if (!confirm(`${id}회차를 ${isAdmin() ? '모든 반' : '내 담당 반'}(${mc.join('·')}반)에 열까요?`)) return;
      return setClasses(id, mc, true);
    }
    if (act === 'all-close') {
      const mc = myClasses();
      const now = (await freshOpen(id)).filter(c => mc.includes(c));
      if (!now.length) { alert(`지금 열려 있는 ${isAdmin() ? '' : '담당 '}반이 없습니다.`); return load(); }
      if (!confirm(`${id}회차를 ${isAdmin() ? '모든 반' : '내 담당 반'}에서 닫을까요?\n지금 열려 있는 반: ${now.join('·')}반` +
        (isAdmin() ? '\n※ 관리자 계정이므로 다른 선생님이 시험 중인 반도 함께 닫힙니다. 한 반만 닫으려면 반 버튼을 누르세요.' : '') +
        '\n(이미 시작한 학생은 남은 시간 동안 계속 응시합니다)')) return;
      return setClasses(id, mc, false);
    }
    if (act === 'edit') {
      if (!isAdmin()) { alert('회차 이름·제한 시간은 관리자 계정만 바꿀 수 있습니다.'); return; }
      const title = prompt(`${id}회차 이름`, e.title);
      if (title === null) return;
      const now = await freshOpen(id);
      const min = prompt(`${id}회차 제한 시간(분, 1~180)\n※ 이미 응시 중인 학생의 남은 시간도 함께 바뀝니다.` +
        (now.length ? `\n※ 지금 열려 있는 반: ${now.join('·')}반 — 다른 선생님 반 학생에게도 적용됩니다.` : ''), String(e.limit_minutes));
      if (min === null) return;
      const m = parseInt(min, 10);
      if (!title.trim() || !(m >= 1 && m <= 180)) { alert('이름과 1~180 사이의 시간을 입력하세요.'); return; }
      const { error } = await sb.from('calc_exams').update({ title: title.trim(), limit_minutes: m }).eq('id', id);
      if (error) alert('수정 실패: ' + error.message);
      return load();
    }
    if (act === 'mk-del') {
      const m = makeups.find(x => x.exam_id === id && x.student_key === b.dataset.key);
      if (!confirm(`${m ? `${m.class_no}반 ${m.num}번 ${m.name}` : '이 학생'}의 ${id}회차 개별 응시 허용을 취소할까요?\n(이미 시작한 답안은 지워지지 않습니다)`)) return;
      const { error } = await sb.from('calc_makeup').delete().eq('exam_id', id).eq('student_key', b.dataset.key);
      if (error) alert('취소 실패: ' + errMsg(error));
      return load();
    }
  }

  async function onSubmit(ev) {
    const f = ev.target.closest('form[data-act]');
    if (!f || !root.contains(f)) return;
    ev.preventDefault();
    const fd = new FormData(f);
    if (f.dataset.act === 'mk-add') {
      const id = Number(f.dataset.exam);
      const g = parseInt(fd.get('g'), 10), c = parseInt(fd.get('c'), 10), n = parseInt(fd.get('n'), 10);
      const name = String(fd.get('name') || '').trim();
      if (!g || !c || !n || !name) { alert('학년·반·번호·이름을 모두 입력하세요.'); return; }
      const { error } = await sb.rpc('calc_makeup_add', { p_exam: id, p_grade: g, p_class: c, p_num: n, p_name: name });
      if (error) {
        const msg = String(error.message || '');
        alert(msg.includes('NOT_IN_ROSTER') ? '명렬표에 없는 학생입니다. 학년·반·번호·이름을 확인하세요.'
          : msg.includes('NOT_MY_CLASS') ? NOT_MINE : '허용 실패: ' + msg);
        return;
      }
      return load();
    }
    if (f.dataset.act === 'new-exam') {
      const id = parseInt(fd.get('id'), 10), m = parseInt(fd.get('min'), 10);
      const title = String(fd.get('title') || '').trim(), page = String(fd.get('page') || '').trim();
      if (!(id >= 1 && id <= 99)) { alert('회차 번호는 1~99입니다.'); return; }
      if (exams.some(x => x.id === id)) { alert(`${id}회차가 이미 있습니다.`); return; }
      if (!PAGE_RE.test(page)) { alert('문항 폴더 이름은 영문·숫자·-·_ 만 쓸 수 있습니다. (예: r2)'); return; }
      if (!(m >= 1 && m <= 180)) { alert('제한 시간은 1~180분입니다.'); return; }
      const { error } = await sb.from('calc_exams').insert({ id, title, page, limit_minutes: m, open_classes: [] });
      if (error) { alert('만들기 실패: ' + error.message); return; }
      return load();
    }
  }

  window.ExamAdmin = {
    mount(el, client, options = {}) {
      root = el; sb = client; opts = options;
      if (!root.dataset.bound) {
        root.addEventListener('click', onClick);
        root.addEventListener('submit', onSubmit);
        root.addEventListener('change', ev => {
          const sel = ev.target.closest('select.owner-sel');
          if (sel) assign(Number(sel.dataset.class), sel.value);
          const rs = ev.target.closest('select.role-sel');
          if (rs) setRole(rs.dataset.email, rs.value);
        });
        root.dataset.bound = '1';
      }
      lastSig = '';
      startPoll();
      return load();
    },
    reload: () => load()
  };
})();
