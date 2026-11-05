/* =====================================================================
 * trash-admin.js — 감춘 답안(휴지통) 보기·되살리기 (r1·r3 교사 화면 공용)
 *  · 수파베이스에서 add_trash.sql을 먼저 한 번 실행해야 합니다.
 * ===================================================================== */
(function () {
  // lib/tailwind.css에 없는 디자인 보충 (외부 tailwind가 막혀도 모양이 깨지지 않게)
  (function () {
    if (document.getElementById('calc-extra-css-trash-admin')) return;
    const st = document.createElement('style');
    st.id = 'calc-extra-css-trash-admin';
    st.textContent = `.flex-1{flex:1 1 0%}.bg-slate-600{background-color:#475569}.border-slate-100{border-color:#f1f5f9}.decoration-slate-400{text-decoration-color:#94a3b8}.hover\\:bg-rose-50:hover{background-color:#fff1f2}.hover\\:bg-slate-100:hover{background-color:#f1f5f9}.hover\\:bg-slate-900:hover{background-color:#0f172a}.list-none{list-style-type:none}summary.list-none::-webkit-details-marker{display:none}.max-h-\\[92vh\\]{max-height:92vh}.max-w-2xl{max-width:42rem}.ml-0\\.5{margin-left:.125rem}.no-underline{text-decoration-line:none}.p-5{padding:1.25rem}.pt-1{padding-top:.25rem}@media (min-width:640px){.sm\\:grid-cols-\\[7rem_1fr\\]{grid-template-columns:7rem 1fr}}.text-indigo-400{color:#818cf8}.transition-transform{transition-property:transform;transition-duration:150ms}.rotate-90{transform:rotate(90deg)}.w-8{width:2rem}.z-\\[90\\]{z-index:90}.bg-slate-900\\/50{background-color:rgb(15 23 42/.5)}`;
    (document.head || document.documentElement).appendChild(st);
  })();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const isMissing = (error, fn) => String(error && error.message || '').includes(fn) || (error && error.code === 'PGRST202');
  const MISSING_TXT = '수파베이스에서 add_trash.sql을 먼저 실행하세요.';
  let ctx = null;   // { sb, examId, examLabel, isAdmin, onChange }

  // 답안 감추기 (휴지통으로 옮김) → { moved } 또는 오류
  async function move(sb, examId, keys) {
    let moved = 0;
    for (let i = 0; i < keys.length; i += 200) {
      const { data, error } = await sb.rpc('calc_trash_move', { p_exam: examId, p_keys: keys.slice(i, i + 200) });
      if (error) return { moved, error: isMissing(error, 'calc_trash_move') ? MISSING_TXT : error.message, missing: isMissing(error, 'calc_trash_move') };
      moved += Number(data && data.moved) || 0;
    }
    return { moved };
  }

  function ensureModal() {
    let el = document.getElementById('trash-modal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'trash-modal';
    el.className = 'hidden fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-3';
    el.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div class="px-5 py-3 border-b flex items-center justify-between">
          <h3 class="font-bold text-slate-800"><i class="fa-solid fa-box-archive mr-1 text-slate-500"></i>감춘 답안 <span id="tr-title" class="text-sm font-normal text-slate-500"></span></h3>
          <button type="button" data-close class="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="p-5 space-y-3 overflow-y-auto">
          <p class="text-xs text-slate-500 leading-relaxed">[답안 감추기]로 감춘 답안은 지워지지 않고 여기에 보관됩니다. [되살리기]를 누르면 그대로 돌아옵니다.
            <br>※ 감춘 뒤 그 학생이 새로 응시(작성)했으면, 새 답안을 지키기 위해 그 학생은 되살리지 않고 여기에 남겨 둡니다.</p>
          <p id="tr-msg" class="text-xs font-bold"></p>
          <div id="tr-list" class="space-y-2"></div>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.classList.contains('hidden')) close(); });
    return el;
  }
  function msg(t, bad) {
    const m = ensureModal().querySelector('#tr-msg');
    m.className = 'text-xs font-bold ' + (bad ? 'text-red-600' : 'text-emerald-700');
    m.innerText = t || '';
  }
  const stuTxt = s => `${Number(s.class)}반 ${Number(s.num)}번 ${s.name || ''}`;

  async function refresh() {
    const el = ensureModal(), box = el.querySelector('#tr-list');
    box.innerHTML = '<p class="text-xs text-slate-400">불러오는 중...</p>';
    const { data, error } = await ctx.sb.rpc('calc_trash_list', { p_exam: ctx.examId });
    if (error) { box.innerHTML = ''; msg(isMissing(error, 'calc_trash_list') ? MISSING_TXT : error.message, true); return; }
    const rows = (Array.isArray(data) ? data : []).map(r => r && r.batch_id ? r : (r && r.calc_trash_list) || r).filter(Boolean);
    if (!rows.length) { box.innerHTML = '<p class="text-xs text-slate-400">감춘 답안이 없습니다.</p>'; return; }
    box.innerHTML = rows.map(b => {
      const studs = Array.isArray(b.students) ? b.students : [];
      const cls = Array.isArray(b.classes) ? b.classes.slice().sort((x, y) => x - y) : [];
      return `<div class="p-3 rounded-xl border border-slate-200 bg-slate-50">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-bold text-slate-800">${esc(new Date(b.trashed_at).toLocaleString())}</span>
          <span class="text-xs text-slate-500">${cls.length ? esc(cls.join('·')) + '반 · ' : ''}${Number(b.count)}명 · ${esc(b.trashed_by || '')}</span>
          <span class="flex-1"></span>
          <button type="button" data-restore="${esc(b.batch_id)}" data-n="${Number(b.count)}" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"><i class="fa-solid fa-rotate-left mr-1"></i>되살리기</button>
          ${ctx.isAdmin ? `<button type="button" data-purge="${esc(b.batch_id)}" data-n="${Number(b.count)}" class="px-2 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50" title="관리자만 · 되돌릴 수 없음">완전 삭제</button>` : ''}
        </div>
        <details class="mt-1"><summary class="text-xs text-slate-500 cursor-pointer">학생 보기</summary>
          <p class="mt-1 text-xs text-slate-600 leading-relaxed">${studs.map(s => esc(stuTxt(s))).join(', ')}</p></details>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => restore(b.dataset.restore, b.dataset.n, b)));
    box.querySelectorAll('[data-purge]').forEach(b => b.addEventListener('click', () => purge(b.dataset.purge, b.dataset.n)));
  }

  async function restore(id, n, btn) {
    if (!confirm(`감춘 답안 ${n}명을 되살릴까요?`)) return;
    btn.disabled = true;
    const { data, error } = await ctx.sb.rpc('calc_trash_restore', { p_batch: id });
    if (error) { btn.disabled = false; msg(error.message, true); return; }
    const sk = Array.isArray(data && data.skipped) ? data.skipped : [];
    msg(`${Number(data && data.restored) || 0}명을 되살렸습니다.` +
      (sk.length ? ` 새로 응시한 학생 ${sk.length}명(${sk.map(stuTxt).join(', ')})은 새 답안을 지키기 위해 되살리지 않았습니다.` : ''), false);
    if (ctx.onChange) await ctx.onChange();
    refresh();
  }

  async function purge(id, n) {
    if (!confirm(`[완전 삭제] 감춘 답안 ${n}명을 휴지통에서 영구히 지웁니다.\n되돌릴 수 없습니다. 계속할까요?`)) return;
    const typed = prompt(`정말 지우려면 학생 수 ${n}을(를) 숫자로 입력하세요.`);
    if (typed === null) return;
    if (typed.replace(/\s|명/g, '') !== String(n)) { msg('입력한 숫자가 달라 지우지 않았습니다.', true); return; }
    const { data, error } = await ctx.sb.rpc('calc_trash_purge', { p_batch: id });
    if (error) { msg(String(error.message).includes('NOT_ADMIN') ? '관리자 계정만 완전 삭제할 수 있습니다.' : error.message, true); return; }
    msg(`${Number(data && data.purged) || 0}명의 답안을 휴지통에서 완전히 지웠습니다.`, false);
    refresh();
  }

  function open(opts) {
    ctx = opts;
    const el = ensureModal();
    el.querySelector('#tr-title').innerText = opts.examLabel ? `(${opts.examLabel})` : '';
    msg('');
    el.classList.remove('hidden');
    refresh();
  }
  function close() { ensureModal().classList.add('hidden'); }

  window.TrashAdmin = { move, open };
})();
