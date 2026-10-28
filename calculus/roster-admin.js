// =====================================================================
// 명렬표 관리 패널 (관리자 전용) — 전입생 추가 · 전출생 삭제 · 번호·이름 수정
//  · 수파베이스 public.students 표를 고칩니다 (다른 수행평가 페이지와 같이 쓰는 명렬표)
//  · 사용: RosterAdmin.mount(요소, 수파베이스클라이언트)
//  · 수파베이스에 add_roster_admin.sql이 실행되어 있어야 합니다.
// =====================================================================
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let sb = null, root = null, rows = [], sel = { grade: null, cls: null }, query = '', busy = false;

  const ERR = {
    NOT_ADMIN: '관리자 계정만 명렬표를 고칠 수 있습니다.',
    BAD_INPUT: '학년(1~3)·반·번호(1~99)·이름을 바르게 입력하세요.',
    NOT_FOUND: '해당 학생을 찾지 못했습니다. 다른 화면에서 이미 고쳤을 수 있으니 [새로고침] 후 확인하세요.',
    ROSTER_CHECK_FAILED: '저장 후 학생 로그인 확인을 통과하지 못해 저장하지 않았습니다.\n(students 표의 열 구성이 다를 수 있습니다. 담당자에게 문의하세요)'
  };
  function errText(e) {
    const m = String((e && (e.message || e.details)) || e);
    const t = m.match(/NUM_TAKEN:(.*)$/);
    if (t) return `그 번호에는 이미 '${t[1]}' 학생이 있습니다.\n전출생이면 먼저 [전출 삭제]를 하거나, 다른 번호를 입력하세요.`;
    const k = Object.keys(ERR).find(x => m.includes(x));
    if (k) return ERR[k];
    if (/calc_roster_admin|calc_student_|PGRST202/.test(m) || (e && e.code === 'PGRST202'))
      return '명렬표 관리 기능이 아직 없습니다. 수파베이스 SQL Editor에서 add_roster_admin.sql을 실행하세요.';
    return m;
  }

  async function load() {
    const { data, error } = await sb.rpc('calc_roster_admin');
    if (error) {
      root.innerHTML = card(`<p class="text-xs text-red-700"><i class="fa-solid fa-plug-circle-xmark mr-1"></i>${esc(errText(error))}</p>`);
      return;
    }
    rows = Array.isArray(data) ? data : [];
    const grades = gradeList();
    if (!grades.includes(sel.grade)) sel.grade = grades[0] ?? 2;
    const classes = classList();
    if (sel.cls !== 'all' && !classes.includes(sel.cls)) sel.cls = classes[0] ?? 'all';
    render();
  }

  const gradeList = () => [...new Set(rows.filter(r => r.grade).map(r => Number(r.grade)))].sort((a, b) => a - b);
  const classList = () => [...new Set(rows.filter(r => Number(r.grade) === sel.grade && r.class).map(r => Number(r.class)))].sort((a, b) => a - b);

  function visible() {
    const q = query.replace(/\s/g, '');
    return rows.filter(r => {
      if (q) return `${r.grade}학년${r.class}반${r.num}번${r.name}${r.code}`.replace(/\s/g, '').includes(q);
      return Number(r.grade) === sel.grade && (sel.cls === 'all' || Number(r.class) === sel.cls);
    });
  }

  function card(inner) {
    return `<details class="bg-white p-4 rounded-xl shadow-sm border border-slate-200" ${root.dataset.open ? 'open' : ''}>
      <summary class="cursor-pointer font-bold text-slate-800"><i class="fa-solid fa-address-book text-indigo-600 mr-1.5"></i>명렬표 관리 (관리자)
        <span class="font-normal text-xs text-slate-500">— 전입생 추가 · 전출생 삭제 · 번호·이름 수정</span></summary>
      <div class="mt-3 space-y-3">${inner}</div></details>`;
  }

  function render() {
    const bad = rows.filter(r => !r.grade);
    const list = visible();
    const tab = (label, on, attrs) => `<button type="button" ${attrs}
        class="px-2.5 py-1 rounded-lg border-2 text-xs font-bold ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}">${label}</button>`;
    const counts = c => rows.filter(r => Number(r.grade) === sel.grade && Number(r.class) === c).length;
    root.innerHTML = card(`
      <p class="text-[11px] text-slate-500 leading-relaxed"><i class="fa-solid fa-circle-info text-indigo-500 mr-1"></i>
        이 명렬표는 <b>다른 수행평가 페이지와 같이 쓰는 명렬표(students)</b>입니다. 고치면 학생 로그인 확인과 교사 화면의 미접속 명단에 바로 반영됩니다.
        (교사 화면은 새로고침해야 보입니다)<br>
        답안은 '학년·반·번호·이름'으로 묶여 있으므로, <b class="text-rose-600">시험을 이미 시작한 학생의 번호·이름은 그 회차가 끝난 뒤에</b> 고치세요.</p>

      <form data-act="add" class="flex flex-wrap items-end gap-1.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <span class="text-xs font-bold text-emerald-800 mr-1 self-center"><i class="fa-solid fa-user-plus mr-1"></i>전입생 추가</span>
        <input name="g" type="number" min="1" max="3" value="${sel.grade || ''}" placeholder="학년" class="w-14 p-1.5 border rounded text-xs text-center" required>
        <input name="c" type="number" min="1" max="20" value="${sel.cls !== 'all' && sel.cls ? sel.cls : ''}" placeholder="반" class="w-12 p-1.5 border rounded text-xs text-center" required>
        <input name="n" type="number" min="1" max="99" placeholder="번호" class="w-14 p-1.5 border rounded text-xs text-center" required>
        <input name="name" type="text" placeholder="이름" class="w-28 p-1.5 border rounded text-xs text-center" required>
        <button class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">추가</button>
      </form>

      <div class="flex flex-wrap items-center gap-1.5">
        ${gradeList().map(g => tab(`${g}학년`, !query && sel.grade === g, `data-act="grade" data-v="${g}"`)).join('')}
        <span class="w-px h-6 bg-slate-200 mx-1"></span>
        ${classList().map(c => tab(`${c}반 <span class="font-normal">${counts(c)}</span>`, !query && sel.cls === c, `data-act="cls" data-v="${c}"`)).join('')}
        ${tab('전체', !query && sel.cls === 'all', 'data-act="cls" data-v="all"')}
        <input type="search" value="${esc(query)}" placeholder="이름·학번 검색 (모든 학년)" class="roster-q ml-auto px-2.5 py-1.5 border rounded-lg text-xs w-44">
        <button type="button" data-act="reload" class="text-xs text-indigo-600 font-semibold hover:underline"><i class="fa-solid fa-rotate mr-0.5"></i>새로고침</button>
      </div>

      <div class="overflow-x-auto max-h-[28rem] overflow-y-auto border rounded-lg">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="sticky top-0 bg-slate-100 text-slate-600"><tr>
            <th class="p-2">학년</th><th class="p-2">반</th><th class="p-2">번호</th><th class="p-2">이름</th><th class="p-2">학번</th>
            <th class="p-2">미적분Ⅰ 응시 기록</th><th class="p-2 text-right">관리</th></tr></thead>
          <tbody class="divide-y divide-slate-100">
            ${list.length ? list.map((r, i) => `<tr class="hover:bg-slate-50">
              <td class="p-2">${esc(r.grade)}</td><td class="p-2">${esc(r.class)}</td><td class="p-2 font-bold">${esc(r.num)}</td>
              <td class="p-2 font-bold text-slate-800">${esc(r.name)}</td><td class="p-2 font-mono text-slate-500">${esc(r.code)}</td>
              <td class="p-2">${r.subs ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-bold">${Number(r.subs)}건</span>` : '<span class="text-slate-300">없음</span>'}</td>
              <td class="p-2 text-right whitespace-nowrap">
                <button type="button" data-act="edit" data-i="${i}" class="px-2 py-1 rounded border bg-white hover:bg-slate-50 text-slate-600 font-semibold"><i class="fa-solid fa-pen mr-0.5"></i>번호·이름 수정</button>
                <button type="button" data-act="del" data-i="${i}" class="px-2 py-1 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold"><i class="fa-solid fa-user-minus mr-0.5"></i>전출 삭제</button>
              </td></tr>`).join('')
        : `<tr><td colspan="7" class="p-4 text-center text-slate-400">${query ? '검색 결과가 없습니다.' : '학생이 없습니다.'}</td></tr>`}
          </tbody></table></div>
      <p class="text-[11px] text-slate-500">${query ? `검색 결과 ${list.length}명` : `${sel.grade}학년 ${sel.cls === 'all' ? '전체' : sel.cls + '반'} ${list.length}명`} · 명렬표 전체 ${rows.length}명
        ${bad.length ? ` · <b class="text-amber-700">학번 형식을 읽을 수 없는 줄 ${bad.length}개</b> (${bad.slice(0, 5).map(r => esc(`${r.code || '빈칸'} ${r.name}`)).join(', ')}${bad.length > 5 ? ' …' : ''}) — 수파베이스 Table Editor에서 확인하세요.` : ''}</p>`);
    root.querySelector('details').addEventListener('toggle', e => { root.dataset.open = e.target.open ? '1' : ''; });
    const q = root.querySelector('.roster-q');
    // 한글 입력 중(조합 중)에는 화면을 다시 그리지 않음 → 글자가 깨지지 않게
    const update = () => {
      query = q.value.trim();
      const pos = q.selectionStart;
      render();
      const nq = root.querySelector('.roster-q'); nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) { }
    };
    q.addEventListener('input', e => { if (!e.isComposing) update(); });
    q.addEventListener('compositionend', update);
    root._list = list;
  }

  async function call(fn, args, okMsg) {
    if (busy) return false;
    busy = true;
    try {
      const { error } = await sb.rpc(fn, args);
      if (error) { alert(errText(error)); return false; }
      if (okMsg) alert(okMsg);
      return true;
    } finally { busy = false; await load(); }
  }

  async function onClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'reload') return load();
    if (act === 'grade') { sel.grade = Number(b.dataset.v); sel.cls = classList()[0] ?? 'all'; query = ''; return render(); }
    if (act === 'cls') { sel.cls = b.dataset.v === 'all' ? 'all' : Number(b.dataset.v); query = ''; return render(); }
    const r = (root._list || [])[Number(b.dataset.i)];
    if (!r) return;
    const label = `${r.grade}학년 ${r.class}반 ${r.num}번 ${r.name}`;
    if (act === 'del') {
      if (!confirm(`[전출 삭제] ${label} (학번 ${r.code})\n\n명렬표에서 삭제하면 이 학생은 로그인할 수 없고 미접속 명단에서도 빠집니다.` +
        (r.subs ? `\n※ 미적분Ⅰ 응시 기록 ${r.subs}건은 지워지지 않고 교사 화면에 남습니다.` : '') +
        '\n※ 다른 수행평가 페이지의 명렬표에서도 함께 빠집니다.\n\n삭제할까요?')) return;
      return call('calc_student_remove', { p_code: String(r.code), p_name: r.name }, `${label} 학생을 명렬표에서 삭제했습니다.`);
    }
    if (act === 'edit') {
      const input = prompt(`[번호·이름 수정] ${label}\n\n새 '학년 반 번호 이름'을 띄어 써서 입력하세요.\n(예: ${r.grade} ${r.class} ${r.num} ${r.name})` +
        (r.subs ? `\n\n※ 이 학생은 응시 기록이 ${r.subs}건 있습니다. 시험 중에 바꾸면 새 번호로 들어올 때 답안을 이어 쓸 수 없습니다.` : ''),
        `${r.grade} ${r.class} ${r.num} ${r.name}`);
      if (input === null) return;
      const m = input.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (!m) { alert('형식이 맞지 않습니다. 예: 2 3 15 홍길동'); return; }
      const [g, c, n, name] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4].trim()];
      if (g === Number(r.grade) && c === Number(r.class) && n === Number(r.num) && name === r.name) return;
      return call('calc_student_update', { p_code: String(r.code), p_name: r.name, p_grade: g, p_class: c, p_num: n, p_new_name: name },
        `${label} → ${g}학년 ${c}반 ${n}번 ${name}(으)로 고쳤습니다.`);
    }
  }

  async function onSubmit(ev) {
    const f = ev.target.closest('form[data-act="add"]');
    if (!f || !root.contains(f)) return;
    ev.preventDefault();
    const fd = new FormData(f);
    const g = parseInt(fd.get('g'), 10), c = parseInt(fd.get('c'), 10), n = parseInt(fd.get('n'), 10);
    const name = String(fd.get('name') || '').trim();
    if (!g || !c || !n || !name) { alert(ERR.BAD_INPUT); return; }
    if (!confirm(`[전입생 추가] ${g}학년 ${c}반 ${n}번 ${name}\n\n추가하면 바로 로그인할 수 있습니다. 추가할까요?\n(지난 회차를 봐야 하면 회차 관리의 [결석생 개별 응시 허용]에도 추가하세요)`)) return;
    sel.grade = g; sel.cls = c;
    await call('calc_student_add', { p_grade: g, p_class: c, p_num: n, p_name: name }, `${g}학년 ${c}반 ${n}번 ${name} 학생을 추가했습니다.`);
  }

  window.RosterAdmin = {
    mount(el, client) {
      root = el; sb = client;
      if (!root.dataset.bound) {
        root.addEventListener('click', onClick);
        root.addEventListener('submit', onSubmit);
        root.dataset.bound = '1';
      }
      root.innerHTML = '';
      return load();
    }
  };
})();
