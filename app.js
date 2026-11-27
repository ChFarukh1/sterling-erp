// Sterling payroll: screens and data storage.
(function () {
  'use strict';
  const PL = window.PL;
  const cfg = window.STERLING_CONFIG || {};
  const LIVE = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const TABLES = ['sites', 'employees', 'runs', 'run_lines', 'advances'];
  const KEY = 'sterling_payroll_demo_v1';
  const VERSION = '11';
  const S = { sites: [], employees: [], runs: [], run_lines: [], advances: [], changes: [] };
  const UI = { view: 'dashboard', role: 'admin', user: null, filter: { siteId: '', from: '', to: '' }, runId: null, empId: null, empQ: '', empSite: '', empShow: 'active', bankShow: 'missing', bankSite: '', payRuns: null, newRun: false, msg: '', allField: 'days', slip: null, histQ: '', histT: '' };
  let sb = null, SITE = {}, EMP = {}, RUN = {}, ADV = {};
  // Other modules (hr.js) add their screens, data loaders and actions here.
  const EXT = { loaders: [], views: {}, nav: [], roleViews: { owner: [], hr: [], procurement: [] }, chgAllowed: {}, actAllowed: {} };

  // ---------- small helpers ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v) => Number(PL.r2(v)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const fmt0 = (v) => Math.round(PL.num(v)).toLocaleString('en-US');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dmy = (d) => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return esc((p[2] || '') + ' ' + (MON[Number(p[1]) - 1] || p[1] || '') + ' ' + p[0]); };
  const period = (r) => (r.date_from && r.date_to ? dmy(r.date_from) + ' to ' + dmy(r.date_to) : '<span class="pill p-warn">Dates not set</span>');
  const numOrNull = (v) => { const t = String(v === null || v === undefined ? '' : v).replace(/,/g, '').trim(); if (t === '') return null; const n = Number(t); return isNaN(n) ? null : n; };
  const strOrNull = (v) => { const t = String(v === null || v === undefined ? '' : v).trim(); return t === '' ? null : t; };
  // isAdmin: may run payroll (admin and accountant). isSys: the whole system, logins and settings (admin only).
  const isAdmin = () => UI.role === 'admin' || UI.role === 'accountant';
  const isSys = () => UI.role === 'admin';
  const isHR = () => UI.role === 'hr';
  const canHR = () => UI.role === 'admin' || UI.role === 'hr';
  const index = () => { PL.invalidate(); SITE = PL.byId(S.sites); EMP = PL.byId(S.employees); RUN = PL.byId(S.runs); ADV = {}; PL.advanceBalances(S).forEach((b) => { ADV[b.employee_id] = b.balance; }); };
  const siteName = (id) => PL.siteLabel(SITE, id);
  const sortedSites = () => S.sites.slice().sort((a, b) => PL.num(a.sort) - PL.num(b.sort) || a.name.localeCompare(b.name));
  const leafSites = () => sortedSites().filter((s) => !S.sites.some((c) => c.parent_id === s.id));
  let toastTimer = null;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3800); }
  // Something went wrong while saving or loading: apologise, and keep the technical detail short for the developer.
  const fail = (e) => { console.error(e); const m = e && e.message ? e.message : String(e || ''); toast(/^(Enter|Choose|Type|Add|Write|Tick|This |That |There |Only |The |A |HR |Attendance|Every|No )/.test(m) ? m : 'Sorry, something went wrong and it was not saved. Please try again, and contact the developer if it keeps happening.' + (m ? ' (' + m.slice(0, 120) + ')' : '')); };
  window.addEventListener('unhandledrejection', (ev) => { console.error(ev.reason); fail(ev.reason); });
  // The full page shown whenever the system cannot be used: no role, blocked, database not reachable, or a crash.
  function sorry(detail, signedIn) {
    if (detail) console.error('Sterling:', detail); // kept in the browser console for the developer, not shown on the page
    $('#app').innerHTML = '<div class="auth"><div class="auth-brand"><img src="logo.jpg" alt=""><h1>Sterling Engineering<br>and Construction</h1><p>Payroll, HR, attendance and procurement</p></div><div class="auth-form"><div class="auth-box sorry"><div class="sorry-ic">!</div><h2>Sorry for the inconvenience</h2><p>The system is not available for you at the moment. Please contact the developer.</p><p>Thank you for your patience.</p>' +
      '<p style="display:flex;gap:8px;margin-top:18px"><button class="b pri" data-act="sorryRetry">Try again</button>' + (signedIn ? '<button class="b" data-act="logout">Sign out</button>' : '') + '</p></div></div></div>';
  }

  // ---------- storage (Supabase when configured, this browser otherwise) ----------
  function persistLocal() { if (LIVE) return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('This browser could not store the demo data.'); } }
  function loadLocal() { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d) TABLES.concat(['changes']).forEach((t) => { S[t] = d[t] || []; }); } catch (e) { /* start empty */ } }
  async function fetchAll(t) {
    const page = (n) => sb.from(t).select('*').order('id').range(n * 1000, n * 1000 + 999);
    const first = await page(0); if (first.error) throw first.error;
    let out = first.data, n = 1;
    while (out.length === n * 1000) { // every page so far was full: fetch the next six together
      const res = await Promise.all([0, 1, 2, 3, 4, 5].map((k) => page(n + k)));
      for (const r of res) { if (r.error) throw r.error; out = out.concat(r.data); }
      n += 6;
    }
    return out;
  }
  // The database keeps one small marker that changes whenever any data changes.
  let hasSync = null, lastStamp = null;
  async function readStamp() {
    const r = await sb.from('sync_state').select('stamp').eq('id', 1).maybeSingle();
    if (r.error || !r.data) { hasSync = false; return null; }
    hasSync = true; return r.data.stamp;
  }
  // After our own save the marker has moved too, so the next background check reloads once.
  // That is deliberate: adopting the new marker without reloading could hide a change someone else made in the same moment.
  function ownChange() { tellTabs(); }
  const typing = () => { const a = document.activeElement; return !!a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName); };
  let pending = 0, saveSeq = 0;
  async function loadLive() {
    for (let tries = 0; tries < 4; tries++) {
      while (pending) await new Promise((r) => setTimeout(r, 150));
      const seq = saveSeq, got = {}, stamp = await readStamp();
      const parts = await Promise.all(TABLES.map(fetchAll).concat([sb.from('changes').select('*').order('at', { ascending: false }).range(0, 999)]));
      TABLES.forEach((t, i) => { got[t] = parts[i]; });
      const h = parts[TABLES.length]; got.changes = h.error ? [] : h.data;
      if (seq !== saveSeq || pending) continue; // something was saved while reading: read again
      Object.keys(got).forEach((t) => { S[t] = got[t]; });
      lastStamp = stamp;
      await Promise.all(EXT.loaders.map((f) => Promise.resolve().then(f).catch((e) => console.error(e))));
      return;
    }
  }
  // Other tabs of this browser are told at once; other devices pick changes up within a minute.
  const bc = LIVE && window.BroadcastChannel ? new BroadcastChannel('sterling_payroll') : null;
  const tellTabs = () => { if (bc) bc.postMessage('changed'); };
  // Runs marked paid before part payment existed: give each of their lines the run's paid date.
  function normalizePaid() {
    const paidRun = {}, changed = [];
    S.runs.forEach((r) => { if (r.status === 'paid') paidRun[r.id] = r.paid_on || today(); });
    S.run_lines.forEach((l, i) => { if (paidRun[l.run_id] && !PL.has(l.paid_on)) { S.run_lines[i] = Object.assign({}, l, { paid_on: paidRun[l.run_id] }); changed.push(S.run_lines[i]); } });
    return changed;
  }
  function putLocal(table, row) { const i = S[table].findIndex((x) => x.id === row.id); if (i >= 0) S[table][i] = row; else S[table].push(row); }

  // ----- change history: who changed what, and when
  const FL = { days: 'Days', rate: 'Rate', days_amount: 'Days amount', ot_hours: 'OT hours', ot_rate: 'OT rate', ot_amount: 'OT amount', allowances: 'Allowances', advance: 'Advance', deductions: 'Mess / deductions', net_override: 'Net (typed)', note: 'Note', paid_on: 'Paid on', emp_code: 'Code', name: 'Name', designation: 'Designation', site_id: 'Site', rate_type: 'Pay basis', pay_method: 'Pay method', bank: 'Bank or wallet', account_no: 'Account number', account_title: 'Account title', paid_through: 'Paid through', active: 'Status', notes: 'Notes', label: 'Run name', date_from: 'From date', date_to: 'To date', amount: 'Amount', given_on: 'Date', father_name: 'Father name', gender: 'Gender', cnic: 'CNIC', phone: 'Phone', department: 'Department', employment_type: 'Employment type', joining_date: 'Joining date', leaving_date: 'Leaving date', leaving_reason: 'Reason for leaving', address: 'Address', emergency_contact: 'Emergency contact' };
  const TRACK = { employees: ['emp_code', 'name', 'designation', 'site_id', 'rate_type', 'rate', 'ot_rate', 'active', 'paid_through', 'pay_method', 'bank', 'account_no', 'account_title', 'notes', 'father_name', 'gender', 'cnic', 'phone', 'department', 'employment_type', 'joining_date', 'leaving_date', 'leaving_reason', 'address', 'emergency_contact'], run_lines: ['days', 'rate', 'days_amount', 'ot_hours', 'ot_rate', 'ot_amount', 'allowances', 'advance', 'deductions', 'net_override', 'note', 'paid_on'], runs: ['label', 'date_from', 'date_to', 'note'], advances: ['amount', 'given_on', 'note'], sites: ['name', 'active'] };
  const NOLOG = { log: false };
  const runLabel = (r) => siteName(r.site_id) + (r.label ? ' · ' + r.label : '') + (r.date_from && r.date_to ? ' · ' + dmy(r.date_from) + ' to ' + dmy(r.date_to) : '');
  function showVal(table, f, v) {
    if (v === null || v === undefined || v === '') return '';
    if (f === 'site_id') return siteName(v);
    if (f === 'paid_through') return EMP[v] ? EMP[v].name : '';
    if (f === 'active') return table === 'sites' ? (v ? 'Open' : 'Closed') : (v ? 'Working' : 'Left');
    if (f === 'rate_type') return v === 'monthly' ? 'Fixed amount per run' : 'Per day';
    if (f === 'date_from' || f === 'date_to' || f === 'paid_on' || f === 'given_on' || f === 'joining_date' || f === 'leaving_date') return dmy(v);
    if (f === 'gender') return v === 'F' ? 'Female' : v === 'M' ? 'Male' : v;
    return typeof v === 'number' ? String(PL.r2(v)) : String(v);
  }
  function subjectOf(table, r) {
    if (table === 'employees') return (r.emp_code ? r.emp_code + ' ' : '') + r.name;
    if (table === 'run_lines') return ((EMP[r.employee_id] || {}).name || 'Unknown') + ' in ' + (RUN[r.run_id] ? runLabel(RUN[r.run_id]) : 'a deleted run');
    if (table === 'runs') return 'Run: ' + runLabel(r);
    if (table === 'advances') return 'Advance for ' + ((EMP[r.employee_id] || {}).name || 'Unknown');
    return 'Site: ' + r.name;
  }
  const logEntry = (table, id, subject, field, a, b) => ({ id: uuid(), at: new Date().toISOString(), who: LIVE ? UI.user : 'Demo user', table_name: table, row_id: id, subject: subject, field: field, old_value: a, new_value: b });
  function logSave(table, before, rows, opt) {
    if (opt && opt.log === false) return [];
    if (opt && opt.summary) return [logEntry(table, null, opt.subject || '', 'Many at once', '', opt.summary)];
    const out = [];
    rows.forEach((r, i) => {
      const old = before[i].old;
      if (!old) { out.push(logEntry(table, r.id, subjectOf(table, r), 'Added', '', table === 'advances' ? fmt(r.amount) : '')); return; }
      (TRACK[table] || []).forEach((f) => { const a = showVal(table, f, old[f]), b = showVal(table, f, r[f]); if (a !== b) out.push(logEntry(table, r.id, subjectOf(table, r), FL[f] || f, a, b)); });
    });
    return out;
  }
  async function pushLog(entries) {
    if (!entries.length) return;
    S.changes = entries.concat(S.changes).slice(0, 3000); persistLocal();
    if (!LIVE) return;
    try { const { error } = await sb.from('changes').insert(entries.map((e) => { const c = Object.assign({}, e); delete c.who; return c; })); if (error) throw error; }
    catch (e) { console.error(e); toast('Saved, but the change history could not be recorded.'); }
  }

  // Every change shows on screen at once. If the database refuses it, the change is undone and a message is shown.
  function rollback(table, before) {
    before.forEach((b) => { if (b.old) putLocal(table, b.old); else S[table] = S[table].filter((x) => x.id !== b.id); });
    index(); render();
  }
  async function saveMany(table, rows, opt) {
    if (!rows.length) return;
    if (table === 'employees') rows.forEach((r) => { r.updated_at = new Date().toISOString(); });
    const before = rows.map((r) => ({ id: r.id, old: S[table].find((x) => x.id === r.id) || null }));
    rows.forEach((r) => putLocal(table, r)); index(); persistLocal();
    const log = logSave(table, before, rows, opt);
    if (LIVE) {
      pending++; saveSeq++;
      try {
        const old = rows.length === 1 ? before[0].old : null;
        if (old) {
          // one record edited: send only the fields that changed, so two people editing different fields do not overwrite each other
          const nv = (v) => (v === undefined ? null : v), patch = {};
          Object.keys(rows[0]).forEach((k) => { if (k !== 'id' && nv(rows[0][k]) !== nv(old[k])) patch[k] = rows[0][k]; });
          if (Object.keys(patch).length) {
            const { data, error } = await sb.from(table).update(patch).eq('id', rows[0].id).select('id');
            if (error) throw error;
            if (!data || !data.length) { setTimeout(() => refreshData(true).catch(() => {}), 0); throw new Error('this record is no longer in the database. It may have been removed on another device'); }
          }
        } else for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from(table).upsert(rows.slice(i, i + 200)); if (error) throw error; }
      }
      catch (e) { rollback(table, before); throw e; }
      finally { pending--; }
    }
    await pushLog(log); ownChange();
  }
  const save = (table, row, opt) => saveMany(table, [row], opt);
  async function remove(table, id, opt) {
    const old = S[table].find((x) => x.id === id), oldLines = table === 'runs' ? S.run_lines.filter((l) => l.run_id === id) : [];
    const log = !old || (opt && opt.log === false) ? [] : [logEntry(table, id, subjectOf(table, old), 'Deleted', table === 'advances' ? fmt(old.amount) : '', '')];
    S[table] = S[table].filter((x) => x.id !== id);
    if (table === 'runs') S.run_lines = S.run_lines.filter((l) => l.run_id !== id);
    index(); persistLocal();
    if (LIVE) {
      pending++; saveSeq++;
      let res; try { res = await sb.from(table).delete().eq('id', id); } finally { pending--; }
      if (res.error) { if (old) S[table].push(old); S.run_lines = S.run_lines.concat(oldLines); index(); render(); throw res.error; }
    }
    await pushLog(log); ownChange();
  }
  let lastLoad = Date.now();
  async function refreshData(quiet) {
    if (UI.role === 'site') { await Promise.all(EXT.loaders.map((f) => f())); render(); if (!quiet) toast('Data refreshed.'); return; }
    if (LIVE) { await loadLive(); normalizePaid(); lastLoad = Date.now(); } else { loadLocal(); await Promise.all(EXT.loaders.map((f) => f())); }
    render(); if (!quiet) toast('Data refreshed.');
  }
  // Quiet refresh in the background. Screens with a half-filled form are not redrawn, so nothing typed is lost.
  let refreshing = false;
  async function autoRefresh(force) {
    if (!LIVE || !sb || !UI.user || UI.role === 'site' || document.hidden || typing() || pending || refreshing) return;
    refreshing = true;
    try {
      if (hasSync !== false) { const st = await readStamp(); if (hasSync && st === lastStamp) return; } // nothing has changed
      if (hasSync === false && !force && Date.now() - lastLoad < 300000) return; // database without the marker: full check every 5 minutes
      if (typing() || pending) return;
      await loadLive(); normalizePaid(); lastLoad = Date.now(); index();
      const safe = ['dashboard', 'reports', 'history', 'payments', 'payslip'].includes(UI.view) || (UI.view === 'runs' && !UI.runId && !UI.newRun);
      if (safe && !typing() && !$('#np-1')) render();
    } catch (e) { console.error(e); } finally { refreshing = false; }
  }

  // ---------- shared pieces ----------
  function siteOptions(sel, all, leafOnly) {
    const list = leafOnly ? leafSites() : sortedSites();
    return (all ? '<option value="">' + all + '</option>' : '') + list.map((s) => '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(siteName(s.id)) + (s.active === false ? ' (closed)' : '') + '</option>').join('');
  }
  function filterBar() {
    const f = UI.filter;
    return '<div class="bar"><label>Site<select data-chg="filter" data-f="siteId">' + siteOptions(f.siteId, 'All sites') + '</select></label>' +
      '<label>From date<input type="date" data-chg="filter" data-f="from" value="' + esc(f.from) + '"></label>' +
      '<label>To date<input type="date" data-chg="filter" data-f="to" value="' + esc(f.to) + '"></label>' +
      (f.siteId || f.from || f.to ? '<button class="b" data-act="clearFilter">Clear</button>' : '') + '</div>';
  }
  const stat = (k, v, cls) => '<div class="stat"><div class="k">' + k + '</div><div class="v"' + (cls ? ' style="color:var(--' + cls + ')"' : '') + '>' + v + '</div></div>';
  function payBadge(e) {
    if (!e) return '';
    const p = PL.payeeOf(EMP, e);
    if (!PL.hasAccount(p)) return '<span class="pill p-warn">Account missing</span>';
    const via = p.id !== e.id ? 'via ' + esc(p.name) : esc(p.bank || p.pay_method || '');
    return '<span class="pill p-ok">' + via + '</span>';
  }
  function accountIssue(e) {
    if (!PL.hasAccount(e)) return '';
    const a = String(e.account_no).trim(), clean = a.replace(/[\s-]/g, '');
    if (e.pay_method === 'Wallet') return clean.replace(/\D/g, '').length === 11 && /^\d+$/.test(clean) ? '' : 'Wallet number should be 11 digits';
    if (/^PK/i.test(clean)) return /^[A-Za-z0-9]{24}$/.test(clean) ? '' : 'IBAN should be 24 letters and digits';
    return /^\d+$/.test(clean) ? '' : 'Account number has letters or symbols';
  }

  // ---------- dashboard ----------
  function vDashboard() {
    const sum = PL.summarize(S, UI.filter), t = sum.totals, adv = PL.advanceSummary(S, UI.filter);
    if (!S.runs.length && !S.employees.length) return '<h1>Dashboard</h1><div class="card">No data yet. ' + (isAdmin() ? 'Go to <button class="link" data-act="nav" data-v="backup">Backup and import</button> and load the import file, or add sites and employees by hand.' : 'The accountant has not entered any data yet.') + '</div>';
    const max = Math.max.apply(null, sum.sites.map((s) => Math.abs(s.net)).concat([1]));
    let h = '<h1>Dashboard</h1>' + filterBar();
    h += '<div class="cards">' + stat('Net to pay (PKR)', fmt0(t.net)) + stat('Paid', fmt0(t.paid), 'ok') + stat('Pending', fmt0(t.pending)) + stat('Employees', t.people) + stat('Ready to pay', t.ready) + stat('Account missing', t.missing, t.missing ? 'warn' : '') + '</div>';
    h += '<div class="cards">' + stat('Gross', fmt0(t.gross)) + stat('Advances deducted', fmt0(t.advance)) + stat('Mess and other deductions', fmt0(t.deductions)) + stat('Advances given' + (UI.filter.from || UI.filter.to ? ' in these dates' : ''), fmt0(adv.given)) + stat('Advances still to recover', fmt0(adv.outstanding), adv.outstanding ? 'warn' : '') + stat('Salary runs', t.runs) + '</div>';
    if (t.skippedUndated) h += '<div class="banner">' + t.skippedUndated + ' run(s) have no dates and are not counted while a date filter is on.</div>';
    h += '<div class="card"><h2 style="margin-top:0">' + (UI.filter.siteId ? 'Teams in this site' : 'By site') + '</h2><div class="scroll"><table><tr><th>Site</th><th class="num">People</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net</th><th style="width:18%">Share</th><th class="num">Paid</th><th class="num">Advances owed</th><th>Status</th></tr>';
    sum.sites.forEach((s) => {
      const st = s.missing ? '<span class="pill p-warn">' + s.missing + ' account(s) missing</span>' : s.pending > 0 ? '<span class="pill p-inf">Ready to pay</span>' : s.paid > 0 ? '<span class="pill p-ok">Paid</span>' : '';
      h += '<tr class="click" data-act="pickSite" data-id="' + s.siteId + '"><td>' + esc(s.name) + '</td><td class="num">' + s.people + '</td><td class="num">' + fmt0(s.gross) + '</td><td class="num">' + fmt0(s.advance + s.deductions) + '</td><td class="num"><b>' + fmt0(s.net) + '</b></td><td><div class="meter"><i style="width:' + Math.max(2, Math.round(Math.abs(s.net) / max * 100)) + '%"></i></div></td><td class="num">' + fmt0(s.paid) + '</td><td class="num">' + (SITE[s.siteId] ? fmt0(PL.advanceSummary(S, { siteId: s.siteId }).outstanding) : '') + '</td><td>' + st + (s.negative ? ' <span class="pill p-bad">' + s.negative + ' negative</span>' : '') + '</td></tr>';
    });
    h += '<tr class="tot"><td>Total</td><td class="num">' + t.people + '</td><td class="num">' + fmt0(t.gross) + '</td><td class="num">' + fmt0(t.advance + t.deductions) + '</td><td class="num">' + fmt0(t.net) + '</td><td></td><td class="num">' + fmt0(t.paid) + '</td><td class="num">' + fmt0(adv.outstanding) + '</td><td></td></tr></table></div></div>';
    h += '<div class="card"><h2 style="margin-top:0">Salary runs in view</h2>' + runsTable(sum.runs, 30) + '</div>';
    return h;
  }

  // ---------- salary runs ----------
  function stateText(r) { const st = PL.runState(S, r); return st.state === 'paid' ? 'Paid' : st.state === 'part' ? 'Part paid: ' + st.paid + ' of ' + st.total : 'Open'; }
  function statePill(r) { const st = PL.runState(S, r).state; return '<span class="pill ' + (st === 'paid' ? 'p-ok' : st === 'part' ? 'p-warn' : 'p-inf') + '">' + stateText(r) + '</span>'; }
  function runsTable(runs, limit) {
    if (!runs.length) return '<p class="mut">No salary runs match.</p>';
    const all = runs.slice().sort((a, b) => (b.date_from || '9999').localeCompare(a.date_from || '9999') || siteName(a.site_id).localeCompare(siteName(b.site_id)));
    const list = limit && all.length > limit ? all.slice(0, limit) : all;
    let h = '<div class="scroll"><table><tr><th>Site</th><th>Name</th><th>Period</th><th class="num">People</th><th class="num">Net</th><th class="num">Still to pay</th><th>Status</th><th>To check</th></tr>';
    list.forEach((r) => {
      const t = PL.runTotals(S, r), w = PL.runWarnings(S, r).length;
      h += '<tr class="click" data-act="openRun" data-id="' + r.id + '"><td>' + esc(siteName(r.site_id)) + '</td><td>' + esc(r.label || '') + '</td><td>' + period(r) + '</td><td class="num">' + t.people + '</td><td class="num">' + fmt0(t.net) + '</td><td class="num">' + fmt0(t.pending) + '</td><td>' + statePill(r) + '</td><td>' + (w ? '<span class="pill p-warn">' + w + '</span>' : '') + '</td></tr>';
    });
    return h + '</table></div>' + (list.length < all.length ? '<p class="mut" style="margin:8px 0 0;font-size:13px">Showing the latest ' + list.length + ' of ' + all.length + ' runs. Open Salary runs, or set dates above, to see the others.</p>' : '');
  }
  function vRuns() {
    if (UI.runId && RUN[UI.runId]) return vRun(RUN[UI.runId]);
    let h = '<h1>Salary runs</h1>' + filterBar();
    if (isAdmin()) {
      h += UI.newRun ? '<div class="card"><h2 style="margin-top:0">New salary run</h2><div class="form"><label>Site<select id="nr-site">' + siteOptions(UI.filter.siteId, null, true) + '</select></label><label>Name (optional)<input id="nr-label" placeholder="Shutdown job, second half, and so on"></label><label>From date<input type="date" id="nr-from"></label><label>To date<input type="date" id="nr-to"></label><label>Start with<select id="nr-start"><option value="copy">Copy from the last run of this site</option><option value="all">All working employees of this site</option></select></label></div><p class="mut" style="font-size:12px">Copy brings the same people with their rates, overtime rates, allowances and mess. Days, overtime hours and advances start empty.</p><p style="margin:12px 0 0"><button class="b pri" data-act="createRun">Create run</button> <button class="b" data-act="cancelNewRun">Cancel</button></p></div>'
        : '<p><button class="b pri" data-act="newRun">New salary run</button></p>';
    }
    return h + '<div class="card">' + runsTable(PL.filterRuns(S, UI.filter).runs) + '</div>';
  }
  // Under the Advance box: what the employee still owes after this line, with a one-click deduction.
  function advHint(l, ro) {
    const owed = PL.num(ADV[l.employee_id]);
    if (owed <= 0) return '';
    return 'Owes ' + fmt0(owed) + (ro ? '' : ' \u00b7 <button class="link" data-act="deductAdv" data-id="' + l.id + '" title="Add the amount still owed to this advance deduction">Deduct</button>');
  }
  function runRow(l, admin) {
    const e = EMP[l.employee_id] || { name: 'Unknown employee' }, c = PL.calcLine(l), paid = PL.linePaid(l), ro = !admin || paid, d = ro ? ' disabled' : '';
    const inp = (f, ph) => '<input' + (ph !== undefined && PL.has(l[f]) ? ' class="typed" title="Typed by hand. Clear the box to use the calculation."' : '') + ' data-chg="line" data-id="' + l.id + '" data-f="' + f + '" value="' + esc(PL.has(l[f]) ? PL.r2(l[f]) : '') + '" placeholder="' + (ph === undefined ? '' : ph) + '" inputmode="decimal" aria-label="' + f.replace(/_/g, ' ') + '"' + d + '>';
    const paidCell = admin ? '<label class="nowrap" style="display:flex;gap:5px;align-items:center"><input type="checkbox" style="width:auto" data-chg="linePaid" data-id="' + l.id + '"' + (paid ? ' checked' : '') + ' aria-label="paid">' + (paid ? dmy(l.paid_on) : '') + '</label>' : (paid ? '<span class="pill p-ok">' + dmy(l.paid_on) + '</span>' : '');
    return '<tr id="ln-' + l.id + '"><td class="nowrap">' + esc(e.emp_code || '') + '</td><td>' + esc(e.name) + '<small>' + esc(e.designation || '') + '</small></td>' +
      '<td>' + inp('days') + '</td><td>' + inp('rate') + '</td><td>' + inp('days_amount', fmt(c.daysCalc)) + '</td><td>' + inp('ot_hours') + '</td><td>' + inp('ot_rate', PL.has(PL.autoOtRate(l.rate)) ? fmt(PL.autoOtRate(l.rate)) : undefined) + '</td><td>' + inp('ot_amount', fmt(c.otCalc)) + '</td><td>' + inp('allowances') + '</td>' +
      '<td class="num" data-cell="gross">' + fmt(c.gross) + '</td><td>' + inp('advance') + '<div class="advh" id="adv-' + l.id + '">' + advHint(l, ro) + '</div></td><td>' + inp('deductions') + '</td><td>' + inp('net_override', fmt(c.netCalc)) + '</td>' +
      '<td class="num" data-cell="net"><b' + (c.net < 0 ? ' style="color:var(--bad)"' : '') + '>' + fmt(c.net) + '</b></td><td>' + paidCell + '</td><td>' + payBadge(EMP[l.employee_id]) + '</td>' +
      '<td><input class="note" data-chg="line" data-id="' + l.id + '" data-f="note" value="' + esc(l.note || '') + '" aria-label="note"' + d + '></td>' +
      '<td class="nowrap"><button class="b sm" data-act="slip" data-id="' + l.id + '">Slip</button>' + (ro ? '' : ' <button class="b sm danger" data-act="delLine" data-id="' + l.id + '" title="Remove from this run">Remove</button>') + '</td></tr>';
  }
  function runSummaryHtml(r) {
    const t = PL.runTotals(S, r), w = PL.runWarnings(S, r), st = PL.runState(S, r);
    return '<div class="cards">' + stat('People', t.people) + stat('Gross', fmt0(t.gross)) + stat('Advance', fmt0(t.advance)) + stat('Deductions', fmt0(t.deductions)) + stat('Net to pay', fmt0(t.net)) + (st.paid ? stat('Paid (' + st.paid + ' of ' + st.total + ')', fmt0(t.paid), 'ok') + stat('Still to pay', fmt0(t.pending)) : '') + '</div>' +
      (w.length ? '<div class="card"><b>To check</b><ul class="warns">' + w.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '');
  }
  const APPLY_FIELDS = [['days', 'Days'], ['rate', 'Rate per day'], ['ot_rate', 'Overtime rate'], ['allowances', 'Allowances'], ['deductions', 'Mess / deductions']];
  const periodDays = (r) => (r.date_from && r.date_to && r.date_from <= r.date_to ? PL.daysBetween(r.date_from, r.date_to) : '');
  function vRun(r) {
    const admin = isAdmin(), d = admin ? '' : ' disabled', st = PL.runState(S, r);
    const lines = S.run_lines.filter((l) => l.run_id === r.id).sort((a, b) => ((EMP[a.employee_id] || {}).emp_code || '').localeCompare((EMP[b.employee_id] || {}).emp_code || '', undefined, { numeric: true }));
    const inRun = new Set(lines.map((l) => l.employee_id));
    let h = '<p><button class="link" data-act="closeRun">Back to all runs</button></p><h1>' + esc(siteName(r.site_id)) + (r.label ? ' · ' + esc(r.label) : '') + ' <span id="run-pill">' + statePill(r) + '</span></h1>';
    h += '<div class="card"><div class="form"><label>Name<input data-chg="run" data-f="label" value="' + esc(r.label || '') + '"' + d + '></label><label>From date<input type="date" data-chg="run" data-f="date_from" value="' + esc(r.date_from || '') + '"' + d + '></label><label>To date<input type="date" data-chg="run" data-f="date_to" value="' + esc(r.date_to || '') + '"' + d + '></label><label>Note<input data-chg="run" data-f="note" value="' + esc(r.note || '') + '"' + d + '></label></div>';
    h += '<p style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap;align-items:end">';
    if (admin) {
      if (st.paid < st.total) h += '<label style="font-size:12px;color:var(--mut)">Paid on<br><input type="date" id="paid-on" value="' + today() + '"></label><button class="b pri" data-act="markAllPaid" data-confirm="1">Mark all ' + (st.total - st.paid) + ' unpaid as paid</button>';
      if (st.paid) h += '<button class="b" data-act="reopenAll" data-confirm="1">Reopen all ' + st.paid + ' paid</button>';
    }
    if (admin && st.paid < st.total && r.date_from && r.date_to && EXT.views.attsheet) h += '<button class="b" data-act="fillFromAtt" data-confirm="1" title="Days = P and OT marks (half day counts 0.5) in this period; OT hours = hours marked. Paid lines are not changed.">Fill days and OT from attendance</button>';
    h += '<button class="b" data-act="exportRun">Download Excel</button>' + (lines.length ? '<button class="b" data-act="slip">Payslips for everyone</button>' : '') + (admin ? '<button class="b danger right" data-act="delRun" data-confirm="1">Delete run</button>' : '') + '</p>';
    h += '</div><div id="run-sum">' + runSummaryHtml(r) + '</div><div class="card">';
    if (admin && st.paid < st.total) h += '<div class="bar" style="margin-bottom:10px"><label>Set for everyone<select id="all-field" data-chg="allField">' + APPLY_FIELDS.map((o) => '<option value="' + o[0] + '"' + (UI.allField === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><label>Value<input id="all-val" inputmode="decimal" style="width:110px" placeholder="' + (UI.allField === 'days' ? periodDays(r) : '') + '"></label><button class="b" data-act="applyAll">Apply to all</button><label style="flex-direction:row;align-items:center;gap:6px;font-size:13px;color:inherit;padding-bottom:6px"><input type="checkbox" id="all-empty"> Only where it is empty</label></div>';
    h += '<div class="scroll"><table class="grid freeze"><tr><th>Code</th><th>Employee</th><th>Days</th><th>Rate/day</th><th>Days amount</th><th>OT hours</th><th>OT rate</th><th>OT amount</th><th>Allowances</th><th class="num">Gross</th><th>Advance</th><th>Mess / deductions</th><th>Net (typed)</th><th class="num">Net to pay</th><th>Paid</th><th>Pay to</th><th>Note</th><th></th></tr>' + lines.map((l) => runRow(l, admin)).join('') + '</table></div>';
    h += '<p class="mut" style="font-size:12px;margin:8px 0 0">Grey figures inside a box are calculated. Type in the box to replace the calculation; clear it to go back. Tick Paid for one employee, or use the buttons above for everyone. A paid line is locked until you untick it.</p>';
    if (admin) {
      const mine = S.employees.filter((e) => e.active !== false && !inRun.has(e.id) && e.site_id === r.site_id), others = S.employees.filter((e) => e.active !== false && !inRun.has(e.id) && e.site_id !== r.site_id);
      const opt = (e) => '<option value="' + e.id + '">' + esc((e.emp_code ? e.emp_code + ' ' : '') + e.name) + '</option>';
      h += '<p style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0"><select id="add-emp"><option value="">Choose employee…</option><optgroup label="This site">' + mine.map(opt).join('') + '</optgroup><optgroup label="Other sites">' + others.map(opt).join('') + '</optgroup></select><button class="b" data-act="addLine">Add to run</button>' + (mine.length ? '<button class="b" data-act="addAllLines">Add all ' + mine.length + ' remaining from this site</button>' : '') + '</p>';
    }
    return h + '</div>';
  }
  function newLine(run, e) {
    const monthly = e.rate_type === 'monthly';
    return { id: uuid(), run_id: run.id, employee_id: e.id, days: null, rate: monthly ? null : (PL.has(e.rate) ? e.rate : null), days_amount: monthly && PL.has(e.rate) ? e.rate : null, ot_hours: null, ot_rate: PL.has(e.ot_rate) && (monthly || PL.r2(e.ot_rate) !== PL.autoOtRate(e.rate)) ? e.ot_rate : null, ot_amount: null, allowances: null, advance: null, deductions: null, net_override: null, note: null, paid_on: null };
  }
  // The run's own status follows its lines: paid only when every employee in it is paid.
  async function syncRun(runId) {
    const r = RUN[runId]; if (!r) return;
    const st = PL.runState(S, r), status = st.state === 'paid' ? 'paid' : 'open';
    const last = status === 'paid' ? S.run_lines.filter((l) => l.run_id === runId).map((l) => l.paid_on).sort().pop() : null;
    if (r.status !== status || (r.paid_on || null) !== last) await save('runs', Object.assign({}, r, { status: status, paid_on: last }), NOLOG);
  }

  // ---------- payslips ----------
  function slipHtml(l) {
    const r = RUN[l.run_id], e = EMP[l.employee_id] || { name: 'Unknown employee' }, c = PL.calcLine(l), p = PL.payeeOf(EMP, e);
    const row = (a, b, v) => '<tr><td>' + a + '</td><td class="mut">' + b + '</td><td class="num">' + v + '</td></tr>';
    const typedDays = PL.has(l.days_amount) && Math.abs(c.daysAmt - c.daysCalc) > 0.01, typedOt = PL.has(l.ot_amount) && Math.abs(c.otAmt - c.otCalc) > 0.01;
    const acct = String(p.account_no || '').replace(/\s/g, '');
    const paidTo = !PL.hasAccount(p) ? 'No account on file' : (p.id !== e.id ? 'Through ' + esc(p.name) : esc(p.account_title || p.name) + ', ' + esc(p.bank || p.pay_method || '') + ', account ending ' + esc(acct.slice(-4)));
    let h = '<div class="slip"><div class="slip-h"><div><b style="font-size:17px">Sterling Engineering</b><div class="mut">Salary slip</div></div><div style="text-align:right"><b>' + esc(siteName(r.site_id)) + '</b><div class="mut">' + (r.date_from && r.date_to ? dmy(r.date_from) + ' to ' + dmy(r.date_to) : esc(r.label || '')) + '</div></div></div>';
    h += '<table><tr><td class="mut">Employee</td><td><b>' + esc(e.name) + '</b></td><td class="mut">Code</td><td>' + esc(e.emp_code || '') + '</td></tr><tr><td class="mut">Designation</td><td>' + esc(e.designation || '') + '</td><td class="mut">Days</td><td>' + (PL.has(l.days) ? PL.r2(l.days) : '') + '</td></tr></table>';
    h += '<table><tr><th>Earnings</th><th></th><th class="num">PKR</th></tr>' + row('Salary for days worked', typedDays || !PL.has(l.rate) ? 'Fixed amount' : PL.r2(l.days) + ' days × ' + fmt(l.rate), fmt(c.daysAmt));
    if (c.otAmt) h += row('Overtime', typedOt || !c.otRate ? '' : PL.r2(l.ot_hours) + ' hours × ' + fmt(c.otRate), fmt(c.otAmt));
    if (PL.num(l.allowances)) h += row('Allowances', '', fmt(l.allowances));
    h += '<tr class="tot"><td>Gross</td><td></td><td class="num">' + fmt(c.gross) + '</td></tr><tr><th>Deductions</th><th></th><th></th></tr>' + row('Advance', '', fmt(l.advance)) + row('Mess and other deductions', '', fmt(l.deductions));
    if (Math.abs(c.net - c.netCalc) > 0.01) h += row('Adjustment', '', fmt(c.net - c.netCalc));
    h += '<tr class="tot big"><td>Net pay</td><td></td><td class="num">' + fmt(c.net) + '</td></tr></table>';
    h += '<p style="margin:6px 0"><span class="mut">Paid to:</span> ' + paidTo + '<br><span class="mut">Status:</span> ' + (PL.linePaid(l) ? 'Paid on ' + dmy(l.paid_on) : 'Not yet paid') + (l.note ? '<br><span class="mut">Note:</span> ' + esc(l.note) : '') + '</p>';
    return h + '<div class="sign"><span>Prepared by</span><span>Received by</span></div></div>';
  }
  function vPayslip() {
    const sl = UI.slip || {}, r = RUN[sl.runId];
    if (!r) { UI.view = 'runs'; return vRuns(); }
    const lines = S.run_lines.filter((l) => l.run_id === r.id && (!sl.lineId || l.id === sl.lineId)).sort((a, b) => ((EMP[a.employee_id] || {}).emp_code || '').localeCompare((EMP[b.employee_id] || {}).emp_code || '', undefined, { numeric: true }));
    return '<div class="noprint"><p><button class="link" data-act="slipBack">Back to the run</button></p><h1>Payslip' + (lines.length === 1 ? '' : 's: ' + lines.length + ' employees') + '</h1><p><button class="b pri" data-act="print">Print or save as PDF</button></p><p class="mut" style="font-size:13px">In the print window, choose "Save as PDF" as the printer. Each employee is on a separate page.</p></div>' + lines.map(slipHtml).join('');
  }

  // ---------- employees ----------
  function empFiltered() {
    const q = UI.empQ.trim().toLowerCase();
    return S.employees.filter((e) => {
      if (UI.empSite && !PL.siteIdsUnder(S.sites, UI.empSite).has(e.site_id)) return false;
      if (UI.empShow === 'active' && e.active === false) return false;
      if (UI.empShow === 'left' && e.active !== false) return false;
      if (UI.empShow === 'missing' && PL.hasAccount(PL.payeeOf(EMP, e))) return false;
      if (q && !((e.name || '') + ' ' + (e.emp_code || '') + ' ' + (e.designation || '') + ' ' + (e.cnic || '') + ' ' + (e.phone || '')).toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => siteName(a.site_id).localeCompare(siteName(b.site_id)) || (a.emp_code || '').localeCompare(b.emp_code || '', undefined, { numeric: true }));
  }
  const EMP_TYPES = ['Daily wage', 'Contract', 'Permanent', 'Probation'];
  function empForm(e, isNew) {
    const sel = (v, cur) => (v === (cur || '') ? ' selected' : '');
    const others = S.employees.filter((x) => x.id !== e.id).sort((a, b) => a.name.localeCompare(b.name));
    const txt = (n, label, ph, cls) => '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + label + '<input name="' + n + '" value="' + esc(e[n] || '') + '"' + (ph ? ' placeholder="' + ph + '"' : '') + '></label>';
    const dt = (n, label) => '<label>' + label + '<input type="date" name="' + n + '" value="' + esc(e[n] || '') + '"></label>';
    let h = '<div class="card"><h2 style="margin-top:0">' + (isNew ? 'New employee' : 'Edit ' + esc(e.name)) + '</h2><div class="form" id="emp-form">' +
      '<label>Employee code<input name="emp_code" data-auto="' + (isNew ? esc(e.emp_code || '') : '') + '" value="' + esc(e.emp_code || '') + '"><button type="button" class="link" data-act="suggestCode" style="text-align:left;font-size:12px">Use the next free code for this site</button></label><label>Name<input name="name" value="' + esc(e.name || '') + '"></label><label>Designation<input name="designation" value="' + esc(e.designation || '') + '"></label>' +
      '<label>Site<select name="site_id" data-chg="empFormSite">' + siteOptions(e.site_id, null, true) + '</select></label>' +
      '<label>Status<select name="active"><option value="1"' + (e.active !== false ? ' selected' : '') + '>Working</option><option value="0"' + (e.active === false ? ' selected' : '') + '>Left</option></select></label>' +
      '<div class="full sec-h">Personal and job details</div>' +
      txt('father_name', 'Father or husband name') +
      '<label>Gender<select name="gender"><option value=""' + sel('', e.gender) + '>Not set</option><option value="M"' + sel('M', e.gender) + '>Male</option><option value="F"' + sel('F', e.gender) + '>Female</option></select></label>' +
      txt('cnic', 'CNIC', '35202-1234567-1') + txt('phone', 'Phone', '03xx-xxxxxxx') + txt('department', 'Department', 'Mechanical, EHS, Civil') +
      '<label>Employment type<select name="employment_type"><option value=""' + sel('', e.employment_type) + '>Not set</option>' + EMP_TYPES.map((t) => '<option' + sel(t, e.employment_type) + '>' + t + '</option>').join('') + '</select></label>' +
      dt('joining_date', 'Joining date') + dt('leaving_date', 'Leaving date') + txt('leaving_reason', 'Reason for leaving') + txt('emergency_contact', 'Emergency contact', 'Name and phone') + txt('address', 'Address', '', 'full');
    if (isAdmin()) h += '<div class="full sec-h">Pay</div>' +
      '<label>Pay basis<select name="rate_type"><option value="daily"' + sel('daily', e.rate_type || 'daily') + '>Per day</option><option value="monthly"' + sel('monthly', e.rate_type) + '>Fixed amount per run</option></select></label>' +
      '<label>Rate (PKR)<input name="rate" inputmode="decimal" value="' + esc(PL.has(e.rate) ? e.rate : '') + '"></label><label>Overtime rate per hour<input name="ot_rate" inputmode="decimal" value="' + esc(PL.has(e.ot_rate) ? e.ot_rate : '') + '" placeholder="Leave empty: day rate \u00f7 8"></label>' +
      '<div class="full sec-h">Bank or wallet details</div>' +
      '<label>Paid through<select name="paid_through"><option value="">His own account</option>' + others.map((x) => '<option value="' + x.id + '"' + (x.id === e.paid_through ? ' selected' : '') + '>' + esc(x.name + (x.emp_code ? ' (' + x.emp_code + ')' : '')) + '</option>').join('') + '</select></label>' +
      '<label>Pay method<select name="pay_method" data-chg="empFormMethod"><option value=""' + sel('', e.pay_method) + '>Not set</option><option value="UBL"' + sel('UBL', e.pay_method) + '>UBL account</option><option value="Bank"' + sel('Bank', e.pay_method) + '>Other bank</option><option value="Wallet"' + sel('Wallet', e.pay_method) + '>Mobile wallet</option></select></label>' +
      '<label>Bank or wallet name<input name="bank" value="' + esc(e.bank || '') + '" placeholder="HBL, JazzCash"></label><label>Account number or IBAN<input name="account_no" value="' + esc(e.account_no || '') + '"></label><label>Account title<input name="account_title" value="' + esc(e.account_title || '') + '"></label>';
    h += '<label class="full">Notes<input name="notes" value="' + esc(e.notes || '') + '"></label></div>';
    h += isAdmin() ? '<p class="mut" style="font-size:12px">When "Paid through" is set, his pay is added to that person’s transfer and his own account fields are ignored.</p>' : '<p class="mut" style="font-size:12px">Rates and bank details are kept by the accountant.</p>';
    return h + '<p style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap"><button class="b pri" data-act="saveEmp">Save</button><button class="b" data-act="cancelEmp">Cancel</button>' + (isNew || !isAdmin() ? '' : '<button class="b danger right" data-act="delEmp" data-confirm="1">Delete employee</button>') + '</p></div>';
  }
  function vEmployees() {
    let h = '<h1>Employees</h1>';
    if (UI.empId === 'new') { const ns = leafSites().find((x) => !UI.empSite || PL.siteIdsUnder(S.sites, UI.empSite).has(x.id)) || leafSites()[0]; h += empForm({ site_id: ns && ns.id, emp_code: PL.nextEmpCode(S, ns), active: true }, true); }
    else if (UI.empId && EMP[UI.empId]) h += empForm(EMP[UI.empId], false);
    const full = empFiltered(), list = UI.empAll ? full : full.slice(0, 300);
    h += '<div class="bar"><label>Search<input id="emp-q" data-inp="empQ" value="' + esc(UI.empQ) + '" placeholder="Name, code or CNIC"></label><label>Site<select data-chg="ui" data-f="empSite">' + siteOptions(UI.empSite, 'All sites') + '</select></label><label>Show<select data-chg="ui" data-f="empShow">' + [['active', 'Working'], ['missing', 'Account missing'], ['left', 'Left'], ['all', 'Everyone']].filter((o) => isAdmin() || o[0] !== 'missing').map((o) => '<option value="' + o[0] + '"' + (UI.empShow === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' + (UI.empId || !canHR() ? '' : '<button class="b pri" data-act="newEmp">New employee</button>') + '<span class="mut">' + full.length + ' shown</span></div>';
    if (!isAdmin()) {
      h += '<div class="card"><div class="scroll"><table><tr><th>Code</th><th>Name</th><th>Site</th><th>Department</th><th>Type</th><th>Phone</th><th>CNIC</th><th>Joined</th><th></th></tr>';
      list.forEach((e) => { h += '<tr><td class="nowrap">' + esc(e.emp_code || '') + '</td><td>' + esc(e.name) + (e.active === false ? ' <span class="pill p-bad">Left' + (e.leaving_date ? ' ' + dmy(e.leaving_date) : '') + '</span>' : '') + '<small>' + esc(e.designation || '') + (e.father_name ? ' · ' + (e.gender === 'F' ? 'D/O ' : 'S/O ') + esc(e.father_name) : '') + '</small></td><td>' + esc(siteName(e.site_id)) + '</td><td>' + esc(e.department || '') + '</td><td>' + esc(e.employment_type || '') + '</td><td class="nowrap">' + esc(e.phone || '') + '</td><td class="nowrap">' + esc(e.cnic || '') + '</td><td class="nowrap">' + dmy(e.joining_date) + '</td><td>' + (isHR() ? '<button class="b sm" data-act="editEmp" data-id="' + e.id + '">Edit</button>' : '') + '</td></tr>'; });
      return h + '</table></div>' + (list.length < full.length ? '<p style="margin:10px 0 0"><button class="b" data-act="showAllEmp">Show all ' + full.length + '</button></p>' : '') + '</div>';
    }
    h += '<div class="card"><div class="scroll"><table><tr><th>Code</th><th>Name</th><th>Site</th><th class="num">Rate</th><th>Pay to</th><th>Account</th><th></th></tr>';
    list.forEach((e) => {
      const p = PL.payeeOf(EMP, e), iss = accountIssue(p);
      h += '<tr><td class="nowrap">' + esc(e.emp_code || '') + '</td><td>' + esc(e.name) + (e.active === false ? ' <span class="pill p-bad">Left</span>' : '') + '<small>' + esc(e.designation || '') + '</small></td><td>' + esc(siteName(e.site_id)) + '</td><td class="num">' + (PL.has(e.rate) ? fmt(e.rate) : '') + '</td><td>' + payBadge(e) + '</td><td>' + (PL.hasAccount(p) ? esc(p.account_no) + '<small>' + esc(p.account_title || '') + (iss ? ' · <span style="color:var(--warn)">' + iss + '</span>' : '') + '</small>' : '') + '</td><td><button class="b sm" data-act="editEmp" data-id="' + e.id + '">Edit</button></td></tr>';
    });
    return h + '</table></div>' + (list.length < full.length ? '<p style="margin:10px 0 0"><button class="b" data-act="showAllEmp">Show all ' + full.length + '</button> <span class="mut">Showing the first ' + list.length + '. Search or pick a site to narrow the list.</span></p>' : '') + '</div>';
  }

  // ---------- bank details ----------
  function bankCheck(e, shared) {
    if (e.paid_through && EMP[e.paid_through]) return '';
    const out = [accountIssue(e)];
    const same = (shared || PL.sharedAccounts(S))[e.id];
    if (same) out.push('Same account as ' + same.map((x) => x.name + (x.emp_code ? ' (' + x.emp_code + ')' : '')).join(', ') + '. Link them with Paid through, or correct the number');
    return out.filter(Boolean).join('. ');
  }
  function bankList(shared) {
    return S.employees.filter((e) => e.active !== false && (!UI.bankSite || PL.siteIdsUnder(S.sites, UI.bankSite).has(e.site_id)) && (UI.bankShow === 'all' || (UI.bankShow === 'issues' ? !!bankCheck(e, shared) : !PL.hasAccount(PL.payeeOf(EMP, e)))))
      .sort((a, b) => siteName(a.site_id).localeCompare(siteName(b.site_id)) || (a.emp_code || '').localeCompare(b.emp_code || '', undefined, { numeric: true }));
  }
  function vBank() {
    const shared = PL.sharedAccounts(S), fullBank = bankList(shared), list = UI.bankAll ? fullBank : fullBank.slice(0, 300), miss = S.employees.filter((e) => e.active !== false && !PL.hasAccount(PL.payeeOf(EMP, e))).length, nShared = Object.keys(shared).length;
    let h = '<h1>Bank details</h1><div class="cards">' + stat('Working employees', S.employees.filter((e) => e.active !== false).length) + stat('Account missing', miss, miss ? 'warn' : '') + stat('Accounts to check', S.employees.filter((e) => e.active !== false && bankCheck(e, shared)).length) + stat('Sharing an account, not linked', nShared, nShared ? 'warn' : '') + '</div>';
    h += '<div class="bar"><label>Site<select data-chg="ui" data-f="bankSite">' + siteOptions(UI.bankSite, 'All sites') + '</select></label><label>Show<select data-chg="ui" data-f="bankShow">' + [['missing', 'Account missing'], ['issues', 'Accounts to check'], ['all', 'Everyone']].map((o) => '<option value="' + o[0] + '"' + (UI.bankShow === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><button class="b" data-act="bankTemplate">Download sheet to fill</button><label>Upload filled sheet<input type="file" accept=".xlsx,.xls,.csv" data-chg="bankUpload"></label></div>';
    h += '<div class="card"><p class="mut" style="margin-top:0;font-size:13px">Type straight into the boxes; each change is saved when you leave the box. To pay someone through a supervisor, use Edit.</p><div class="scroll"><table class="grid wide"><tr><th>Code</th><th>Employee</th><th>Method</th><th>Bank or wallet</th><th>Account number or IBAN</th><th>Account title</th><th>Check</th><th></th></tr>';
    list.forEach((e) => {
      const via = e.paid_through && EMP[e.paid_through];
      const inp = (f) => '<input style="text-align:left" data-chg="bank" data-id="' + e.id + '" data-f="' + f + '" value="' + esc(e[f] || '') + '" aria-label="' + f.replace(/_/g, ' ') + '">';
      h += '<tr><td class="nowrap">' + esc(e.emp_code || '') + '</td><td>' + esc(e.name) + '<small>' + esc(siteName(e.site_id)) + '</small></td>' +
        (via ? '<td colspan="4"><span class="pill p-inf">Paid through ' + esc(via.name) + '</span></td>' : '<td><select data-chg="bank" data-id="' + e.id + '" data-f="pay_method" aria-label="pay method">' + [['', 'Not set'], ['UBL', 'UBL'], ['Bank', 'Other bank'], ['Wallet', 'Wallet']].map((o) => '<option value="' + o[0] + '"' + ((e.pay_method || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></td><td>' + inp('bank') + '</td><td>' + inp('account_no') + '</td><td>' + inp('account_title') + '</td>') +
        '<td id="iss-' + e.id + '" style="color:var(--warn);font-size:12px;max-width:260px">' + esc(bankCheck(e, shared)) + '</td><td><button class="b sm" data-act="editEmpFrom" data-id="' + e.id + '">Edit</button></td></tr>';
    });
    return h + '</table></div>' + (list.length ? '' : '<p class="mut">Nothing to show for this choice.</p>') + (list.length < fullBank.length ? '<p style="margin:10px 0 0"><button class="b" data-act="showAllBank">Show all ' + fullBank.length + '</button> <span class="mut">Showing the first ' + list.length + '.</span></p>' : '') + '</div>';
  }

  // ---------- advances ----------
  // Search box for choosing the employee: type part of a name or code, then pick from the short list.
  function advMatches() {
    const q = (UI.advQ || '').trim().toLowerCase(); if (!q) return [];
    const words = q.split(/\s+/);
    // names that start with what was typed come first, then names with a word starting with it, then the rest
    const rank = (e) => { const n = (e.name || '').toLowerCase(), c = (e.emp_code || '').toLowerCase(); return n.startsWith(q) || c.startsWith(q) ? 0 : (' ' + n).includes(' ' + q) ? 1 : 2; };
    return S.employees.filter((e) => { const t = ((e.name || '') + ' ' + (e.emp_code || '') + ' ' + siteName(e.site_id)).toLowerCase(); return words.every((w) => t.includes(w)); })
      .sort((a, b) => (a.active === false) - (b.active === false) || rank(a) - rank(b) || a.name.localeCompare(b.name));
  }
  function advResults() {
    if (UI.advEmp && EMP[UI.advEmp]) { const owed = PL.num(ADV[UI.advEmp]); return '<div class="picked">' + esc(siteName(EMP[UI.advEmp].site_id)) + ' \u00b7 ' + (owed > 0 ? 'owes ' + fmt0(owed) : 'owes nothing') + '</div>'; }
    const list = advMatches(); if (!(UI.advQ || '').trim()) return '';
    if (!list.length) return '<div class="picked">No employee matches.</div>';
    return '<div class="plist">' + list.slice(0, 8).map((e) => '<button type="button" data-act="pickAdvEmp" data-id="' + e.id + '">' + esc(e.name) + ' <span class="mut">' + esc(e.emp_code || '') + ' \u00b7 ' + esc(siteName(e.site_id)) + (e.active === false ? ' \u00b7 left' : '') + '</span></button>').join('') + (list.length > 8 ? '<div class="picked">' + (list.length - 8) + ' more. Keep typing to narrow the list.</div>' : '') + '</div>';
  }
  // Where more was recovered in salary sheets than was ever recorded as given, the advance was given before the system started.
  const overRecovered = () => PL.advanceBalances(S).filter((b) => EMP[b.employee_id] && b.balance < -0.005);
  const openingRows = () => overRecovered().map((b) => ({ id: uuid(), employee_id: b.employee_id, given_on: null, amount: PL.r2(-b.balance), note: 'Opening balance: given before the system started' }));
  function vAdvances() {
    const bal = PL.advanceBalances(S).filter((b) => EMP[b.employee_id]).sort((a, b) => b.balance - a.balance || EMP[a.employee_id].name.localeCompare(EMP[b.employee_id].name));
    const emps = S.employees.slice().sort((a, b) => a.name.localeCompare(b.name));
    let h = '<h1>Advances</h1>';
    if (isAdmin()) h += '<div class="card"><h2 style="margin-top:0">Record an advance given</h2><div class="bar" style="margin:0"><label style="position:relative">Employee<input id="adv-q" data-inp="advQ" autocomplete="off" placeholder="Type a name or code" style="width:240px" value="' + esc(UI.advQ || '') + '"><div id="adv-results" class="picker">' + advResults() + '</div></label><label>Date<input type="date" id="adv-date" value="' + today() + '"></label><label>Amount (PKR)<input id="adv-amt" inputmode="decimal" style="width:120px"></label><label>Note<input id="adv-note"></label><button class="b pri" data-act="addAdvance">Save advance</button></div></div>';
    const over = overRecovered();
    if (over.length) h += '<div class="card"><b>' + over.length + ' employee(s) have more recovered than given, ' + fmt0(over.reduce((t, b) => t - b.balance, 0)) + ' in total.</b><p style="margin:6px 0">This normally means the advance was given before the system started, and the salary sheets only show it being recovered. Until it is recorded, a new advance to these employees will not show as owed. If one of them is a typing mistake in a run, correct the run instead.</p>' + (isAdmin() ? '<button class="b pri" data-act="openingAdv" data-confirm="1">Record these as opening advances</button>' : '') + '</div>';
    h += '<div class="card"><h2 style="margin-top:0">Balance by employee</h2><p class="mut" style="font-size:13px;margin-top:0">Given comes from this page. Recovered is the advance column of the salary runs. The amount still to recover is also shown under the Advance box in each salary run.</p><div class="scroll"><table><tr><th>Employee</th><th>Site</th><th class="num">Given</th><th class="num">Recovered in runs</th><th class="num">Still to recover</th></tr>';
    bal.forEach((b) => { const e = EMP[b.employee_id]; h += '<tr><td>' + esc(e.name) + ' <span class="mut">' + esc(e.emp_code || '') + '</span></td><td>' + esc(siteName(e.site_id)) + '</td><td class="num">' + fmt0(b.given) + '</td><td class="num">' + fmt0(b.recovered) + '</td><td class="num"><b' + (b.balance > 0 ? ' style="color:var(--warn)"' : '') + '>' + fmt0(b.balance) + '</b></td></tr>'; });
    h += '</table></div></div><div class="card"><h2 style="margin-top:0">Advances given</h2>';
    if (!S.advances.length) return h + '<p class="mut">None recorded yet.</p></div>';
    h += '<div class="scroll"><table><tr><th>Date</th><th>Employee</th><th class="num">Amount</th><th>Note</th><th></th></tr>';
    S.advances.slice().sort((a, b) => (b.given_on || '').localeCompare(a.given_on || '')).forEach((a) => { h += '<tr><td>' + (dmy(a.given_on) || 'Before the system') + '</td><td>' + esc((EMP[a.employee_id] || {}).name || '') + '</td><td class="num">' + fmt0(a.amount) + '</td><td>' + esc(a.note || '') + '</td><td>' + (isAdmin() ? '<button class="b sm danger" data-act="delAdvance" data-id="' + a.id + '" data-confirm="1">Delete</button>' : '') + '</td></tr>'; });
    return h + '</table></div></div>';
  }

  // ---------- payments ----------
  function payRunList() { return PL.filterRuns(S, UI.filter).runs.filter((r) => { const st = PL.runState(S, r); return st.total && st.paid < st.total; }); }
  function paySelected() { const open = payRunList(); return UI.payRuns ? open.filter((r) => UI.payRuns.has(r.id)) : open; }
  function vPayments() {
    const open = payRunList(), sel = paySelected(), selIds = new Set(sel.map((r) => r.id));
    let h = '<h1>Payments</h1>' + filterBar();
    if (!open.length) return h + '<div class="card">Nobody is waiting to be paid in the runs that match. Fully paid runs are not listed here.</div>';
    h += '<div class="card"><h2 style="margin-top:0">Runs to pay</h2>' + open.map((r) => '<label style="display:block"><input type="checkbox" data-chg="payRun" data-id="' + r.id + '"' + (selIds.has(r.id) ? ' checked' : '') + '> ' + esc(siteName(r.site_id)) + (r.label ? ' · ' + esc(r.label) : '') + ' · ' + period(r) + ' · still to pay ' + fmt0(PL.runTotals(S, r).pending) + '</label>').join('') + '</div>';
    const p = PL.buildPayments(S, sel.map((r) => r.id)), shared = PL.sharedAccounts(S), nShared = Object.keys(shared).length;
    h += '<div class="cards">' + stat('Ready to send', fmt0(p.totals.all), 'ok') + stat('UBL to UBL', fmt0(p.totals.UBL)) + stat('Other banks', fmt0(p.totals['Other bank'])) + stat('Wallets', fmt0(p.totals.Wallet)) + stat('Held: no account', fmt0(p.totals.missing), p.totals.missing ? 'warn' : '') + '</div>';
    h += '<p style="display:flex;gap:8px;flex-wrap:wrap;align-items:end"><button class="b pri" data-act="exportPay">Download payment list (Excel)</button><label style="font-size:12px;color:var(--mut)">Paid on<br><input type="date" id="pay-date" value="' + today() + '"></label><button class="b" data-act="markSelPaid" data-confirm="1">Mark the ' + (p.payIds.length + p.zeroIds.length) + ' employees in this list as paid</button></p>';
    if (p.missing.length) h += '<div class="banner">' + p.missing.length + ' employee(s) have no account. They are left out of the list and stay pending until you add their account.</div>';
    if (nShared) h += '<div class="banner">' + nShared + ' employee(s) use an account number that another, unlinked employee also uses: ' + esc(Object.keys(shared).map((id) => EMP[id].name).join(', ')) + '. Check Bank details before paying.</div>';
    ['UBL', 'Other bank', 'Wallet'].forEach((ch) => {
      const rows = p.rows.filter((r) => r.channel === ch);
      if (!rows.length) return;
      h += '<div class="card"><h2 style="margin-top:0">' + ({ UBL: 'UBL to UBL', 'Other bank': 'Other banks', Wallet: 'Mobile wallets' }[ch]) + ' · ' + rows.length + ' transfer(s) · ' + fmt0(p.totals[ch]) + '</h2><div class="scroll"><table><tr><th>Account title</th><th>Bank or wallet</th><th>Account</th><th class="num">Amount</th><th>Covers</th><th>Site</th></tr>';
      rows.forEach((r) => { h += '<tr><td>' + esc(r.title) + '</td><td>' + esc(r.bank) + '</td><td class="nowrap">' + esc(r.account) + '</td><td class="num"><b>' + fmt(r.amount) + '</b></td><td>' + (r.covers.length > 1 ? '<span class="pill p-inf">' + r.covers.length + ' people</span> ' : '') + esc(r.covers.join(', ')) + '</td><td>' + esc(r.sites) + '</td></tr>'; });
      h += '</table></div></div>';
    });
    if (p.missing.length) { h += '<div class="card"><h2 style="margin-top:0">Held back: no account on file (' + p.missing.length + ')</h2><div class="scroll"><table><tr><th>Code</th><th>Employee</th><th>Site</th><th class="num">Amount</th></tr>' + p.missing.map((m) => '<tr><td>' + esc(m.code || '') + '</td><td>' + esc(m.name) + (m.via ? ' <span class="mut">via ' + esc(m.via) + '</span>' : '') + '</td><td>' + esc(m.site) + '</td><td class="num">' + fmt(m.amount) + '</td></tr>').join('') + '</table></div></div>'; }
    if (p.skipped.length) h += '<div class="card"><h2 style="margin-top:0">Nothing to send: negative net</h2>' + p.skipped.map((m) => '<div>' + esc(m.name) + ' (' + esc(m.site) + '): ' + fmt(m.amount) + '</div>').join('') + '</div>';
    return h;
  }

  // ---------- sites ----------
  function vSites() {
    let h = '<h1>Sites</h1><div class="card"><h2 style="margin-top:0">Add a site or a team</h2><div class="bar" style="margin:0"><label>Name<input id="site-name"></label><label>Inside (for a team)<select id="site-parent"><option value="">None: this is a main site</option>' + sortedSites().filter((s) => !s.parent_id).map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('') + '</select></label><button class="b pri" data-act="addSite">Add</button></div></div>';
    h += '<div class="card"><div class="scroll"><table class="grid wide"><tr><th>Name</th><th>Inside</th><th class="num">Employees</th><th class="num">Runs</th><th>Status</th><th></th></tr>';
    sortedSites().forEach((s) => {
      const ne = S.employees.filter((e) => e.site_id === s.id).length, nr = S.runs.filter((r) => r.site_id === s.id).length, kids = S.sites.some((c) => c.parent_id === s.id);
      h += '<tr><td><input style="text-align:left" data-chg="site" data-id="' + s.id + '" data-f="name" value="' + esc(s.name) + '" aria-label="site name"></td><td>' + esc(s.parent_id && SITE[s.parent_id] ? SITE[s.parent_id].name : '') + '</td><td class="num">' + ne + '</td><td class="num">' + nr + '</td><td><select data-chg="site" data-id="' + s.id + '" data-f="active" aria-label="status"><option value="1"' + (s.active !== false ? ' selected' : '') + '>Open</option><option value="0"' + (s.active === false ? ' selected' : '') + '>Closed</option></select></td><td>' + (!ne && !nr && !kids ? '<button class="b sm danger" data-act="delSite" data-id="' + s.id + '" data-confirm="1">Delete</button>' : '') + '</td></tr>';
    });
    return h + '</table></div><p class="mut" style="font-size:12px">A site with employees or runs cannot be deleted; mark it Closed instead.</p></div>';
  }

  // ---------- reports ----------
  function reportRows() {
    return PL.filterRuns(S, UI.filter).runs.slice().sort((a, b) => siteName(a.site_id).localeCompare(siteName(b.site_id)) || (a.date_from || '').localeCompare(b.date_from || '')).map((r) => Object.assign({ run: r }, PL.runTotals(S, r)));
  }
  function vReports() {
    const rows = reportRows(), sum = PL.summarize(S, UI.filter), t = sum.totals;
    let h = '<h1>Reports</h1>' + filterBar() + '<p class="noprint" style="display:flex;gap:8px"><button class="b" data-act="exportReport">Download Excel</button><button class="b" data-act="print">Print or save as PDF</button></p>';
    h += '<div class="card"><h2 style="margin-top:0">Salary cost by run</h2><div class="scroll"><table><tr><th>Site</th><th>Run</th><th>Period</th><th class="num">People</th><th class="num">Gross</th><th class="num">Advance</th><th class="num">Deductions</th><th class="num">Net</th><th>Status</th></tr>';
    rows.forEach((x) => { h += '<tr><td>' + esc(siteName(x.run.site_id)) + '</td><td>' + esc(x.run.label || '') + '</td><td>' + period(x.run) + '</td><td class="num">' + x.people + '</td><td class="num">' + fmt0(x.gross) + '</td><td class="num">' + fmt0(x.advance) + '</td><td class="num">' + fmt0(x.deductions) + '</td><td class="num"><b>' + fmt0(x.net) + '</b></td><td>' + stateText(x.run) + '</td></tr>'; });
    h += '<tr class="tot"><td colspan="3">Total</td><td class="num">' + t.people + '</td><td class="num">' + fmt0(t.gross) + '</td><td class="num">' + fmt0(t.advance) + '</td><td class="num">' + fmt0(t.deductions) + '</td><td class="num">' + fmt0(t.net) + '</td><td></td></tr></table></div></div>';
    const des = {};
    S.run_lines.filter((l) => sum.runs.some((r) => r.id === l.run_id)).forEach((l) => { const k = ((EMP[l.employee_id] || {}).designation || 'Not set').trim(); const d = des[k] || (des[k] = { n: 0, net: 0 }); d.n++; d.net += PL.calcLine(l).net; });
    h += '<div class="card"><h2 style="margin-top:0">By designation</h2><div class="scroll"><table><tr><th>Designation</th><th class="num">People</th><th class="num">Net</th></tr>' + Object.keys(des).sort((a, b) => des[b].net - des[a].net).map((k) => '<tr><td>' + esc(k) + '</td><td class="num">' + des[k].n + '</td><td class="num">' + fmt0(des[k].net) + '</td></tr>').join('') + '</table></div></div>';
    return h;
  }

  // ---------- change history ----------
  const HIST_T = [['', 'Everything'], ['employees', 'Employees and bank details'], ['run_lines', 'Salary amounts and payments'], ['runs', 'Salary runs'], ['advances', 'Advances'], ['sites', 'Sites']];
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : dmy(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function histRows() {
    const q = UI.histQ.trim().toLowerCase();
    return S.changes.filter((c) => (!UI.histT || c.table_name === UI.histT) && (!q || [c.subject, c.field, c.old_value, c.new_value, c.who].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }
  function vHistory() {
    const rows = histRows();
    let h = '<h1>Change history</h1><div class="bar"><label>Search<input id="hist-q" data-inp="histQ" value="' + esc(UI.histQ) + '" placeholder="Name, code, account, user"></label><label>Show<select data-chg="ui" data-f="histT">' + HIST_T.map((o) => '<option value="' + o[0] + '"' + (UI.histT === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><button class="b" data-act="exportHistory">Download Excel</button><span class="mut">' + rows.length + ' change(s)' + (rows.length > 300 ? ', showing the latest 300' : '') + '</span></div>';
    if (!rows.length) return h + '<div class="card">No changes recorded' + (S.changes.length ? ' for this choice' : ' yet. Every edit made from now on is listed here') + '.</div>';
    h += '<div class="card"><div class="scroll"><table><tr><th>When</th><th>Who</th><th>What</th><th>Field</th><th>Before</th><th>After</th></tr>';
    rows.slice(0, 300).forEach((c) => { h += '<tr><td class="nowrap">' + when(c.at) + '</td><td>' + esc(c.who || '') + '</td><td>' + esc(c.subject || '') + '</td><td>' + esc(c.field || '') + '</td><td>' + esc(c.old_value || '') + '</td><td>' + esc(c.new_value || '') + '</td></tr>'; });
    return h + '</table></div></div>';
  }

  // ---------- backup and import ----------
  let pendingImport = null;
  async function runImport(d) {
    pendingImport = null; UI.msg = 'Loading\u2026'; render();
    try { UI.msg = await importData(d); } catch (e) { UI.msg = 'Could not load this file: ' + (e.message || e); }
    render();
  }
  function vBackup() {
    return '<h1>Backup and import</h1><div class="card"><h2 style="margin-top:0">Download a backup</h2><p>Save a copy after every salary run. The Excel file is for reading; the backup file can be loaded back into the system.</p><p style="display:flex;gap:8px;flex-wrap:wrap"><button class="b pri" data-act="backupJson">Download backup file</button><button class="b" data-act="backupXlsx">Download everything as Excel</button></p></div>' +
      '<div class="card"><h2 style="margin-top:0">Load data</h2><p>Choose the import file (<code>sterling_import.json</code>) or a backup file. Records already in the system with the same ID are updated; nothing is deleted.</p><input type="file" accept=".json,application/json" data-chg="importJson">' + (pendingImport ? '<div class="banner" style="margin-top:10px"><span><b>This file contains records that are already in the system.</b> Loading it puts them back to what the file says, so changes made since then to those employees, runs and salary lines, including paid marks, are lost.</span><button class="b danger" data-act="confirmImport">Load and overwrite</button><button class="b" data-act="cancelImport">Cancel</button></div>' : '') + '<p class="mut" id="imp-msg">' + esc(UI.msg) + '</p></div>' +
      (S.runs.length || S.advances.length ? '<div class="card"><h2 style="margin-top:0">Start fresh</h2><p>Removes every salary run, salary line and advance, so all totals and balances start from zero. Employees, sites, rates and bank details are kept. Download a backup first if you may want the old figures again.</p><button class="b danger" data-act="freshStart" data-confirm="1">Remove ' + S.runs.length + ' salary runs and ' + S.advances.length + ' advances</button></div>' : '') + 
      '<div class="card"><h2 style="margin-top:0">In the system now</h2><p>' + TABLES.map((t) => t.replace('_', ' ') + ': <b>' + S[t].length + '</b>').join(' · ') + '</p>' + (LIVE ? '' : '<p><button class="b danger" data-act="clearDemo" data-confirm="1">Erase demo data from this browser</button></p>') + '</div>';
  }
  async function importData(d) {
    const need = TABLES.filter((t) => !Array.isArray(d[t]));
    if (need.length) throw new Error('This file is missing: ' + need.join(', '));
    const pick = (o, keys) => { const r = {}; keys.forEach((k) => { r[k] = o[k] === undefined ? null : o[k]; }); return r; };
    const sites = d.sites.map((s) => Object.assign(pick(s, ['id', 'name', 'parent_id', 'sort']), { active: s.active !== false }));
    await saveMany('sites', sites.filter((s) => !s.parent_id), NOLOG); await saveMany('sites', sites.filter((s) => s.parent_id), NOLOG);
    const HRF = ['father_name', 'gender', 'cnic', 'phone', 'department', 'employment_type', 'joining_date', 'leaving_date', 'leaving_reason', 'address', 'emergency_contact'];
    const emps = d.employees.map((e) => Object.assign(pick(e, ['id', 'emp_code', 'name', 'designation', 'site_id', 'rate', 'ot_rate', 'pay_method', 'bank', 'account_no', 'account_title', 'paid_through', 'notes'].concat(HRF.filter((k) => d.employees.some((x) => x[k] !== undefined)))), { rate_type: e.rate_type || 'daily', active: e.active !== false }));
    await saveMany('employees', emps.map((e) => Object.assign({}, e, { paid_through: null })), NOLOG);
    await saveMany('employees', emps.filter((e) => e.paid_through), NOLOG);
    const runs = d.runs.map((r) => Object.assign(pick(r, ['id', 'site_id', 'label', 'date_from', 'date_to', 'paid_on', 'note']), { status: r.status || 'open' })), paidRun = {};
    runs.forEach((r) => { if (r.status === 'paid') paidRun[r.id] = r.paid_on || today(); });
    await saveMany('runs', runs, NOLOG);
    await saveMany('run_lines', d.run_lines.map((l) => { const n = pick(l, ['id', 'run_id', 'employee_id', 'days', 'rate', 'days_amount', 'ot_hours', 'ot_rate', 'ot_amount', 'allowances', 'advance', 'deductions', 'net_override', 'note', 'paid_on']); if (!n.paid_on && paidRun[n.run_id]) n.paid_on = paidRun[n.run_id]; return n; }), NOLOG);
    await saveMany('advances', d.advances.map((a) => pick(a, ['id', 'employee_id', 'given_on', 'amount', 'note'])), NOLOG);
    index(); if (!d.advances.length) await saveMany('advances', openingRows(), NOLOG);
    for (const r of runs) await syncRun(r.id);
    const msg = d.employees.length + ' employees, ' + d.runs.length + ' runs and ' + d.run_lines.length + ' salary lines loaded.';
    await pushLog([logEntry('import', null, 'File loaded', 'Many at once', '', msg)]);
    return msg;
  }

  // ---------- Excel ----------
  function xlsxOut(name, sheets) {
    if (!window.XLSX) { toast('The Excel library did not load. Check the internet connection and reload.'); return; }
    const wb = XLSX.utils.book_new();
    sheets.forEach((s) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ Note: 'No rows' }]), s.name.slice(0, 31)));
    XLSX.writeFile(wb, name);
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function lineSheetRows(runs) {
    const set = new Set(runs.map((r) => r.id));
    return S.run_lines.filter((l) => set.has(l.run_id)).map((l) => {
      const e = EMP[l.employee_id] || {}, r = RUN[l.run_id], c = PL.calcLine(l), p = PL.payeeOf(EMP, e);
      return { Site: siteName(r.site_id), Run: r.label || '', From: r.date_from || '', To: r.date_to || '', Code: e.emp_code || '', Name: e.name || '', Designation: e.designation || '', Days: l.days, 'Rate per day': l.rate, 'Days amount': c.daysAmt, 'OT hours': l.ot_hours, 'OT rate': c.otRate || '', 'OT amount': c.otAmt, Allowances: PL.num(l.allowances), Gross: c.gross, Advance: PL.num(l.advance), 'Mess / deductions': PL.num(l.deductions), 'Net to pay': c.net, 'Paid to': p.account_title || p.name || '', 'Bank or wallet': p.bank || '', Account: p.account_no || '', Status: l.paid_on ? 'Paid ' + l.paid_on : 'Pending', Note: l.note || '' };
    });
  }
  const empSheetRows = () => S.employees.map((e) => ({ 'Emp code': e.emp_code || '', Name: e.name, Site: siteName(e.site_id), Designation: e.designation || '', 'Pay method (UBL / Bank / Wallet)': e.pay_method || '', 'Bank or wallet': e.bank || '', 'Account number': e.account_no || '', 'Account title': e.account_title || '', 'Paid through (emp code)': e.paid_through && EMP[e.paid_through] ? EMP[e.paid_through].emp_code || '' : '' }));
  async function bankUpload(file) {
    if (!window.XLSX) { toast('The Excel library did not load.'); return; }
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    const byCode = {}; S.employees.forEach((e) => { if (e.emp_code) byCode[e.emp_code.trim().toUpperCase()] = e; });
    const get = (r, start) => { const k = Object.keys(r).find((x) => x.toLowerCase().replace(/\s+/g, ' ').trim().startsWith(start)); return k ? String(r[k]).trim() : ''; };
    const changed = []; let unknown = 0;
    rows.forEach((r) => {
      const e = byCode[get(r, 'emp code').toUpperCase()];
      if (!e) { if (get(r, 'emp code')) unknown++; return; }
      let m = get(r, 'pay method'); const ml = m.toLowerCase();
      m = ml.startsWith('ubl') ? 'UBL' : ml.startsWith('wallet') || ml.startsWith('mobile') ? 'Wallet' : ml ? 'Bank' : '';
      const via = byCode[get(r, 'paid through').toUpperCase()];
      const n = Object.assign({}, e, { pay_method: m, bank: strOrNull(get(r, 'bank')) || (m === 'UBL' ? 'UBL' : null), account_no: strOrNull(get(r, 'account number')), account_title: strOrNull(get(r, 'account title')), paid_through: via && via.id !== e.id ? via.id : null });
      if (['pay_method', 'bank', 'account_no', 'account_title', 'paid_through'].some((k) => (n[k] || '') !== (e[k] || ''))) changed.push(n);
    });
    await saveMany('employees', changed);
    toast(changed.length + ' employee(s) updated' + (unknown ? ', ' + unknown + ' code(s) not recognised' : '') + '.');
  }

  // ---------- page frame ----------
  // Sidebar: groups of screens. Other modules add theirs into EXT.nav.
  const ICON = {
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>', sheet: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/>', send: '<path d="M4 12l16-8-6 16-3-7z"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4"/>', bank: '<path d="M3 10l9-6 9 6M5 10v8M19 10v8M9.5 10v8M14.5 10v8M3 20h18"/>', chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 010 6M18 14c1.8.8 3 2.8 3 6"/>', pin: '<path d="M12 21s-6-5.4-6-11a6 6 0 0112 0c0 5.6-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', db: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
    live: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 000 11.4M17.7 6.3a8 8 0 010 11.4"/>', cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>', cart: '<path d="M3 4h2l2.4 11h10.2L20 8H6.3"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>', list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>', truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>', store: '<path d="M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>', check: '<path d="M5 12.5l4.5 4.5L19 7"/>'
  };
  ICON.refresh = '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>';
  // a round icon button for refreshing (keeps the word as a tooltip and for screen readers)
  const refreshBtn = (act, label) => '<button class="b ico" data-act="' + act + '" title="' + (label || 'Refresh') + '" aria-label="' + (label || 'Refresh') + '">' + icon('refresh') + '</button>';
  const icon = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || ICON.grid) + '</svg>';
  const NAV = [
    ['Overview', [['dashboard', 'Payroll dashboard', 'grid']]],
    ['Payroll', [['runs', 'Salary runs', 'sheet'], ['payments', 'Payments', 'send'], ['advances', 'Advances', 'coin'], ['bank', 'Bank details', 'bank'], ['reports', 'Reports', 'chart']]],
    ['People', [['employees', 'Employees', 'users']]],
    ['Administration', [['sites', 'Sites', 'pin'], ['history', 'Change history', 'clock'], ['backup', 'Backup and import', 'db']]]
  ];
  const ROLE_VIEWS = { owner: ['dashboard', 'runs', 'advances', 'reports', 'history', 'payslip'], accountant: ['dashboard', 'runs', 'payslip', 'payments', 'advances', 'bank', 'reports', 'employees', 'sites', 'history'], hr: ['employees'], procurement: [] };
  const ROLE_NAME = { admin: 'Admin', accountant: 'Accountant', owner: 'Owner', hr: 'HR', procurement: 'Procurement', site: 'Site attendance' };
  const VIEWS = { dashboard: vDashboard, runs: vRuns, employees: vEmployees, bank: vBank, advances: vAdvances, payments: vPayments, sites: vSites, reports: vReports, history: vHistory, payslip: vPayslip, backup: vBackup };
  const allowed = (v) => !!(VIEWS[v] || EXT.views[v]) && (isSys() || (ROLE_VIEWS[UI.role] || []).concat(EXT.roleViews[UI.role] || []).includes(v));
  const homeView = () => (UI.role === 'hr' ? 'attlive' : UI.role === 'procurement' ? 'proc' : 'dashboard');
  function navHtml() {
    const groups = NAV.map((g) => [g[0], g[1].slice()]);
    EXT.nav.forEach((n) => { const g = groups.find((x) => x[0] === n.group) || (groups.push([n.group, []]), groups[groups.length - 1]); if (n.first) g[1].unshift(n.item); else g[1].push(n.item); });
    return groups.map((g) => {
      const items = g[1].filter((n) => allowed(n[0]));
      if (!items.length) return '';
      return '<div class="nav-g">' + g[0] + '</div>' + items.map((n) => '<button data-act="nav" data-v="' + n[0] + '"' + (UI.view === n[0] || (UI.view === 'payslip' && n[0] === 'runs') ? ' class="on"' : '') + '>' + icon(n[2]) + '<span>' + n[1] + '</span></button>').join('');
    }).join('');
  }
  // Keep the screen where it was after a redraw: the item last clicked stays at the same place on screen,
  // and boxes with their own scroll (wide tables, the attendance grid) keep their position.
  let lastEl = null;
  ['pointerdown', 'change', 'keydown'].forEach((t) => document.addEventListener(t, (ev) => { if (ev.target && ev.target.closest) lastEl = ev.target.closest('[id],[data-act],[data-chg],[data-inp],[data-it],[data-f]') || ev.target; }, true));
  function anchorOf(el) {
    if (!el || !el.isConnected) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const keys = ['act', 'chg', 'inp', 'id', 'st', 'day', 'emp', 'f', 'i', 't', 'd', 'v'].filter((k) => el.dataset[k] !== undefined);
    if (!keys.length) return null;
    return keys.map((k) => '[data-' + k + '="' + CSS.escape(el.dataset[k]) + '"]').join('');
  }
  function paint(html) {
    const app = $('#app'), sel = anchorOf(lastEl), top = sel && lastEl.isConnected ? lastEl.getBoundingClientRect().top : null;
    const boxes = Array.from(app.querySelectorAll('.scroll,.reg-wrap,.sa-chips')).map((b) => [b.scrollLeft, b.scrollTop]);
    const sideEl = app.querySelector('.side'), sideY = sideEl ? sideEl.scrollTop : 0; // the menu keeps its place
    const y = window.scrollY;
    app.innerHTML = html;
    window.scrollTo(0, y);
    const side2 = app.querySelector('.side'); if (side2 && sideY) side2.scrollTop = sideY;
    Array.from(app.querySelectorAll('.scroll,.reg-wrap,.sa-chips')).forEach((b, i) => { if (boxes[i]) { b.scrollLeft = boxes[i][0]; b.scrollTop = boxes[i][1]; } });
    if (sel && top !== null) { let now = null; try { now = app.querySelector(sel); } catch (e) { /* odd selector: keep the page scroll */ } if (now) { const d = now.getBoundingClientRect().top - top; if (Math.abs(d) > 1) window.scrollBy(0, d); lastEl = now; } }
  }
  function render() {
    index();
    if (UI.role === 'site' && EXT.siteApp) { paint(EXT.siteApp()); return; }
    if (!allowed(UI.view)) UI.view = allowed(homeView()) ? homeView() : 'dashboard';
    const initials = (UI.name || UI.user || 'D').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    const meTag = allowed('profile') ? 'button class="me" data-act="nav" data-v="profile" title="My profile and status"' : 'div class="me"';
    const meBox = '<' + meTag + '>' + (EXT.avatar ? EXT.avatar(initials) : '<span class="av">' + esc(initials) + '</span>') + '<div class="me-t"><div class="who" title="' + esc(UI.user || UI.name || '') + '">' + esc(UI.name || UI.user || (LIVE ? '' : 'Demo user')) + '</div><div class="me-sub"><span class="role">' + (ROLE_NAME[UI.role] || UI.role) + '</span>' + (EXT.statusLine ? EXT.statusLine() : '') + '</div></div></' + meTag.split(' ')[0] + '>';
    const who = LIVE ? meBox + '<div class="foot-row"><button data-act="changePw">Change password</button><button class="ico" data-act="refresh" title="Refresh data" aria-label="Refresh data">' + icon('refresh') + '</button></div><button data-act="logout">Sign out</button>' : meBox + '<span class="role">Demo mode</span>';
    let h = '<div class="shell"><nav class="side" data-version="' + VERSION + '"><div class="brand"><img src="logo.jpg" alt=""><span>Sterling Engineering<small>Payroll · HR · Attendance</small></span></div><div class="nav">' + navHtml() + '</div><div class="foot">' + who + '</div></nav><div class="scrim" data-act="toggleNav"></div><main class="main"><header class="mtop"><button class="hamb" data-act="toggleNav" aria-label="Menu">\u2630</button><img src="logo.jpg" alt=""><b>Sterling Engineering</b></header>';
    if (!LIVE) h += '<div class="banner"><span><b>Demo mode.</b> Data is kept only in this browser until the system is connected to the database.</span><span class="right">View as <select data-chg="role">' + Object.keys(ROLE_NAME).map((r) => '<option value="' + r + '"' + (UI.role === r ? ' selected' : '') + '>' + ROLE_NAME[r] + '</option>').join('') + '</select></span></div>';
    if (UI.schemaOld && !isSys()) h += '<div class="banner" style="background:var(--bad-bg);color:var(--bad)"><b>Sorry for the inconvenience.</b> Some parts of the system are being updated and may not work yet. Please contact the developer.</div>';
    if (UI.schemaOld && isSys()) h += '<div class="banner" style="background:var(--bad-bg);color:var(--bad)"><b>The database needs an update.</b> Run 1_database_setup.sql again in Supabase, SQL Editor, then reload this page. Until then, saving will fail. Your data is kept.</div>';
    h += (VIEWS[UI.view] || EXT.views[UI.view])() + '</main></div>';
    const ae = document.activeElement, af = ae && ae.dataset && ae.dataset.inp ? ae.id : '';
    paint(h);
    if (af) { const el = document.getElementById(af); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  }
  const authPage = (inner) => '<div class="auth"><div class="auth-brand"><img src="logo.jpg" alt="Sterling Engineering and Construction"><h1>Sterling Engineering<br>and Construction</h1><p>Payroll, HR and site attendance</p></div><div class="auth-form"><div class="auth-box">' + inner + '</div></div></div>';
  function renderLogin(msg, email, good) {
    $('#app').innerHTML = authPage('<h2>Sign in</h2><p class="mut" style="margin:0 0 18px">Use the email and password the company gave you.</p>' +
      '<label>Email<input id="lg-email" type="email" autocomplete="username" value="' + esc(email || '') + '" placeholder="name@company.com"></label>' +
      '<label>Password<span class="pw"><input id="lg-pass" type="password" autocomplete="current-password"><button type="button" class="link" data-act="togglePw">Show</button></span></label>' +
      '<p class="auth-err' + (good ? ' good' : '') + '" role="alert">' + esc(msg || '') + '</p><button class="b pri" id="lg-btn" data-act="login">Sign in</button>' +
      '<p style="margin:16px 0 0;text-align:center"><button type="button" class="link" data-act="forgot">Forgot password?</button></p>' +
      '<p class="mut" style="font-size:12px;margin:18px 0 0;text-align:center">This system is for company staff only.</p>');
    const f = $(email ? '#lg-pass' : '#lg-email'); if (f) f.focus();
  }
  function renderForgot(msg, email, sent) {
    $('#app').innerHTML = authPage('<h2>Reset your password</h2>' + (sent
      ? '<p class="auth-err good" role="status" style="margin:10px 0 18px">' + esc(msg) + '</p><p class="mut" style="font-size:13px">The link opens this page and asks for a new password. It works once and expires after a short time. Check the spam folder if it does not arrive in a few minutes.</p><button class="b pri" data-act="backToLogin">Back to sign in</button>'
      : '<p class="mut" style="margin:0 0 18px">Enter your email. We will send you a link to choose a new password.</p><label>Email<input id="fp-email" type="email" autocomplete="username" value="' + esc(email || '') + '" placeholder="name@company.com"></label><p class="auth-err" role="alert">' + esc(msg || '') + '</p><button class="b pri" id="fp-btn" data-act="sendReset">Send reset link</button><p style="margin:16px 0 0;text-align:center"><button type="button" class="link" data-act="backToLogin">Back to sign in</button></p>'));
    const f = $('#fp-email'); if (f) f.focus();
  }
  // Shown after opening the emailed link, and from "Change password" in the menu.
  function renderNewPassword(msg) {
    $('#app').innerHTML = authPage('<h2>' + (recovering ? 'Choose a new password' : 'Change password') + '</h2><p class="mut" style="margin:0 0 18px">' + (UI.user ? 'For ' + esc(UI.user) + '. ' : '') + 'Use at least 8 characters.</p>' +
      '<label>New password<span class="pw"><input id="np-1" type="password" autocomplete="new-password"><button type="button" class="link" data-act="togglePw2">Show</button></span></label><label>Repeat new password<input id="np-2" type="password" autocomplete="new-password"></label>' +
      '<p class="auth-err" role="alert">' + esc(msg || '') + '</p><button class="b pri" id="np-btn" data-act="savePw">Save new password</button>' +
      '<p style="margin:16px 0 0;text-align:center"><button type="button" class="link" data-act="cancelPw">' + (recovering ? 'Cancel and sign out' : 'Cancel') + '</button></p>');
    $('#np-1').focus();
  }

  // ---------- actions ----------
  const A = {
    nav(el) { if (window.innerWidth < 821) document.body.classList.remove('nav-open'); UI.view = el.dataset.v; UI.prId = null; UI.prDraft = null; UI.prTab = null; UI.pqEdit = null; UI.poId = null; UI.poRecv = false; UI.supEdit = null; UI.runId = null; UI.empId = null; UI.newRun = false; UI.msg = ''; UI.advQ = ''; UI.advEmp = null; render(); window.scrollTo(0, 0); },
    toggleNav() { document.body.classList.toggle('nav-open'); },
    sorryRetry() { location.reload(); },
    clearFilter() { UI.filter = { siteId: '', from: '', to: '' }; UI.payRuns = null; render(); },
    pickSite(el) { if (SITE[el.dataset.id]) { UI.filter.siteId = el.dataset.id; UI.payRuns = null; render(); } },
    openRun(el) { UI.view = 'runs'; UI.runId = el.dataset.id; render(); window.scrollTo(0, 0); },
    closeRun() { UI.runId = null; render(); },
    newRun() { UI.newRun = true; render(); }, cancelNewRun() { UI.newRun = false; render(); },
    async delRun() { if (PL.runState(S, RUN[UI.runId]).paid) return toast('This run has paid employees. Reopen them first if you really want to delete it.'); await remove('runs', UI.runId); UI.runId = null; render(); toast('Run deleted.'); },
    exportRun() { const r = RUN[UI.runId]; xlsxOut('Salary ' + siteName(r.site_id).replace(/[^\w ]/g, '') + ' ' + (r.date_from || r.label || '') + '.xlsx', [{ name: 'Salary', rows: lineSheetRows([r]) }]); },
    async addLine() { const id = $('#add-emp').value; if (!id) return toast('Choose an employee.'); await save('run_lines', newLine(RUN[UI.runId], EMP[id])); render(); },
    async addAllLines() { const r = RUN[UI.runId], inRun = new Set(S.run_lines.filter((l) => l.run_id === r.id).map((l) => l.employee_id)); await saveMany('run_lines', S.employees.filter((e) => e.site_id === r.site_id && e.active !== false && !inRun.has(e.id)).map((e) => newLine(r, e)), { summary: 'Remaining employees of the site added', subject: 'Run: ' + runLabel(r) }); render(); },
    async delLine(el) { await remove('run_lines', el.dataset.id); render(); },
    suggestCode() {
      const f = $('#emp-form'), box = f.querySelector('[name=emp_code]'), site = SITE[f.querySelector('[name=site_id]').value];
      const others = { employees: S.employees.filter((e) => e.id !== UI.empId) };
      box.value = PL.nextEmpCode(others, site); box.dataset.auto = box.value;
    },
    async freshStart() {
      const runs = S.runs.length, lines = S.run_lines.length, advs = S.advances.length;
      for (const r of S.runs.slice()) await remove('runs', r.id, NOLOG);
      for (const a of S.advances.slice()) await remove('advances', a.id, NOLOG);
      await pushLog([logEntry('runs', null, 'Fresh start', 'Many at once', '', runs + ' salary runs with ' + lines + ' salary lines and ' + advs + ' advances removed. Employees, sites and bank details kept.')]);
      UI.runId = null; UI.payRuns = null; UI.filter = { siteId: '', from: '', to: '' }; render(); toast('Done. Salary runs and advances are empty; everything now starts from zero.');
    },
    newEmp() { UI.empId = 'new'; render(); window.scrollTo(0, 0); }, cancelEmp() { UI.empId = null; render(); },
    editEmp(el) { UI.empId = el.dataset.id; render(); window.scrollTo(0, 0); },
    editEmpFrom(el) { UI.view = 'employees'; UI.empShow = 'all'; UI.empId = el.dataset.id; render(); window.scrollTo(0, 0); },
    async saveEmp() {
      if (!canHR()) return;
      const f = $('#emp-form'), box = (n) => f.querySelector('[name=' + n + ']'), v = (n) => (box(n) ? box(n).value : undefined), isNew = UI.empId === 'new';
      if (!v('name').trim()) return toast('Enter a name.');
      const cnic = (v('cnic') || '').trim();
      if (cnic && !/^\d{5}-?\d{7}-?\d$/.test(cnic)) return toast('CNIC should be 13 digits, like 35202-1234567-1.');
      const base = isNew ? { id: uuid(), rate_type: 'daily' } : EMP[UI.empId];
      const e = Object.assign({}, base, { emp_code: strOrNull(v('emp_code')), name: v('name').trim(), designation: strOrNull(v('designation')), site_id: v('site_id') || null, active: v('active') === '1' });
      ['father_name', 'gender', 'cnic', 'phone', 'department', 'employment_type', 'joining_date', 'leaving_date', 'leaving_reason', 'address', 'emergency_contact', 'notes'].forEach((k) => { if (box(k)) e[k] = strOrNull(v(k)); });
      if (cnic && /^\d{13}$/.test(cnic)) e.cnic = cnic.slice(0, 5) + '-' + cnic.slice(5, 12) + '-' + cnic.slice(12);
      if (isAdmin()) Object.assign(e, { rate_type: v('rate_type'), rate: numOrNull(v('rate')), ot_rate: numOrNull(v('ot_rate')), paid_through: v('paid_through') || null, pay_method: v('pay_method'), bank: strOrNull(v('bank')) || (v('pay_method') === 'UBL' ? 'UBL' : null), account_no: strOrNull(v('account_no')), account_title: strOrNull(v('account_title')) });
      if (e.paid_through && PL.paidThroughLoops(EMP, e.id, e.paid_through)) return toast('That would pay him through someone who is paid through him. Choose another person.');
      const dupe = e.emp_code && S.employees.find((x) => x.id !== e.id && x.emp_code === e.emp_code);
      const dupeCnic = e.cnic && S.employees.find((x) => x.id !== e.id && x.cnic === e.cnic);
      await save('employees', e); UI.empId = null; render();
      const iss = isAdmin() ? bankCheck(EMP[e.id]) : '';
      toast('Saved.' + (dupe ? ' Note: code ' + e.emp_code + ' is also used by ' + dupe.name + '.' : '') + (dupeCnic ? ' Note: CNIC ' + e.cnic + ' is also on ' + dupeCnic.name + '.' : '') + (iss ? ' Check: ' + iss + '.' : ''));
    },
    async delEmp() {
      const id = UI.empId;
      if (S.run_lines.some((l) => l.employee_id === id) || S.advances.some((a) => a.employee_id === id) || S.employees.some((e) => e.paid_through === id)) return toast('He has salary history or receives pay for others, so he cannot be deleted. Set his status to Left instead.');
      await remove('employees', id); UI.empId = null; render(); toast('Employee deleted.');
    },
    bankTemplate() { xlsxOut('Sterling bank details.xlsx', [{ name: 'Bank details', rows: empSheetRows() }]); },
    async addAdvance() {
      const only = UI.advEmp ? [] : advMatches();
      const emp = UI.advEmp || (only.length === 1 ? only[0].id : ''), amt = numOrNull($('#adv-amt').value);
      if (!emp) return toast((UI.advQ || '').trim() ? 'Pick the employee from the list under the search box.' : 'Search for the employee first.');
      if (!amt || amt <= 0) return toast('Enter an amount above zero.');
      const rows = [], bal = PL.num(ADV[emp]);
      // More was recovered from him in salary sheets than was ever recorded as given: record that older advance first.
      if (bal < -0.005) rows.push({ id: uuid(), employee_id: emp, given_on: null, amount: PL.r2(-bal), note: 'Opening balance: given before the system started' });
      rows.push({ id: uuid(), employee_id: emp, given_on: $('#adv-date').value || today(), amount: amt, note: strOrNull($('#adv-note').value) });
      await saveMany('advances', rows); UI.advQ = ''; UI.advEmp = null; render();
      toast('Advance saved. ' + EMP[emp].name + ' now owes ' + fmt0(ADV[emp]) + '. See the dashboard, and Deduct under his Advance box in a salary run.');
    },
    pickAdvEmp(el) {
      const e = EMP[el.dataset.id]; if (!e) return;
      UI.advEmp = e.id; UI.advQ = e.name + (e.emp_code ? ' (' + e.emp_code + ')' : '');
      $('#adv-q').value = UI.advQ; $('#adv-results').innerHTML = advResults(); $('#adv-amt').focus();
    },
    async openingAdv() {
      const rows = openingRows(); if (!rows.length) return;
      await saveMany('advances', rows, { summary: rows.length + ' opening advances recorded, ' + fmt0(rows.reduce((t, r) => t + r.amount, 0)) + ' in total', subject: 'Advances' });
      render(); toast(rows.length + ' opening advance(s) recorded.');
    },
    async delAdvance(el) { await remove('advances', el.dataset.id); render(); },
    exportPay() {
      const sel = paySelected(), p = PL.buildPayments(S, sel.map((r) => r.id));
      const rows = (ch) => p.rows.filter((r) => r.channel === ch).map((r, i) => ({ Sr: i + 1, 'Account title': r.title, 'Bank or wallet': r.bank, 'Account number': r.account, 'Amount (PKR)': r.amount, Covers: r.covers.join(', '), Site: r.sites }));
      xlsxOut('Sterling payments ' + today() + '.xlsx', [{ name: 'UBL to UBL', rows: rows('UBL') }, { name: 'Other banks', rows: rows('Other bank') }, { name: 'Wallets', rows: rows('Wallet') }, { name: 'No account', rows: p.missing.map((m) => ({ Code: m.code, Employee: m.name, Site: m.site, 'Amount (PKR)': m.amount })) }, { name: 'Detail', rows: lineSheetRows(sel) }]);
    },
    async addSite() { const name = $('#site-name').value.trim(); if (!name) return toast('Enter a name.'); await save('sites', { id: uuid(), name: name, parent_id: $('#site-parent').value || null, active: true, sort: S.sites.reduce((m, s) => Math.max(m, PL.num(s.sort)), 0) + 1 }); render(); },
    async delSite(el) { await remove('sites', el.dataset.id); render(); },
    exportReport() { const runs = PL.filterRuns(S, UI.filter).runs; xlsxOut('Sterling report ' + today() + '.xlsx', [{ name: 'By run', rows: reportRows().map((x) => ({ Site: siteName(x.run.site_id), Run: x.run.label || '', From: x.run.date_from || '', To: x.run.date_to || '', People: x.people, Gross: x.gross, Advance: x.advance, Deductions: x.deductions, Net: x.net, Paid: x.paid, 'Still to pay': x.pending, Status: stateText(x.run) })) }, { name: 'Detail', rows: lineSheetRows(runs) }]); },
    print() { window.print(); },
    showAllEmp() { UI.empAll = true; render(); },
    showAllBank() { UI.bankAll = true; render(); },
    forgot() { const e = $('#lg-email'); renderForgot('', e ? e.value.trim() : ''); },
    backToLogin() { const e = $('#fp-email'); renderLogin('', e ? e.value.trim() : ''); },
    async sendReset() {
      const email = $('#fp-email').value.trim(), btn = $('#fp-btn');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return renderForgot('Enter your email address.', email);
      if (location.protocol === 'file:') return renderForgot('Password reset by email needs the system to be opened from its web address, not from a file on this computer. Ask the administrator to set a new password for you.', email);
      btn.disabled = true; btn.textContent = 'Sending\u2026';
      let res;
      try { res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); }
      catch (e) { return renderForgot('Could not reach the server. Check the internet connection and try again.', email); }
      if (res.error) return renderForgot(/rate|limit|seconds/i.test(res.error.message || '') ? 'Too many requests. Wait a few minutes and try again.' : 'Could not send the link: ' + res.error.message, email);
      renderForgot('If ' + email + ' has an account, a reset link is on its way.', email, true); // same message either way, so nobody can test which emails exist
    },
    changePw() { recovering = false; renderNewPassword(); },
    togglePw2(el) { const b = $('#np-1'), c = $('#np-2'); b.type = c.type = b.type === 'password' ? 'text' : 'password'; el.textContent = b.type === 'password' ? 'Show' : 'Hide'; },
    async savePw() {
      const a = $('#np-1').value, b2 = $('#np-2').value, btn = $('#np-btn');
      if (a.length < 8) return renderNewPassword('Use at least 8 characters.');
      if (a !== b2) return renderNewPassword('The two passwords are not the same.');
      btn.disabled = true; btn.textContent = 'Saving\u2026';
      let res;
      try { res = await sb.auth.updateUser({ password: a }); }
      catch (e) { return renderNewPassword('Could not reach the server. Check the internet connection and try again.'); }
      if (res.error) return renderNewPassword(/same|different/i.test(res.error.message || '') ? 'Choose a password that is different from the old one.' : /session|expired|jwt/i.test(res.error.message || '') ? 'This link has expired. Go back and ask for a new one.' : 'Could not save: ' + res.error.message);
      const wasRecovery = recovering; recovering = false;
      if (location.hash || location.search) history.replaceState(null, '', location.pathname);
      if (wasRecovery) await startLive(); else render();
      toast('Password changed.');
    },
    async cancelPw() {
      if (!recovering) return render();
      recovering = false; if (location.hash || location.search) history.replaceState(null, '', location.pathname);
      await sb.auth.signOut(); UI.user = null; renderLogin();
    },
    togglePw(el) { const b = $('#lg-pass'); b.type = b.type === 'password' ? 'text' : 'password'; el.textContent = b.type === 'password' ? 'Show' : 'Hide'; b.focus(); },
    async confirmImport() { if (pendingImport) await runImport(pendingImport); },
    cancelImport() { pendingImport = null; render(); },
    async refresh() { await refreshData(); },
    backupJson() { download('sterling_backup_' + today() + '.json', JSON.stringify(Object.assign({ version: 1, saved: new Date().toISOString() }, S)), 'application/json'); },
    backupXlsx() { xlsxOut('Sterling payroll ' + today() + '.xlsx', [{ name: 'Salary lines', rows: lineSheetRows(S.runs) }, { name: 'Employees', rows: empSheetRows() }, { name: 'Advances', rows: S.advances.map((a) => ({ Date: a.given_on, Employee: (EMP[a.employee_id] || {}).name || '', Amount: a.amount, Note: a.note || '' })) }]); },
    clearDemo() { TABLES.concat(['changes']).forEach((t) => { S[t] = []; }); persistLocal(); render(); toast('Demo data erased.'); },
    async login() {
      const email = $('#lg-email').value.trim(), pass = $('#lg-pass').value, btn = $('#lg-btn');
      if (!email || !pass) return renderLogin('Enter your email and password.', email);
      btn.disabled = true; btn.textContent = 'Signing in\u2026';
      let res;
      try { res = await sb.auth.signInWithPassword({ email: email, password: pass }); }
      catch (e) { return renderLogin('Could not reach the server. Check the internet connection and try again.', email); }
      if (res.error) return renderLogin(/invalid|credentials/i.test(res.error.message || '') ? 'Wrong email or password.' : 'Could not sign in: ' + res.error.message, email);
      await startLive();
    },
    async logout() { if (EXT.onLogout) EXT.onLogout(); await sb.auth.signOut(); UI.user = null; UI.name = ''; UI.view = 'dashboard'; TABLES.concat(['changes']).forEach((t) => { S[t] = []; }); renderLogin(); }
  };
  const C = {
    filter(el) { UI.filter[el.dataset.f] = el.value; UI.payRuns = null; render(); },
    ui(el) { UI[el.dataset.f] = el.value; render(); },
    role(el) { UI.role = el.value; if (EXT.onRole) EXT.onRole(); render(); },
    async run(el) { const r = RUN[UI.runId]; const p = save('runs', Object.assign({}, r, { [el.dataset.f]: strOrNull(el.value) })); const rr = RUN[UI.runId], box = $('#run-sum'), ad = $('#all-val'); if (box && rr) box.innerHTML = runSummaryHtml(rr); if (ad && rr) ad.placeholder = UI.allField === 'days' ? periodDays(rr) : ''; await p; },
    async line(el) {
      const l = S.run_lines.find((x) => x.id === el.dataset.id), f = el.dataset.f; if (!l) return;
      if (PL.linePaid(l)) { toast('This employee is marked paid. Untick Paid to change the line.'); render(); return; }
      const val = f === 'note' ? strOrNull(el.value) : numOrNull(el.value);
      if (f !== 'note' && el.value.trim() !== '' && val === null) { toast('That is not a number.'); el.value = PL.has(l[f]) ? l[f] : ''; return; }
      const n = Object.assign({}, l, { [f]: val });
      if (f === 'rate' && PL.has(l.ot_rate) && PL.r2(l.ot_rate) === PL.autoOtRate(l.rate)) n.ot_rate = null; // it was the automatic rate, so it follows
      const p = save('run_lines', n);
      const tr = $('#ln-' + n.id), c = PL.calcLine(n);
      if (tr) {
        const ob = tr.querySelector('[data-f=ot_rate]'), auto = PL.autoOtRate(n.rate);
        if (ob) { ob.placeholder = PL.has(auto) ? fmt(auto) : ''; if (!PL.has(n.ot_rate) && document.activeElement !== ob) ob.value = ''; ob.classList.toggle('typed', PL.has(n.ot_rate) && PL.has(auto)); }
        tr.querySelector('[data-f=days_amount]').placeholder = fmt(c.daysCalc); tr.querySelector('[data-f=ot_amount]').placeholder = fmt(c.otCalc); tr.querySelector('[data-f=net_override]').placeholder = fmt(c.netCalc);
        tr.querySelector('[data-cell=gross]').textContent = fmt(c.gross);
        tr.querySelector('[data-cell=net]').innerHTML = '<b' + (c.net < 0 ? ' style="color:var(--bad)"' : '') + '>' + fmt(c.net) + '</b>';
      }
      if (tr) ['days_amount', 'ot_amount', 'net_override'].forEach((k) => tr.querySelector('[data-f=' + k + ']').classList.toggle('typed', PL.has(n[k])));
      const ah = $('#adv-' + n.id); if (ah) ah.innerHTML = advHint(n, false);
      const box = $('#run-sum'); if (box && RUN[UI.runId]) box.innerHTML = runSummaryHtml(RUN[UI.runId]);
      const hint = (f === 'days' || f === 'rate') && PL.has(n.days_amount) ? 'Days amount' : (f === 'ot_hours' || f === 'ot_rate') && PL.has(n.ot_amount) ? 'OT amount' : f !== 'net_override' && f !== 'note' && PL.has(n.net_override) ? 'Net' : '';
      if (hint) toast(hint + ' for this employee is typed by hand, so it did not change. Clear the yellow box to use the calculation.');
      await p;
    },
    async bank(el) {
      const e = EMP[el.dataset.id], f = el.dataset.f, n = Object.assign({}, e, { [f]: f === 'pay_method' ? el.value : strOrNull(el.value) });
      if (f === 'pay_method') { // UBL fills the bank name; leaving UBL clears a bank name that only said UBL
        if (el.value === 'UBL') n.bank = 'UBL'; else if ((e.bank || '').trim().toUpperCase() === 'UBL') n.bank = null;
        const box = el.closest('tr').querySelector('[data-f=bank]'); if (box) box.value = n.bank || '';
      }
      const p = save('employees', n); const c = $('#iss-' + n.id); if (c) c.textContent = bankCheck(n); await p;
    },
    async bankUpload(el) { if (el.files[0]) { await bankUpload(el.files[0]); render(); } },
    async site(el) { const s = SITE[el.dataset.id], f = el.dataset.f; if (f === 'name' && !el.value.trim()) { el.value = s.name; return; } await save('sites', Object.assign({}, s, { [f]: f === 'active' ? el.value === '1' : el.value.trim() })); toast('Saved.'); },
    payRun(el) { const open = payRunList(); if (!UI.payRuns) UI.payRuns = new Set(open.map((r) => r.id)); if (el.checked) UI.payRuns.add(el.dataset.id); else UI.payRuns.delete(el.dataset.id); render(); },
    async importJson(el) {
      if (!el.files[0]) return;
      let d;
      try { d = JSON.parse(await el.files[0].text()); const need = TABLES.filter((t) => !Array.isArray(d[t])); if (need.length) throw new Error('it is missing ' + need.join(', ')); }
      catch (e) { UI.msg = 'Could not load this file: ' + (e.message || e); pendingImport = null; return render(); }
      const clash = TABLES.reduce((n, t) => { const ids = new Set(S[t].map((x) => x.id)); return n + d[t].filter((x) => ids.has(x.id)).length; }, 0);
      if (clash) { pendingImport = d; UI.msg = ''; return render(); }
      await runImport(d);
    }
  };

  // ---------- actions added for part payment, copying, payslips and history ----------
  Object.assign(A, {
    async createRun() {
      const site = $('#nr-site').value; if (!site) return toast('Add a site first.');
      const run = { id: uuid(), site_id: site, label: strOrNull($('#nr-label').value), date_from: $('#nr-from').value || null, date_to: $('#nr-to').value || null, status: 'open', paid_on: null, note: null };
      const start = $('#nr-start').value, prev = start === 'copy' ? PL.lastRun(S, site, run.id) : null, lines = [], seen = new Set();
      if (prev) S.run_lines.filter((l) => l.run_id === prev.id).forEach((l) => {
        const e = EMP[l.employee_id]; if (!e || e.active === false || seen.has(e.id)) return;
        seen.add(e.id);
        const n = newLine(run, e);
        if (PL.has(l.rate)) n.rate = l.rate;
        if (PL.has(l.ot_rate) && PL.r2(l.ot_rate) !== PL.autoOtRate(n.rate)) n.ot_rate = l.ot_rate;
        if (!PL.has(l.rate) && PL.has(l.days_amount)) n.days_amount = l.days_amount;
        n.allowances = l.allowances; n.deductions = l.deductions;
        lines.push(n);
      });
      if (start !== 'empty') S.employees.filter((e) => e.site_id === site && e.active !== false && !seen.has(e.id)).forEach((e) => lines.push(newLine(run, e)));
      await save('runs', run);
      await saveMany('run_lines', lines, { summary: lines.length + ' employees added' + (prev ? ', copied from ' + runLabel(prev) : ''), subject: 'Run: ' + runLabel(run) });
      UI.newRun = false; UI.runId = run.id; render();
      if (start === 'copy') toast(prev ? 'Copied from ' + runLabel(prev) + '.' : 'There is no earlier run for this site, so all working employees were added.');
    },
    async markAllPaid() {
      const d = $('#paid-on').value || today(), r = RUN[UI.runId], rows = S.run_lines.filter((l) => l.run_id === r.id && !PL.linePaid(l)).map((l) => Object.assign({}, l, { paid_on: d }));
      await saveMany('run_lines', rows, rows.length > 10 ? { summary: rows.length + ' employees marked paid on ' + dmy(d), subject: 'Run: ' + runLabel(r) } : undefined);
      await syncRun(r.id); render();
    },
    async reopenAll() {
      const r = RUN[UI.runId], rows = S.run_lines.filter((l) => l.run_id === r.id && PL.linePaid(l)).map((l) => Object.assign({}, l, { paid_on: null }));
      await saveMany('run_lines', rows, rows.length > 10 ? { summary: rows.length + ' employees set back to unpaid', subject: 'Run: ' + runLabel(r) } : undefined);
      await syncRun(r.id); render();
    },
    async applyAll() {
      const f = $('#all-field').value, box = $('#all-val'), v = numOrNull(box.value !== '' ? box.value : box.placeholder), onlyEmpty = $('#all-empty').checked, name = (APPLY_FIELDS.find((o) => o[0] === f) || [f, f])[1];
      if (v === null || v < 0) return toast('Enter a value first.');
      const rows = S.run_lines.filter((l) => l.run_id === UI.runId && !PL.linePaid(l) && (!onlyEmpty || !PL.has(l[f])) && l[f] !== v).map((l) => Object.assign({}, l, { [f]: v }));
      if (!rows.length) return toast('Nothing to change.');
      await saveMany('run_lines', rows, rows.length > 10 ? { summary: name + ' set to ' + v + ' for ' + rows.length + ' employees', subject: 'Run: ' + runLabel(RUN[UI.runId]) } : undefined);
      render(); toast(name + ' set to ' + v + ' for ' + rows.length + ' employee(s).');
    },
    async deductAdv(el) {
      const l = S.run_lines.find((x) => x.id === el.dataset.id); if (!l || PL.linePaid(l)) return;
      const owed = PL.num(ADV[l.employee_id]), room = Math.max(0, PL.calcLine(l).netCalc), take = PL.r2(Math.min(owed, room));
      if (owed <= 0) return toast('Nothing is owed.');
      if (take <= 0) return toast('There is no pay left in this run to deduct from. Enter the days first.');
      await save('run_lines', Object.assign({}, l, { advance: PL.r2(PL.num(l.advance) + take) }));
      render();
      toast('Deducted ' + fmt0(take) + '.' + (owed - take > 0.005 ? ' ' + fmt0(owed - take) + ' is still owed, because the pay in this run does not cover it.' : ' Nothing more is owed.') + (PL.has(l.net_override) ? ' Net for this employee is typed by hand, so clear the yellow box for it to change.' : ''));
    },
    slip(el) { UI.slip = { runId: UI.runId, lineId: el.dataset.id || null }; UI.view = 'payslip'; render(); window.scrollTo(0, 0); },
    slipBack() { UI.view = 'runs'; render(); },
    async markSelPaid() {
      const d = $('#pay-date').value || today(), sel = paySelected(), p = PL.buildPayments(S, sel.map((r) => r.id)), ids = new Set(p.payIds.concat(p.zeroIds));
      const rows = S.run_lines.filter((l) => ids.has(l.id)).map((l) => Object.assign({}, l, { paid_on: d }));
      if (!rows.length) return toast('Nobody in this list can be paid yet.');
      await saveMany('run_lines', rows, rows.length > 10 ? { summary: rows.length + ' employees marked paid on ' + dmy(d), subject: sel.map((r) => siteName(r.site_id)).join(', ') } : undefined);
      for (const r of sel) await syncRun(r.id);
      UI.payRuns = null; render(); toast(rows.length + ' employee(s) marked as paid.' + (p.missing.length ? ' ' + p.missing.length + ' without an account stay pending.' : ''));
    },
    exportHistory() { xlsxOut('Sterling change history ' + today() + '.xlsx', [{ name: 'Changes', rows: histRows().map((c) => ({ When: when(c.at), Who: c.who || '', What: c.subject || '', Field: c.field || '', Before: c.old_value || '', After: c.new_value || '' })) }]); }
  });
  Object.assign(C, {
    // Choosing UBL as the pay method fills the bank name, so it is not typed twice.
    empFormMethod(el) {
      const box = $('#emp-form [name=bank]'); if (!box) return;
      if (el.value === 'UBL') box.value = 'UBL'; else if (box.value.trim().toUpperCase() === 'UBL') box.value = '';
    },
    // New employee: the code follows the chosen site until you type your own.
    empFormSite(el) {
      const box = $('#emp-form [name=emp_code]');
      if (UI.empId === 'new' && box && (box.value.trim() === '' || box.value === box.dataset.auto)) { box.value = PL.nextEmpCode(S, SITE[el.value]); box.dataset.auto = box.value; }
    },
    allField(el) { UI.allField = el.value; const b = $('#all-val'); if (b) b.placeholder = el.value === 'days' && RUN[UI.runId] ? periodDays(RUN[UI.runId]) : ''; },
    async linePaid(el) {
      const l = S.run_lines.find((x) => x.id === el.dataset.id); if (!l) return;
      const box = $('#paid-on');
      await save('run_lines', Object.assign({}, l, { paid_on: el.checked ? ((box && box.value) || today()) : null }));
      await syncRun(l.run_id); render();
    }
  });

  const ADMIN_ONLY = new Set(['pickAdvEmp', 'freshStart', 'confirmImport', 'deductAdv', 'openingAdv', 'createRun', 'markAllPaid', 'reopenAll', 'applyAll', 'delRun', 'addLine', 'addAllLines', 'delLine', 'delEmp', 'addAdvance', 'delAdvance', 'markSelPaid', 'addSite', 'delSite', 'clearDemo']);
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]'); if (!el || !A[el.dataset.act]) return;
    if (ADMIN_ONLY.has(el.dataset.act) && !isAdmin()) return;
    if (EXT.actAllowed[el.dataset.act] && !EXT.actAllowed[el.dataset.act]()) return;
    if (el.dataset.confirm === '1') { el.dataset.confirm = '2'; el.dataset.label = el.textContent; el.textContent = 'Click again to confirm'; setTimeout(() => { if (el.isConnected) { el.dataset.confirm = '1'; el.textContent = el.dataset.label; } }, 4000); return; }
    Promise.resolve().then(() => A[el.dataset.act](el)).catch(fail);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-chg]'); if (!el || !C[el.dataset.chg]) return;
    const hrOk = canHR() && ['empFormSite', 'empFormMethod'].includes(el.dataset.chg), extOk = EXT.chgAllowed[el.dataset.chg] && EXT.chgAllowed[el.dataset.chg]();
    if (!isAdmin() && !hrOk && !extOk && !['filter', 'ui', 'role'].includes(el.dataset.chg)) return;
    Promise.resolve().then(() => C[el.dataset.chg](el)).catch(fail);
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-inp]'); if (!el) return;
    UI[el.dataset.inp] = el.value;
    // the advance search only redraws its own list, so a date, amount or note already typed is kept
    if (el.dataset.inp === 'advQ') { UI.advEmp = null; $('#adv-results').innerHTML = advResults(); return; }
    render();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ev.target.id === 'adv-q') { UI.advQ = ''; UI.advEmp = null; ev.target.value = ''; $('#adv-results').innerHTML = ''; return; }
    if (ev.key !== 'Enter') return;
    if (ev.target.id === 'adv-q') { const first = $('#adv-results [data-act=pickAdvEmp]'); if (first) first.click(); }
    if (ev.target.id === 'adv-amt' || ev.target.id === 'adv-note') { Promise.resolve().then(() => A.addAdvance()).catch(fail); }
    if (ev.target.id === 'lg-pass' || ev.target.id === 'lg-email') A.login().catch(fail);
    if (ev.target.id === 'fp-email') A.sendReset().catch(fail);
    if (ev.target.id === 'np-1' || ev.target.id === 'np-2') A.savePw().catch(fail); });

  // Keep screens in step: another tab of this browser, or coming back to the page after a while.
  window.addEventListener('storage', (ev) => { if (!LIVE && ev.key === KEY && !typing()) refreshData(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 5000) autoRefresh(true); });
  if (bc) bc.onmessage = () => { autoRefresh(true); };
  if (LIVE) setInterval(autoRefresh, Math.max(1, Number(cfg.refreshSeconds) || 45) * 1000);

  // ---------- interface for other modules ----------
  window.SEC = { S, UI, PL, EXT, A, C, LIVE, cfg, get sb() { return sb; }, $, esc, fmt, fmt0, dmy, uuid, today, toast, fail, numOrNull, strOrNull, save, saveMany, remove, render, index, siteName, siteOptions, sortedSites, leafSites, stat, xlsxOut, download, isAdmin, isSys, isHR, canHR, icon, refreshBtn, typing, refreshData, get EMP() { return EMP; }, get SITE() { return SITE; }, get RUN() { return RUN; }, startApp: () => start().catch((e) => { console.error(e); sorry(e && e.message ? e.message : e, !!(sb && UI.user)); }) };

  // ---------- start ----------
  let recovering = false;
  async function startLive() {
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return renderLogin();
    UI.user = data.session.user.email;
    if (recovering) return renderNewPassword();
    let prof = await sb.from('profiles').select('role,name,site_ids,active').eq('id', data.session.user.id).maybeSingle();
    if (prof.error) prof = await sb.from('profiles').select('role,name').eq('id', data.session.user.id).maybeSingle(); // database not updated yet
    if (prof.error || !prof.data || prof.data.active === false) return sorry(prof.error ? prof.error.message : !prof.data ? 'No role has been given to ' + UI.user + '.' : 'The login ' + UI.user + ' is blocked.', true);
    UI.role = ROLE_NAME[prof.data.role] ? prof.data.role : 'owner';
    // the person's name from the database; the setup's placeholder names count as not set
    const nm = (prof.data.name || '').trim(); UI.name = nm && !/^(accountant|owner)$/i.test(nm) ? nm : '';
    if (UI.role === 'site') { $('#app').innerHTML = '<p style="padding:24px">Loading today’s list…</p>'; await Promise.all(EXT.loaders.map((f) => f())); render(); return; }
    if (!allowed(UI.view)) UI.view = homeView();
    const chk = await Promise.all([sb.from('run_lines').select('paid_on').range(0, 0), sb.from('changes').select('id').range(0, 0), sb.from('attendance').select('id').range(0, 0)]);
    UI.schemaOld = chk.some((c) => c.error);
    $('#app').innerHTML = '<p style="padding:24px">Loading data…</p>';
    await loadLive(); lastLoad = Date.now();
    const fix = normalizePaid(); if (fix.length && isAdmin()) await saveMany('run_lines', fix, NOLOG).catch((e) => console.error(e));
    render();
  }
  async function start() {
    if (LIVE) {
      if (!window.supabase) return sorry('The database library could not be downloaded on this network.', false);
      // A link from a password-reset email carries its details in the address; read them before the library clears them.
      const link = location.hash + '&' + location.search;
      const linkError = /error_code=otp_expired|error=access_denied/.test(link);
      recovering = !linkError && /type=recovery/.test(link);
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      sb.auth.onAuthStateChange((event, session) => { if (event === 'PASSWORD_RECOVERY') { recovering = true; UI.user = session && session.user ? session.user.email : UI.user; setTimeout(() => renderNewPassword(), 0); } });
      if (linkError) { history.replaceState(null, '', location.pathname); await sb.auth.signOut().catch(() => {}); PL.setCache(true); return renderLogin('That reset link has expired or was already used. Ask for a new one with "Forgot password?".'); }
      PL.setCache(true);
      await startLive();
    } else { PL.setCache(true); loadLocal(); if (normalizePaid().length) persistLocal(); await Promise.all(EXT.loaders.map((f) => f())); render(); }
  }
  // hr.js loads after this file and starts the app once its screens are registered.
  if (!window.SEC_WAIT_FOR_MODULES) window.SEC.startApp();
})();
