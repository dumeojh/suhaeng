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

  function setupError(e) {
    root.innerHTML = `<div class="p-4 rounded-xl border-2 border-red-300 bg-red-50 text-sm text-red-700">
      <p class="font-bold"><i class="fa-solid fa-plug-circle-xmark mr-1"></i>회차 정보를 불러오지 못했습니다.</p>
      <p class="text-xs mt-1">수파베이스 SQL Editor에서 <b>add_exams.sql</b>을 실행했는지 확인하세요. (${esc(e && e.message)})</p></div>`;
  }

  async function load() {
    if (!root) return;
    let q = sb.from('calc_exams').select('*').order('id');
    if (opts.examId) q = q.eq('id', opts.examId);
    let mq = sb.from('calc_makeup').select('*').order('added_at');
    if (opts.examId) mq = mq.eq('exam_id', opts.examId);
    const [ex, mk] = await Promise.all([q, mq]);
    if (ex.error || mk.error) { setupError(ex.error || mk.error); return; }
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
    render();
    if (opts.onChange) opts.onChange(exams);
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
            <button type="button" data-act="edit" data-exam="${e.id}" class="px-2.5 py-1 text-xs font-semibold rounded-lg border bg-white hover:bg-slate-50 text-slate-600">
              <i class="fa-solid fa-pen mr-1"></i>이름·시간 수정</button>
            ${opts.examId ? '' : `<a href="${esc(href)}" class="px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">
              <i class="fa-solid fa-chalkboard-user mr-1"></i>이 회차 모니터링·채점</a>`}
          </div>
        </div>

        <div class="space-y-1.5">
          <p class="text-xs font-bold text-slate-700">반별 응시 열기 <span class="font-normal text-slate-500">— 눌러서 열기/닫기. 닫아도 이미 시작한 학생은 남은 시간 동안 계속 응시합니다.</span></p>
          <div class="flex flex-wrap items-center gap-2">
            ${CLASSES.map(classBtn).join('')}
            <span class="w-px h-7 bg-slate-200 mx-1"></span>
            <button type="button" data-act="all-open" data-exam="${e.id}" class="text-xs font-semibold text-emerald-700 hover:underline">모두 열기</button>
            <button type="button" data-act="all-close" data-exam="${e.id}" class="text-xs font-semibold text-slate-500 hover:underline">모두 닫기</button>
          </div>
          <p class="overlap-note hidden text-xs font-semibold text-amber-700" data-exam="${e.id}"></p>
        </div>

        <div class="space-y-1.5 pt-2 border-t">
          <p class="text-xs font-bold text-slate-700">결석생 개별 응시 허용 <span class="font-normal text-slate-500">— 반이 닫혀 있어도 이 학생은 이 회차를 볼 수 있습니다.</span></p>
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
      <details class="border border-dashed border-indigo-300 rounded-xl p-4 bg-indigo-50/40">
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

  function render() {
    root.innerHTML = `
      <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-slate-800"><i class="fa-solid fa-layer-group text-indigo-600 mr-1.5"></i>${opts.examId ? '이 회차 응시 관리' : '회차 관리'}</h3>
          <button type="button" data-act="reload" class="text-xs text-indigo-600 font-semibold hover:underline"><i class="fa-solid fa-rotate mr-0.5"></i>새로고침</button>
        </div>
        ${exams.length ? exams.map(examCard).join('') : '<p class="text-sm text-slate-400">회차가 없습니다.</p>'}
        ${opts.examId ? '' : newExamForm()}
      </div>`;
    exams.forEach(async e => {
      const dup = await overlapWarning(e);
      const el = root.querySelector(`.overlap-note[data-exam="${e.id}"]`);
      if (el && dup.length) {
        el.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i>${esc(dup.join(', '))}에도 열려 있습니다. 해당 반 학생은 첫 화면에서 회차를 골라 들어갑니다.`;
        el.classList.remove('hidden');
      }
    });
  }

  async function setClasses(id, list) {
    const { error } = await sb.from('calc_exams').update({ open_classes: [...new Set(list)].sort((a, b) => a - b) }).eq('id', id);
    if (error) alert('변경 실패: ' + error.message);
    await load();
  }

  async function onClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act, id = Number(b.dataset.exam);
    const e = exams.find(x => x.id === id);
    if (act === 'reload') return load();
    if (!e) return;
    if (act === 'toggle') {
      const c = Number(b.dataset.class), cur = new Set(e.open_classes || []);
      cur.has(c) ? cur.delete(c) : cur.add(c);
      return setClasses(id, [...cur]);
    }
    if (act === 'all-open') {
      if (!confirm(`${id}회차를 모든 반(${CLASSES.join('·')}반)에 열까요?`)) return;
      return setClasses(id, CLASSES);
    }
    if (act === 'all-close') {
      if (!confirm(`${id}회차를 모든 반에서 닫을까요?\n(이미 시작한 학생은 남은 시간 동안 계속 응시합니다)`)) return;
      return setClasses(id, []);
    }
    if (act === 'edit') {
      const title = prompt(`${id}회차 이름`, e.title);
      if (title === null) return;
      const min = prompt(`${id}회차 제한 시간(분, 1~180)\n※ 이미 응시 중인 학생의 남은 시간도 함께 바뀝니다.`, String(e.limit_minutes));
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
      if (error) alert('취소 실패: ' + error.message);
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
        alert(msg.includes('NOT_IN_ROSTER') ? '명렬표에 없는 학생입니다. 학년·반·번호·이름을 확인하세요.' : '허용 실패: ' + msg);
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
        root.dataset.bound = '1';
      }
      return load();
    },
    reload: () => load()
  };
})();
