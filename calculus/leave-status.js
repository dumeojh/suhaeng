/* =====================================================================
 * leave-status.js — 전출·자퇴 학생 표시 (r1·r3 교사 화면 공용)
 *
 *  · 수파베이스에서 add_student_leave.sql을 먼저 한 번 실행해야 합니다.
 *  · 표시한 학생은 목록·제출 수·미접속 수에서 빠지고, '전출·자퇴 학생' 칸에 따로 보입니다.
 *  · 답안과 명렬표는 지우지 않습니다. (표시만 따로 저장)
 * ===================================================================== */
(function () {
  // lib/tailwind.css에 없는 디자인 보충 (외부 tailwind가 막혀도 모양이 깨지지 않게)
  (function () {
    if (document.getElementById('calc-extra-css-leave-status')) return;
    const st = document.createElement('style');
    st.id = 'calc-extra-css-leave-status';
    st.textContent = `.flex-1{flex:1 1 0%}.bg-slate-600{background-color:#475569}.border-slate-100{border-color:#f1f5f9}.decoration-slate-400{text-decoration-color:#94a3b8}.hover\\:bg-rose-50:hover{background-color:#fff1f2}.hover\\:bg-slate-100:hover{background-color:#f1f5f9}.hover\\:bg-slate-900:hover{background-color:#0f172a}.list-none{list-style-type:none}summary.list-none::-webkit-details-marker{display:none}.max-h-\\[92vh\\]{max-height:92vh}.max-w-2xl{max-width:42rem}.ml-0\\.5{margin-left:.125rem}.no-underline{text-decoration-line:none}.p-5{padding:1.25rem}.pt-1{padding-top:.25rem}@media (min-width:640px){.sm\\:grid-cols-\\[7rem_1fr\\]{grid-template-columns:7rem 1fr}}.text-indigo-400{color:#818cf8}.transition-transform{transition-property:transform;transition-duration:150ms}.rotate-90{transform:rotate(90deg)}.w-8{width:2rem}.z-\\[90\\]{z-index:90}.bg-slate-900\\/50{background-color:rgb(15 23 42/.5)}.gap-x-2{column-gap:.5rem}.gap-y-1{row-gap:.25rem}`;
    (document.head || document.documentElement).appendChild(st);
  })();
  const normName = s => String(s ?? '').replace(/\s/g, '');
  const idOf = (g, c, n, name) => `${Number(g)}_${Number(c)}_${Number(n)}_${normName(name)}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const STATUSES = ['전출', '자퇴', '기타'];

  let map = {};          // idOf(...) → { grade, class, num, name, status, date, memo }
  let missing = false;   // add_student_leave.sql 미실행

  async function load(sb) {
    const { data, error } = await sb.rpc('calc_leave_list');
    if (error) {
      missing = String(error.message || '').includes('calc_leave_list') || error.code === 'PGRST202';
      if (!missing) console.error('전출·자퇴 목록 오류', error);
      map = {};
      return map;
    }
    missing = false;
    const next = {};
    (Array.isArray(data) ? data : []).forEach(r => {
      const rec = r && typeof r === 'object' && 'grade' in r ? r : (r && r.calc_leave_list) || r;
      if (rec) next[idOf(rec.grade, rec.class, rec.num, rec.name)] = rec;
    });
    map = next;
    return map;
  }

  // info: {grade, class, num, name}
  const get = info => info ? map[idOf(info.grade, info.class, info.num, info.name)] || null : null;
  const list = classes => Object.values(map)
    .filter(r => !classes || classes.includes(Number(r.class)))
    .sort((a, b) => a.grade - b.grade || a.class - b.class || a.num - b.num);
  const fmtDate = d => {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${Number(m[2])}/${Number(m[3])}` : String(d);
  };
  const label = rec => rec ? rec.status + (rec.date ? ` ${fmtDate(rec.date)}` : '') : '';
  const csvLabel = rec => rec ? rec.status + (rec.date ? ` (${String(rec.date).slice(0, 10)})` : '') + (rec.memo ? ` - ${rec.memo}` : '') : '';

  // ===== 관리 창 =====
  let ctx = null;   // { sb, roster, classes, onChange }

  function ensureModal() {
    let el = document.getElementById('leave-modal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'leave-modal';
    el.className = 'hidden fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-3';
    el.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div class="px-5 py-3 border-b flex items-center justify-between">
          <h3 class="font-bold text-slate-800"><i class="fa-solid fa-user-slash mr-1 text-slate-500"></i>전출·자퇴 학생 표시</h3>
          <button type="button" data-close class="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="p-5 space-y-4 overflow-y-auto">
          <p class="text-xs text-slate-500 leading-relaxed">표시한 학생은 학생 목록·제출 수·미접속 수에서 빠지고 아래쪽에 따로 보입니다.
            <b class="text-slate-700">답안과 명렬표는 지워지지 않으며</b>, 표시를 해제하면 다시 목록에 나옵니다. 모든 회차에 똑같이 적용됩니다.</p>
          <div class="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-[7rem_1fr] gap-2 items-center">
              <label class="text-xs font-bold text-slate-600">반</label>
              <select id="lv-class" class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"></select>
              <label class="text-xs font-bold text-slate-600">학생</label>
              <select id="lv-student" class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"></select>
              <label class="text-xs font-bold text-slate-600">구분</label>
              <div id="lv-status" class="flex gap-2">${STATUSES.map((s, i) => `
                <label class="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm cursor-pointer">
                  <input type="radio" name="lv-status" value="${s}" ${i === 0 ? 'checked' : ''}> ${s}</label>`).join('')}</div>
              <label class="text-xs font-bold text-slate-600">날짜</label>
              <input id="lv-date" type="date" class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
              <label class="text-xs font-bold text-slate-600">메모 (선택)</label>
              <input id="lv-memo" type="text" maxlength="100" placeholder="예: ○○고로 전출" class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            </div>
            <div class="flex items-center justify-between gap-2">
              <p id="lv-msg" class="text-xs"></p>
              <button type="button" id="lv-save" class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold">표시하기</button>
            </div>
          </div>
          <div>
            <p class="text-sm font-bold text-slate-700 mb-2">표시된 학생 <span id="lv-count" class="text-slate-500 font-normal"></span></p>
            <div id="lv-list" class="space-y-1.5"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) close(); });
    el.querySelector('#lv-class').addEventListener('change', fillStudents);
    el.querySelector('#lv-student').addEventListener('change', fillFromExisting);
    el.querySelector('#lv-save').addEventListener('click', save);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.classList.contains('hidden')) close(); });
    return el;
  }

  function rosterFor(cls) {
    return (ctx.roster || []).filter(r => Number(r.class) === Number(cls))
      .sort((a, b) => Number(a.num) - Number(b.num));
  }
  function fillStudents(_, pickId) {
    const el = ensureModal();
    const cls = el.querySelector('#lv-class').value;
    const rows = rosterFor(cls);
    el.querySelector('#lv-student').innerHTML = rows.length
      ? rows.map(r => {
        const id = idOf(r.grade, r.class, r.num, r.name), rec = map[id];
        return `<option value="${esc(id)}" ${pickId === id ? 'selected' : ''}>${Number(r.num)}번 ${esc(r.name)}${rec ? ` — [${esc(rec.status)}]` : ''}</option>`;
      }).join('')
      : '<option value="">명렬표에 학생이 없습니다</option>';
    fillFromExisting();
  }
  function selectedRow() {
    const el = ensureModal(), id = el.querySelector('#lv-student').value;
    return (ctx.roster || []).find(r => idOf(r.grade, r.class, r.num, r.name) === id) || null;
  }
  function fillFromExisting() {
    const el = ensureModal(), r = selectedRow(), rec = r ? get(r) : null;
    el.querySelectorAll('input[name="lv-status"]').forEach(x => x.checked = x.value === (rec ? rec.status : '전출'));
    el.querySelector('#lv-date').value = rec && rec.date ? String(rec.date).slice(0, 10) : new Date().toLocaleDateString('sv-SE');
    el.querySelector('#lv-memo').value = rec ? rec.memo || '' : '';
    el.querySelector('#lv-save').innerText = rec ? '고치기' : '표시하기';
    msg('');
  }
  function msg(t, bad) {
    const m = ensureModal().querySelector('#lv-msg');
    m.className = 'text-xs ' + (bad ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold');
    m.innerText = t;
  }

  function renderList() {
    const el = ensureModal(), rows = list(ctx.classes);
    el.querySelector('#lv-count').innerText = `${rows.length}명`;
    el.querySelector('#lv-list').innerHTML = rows.length ? rows.map(r => `
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm">
        <span class="px-1.5 py-0.5 rounded text-[11px] font-bold bg-slate-600 text-white whitespace-nowrap">${esc(r.status)}</span>
        <span class="font-semibold text-slate-800 whitespace-nowrap">${Number(r.class)}반 ${Number(r.num)}번 ${esc(r.name)}</span>
        <span class="text-xs text-slate-500 truncate">${r.date ? esc(String(r.date).slice(0, 10)) : ''}${r.memo ? ' · ' + esc(r.memo) : ''}</span>
        <span class="flex-1"></span>
        <button type="button" data-edit="${esc(idOf(r.grade, r.class, r.num, r.name))}" data-cls="${Number(r.class)}" class="px-2 py-1 rounded text-xs font-bold text-slate-600 hover:bg-slate-100 whitespace-nowrap">고치기</button>
        <button type="button" data-clear="${esc(idOf(r.grade, r.class, r.num, r.name))}" class="px-2 py-1 rounded text-xs font-bold text-indigo-600 hover:bg-indigo-50 whitespace-nowrap">표시 해제</button>
      </div>`).join('')
      : '<p class="text-xs text-slate-400">아직 표시한 학생이 없습니다.</p>';
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      el.querySelector('#lv-class').value = b.dataset.cls;
      fillStudents(null, b.dataset.edit);
    }));
    el.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => clear(b.dataset.clear)));
  }

  async function call(r, status, date, memo) {
    const { error } = await ctx.sb.rpc('calc_leave_set', {
      p_grade: Number(r.grade), p_class: Number(r.class), p_num: Number(r.num), p_name: r.name,
      p_status: status, p_date: date || null, p_memo: memo || null
    });
    if (error) {
      const m = String(error.message || '');
      throw new Error(m.includes('NOT_MY_CLASS') ? '담당 반이 아닌 학생입니다.'
        : m.includes('calc_leave_set') || error.code === 'PGRST202' ? '수파베이스에서 add_student_leave.sql을 먼저 실행하세요.' : m);
    }
    await load(ctx.sb);
    renderList();
    if (ctx.onChange) ctx.onChange();
  }

  async function save() {
    const el = ensureModal(), r = selectedRow();
    if (!r) { msg('학생을 고르세요.', true); return; }
    const status = (el.querySelector('input[name="lv-status"]:checked') || {}).value || '전출';
    const btn = el.querySelector('#lv-save');
    btn.disabled = true;
    try {
      const id = idOf(r.grade, r.class, r.num, r.name);
      await call(r, status, el.querySelector('#lv-date').value, el.querySelector('#lv-memo').value.trim());
      fillStudents(null, id);
      msg(`${Number(r.class)}반 ${Number(r.num)}번 ${r.name} 학생을 '${status}'(으)로 표시했습니다.`);
    } catch (e) { msg(e.message, true); }
    btn.disabled = false;
  }

  async function clear(id) {
    const r = map[id];
    if (!r) return;
    if (!confirm(`${Number(r.class)}반 ${Number(r.num)}번 ${r.name} 학생의 '${r.status}' 표시를 해제할까요?\n(다시 학생 목록에 나옵니다)`)) return;
    try {
      await call(r, null);
      const el = ensureModal();
      fillStudents(null, el.querySelector('#lv-student').value);
      msg('표시를 해제했습니다.');
    } catch (e) { msg(e.message, true); }
  }

  // opts: { sb, roster, classes: [반...], onChange, pick: {grade,class,num,name} }
  async function open(opts) {
    ctx = opts;
    const el = ensureModal();
    const classes = (opts.classes && opts.classes.length ? opts.classes
      : [...new Set((opts.roster || []).map(r => Number(r.class)))]).slice().sort((a, b) => a - b);
    const pick = opts.pick;
    el.querySelector('#lv-class').innerHTML = classes.map(c => `<option value="${c}">${c}반</option>`).join('');
    if (pick && classes.includes(Number(pick.class))) el.querySelector('#lv-class').value = String(Number(pick.class));
    el.classList.remove('hidden');
    await load(opts.sb);
    if (missing) {
      fillStudents();
      el.querySelector('#lv-list').innerHTML = '';
      msg('수파베이스에서 add_student_leave.sql을 먼저 실행하세요.', true);
      return;
    }
    fillStudents(null, pick ? idOf(pick.grade, pick.class, pick.num, pick.name) : undefined);
    renderList();
  }
  function close() { ensureModal().classList.add('hidden'); }

  window.LeaveStatus = { load, get, list, label, csvLabel, open, idOf, isMissing: () => missing };
})();
