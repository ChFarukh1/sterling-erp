// Sterling: HR, site attendance, letters, and users and access. Loads after app.js.
(function () {
  'use strict';
  const X = window.SEC;
  const { S, UI, PL, EXT, A, C, LIVE, $, esc, fmt0, dmy, uuid, toast, numOrNull, strOrNull } = X;
  const HKEY = 'sterling_hr_demo_v1';
  const ATT_ST = { P: 'Present', H: 'Half day', A: 'Absent', L: 'Leave', OT: 'Overtime' };
  // days a mark counts for in salary: half day is half a day
  const DAY_VAL = { P: 1, OT: 1, H: 0.5 };
  const MON_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ---------- dates in Pakistan time ----------
  const pkFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' });
  const pkDay = (d) => pkFmt.format(d || new Date());
  const pkTime = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
  const pkStamp = (iso) => (iso ? dmy(pkDay(new Date(iso))) + ', ' + pkTime(iso) : '');
  const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayList = (a, b) => { const out = []; for (let d = a; d <= b && out.length < 62; d = addDays(d, 1)) out.push(d); return out; };
  const wkday = (day, style) => new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: style || 'long', timeZone: 'UTC' });
  const longDate = (day) => { if (!day) return ''; const p = day.split('-'); return Number(p[2]) + ' ' + MON_L[Number(p[1]) - 1] + ' ' + p[0]; };
  const canHR = () => X.canHR();
  const staffRole = () => ['admin', 'owner', 'hr'].includes(UI.role);
  const who = () => UI.name || UI.user || 'Demo user';

  // ---------- demo store (used when the system is not connected to the database) ----------
  const H = { att: [], log: [], letters: [], users: [], settings: { site_same_day_edit: true, signatory: { name: 'Sidra Usman', title: 'HR Manager' } } };
  function loadDemo() { try { const d = JSON.parse(localStorage.getItem(HKEY) || 'null'); if (d) Object.keys(H).forEach((k) => { if (d[k] !== undefined) H[k] = d[k]; }); } catch (e) { /* start empty */ } }
  function saveDemo() { if (LIVE) return; try { localStorage.setItem(HKEY, JSON.stringify(H)); } catch (e) { toast('This browser could not store the demo data.'); } }

  // Settings and letters, shared by every screen
  const M = { settings: { site_same_day_edit: true, signatory: { name: 'Sidra Usman', title: 'HR Manager' } }, letters: [] };

  // ---------- data access: Supabase when live, the demo store otherwise ----------
  const sb = () => X.sb;
  const check = (r) => { if (r.error) throw r.error; return r.data; };
  async function pageAll(q) {
    let out = [], n = 0;
    for (;;) { const rows = check(await q().range(n * 1000, n * 1000 + 999)); out = out.concat(rows); if (rows.length < 1000) return out; n++; }
  }
  function demoLog(row, old, action) {
    H.log.unshift({ id: H.log.length + 1, at: new Date().toISOString(), who: who(), employee_id: row.employee_id, day: row.day, action: action, old_status: old ? old.status : null, new_status: action === 'Cleared' ? null : row.status, old_ot: old ? old.ot_hours : null, new_ot: action === 'Cleared' ? null : row.ot_hours, source: row.source || 'hr' });
    H.log = H.log.slice(0, 2000);
  }
  const DB = {
    async meta() {
      if (!staffRole()) return;
      if (!LIVE) { M.settings = H.settings; M.letters = H.letters; return; }
      const [st, lt] = await Promise.all([sb().from('app_settings').select('*'), sb().from('hr_letters').select('*').order('created_at', { ascending: false }).range(0, 1999)]);
      if (!st.error) st.data.forEach((r) => { M.settings[r.key] = r.value; });
      if (!lt.error) M.letters = lt.data;
    },
    async attRange(from, to) {
      if (!LIVE) return H.att.filter((a) => a.day >= from && a.day <= to);
      return pageAll(() => sb().from('attendance').select('*').gte('day', from).lte('day', to).order('id'));
    },
    async attLog(day) {
      if (!LIVE) return H.log.filter((l) => !day || l.day === day).slice(0, 25);
      let q = sb().from('attendance_log').select('*').order('at', { ascending: false }).limit(25);
      if (day) q = q.eq('day', day);
      return check(await q);
    },
    async attStamp() { if (!LIVE) return null; const r = await sb().from('sync_state').select('stamp').eq('id', 2).maybeSingle(); return r.data ? r.data.stamp : null; },
    // HR sets or clears marks for any day. rows: {employee_id, day, status|null, ot_hours}
    async attSet(rows) {
      const now = new Date().toISOString();
      const full = rows.map((r) => { const e = X.EMP[r.employee_id] || {}; return { employee_id: r.employee_id, day: r.day, status: r.status, ot_hours: r.status === 'OT' ? r.ot_hours : null, site_id: r.site_id || e.site_id || null, source: 'hr', marked_by_name: who(), marked_at: now }; });
      const put = full.filter((r) => r.status), del = full.filter((r) => !r.status);
      if (!LIVE) {
        put.forEach((r) => { const i = H.att.findIndex((a) => a.employee_id === r.employee_id && a.day === r.day), old = i >= 0 ? H.att[i] : null; const n = Object.assign({ id: old ? old.id : uuid() }, r); if (old) H.att[i] = n; else H.att.push(n); demoLog(n, old, old ? 'Changed' : 'Marked'); });
        del.forEach((r) => { const old = H.att.find((a) => a.employee_id === r.employee_id && a.day === r.day); if (old) { H.att = H.att.filter((a) => a !== old); demoLog(old, old, 'Cleared'); } });
        saveDemo(); return;
      }
      for (let i = 0; i < put.length; i += 300) check(await sb().from('attendance').upsert(put.slice(i, i + 300), { onConflict: 'employee_id,day' }));
      for (const r of del) check(await sb().from('attendance').delete().eq('employee_id', r.employee_id).eq('day', r.day));
    },
    async siteToday() {
      if (LIVE) { const r = await sb().rpc('att_today'); return check(r); }
      const d = pkDay(), ids = new Set(); (UI.demoSites || []).forEach((id) => PL.siteIdsUnder(S.sites, id).forEach((x) => ids.add(x)));
      const emps = S.employees.filter((e) => e.active !== false && ids.has(e.site_id)).sort((a, b) => (a.emp_code || '').localeCompare(b.emp_code || '', undefined, { numeric: true }));
      const set = new Set(emps.map((e) => e.id));
      return { day: d, server_time: new Date().toISOString(), name: 'Demo site login', same_day_edit: H.settings.site_same_day_edit !== false, sites: X.sortedSites().filter((s) => ids.has(s.id)).map((s) => ({ id: s.id, name: s.name, parent_id: s.parent_id })), employees: emps.map((e) => ({ id: e.id, emp_code: e.emp_code, name: e.name, designation: e.designation, site_id: e.site_id })), marks: H.att.filter((a) => a.day === d && set.has(a.employee_id)) };
    },
    // Site login marks today. The database applies the same rules as here, so they cannot be skipped.
    async siteMark(marks) {
      if (LIVE) return check(await sb().rpc('att_mark', { p_marks: marks }));
      const t = await DB.siteToday(), mine = new Set(t.employees.map((e) => e.id)), same = H.settings.site_same_day_edit !== false;
      let n = 0;
      marks.forEach((m) => {
        const st = String(m.status || '').toUpperCase(), ot = st === 'OT' ? numOrNull(m.ot_hours) : null, e = X.EMP[m.employee_id];
        if (!ATT_ST[st]) throw new Error('Unknown mark "' + st + '"');
        if (st === 'OT' && (!ot || ot <= 0 || ot > 16)) throw new Error('Enter overtime hours from 0.5 to 16');
        if (!e || !mine.has(e.id)) throw new Error('This employee is not on your site');
        const i = H.att.findIndex((a) => a.employee_id === e.id && a.day === t.day), cur = i >= 0 ? H.att[i] : null;
        if (cur) {
          if (cur.status === st && (cur.ot_hours || null) === (ot || null)) return;
          if (cur.source === 'hr') throw new Error('HR has set today\'s attendance for ' + e.name + '. Ask HR to change it.');
          if (!same) throw new Error('Attendance for ' + e.name + ' is already marked and locked. Ask HR to change it.');
        }
        const row = { id: cur ? cur.id : uuid(), employee_id: e.id, site_id: e.site_id, day: t.day, status: st, ot_hours: ot, marked_by_name: 'Demo site login', marked_at: new Date().toISOString(), source: 'site' };
        if (cur) H.att[i] = row; else H.att.push(row);
        demoLog(row, cur, cur ? 'Changed' : 'Marked'); n++;
      });
      saveDemo(); return n;
    },
    async saveSetting(key, value) {
      M.settings[key] = value;
      if (!LIVE) { H.settings[key] = value; saveDemo(); return; }
      check(await sb().from('app_settings').upsert({ key: key, value: value }));
    },
    async saveLetter(row) {
      M.letters.unshift(row);
      if (!LIVE) { H.letters = M.letters; saveDemo(); return; }
      try { const c = Object.assign({}, row); delete c.created_by; check(await sb().from('hr_letters').insert(c)); }
      catch (e) { M.letters = M.letters.filter((x) => x.id !== row.id); throw e; }
    },
    async staff() {
      if (!LIVE) { if (!H.users.length) H.users = [['haroon.iftikhar@sterlingengineering.pk', 'Haroon Iftikhar', 'admin'], ['salik@sterlingengineering.pk', 'Salik', 'owner'], ['yaseenwasif509@gmail.com', 'Muhammad Wasif', 'accountant'], ['farhan.ali@sterlingengineering.pk', 'Farhan Ali', 'procurement'], ['hr@sterlingengineering.pk', 'HR', 'hr'], ['pepsico.site@sterlingengineering.pk', null, null]].map(([email, name, role]) => ({ id: uuid(), email: email, name: name, role: role, site_ids: [], active: !!role })); return H.users; }
      return check(await sb().rpc('staff_list'));
    },
    async setStaff(u) {
      if (!LIVE) { const i = H.users.findIndex((x) => x.id === u.id); H.users[i] = Object.assign({}, H.users[i], u); saveDemo(); return; }
      check(await sb().rpc('staff_set', { p_user: u.id, p_role: u.role, p_name: u.name || '', p_site_ids: u.site_ids || [], p_active: u.active !== false }));
    }
  };

  // ---------- attendance cache for the open screen ----------
  const ATT = { key: '', rows: [], log: [], loading: false, at: null, err: '', stale: false };
  function attFor(from, to, withLog) {
    const key = from + '|' + to + (withLog ? '|log' : '');
    if (ATT.key === key && !ATT.stale) return ATT.rows;
    if (ATT.key === key) { if (!ATT.loading) loadAtt(from, to, withLog, key); return ATT.rows; } // show what we have while fresh marks load
    if (!ATT.loading) loadAtt(from, to, withLog, key);
    return null;
  }
  async function loadAtt(from, to, withLog, key) {
    ATT.loading = true; ATT.err = '';
    try {
      const [rows, log] = await Promise.all([DB.attRange(from, to), withLog ? DB.attLog(from === to ? from : null) : Promise.resolve([])]);
      ATT.rows = rows; ATT.log = log; ATT.key = key; ATT.at = new Date(); ATT.stale = false;
    } catch (e) { console.error(e); ATT.err = e.message || String(e); ATT.key = key; ATT.rows = []; }
    finally { ATT.loading = false; }
    if (['attlive', 'attsheet'].includes(UI.view) && !X.typing()) X.render();
  }
  const reloadAtt = () => { ATT.stale = true; if (['attlive', 'attsheet'].includes(UI.view) && !X.typing()) X.render(); };
  const markMap = (rows, day) => { const m = {}; rows.forEach((a) => { if (!day || a.day === day) m[a.employee_id] = a; }); return m; };

  // ---------- live updates ----------
  let chan = null, lastAttStamp = null, bumpTimer = null;
  function bump() { clearTimeout(bumpTimer); bumpTimer = setTimeout(() => { ATT.stale = true; if (!['attlive', 'attsheet'].includes(UI.view)) return; if (X.typing()) return bump(); X.render(); }, 700); }
  function subscribe() {
    if (!LIVE || chan || !staffRole() || !sb()) return;
    try { chan = sb().channel('attendance-live').on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, bump).subscribe((st) => { UI.attRealtime = st === 'SUBSCRIBED'; }); } catch (e) { console.error(e); }
  }
  // Fallback when live updates are blocked by the network: check the attendance marker every 20 seconds.
  setInterval(async () => {
    if (!LIVE || !staffRole() || document.hidden || !['attlive', 'attsheet'].includes(UI.view)) return;
    try { const st = await DB.attStamp(); if (st && lastAttStamp && st !== lastAttStamp) bump(); lastAttStamp = st; } catch (e) { /* try again later */ }
  }, 20000);
  // Site login: refresh the list every minute, so HR changes and new people show up.
  setInterval(() => { if (UI.role === 'site' && !document.hidden && !X.typing() && !SA.busy) siteLoad(true); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && UI.role === 'site') siteLoad(true); });

  // ---------- shared pieces ----------
  const pill = (st, ot) => (st ? '<span class="att a-' + st + '">' + (st === 'OT' ? 'OT' + (ot ? ' ' + PL.r2(ot) + 'h' : '') : st) + '</span>' : '<span class="att a-none">Not marked</span>');
  function rosterBySite(day, marks) {
    // working employees grouped by their own site or team
    const out = {};
    S.employees.forEach((e) => {
      if (e.active === false && !marks[e.id]) return;
      if (e.joining_date && e.joining_date > day) return;
      const k = e.site_id || 'none', r = out[k] || (out[k] = { siteId: k, people: [], P: 0, H: 0, A: 0, L: 0, OT: 0, otH: 0, marked: 0, last: null, by: new Set() });
      r.people.push(e);
      const m = marks[e.id];
      if (m) { r[m.status]++; r.marked++; if (m.status === 'OT') r.otH += PL.num(m.ot_hours); if (!r.last || m.marked_at > r.last) r.last = m.marked_at; if (m.marked_by_name) r.by.add(m.marked_by_name); }
    });
    return out;
  }
  const meter = (n, d) => '<div class="meter"><i style="width:' + (d ? Math.round(n / d * 100) : 0) + '%"></i></div>';
  const pageHead = (title, sub, right) => '<div class="page-h"><div><h1>' + title + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (right ? '<div class="page-r">' + right + '</div>' : '') + '</div>';
  const liveTag = () => '<span class="live"><i></i>' + (LIVE ? 'Live' : 'Demo') + (ATT.at ? ' · updated ' + ATT.at.toLocaleTimeString('en-GB') : '') + '</span>';

  // HR buttons to set one employee's mark for a day
  function hrMarkCtl(empId, day, m) {
    const on = (s) => (m && m.status === s ? ' on' : '');
    return '<span class="mk">' + ['P', 'H', 'A', 'L'].map((s) => '<button class="mkb m-' + s + on(s) + '" data-act="hrMark" data-emp="' + empId + '" data-day="' + day + '" data-st="' + s + '" title="' + ATT_ST[s] + '">' + s + '</button>').join('') +
      '<input class="oth" id="ot-' + empId + '-' + day + '" inputmode="decimal" placeholder="hrs" value="' + (m && m.status === 'OT' ? esc(m.ot_hours) : '') + '" aria-label="overtime hours"><button class="mkb m-OT' + on('OT') + '" data-act="hrMark" data-emp="' + empId + '" data-day="' + day + '" data-st="OT" title="Overtime: type the hours first">OT</button>' +
      (m ? '<button class="mkb m-x" data-act="hrMark" data-emp="' + empId + '" data-day="' + day + '" data-st="" title="Clear this mark">Clear</button>' : '') + '</span>';
  }

  // ---------- Live attendance ----------
  function vAttLive() {
    const day = UI.attDay || (UI.attDay = pkDay()), today = pkDay();
    const rows = attFor(day, day, true);
    let h = pageHead('Live attendance', day === today ? 'Today, ' + wkday(day) + ' ' + dmy(day) + '. Marks from every site appear here as they come in.' : wkday(day) + ' ' + dmy(day), liveTag());
    h += '<div class="bar"><label>Day<input type="date" data-chg="attDay" value="' + esc(day) + '" max="' + today + '"></label>' + (day !== today ? '<button class="b" data-act="attToday">Back to today</button>' : '') + X.refreshBtn('attReload', 'Refresh now') + '</div>';
    if (ATT.err) h += '<div class="banner" style="background:var(--bad-bg);color:var(--bad)">Could not load attendance: ' + esc(ATT.err) + '. If the database was just updated, run 1_database_setup.sql again.</div>';
    if (!rows) return h + '<div class="card"><p class="mut">Loading attendance…</p></div>';
    const marks = markMap(rows, day), by = rosterBySite(day, marks), groups = Object.values(by);
    const t = groups.reduce((a, g) => { ['P', 'H', 'A', 'L', 'OT', 'otH', 'marked'].forEach((k) => { a[k] += g[k]; }); a.people += g.people.length; return a; }, { P: 0, H: 0, A: 0, L: 0, OT: 0, otH: 0, marked: 0, people: 0 });
    h += '<div class="cards kpi">' + X.stat('Workforce', fmt0(t.people)) + X.stat('Marked', t.marked + '<small class="kx">' + (t.people ? Math.round(t.marked / t.people * 100) : 0) + '%</small>') + X.stat('Present', t.P + t.OT, 'ok') + X.stat('Half day', t.H) + X.stat('Absent', t.A, t.A ? 'bad' : '') + X.stat('On leave', t.L) + X.stat('Not marked yet', t.people - t.marked, t.people - t.marked ? 'warn' : '') + X.stat('Overtime hours', PL.r2(t.otH)) + '</div>';
    const order = X.sortedSites().map((s) => s.id).concat(['none']);
    groups.sort((a, b) => order.indexOf(a.siteId) - order.indexOf(b.siteId));
    h += '<div class="card"><div class="card-h"><h2>By site</h2><span class="mut">Click a site to see each person' + (canHR() ? ' and correct marks' : '') + '.</span></div><div class="scroll"><table><tr><th>Site</th><th>Taken by</th><th class="num">People</th><th class="num">Present</th><th class="num">OT</th><th class="num">Half day</th><th class="num">Absent</th><th class="num">Leave</th><th class="num">Not marked</th><th style="width:16%">Progress</th><th>Last mark</th></tr>';
    groups.forEach((g) => {
      const left = g.people.length - g.marked;
      h += '<tr class="click' + (UI.attSite === g.siteId ? ' sel' : '') + '" data-act="attSite" data-id="' + g.siteId + '"><td><b>' + esc(g.siteId === 'none' ? 'No site' : X.siteName(g.siteId)) + '</b></td><td>' + esc(Array.from(g.by).join(', ')) + '</td><td class="num">' + g.people.length + '</td><td class="num">' + (g.P + g.OT) + '</td><td class="num">' + (g.OT ? g.OT + ' <small class="kx">' + PL.r2(g.otH) + 'h</small>' : '0') + '</td><td class="num">' + g.H + '</td><td class="num">' + g.A + '</td><td class="num">' + g.L + '</td><td class="num">' + (left ? '<span class="pill p-warn">' + left + '</span>' : '<span class="pill p-ok">All done</span>') + '</td><td>' + meter(g.marked, g.people.length) + '</td><td class="nowrap">' + (g.last ? pkTime(g.last) : '<span class="mut">None yet</span>') + '</td></tr>';
    });
    h += '<tr class="tot"><td>Total</td><td></td><td class="num">' + t.people + '</td><td class="num">' + (t.P + t.OT) + '</td><td class="num">' + t.OT + '</td><td class="num">' + t.H + '</td><td class="num">' + t.A + '</td><td class="num">' + t.L + '</td><td class="num">' + (t.people - t.marked) + '</td><td>' + meter(t.marked, t.people) + '</td><td></td></tr></table></div></div>';
    const g = UI.attSite && by[UI.attSite];
    if (g) {
      const list = g.people.slice().sort((a, b) => (marks[a.id] ? 1 : 0) - (marks[b.id] ? 1 : 0) || (a.emp_code || '').localeCompare(b.emp_code || '', undefined, { numeric: true }));
      const notMarked = list.filter((e) => !marks[e.id]).length;
      h += '<div class="card" id="att-detail"><div class="card-h"><h2>' + esc(g.siteId === 'none' ? 'No site' : X.siteName(g.siteId)) + ' · ' + dmy(day) + '</h2>' + (canHR() && notMarked ? '<button class="b" data-act="hrAllP" data-id="' + g.siteId + '" data-confirm="1">Mark the ' + notMarked + ' not marked as Present</button>' : '') + '<button class="b sm" data-act="attSite" data-id="">Close</button></div>';
      h += '<div class="scroll"><table><tr><th>Code</th><th>Employee</th><th>Mark</th><th>Marked at</th><th>By</th>' + (canHR() ? '<th>Set by HR</th>' : '') + '</tr>';
      list.forEach((e) => { const m = marks[e.id]; h += '<tr><td class="nowrap">' + esc(e.emp_code || '') + '</td><td>' + esc(e.name) + '<small>' + esc(e.designation || '') + '</small></td><td>' + pill(m && m.status, m && m.ot_hours) + '</td><td class="nowrap">' + (m ? pkTime(m.marked_at) : '') + '</td><td>' + (m ? esc(m.marked_by_name || '') + (m.source === 'hr' ? ' <span class="pill p-inf">HR</span>' : '') : '') + '</td>' + (canHR() ? '<td>' + hrMarkCtl(e.id, day, m) + '</td>' : '') + '</tr>'; });
      h += '</table></div></div>';
    }
    h += '<div class="card"><div class="card-h"><h2>Activity' + (day === today ? ' today' : '') + '</h2><span class="mut">Every mark and correction, recorded by the database.</span></div>';
    if (!ATT.log.length) h += '<p class="mut">Nothing marked yet.</p>';
    else h += '<div class="feed">' + ATT.log.map((l) => { const e = X.EMP[l.employee_id] || {}; return '<div class="fi"><span class="ft">' + pkTime(l.at) + '</span><span><b>' + esc(e.name || 'Unknown') + '</b> <span class="mut">' + esc(e.emp_code || '') + ' · ' + esc(X.siteName(e.site_id)) + '</span></span><span>' + (l.action === 'Changed' ? pill(l.old_status, l.old_ot) + ' → ' : '') + (l.action === 'Cleared' ? pill(l.old_status, l.old_ot) + ' cleared' : pill(l.new_status, l.new_ot)) + '</span><span class="mut">' + esc(l.who || '') + (l.day !== day ? ' · for ' + dmy(l.day) : '') + '</span></div>'; }).join('') + '</div>';
    return h + '</div>';
  }

  // ---------- Attendance register ----------
  // HR settings, shown on the HR pages (attendance rules on the register, signatory on letters)
  function rulesCard() {
    if (!canHR()) return '';
    let h = '';
    const same = M.settings.site_same_day_edit !== false;
    h += '<div class="card"><h2 style="margin-top:0">Attendance rules</h2><label class="chk"><input type="checkbox" data-chg="setSameDay"' + (same ? ' checked' : '') + '> Site logins can correct their own marks until midnight (Pakistan time)</label><p class="mut" style="font-size:13px;margin:6px 0 0">' + (same ? 'A site login can change a mark during the same day. From the next day the day is locked for him; only HR can change it.' : 'A mark is locked as soon as it is saved. Only HR can change it.') + ' Site logins can never mark a past or future day.</p></div>';
    return h;
  }
  function sigCard() {
    if (!canHR()) return '';
    const sig = M.settings.signatory || {};
    let h = '';
    h += '<div class="card"><h2 style="margin-top:0">Letter signatory</h2><div class="bar" style="margin:0"><label>Name<input id="sig-name" value="' + esc(sig.name || '') + '"></label><label>Title<input id="sig-title" value="' + esc(sig.title || '') + '"></label><button class="b" data-act="sigSave">Save</button></div></div>';
    return h;
  }
  const vAttSheet = () => vAttSheetBody() + rulesCard();
  function vAttSheetBody() {
    const today = pkDay();
    const leaves = X.leafSites();
    if (!UI.regSite || !X.SITE[UI.regSite]) UI.regSite = (leaves.find((s) => S.employees.some((e) => e.site_id === s.id && e.active !== false)) || leaves[0] || {}).id || '';
    if (!UI.regFrom) { UI.regFrom = today.slice(0, 8) + '01'; UI.regTo = today; }
    const from = UI.regFrom, to = UI.regTo < UI.regFrom ? UI.regFrom : UI.regTo, days = dayList(from, to);
    let h = pageHead('Attendance register', 'One row per person, one column per day. This is what salary runs read for days and overtime.', liveTag());
    h += '<div class="bar"><label>Site<select data-chg="regSet" data-f="regSite">' + X.siteOptions(UI.regSite, null) + '</select></label><label>From<input type="date" data-chg="regSet" data-f="regFrom" value="' + esc(from) + '"></label><label>To<input type="date" data-chg="regSet" data-f="regTo" value="' + esc(to) + '"></label>' +
      '<button class="b" data-act="regMonth" data-m="0">This month</button><button class="b" data-act="regMonth" data-m="-1">Last month</button><button class="b" data-act="regExport">Download Excel</button></div>';
    if (dayList(from, to).length >= 62) h += '<div class="banner">Showing the first 62 days. Choose a shorter period to see the rest.</div>';
    if (!UI.regSite) return h + '<div class="card">Add a site first.</div>';
    const rows = attFor(from, to, false);
    if (ATT.err) h += '<div class="banner" style="background:var(--bad-bg);color:var(--bad)">Could not load attendance: ' + esc(ATT.err) + '</div>';
    if (!rows) return h + '<div class="card"><p class="mut">Loading attendance…</p></div>';
    const reg = regData(rows, days);
    if (UI.regEdit) {
      const e = X.EMP[UI.regEdit.emp], m = reg.cell[UI.regEdit.emp + '|' + UI.regEdit.day];
      if (e) h += '<div class="card editbar"><div><b>' + esc(e.name) + '</b> <span class="mut">' + esc(e.emp_code || '') + '</span><br>' + wkday(UI.regEdit.day) + ' ' + dmy(UI.regEdit.day) + ' · now ' + pill(m && m.status, m && m.ot_hours) + (m ? ' <span class="mut">by ' + esc(m.marked_by_name || '') + ' at ' + pkStamp(m.marked_at) + '</span>' : '') + '</div>' + hrMarkCtl(e.id, UI.regEdit.day, m) + '<button class="b sm" data-act="regEditClose">Close</button></div>';
    }
    h += '<div class="card"><div class="legend"><span>' + pill('P') + ' Present</span><span>' + pill('H') + ' Half day</span><span>' + pill('A') + ' Absent</span><span>' + pill('L') + ' Leave</span><span><span class="att a-OT">4</span> Overtime hours</span><span><span class="att a-none">·</span> Not marked</span>' + (canHR() ? '<span class="mut">Click a day to change it.</span>' : '') + '</div>';
    if (!reg.people.length) return h + '<p class="mut">Nobody works at this site in this period.</p></div>';
    h += '<div class="scroll reg-wrap"><table class="reg"><thead><tr><th class="rc">Code</th><th class="rn">Employee</th>' + days.map((d) => '<th class="d' + (wkday(d, 'short') === 'Sun' ? ' sun' : '') + (d === today ? ' tdy' : '') + '"><span>' + wkday(d, 'narrow') + '</span>' + Number(d.slice(8)) + '</th>').join('') + '<th class="num">Days</th><th class="num">A</th><th class="num">L</th><th class="num">OT h</th></tr></thead><tbody>';
    reg.people.forEach((e) => {
      const t = reg.tot[e.id];
      h += '<tr><td class="rc">' + esc(e.emp_code || '') + '</td><td class="rn">' + esc(e.name) + (e.site_id !== UI.regSite && !PL.siteIdsUnder(S.sites, UI.regSite).has(e.site_id) ? ' <small>now at ' + esc(X.siteName(e.site_id)) + '</small>' : '') + '</td>' +
        days.map((d) => { const m = reg.cell[e.id + '|' + d], ed = canHR() && d <= today; return '<td class="d' + (wkday(d, 'short') === 'Sun' ? ' sun' : '') + (UI.regEdit && UI.regEdit.emp === e.id && UI.regEdit.day === d ? ' cur' : '') + '"' + (ed ? ' data-act="regEdit" data-emp="' + e.id + '" data-day="' + d + '"' : '') + '>' + (m ? '<span class="att a-' + m.status + '">' + (m.status === 'OT' ? PL.r2(m.ot_hours) : m.status) + '</span>' : d <= today ? '<span class="att a-none">·</span>' : '') + '</td>'; }).join('') +
        '<td class="num"><b>' + t.days + '</b></td><td class="num">' + (t.A || '') + '</td><td class="num">' + (t.L || '') + '</td><td class="num">' + (t.ot ? PL.r2(t.ot) : '') + '</td></tr>';
    });
    const all = reg.people.reduce((a, e) => { const t = reg.tot[e.id]; a.days += t.days; a.A += t.A; a.L += t.L; a.ot += t.ot; return a; }, { days: 0, A: 0, L: 0, ot: 0 });
    h += '</tbody><tfoot><tr class="tot"><td class="rc"></td><td class="rn">' + reg.people.length + ' people</td>' + days.map((d) => '<td class="d num">' + (reg.dayP[d] || '') + '</td>').join('') + '<td class="num">' + all.days + '</td><td class="num">' + all.A + '</td><td class="num">' + all.L + '</td><td class="num">' + PL.r2(all.ot) + '</td></tr></tfoot></table></div><p class="mut" style="font-size:12px;margin:8px 0 0">Days counts Present and Overtime as 1 and Half day as 0.5. The bottom row is the number present each day.</p></div>';
    return h;
  }
  function regData(rows, days) {
    const ids = PL.siteIdsUnder(S.sites, UI.regSite), dset = new Set(days), cell = {}, withMarks = new Set();
    rows.forEach((a) => { if (!dset.has(a.day)) return; cell[a.employee_id + '|' + a.day] = a; if (ids.has(a.site_id)) withMarks.add(a.employee_id); });
    const people = S.employees.filter((e) => (ids.has(e.site_id) && (e.active !== false || !e.leaving_date || e.leaving_date >= days[0])) || withMarks.has(e.id))
      .filter((e) => e.active !== false || withMarks.has(e.id))
      .sort((a, b) => (a.emp_code || '').localeCompare(b.emp_code || '', undefined, { numeric: true }) || a.name.localeCompare(b.name));
    const tot = {}, dayP = {};
    people.forEach((e) => {
      const t = tot[e.id] = { days: 0, H: 0, A: 0, L: 0, ot: 0 };
      days.forEach((d) => { const m = cell[e.id + '|' + d]; if (!m) return; if (DAY_VAL[m.status]) { t.days += DAY_VAL[m.status]; dayP[d] = (dayP[d] || 0) + 1; } if (m.status === 'H') t.H++; if (m.status === 'A') t.A++; if (m.status === 'L') t.L++; if (m.status === 'OT') t.ot += PL.num(m.ot_hours); });
    });
    return { people, cell, tot, dayP };
  }

  // ---------- Letters ----------
  const KINDS = {
    offer: { name: 'Offer letter', file: 'Offer Letter', prefix: 'SEC/HR/OL/', seed: 103, ref: true },
    warning: { name: 'Warning letter', file: 'Warning Letter', prefix: 'SEC/HR/WL/', seed: 1, pad: 2, ref: true },
    experience: { name: 'Experience letter', file: 'Experience Letter', ref: false },
    termination: { name: 'Termination letter', file: 'Termination Letter', prefix: 'SEC/TERM/', seed: 1001, yearly: true, ref: true }
  };
  function nextRef(kind) {
    const k = KINDS[kind]; if (!k.ref) return '';
    let max = k.seed;
    M.letters.filter((l) => l.kind === kind && l.ref_no && l.ref_no.indexOf(k.prefix) === 0).forEach((l) => { const n = parseInt(l.ref_no.slice(k.prefix.length), 10); if (!isNaN(n)) max = Math.max(max, n); });
    return k.prefix + String(max + 1).padStart(k.pad || 1, '0') + (k.yearly ? '/' + pkDay().slice(0, 4) : '');
  }
  function letterDefaults(kind, e) {
    e = e || {}; const f = e.gender === 'F', site = e.site_id ? X.siteName(e.site_id) : '';
    const d = { ref_no: nextRef(kind), date: pkDay(), title: f ? 'Ms.' : 'Mr.', name: e.name || '', so: f ? 'D/O' : 'S/O', father_name: e.father_name || '', cnic: e.cnic || '', designation: e.designation || '', department: e.department || '', emp_code: e.emp_code || '', site: site };
    if (kind === 'offer') Object.assign(d, { location: site, reporting_to: 'Site Incharge', employment_type: e.employment_type || 'Contract', probation: '3 Months', salary: '', working_hours: 'Monday – Saturday, 8:00 AM to 5:00 PM' });
    if (kind === 'warning') Object.assign(d, { subject: 'Poor Performance and Not Following Instructions',
      para1: 'This letter serves as a formal warning regarding your unsatisfactory performance and unprofessional conduct at Sterling Engineering & Construction Company (SEC)' + (site ? ', ' + site + ' Site' : '') + '. We have noticed that you have often failed to do your assigned work to the required standard, and that you have repeatedly failed to follow the instructions and orders given by your senior management and supervisors. This is a serious breach of workplace discipline and will not be allowed to continue.',
      para2: 'You are hereby directed to improve your work performance immediately and to fully follow all instructions given by your seniors and management. You must show a clear improvement in both behavior and performance within the next 30 days from the date of this letter.',
      para3: 'Please treat this as a formal and final warning. If there is no improvement, or if similar behavior happens again, the company will have to take further action, which may include suspension or termination of your employment, as per company policy. A copy of this letter will be placed in your personal file.' });
    if (kind === 'experience') Object.assign(d, { from: e.joining_date || '', to: e.leaving_date || pkDay(), exp_body: expBody(f) });
    if (kind === 'termination') Object.assign(d, { reason: 'Violation of Company Policy', termination_date: pkDay(), last_day: pkDay(), mark_left: !!e.id });
    return d;
  }
  const expBody = (f) => (f ? 'She has demonstrated excellent performance throughout her service period and has always been highly cooperative. She possesses strong moral character, maintains a professional attitude, and has consistently shown dedication and commitment to her responsibilities. Her overall performance has been excellent.'
    : 'He has demonstrated excellent performance throughout his service period and has always been highly cooperative. He possesses strong moral character, maintains a professional attitude, and has consistently shown dedication and commitment to his responsibilities. His overall performance has been excellent.');
  const LF = {
    common: [['ref_no', 'Ref no'], ['date', 'Letter date', 'date'], ['title', 'Title', ['Mr.', 'Ms.']], ['name', 'Name'], ['so', 'S/O or D/O', ['S/O', 'D/O']], ['father_name', 'Father or husband name'], ['cnic', 'CNIC'], ['designation', 'Designation'], ['department', 'Department']],
    offer: [['location', 'Project or work location'], ['reporting_to', 'Reporting to'], ['employment_type', 'Employment type'], ['probation', 'Probation period'], ['salary', 'Monthly gross salary (PKR)'], ['working_hours', 'Working hours', null, 'full']],
    warning: [['emp_code', 'Employee ID'], ['subject', 'Subject (after "Warning Letter –")', null, 'full'], ['para1', 'First paragraph', 'area'], ['para2', 'Second paragraph', 'area'], ['para3', 'Third paragraph', 'area']],
    experience: [['from', 'Worked from', 'date'], ['to', 'Worked to', 'date'], ['exp_body', 'Performance paragraph', 'area']],
    termination: [['reason', 'Reason for termination', null, 'full'], ['termination_date', 'Termination date', 'date'], ['last_day', 'Last working day', 'date']]
  };
  const SKIP = { experience: ['ref_no', 'title', 'cnic'], warning: ['title', 'so', 'father_name', 'cnic'] };
  function letterForm() {
    const kind = UI.letKind, d = UI.letData, skip = SKIP[kind] || [];
    const field = (f) => {
      const [k, label, type, cls] = f, v = d[k] === undefined || d[k] === null ? '' : d[k];
      if (Array.isArray(type)) return '<label>' + label + '<select data-let="' + k + '">' + type.map((o) => '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>';
      if (type === 'area') return '<label class="full">' + label + '<textarea rows="3" data-let="' + k + '">' + esc(v) + '</textarea></label>';
      return '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + label + '<input' + (type === 'date' ? ' type="date"' : '') + ' data-let="' + k + '" value="' + esc(v) + '"></label>';
    };
    let h = '<div class="form" id="let-form">' + LF.common.filter((f) => !skip.includes(f[0])).map(field).join('') + LF[kind].map(field).join('');
    if (kind === 'termination' && UI.letEmp) h += '<label class="full chk"><input type="checkbox" data-let="mark_left"' + (d.mark_left ? ' checked' : '') + '> Also mark ' + esc((X.EMP[UI.letEmp] || {}).name || 'the employee') + ' as Left from the termination date</label>';
    if (kind === 'experience') h += '<p class="full mut" style="font-size:12px;margin:0">The letter says "' + (d.so === 'D/O' ? 'she' : 'he') + '" and "' + (d.so === 'D/O' ? 'her' : 'him') + '" from the S/O or D/O choice. Changing it rewrites the performance paragraph.</p>';
    return h + '</div>';
  }
  function letPicker() {
    if (UI.letEmp && X.EMP[UI.letEmp]) { const e = X.EMP[UI.letEmp]; return '<div class="picked">' + esc(e.emp_code || '') + ' · ' + esc(X.siteName(e.site_id)) + (e.active === false ? ' · left' : '') + ' · <button class="link" data-act="letClearEmp">Choose someone else</button></div>'; }
    const q = (UI.letQ || '').trim().toLowerCase(); if (!q) return '';
    const list = S.employees.filter((e) => ((e.name || '') + ' ' + (e.emp_code || '') + ' ' + (e.cnic || '')).toLowerCase().includes(q)).sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
    if (!list.length) return '<div class="picked">No employee matches. ' + (UI.letKind === 'offer' ? 'For a new candidate, type his details in the form below.' : '') + '</div>';
    return '<div class="plist">' + list.slice(0, 8).map((e) => '<button type="button" data-act="letPick" data-id="' + e.id + '">' + esc(e.name) + ' <span class="mut">' + esc(e.emp_code || '') + ' · ' + esc(X.siteName(e.site_id)) + (e.active === false ? ' · left' : '') + '</span></button>').join('') + '</div>';
  }
  const vLetters = () => vLettersBody() + sigCard();
  function vLettersBody() {
    if (!UI.letKind) UI.letKind = 'offer';
    if (!UI.letData) UI.letData = letterDefaults(UI.letKind, X.EMP[UI.letEmp]);
    const sig = M.settings.signatory || {};
    let h = pageHead('HR letters', 'Fill the details and download the letter as a Word file in the company format. Every letter is kept in the register below.');
    if (canHR()) {
      h += '<div class="tabs">' + Object.keys(KINDS).map((k) => '<button class="tab' + (UI.letKind === k ? ' on' : '') + '" data-act="letKind" data-k="' + k + '">' + KINDS[k].name + '</button>').join('') + '</div>';
      h += '<div class="card"><div class="bar" style="margin-bottom:6px"><label style="position:relative">Employee<input id="let-q" autocomplete="off" placeholder="Type a name, code or CNIC" style="width:280px" value="' + esc(UI.letQ || '') + '"><div id="let-results" class="' + (UI.letEmp ? 'inflow' : 'picker') + '">' + letPicker() + '</div></label></div>';
      h += letterForm();
      h += '<p class="mut" style="font-size:12px">' + (UI.letKind === 'termination' ? 'Signed as Authorized Signatory, Human Resources Division.' : 'Signed by ' + esc(sig.name || '') + ', ' + esc(sig.title || '') + '. Change it at the bottom of this page.') + '</p>';
      h += '<p style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap"><button class="b pri" data-act="letMake">Download Word letter</button><button class="b" data-act="letReset">Clear the form</button></p></div>';
    }
    h += '<div class="card"><div class="card-h"><h2>Letter register</h2><span class="mut">' + M.letters.length + ' letter(s)</span></div>';
    if (!M.letters.length) return h + '<p class="mut">No letters issued yet.</p></div>';
    h += '<div class="scroll"><table><tr><th>Date</th><th>Letter</th><th>Ref no</th><th>Employee</th><th>Issued by</th><th></th></tr>' + M.letters.slice(0, 300).map((l) => '<tr><td class="nowrap">' + dmy(l.issued_on) + '</td><td>' + esc((KINDS[l.kind] || {}).name || l.kind) + '</td><td class="nowrap">' + esc(l.ref_no || '') + '</td><td>' + esc(l.person_name || '') + (l.employee_id && X.EMP[l.employee_id] ? ' <span class="mut">' + esc(X.EMP[l.employee_id].emp_code || '') + '</span>' : '') + '</td><td>' + esc(l.created_by || '') + '</td><td><button class="b sm" data-act="letAgain" data-id="' + l.id + '">Download again</button></td></tr>').join('') + '</table></div></div>';
    return h;
  }
  // Filling the Word template: the templates are the company letters with {{fields}} in place of the details.
  let tplPromise = null;
  function templates() {
    if (window.SEC_TEMPLATES) return Promise.resolve(window.SEC_TEMPLATES);
    if (!tplPromise) tplPromise = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'templates.js?v=12'; s.onload = () => (window.SEC_TEMPLATES ? ok(window.SEC_TEMPLATES) : no(new Error('templates missing'))); s.onerror = () => { tplPromise = null; no(new Error('The letter templates (templates.js) could not be loaded. Upload templates.js with the other files.')); }; document.head.appendChild(s); });
    return tplPromise;
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    files.forEach((f) => {
      const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length, lh = new DataView(new ArrayBuffer(30)), ch = new DataView(new ArrayBuffer(46));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      parts.push(new Uint8Array(lh.buffer), nm, f.data); central.push(new Uint8Array(ch.buffer), nm); off += 30 + nm.length + sz;
    });
    const cd = central.reduce((t, a) => t + a.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  const xmlEsc = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function letterValues(kind, d, sig) {
    const v = Object.assign({}, d, { signatory: sig.name || '', signatory_title: sig.title || '', date: longDate(d.date) });
    const fem = d.so === 'D/O';
    if (kind === 'offer') v.salary_text = d.salary ? 'PKR ' + Number(String(d.salary).replace(/[^\d.]/g, '') || 0).toLocaleString('en-US') + ' per month' : '';
    if (kind === 'experience') Object.assign(v, { from: longDate(d.from), to: longDate(d.to), he: fem ? 'she' : 'he', him: fem ? 'her' : 'him', a: /^[aeiou]/i.test(d.designation || '') ? 'an' : 'a' });
    if (kind === 'termination') Object.assign(v, { termination_date: longDate(d.termination_date), last_day: longDate(d.last_day) });
    return v;
  }
  // Fill a Word template. repeats: {token: [values...]} repeats the table row (or paragraph) holding {{token}}.
  async function buildDoc(name, v, repeats) {
    const tpl = (await templates())[name]; if (!tpl) throw new Error('No template for ' + name);
    const enc = new TextEncoder(), val = (x) => xmlEsc(x).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
    const fill = (xml, vals) => xml.replace(/\{\{(\w+)\}\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vals, k) ? val(vals[k]) : m));
    const files = tpl.map(([fname, b64]) => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(fname)) return { name: fname, data: bytes };
      let xml = new TextDecoder().decode(bytes);
      Object.keys(repeats || {}).forEach((tok) => {
        const at = xml.indexOf('{{' + tok + '}}'); if (at < 0) return;
        const tag = xml.lastIndexOf('<w:tr', at) > xml.lastIndexOf('</w:tr>', at) && xml.lastIndexOf('<w:tr', at) >= 0 ? 'w:tr' : 'w:p';
        const s1 = Math.max(xml.lastIndexOf('<' + tag + ' ', at), xml.lastIndexOf('<' + tag + '>', at)), s2 = xml.indexOf('</' + tag + '>', at) + tag.length + 3;
        const block = xml.slice(s1, s2);
        xml = xml.slice(0, s1) + repeats[tok].map((r) => fill(block, r)).join('') + xml.slice(s2);
      });
      return { name: fname, data: enc.encode(fill(xml, v).replace(/\{\{\w+\}\}/g, '')) };
    });
    files.sort((a, b) => (a.name === '[Content_Types].xml' ? -1 : b.name === '[Content_Types].xml' ? 1 : 0));
    return zipStore(files);
  }
  const buildLetter = (kind, d, sig) => buildDoc(kind, letterValues(kind, d, sig));
  const saveBlob = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  const fileName = (kind, d) => KINDS[kind].file + ' - ' + String(d.name || 'employee').replace(/[\\/:*?"<>|]/g, '') + (d.ref_no ? ' - ' + d.ref_no.replace(/[\\/]/g, '-') : '') + '.docx';

  // ---------- Users and access ----------
  let STAFF = null, staffErr = '';
  async function loadStaff() { try { STAFF = await DB.staff(); staffErr = ''; } catch (e) { STAFF = []; staffErr = e.message || String(e); } if (UI.view === 'users') X.render(); }
  const RN = { admin: 'Admin (full access)', accountant: 'Accountant (payroll only)', owner: 'Owner (views all, approves purchases)', hr: 'HR', procurement: 'Procurement', site: 'Site attendance' };
  function siteChecks(sel) {
    sel = new Set(sel || []);
    return '<div class="chks">' + X.sortedSites().filter((s) => s.active !== false).map((s) => '<label class="' + (s.parent_id ? 'kid' : '') + '"><input type="checkbox" data-site="' + s.id + '"' + (sel.has(s.id) ? ' checked' : '') + '> ' + esc(X.siteName(s.id)) + '</label>').join('') + '</div>';
  }
  function vUsers() {
    if (STAFF === null) { loadStaff(); return pageHead('Users and access') + '<div class="card"><p class="mut">Loading…</p></div>'; }
    const admin = X.isSys();
    let h = pageHead('Users and access', 'Who can sign in, what each person can do, and which sites a site login can mark.' + (admin ? '' : ' Only the admin can change access.'));
    if (staffErr) h += '<div class="banner" style="background:var(--bad-bg);color:var(--bad)">Could not load users: ' + esc(staffErr) + '. Run 1_database_setup.sql again if the database was not updated.</div>';
    const ed = UI.userEdit && STAFF.find((u) => u.id === UI.userEdit);
    if (ed) {
      const roles = Object.keys(RN);
      h += '<div class="card" id="user-form"><h2 style="margin-top:0">' + esc(ed.email) + '</h2><div class="form"><label>Name shown in the system<input name="u-name" value="' + esc(ed.name || '') + '" placeholder="Site supervisor name"></label><label>Access<select name="u-role" data-chg="userRole">' + roles.map((r) => '<option value="' + r + '"' + ((UI.userRole || ed.role || 'site') === r ? ' selected' : '') + '>' + RN[r] + '</option>').join('') + '</select></label><label>Status<select name="u-active"><option value="1"' + (ed.active !== false || !ed.role ? ' selected' : '') + '>Can sign in</option><option value="0"' + (ed.active === false && ed.role ? ' selected' : '') + '>Blocked</option></select></label></div>';
      if ((UI.userRole || ed.role || 'site') === 'site') h += '<h2>Sites this login marks</h2><p class="mut" style="font-size:12px;margin-top:0">Choosing a main site includes the teams inside it.</p>' + siteChecks(ed.site_ids);
      h += '<p style="margin:14px 0 0;display:flex;gap:8px"><button class="b pri" data-act="userSave">Save</button><button class="b" data-act="userCancel">Cancel</button></p></div>';
    }
    h += '<div class="card"><div class="scroll"><table><tr><th>Name</th><th>Email</th><th>Access</th><th>Sites</th><th>Status</th><th>Last sign-in</th><th></th></tr>';
    STAFF.forEach((u) => {
      const can = admin;
      h += '<tr><td>' + esc(u.name || '') + '</td><td>' + esc(u.email) + '</td><td>' + (u.role ? esc(RN[u.role] || u.role) : '<span class="pill p-warn">No access yet</span>') + '</td><td>' + esc((u.site_ids || []).map((id) => X.SITE[id] ? X.siteName(id) : '').filter(Boolean).join(', ')) + '</td><td>' + (!u.role ? '' : u.active === false ? '<span class="pill p-bad">Blocked</span>' : '<span class="pill p-ok">Active</span>') + '</td><td class="nowrap">' + (u.last_sign_in ? pkStamp(u.last_sign_in) : '<span class="mut">Never</span>') + '</td><td>' + (can && u.email !== UI.user ? '<button class="b sm" data-act="userEdit" data-id="' + u.id + '">' + (u.role ? 'Edit' : 'Give access') + '</button>' : '') + '</td></tr>';
    });
    h += '</table></div></div>';
    h += '<div class="card"><h2 style="margin-top:0">Adding a site login</h2><p style="margin:0">Contact developer.</p></div>';
    return h;
  }

  // ---------- Site attendance app (for site logins) ----------
  const SA = { data: null, err: '', q: '', filter: 'all', site: '', ot: null, otVal: '2', confirm: null, busy: false };
  async function siteLoad(quiet) {
    if (UI.role !== 'site') return;
    try { SA.data = await DB.siteToday(); SA.err = ''; } catch (e) { console.error(e); SA.err = e.message || String(e); }
    if (!quiet || !X.typing()) X.render();
  }
  const saMarks = () => { const m = {}; (SA.data ? SA.data.marks : []).forEach((a) => { m[a.employee_id] = a; }); return m; };
  const saLocked = (m) => !!m && (m.source === 'hr' || !SA.data.same_day_edit);
  function saList() {
    const d = SA.data, marks = saMarks(), q = SA.q.trim().toLowerCase();
    const ids = SA.site ? PL.siteIdsUnder(d.sites, SA.site) : null;
    const emps = d.employees.filter((e) => (!ids || ids.has(e.site_id)) && (!q || ((e.name || '') + ' ' + (e.emp_code || '') + ' ' + (e.designation || '')).toLowerCase().includes(q)) &&
      (SA.filter === 'all' || (SA.filter === 'todo' ? !marks[e.id] : marks[e.id] && marks[e.id].status === SA.filter)));
    if (!emps.length) return '<div class="sa-empty">' + (SA.filter === 'todo' && !q ? X.icon('check') + '<b>Everyone is marked.</b>' : 'Nobody matches.') + '</div>';
    return emps.map((e) => {
      const m = marks[e.id], lock = saLocked(m), st = m && m.status;
      let r = '<div class="sa-row' + (st ? ' done' : '') + '" id="sa-' + e.id + '"><div class="sa-who"><b>' + esc(e.name) + '</b><span>' + esc(e.emp_code || '') + (e.designation ? ' · ' + esc(e.designation) : '') + (d.sites.length > 1 ? ' · ' + esc((d.sites.find((s) => s.id === e.site_id) || {}).name || '') : '') + '</span>' +
        (m ? '<span class="sa-when">' + (lock ? '🔒 ' : '') + ATT_ST[st] + (st === 'OT' ? ' ' + PL.r2(m.ot_hours) + 'h' : '') + ' · ' + pkTime(m.marked_at) + (m.source === 'hr' ? ' · set by HR' : '') + '</span>' : '') + '</div>';
      r += '<div class="sa-btns">' + ['P', 'H', 'A', 'L', 'OT'].map((s) => '<button class="sab s-' + s + (st === s ? ' on' : '') + '" data-act="saTap" data-id="' + e.id + '" data-st="' + s + '"' + (lock || SA.busy ? ' disabled' : '') + ' aria-label="' + ATT_ST[s] + '">' + s + '</button>').join('') + '</div>';
      if (SA.ot === e.id) r += '<div class="sa-x"><span>Overtime hours</span><button class="sab sm" data-act="saOtStep" data-n="-0.5">−</button><input id="sa-oth" inputmode="decimal" value="' + esc(SA.otVal) + '" data-sachg="otVal"><button class="sab sm" data-act="saOtStep" data-n="0.5">+</button><button class="b pri" data-act="saOtSave" data-id="' + e.id + '">Save OT</button><button class="b" data-act="saCancel">Cancel</button></div>';
      if (SA.confirm && SA.confirm.id === e.id) r += '<div class="sa-x warn"><span>Save <b>' + ATT_ST[SA.confirm.st] + (SA.confirm.st === 'OT' ? ' ' + esc(SA.confirm.ot) + 'h' : '') + '</b>? It cannot be changed after saving.</span><button class="b pri" data-act="saConfirm">Save</button><button class="b" data-act="saCancel">Cancel</button></div>';
      return r + '</div>';
    }).join('');
  }
  function siteApp() {
    const demo = !LIVE ? '<div class="sa-demo">Demo: viewing as a site login. <select data-chg="demoSite">' + X.sortedSites().filter((s) => !s.parent_id).map((s) => '<option value="' + s.id + '"' + ((UI.demoSites || [])[0] === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select> <select data-chg="role"><option value="site" selected>Site attendance</option><option value="hr">Switch to HR</option><option value="admin">Switch to Accountant</option></select></div>' : '';
    let h = '<div class="sa">' + demo + '<header class="sa-top"><img src="logo.jpg" alt=""><div><b>Sterling Engineering</b><small>Site attendance' + (SA.data && SA.data.name ? ' · ' + esc(SA.data.name) : '') + '</small></div>' + (LIVE ? '<button class="sa-menu" data-act="saMenu" aria-label="Menu">☰</button>' : '') + '</header>';
    if (UI.saMenu && LIVE) h += '<div class="sa-pop"><div class="mut">' + esc(UI.user || '') + '</div><button data-act="refresh">Refresh</button><button data-act="changePw">Change password</button><button data-act="logout">Sign out</button></div>';
    if (SA.err) h += '<div class="sa-err"><b>Sorry for the inconvenience.</b> Today\u2019s list could not be loaded. Please try again, and contact the developer if it keeps happening.<small>' + esc(SA.err) + '</small> <button class="b" data-act="saReload">Try again</button></div>';
    if (!SA.data) return h + (SA.err ? '' : '<p class="sa-empty">Loading today’s list…</p>') + '</div>';
    const d = SA.data, marks = saMarks(), ids = SA.site ? PL.siteIdsUnder(d.sites, SA.site) : null, emps = d.employees.filter((e) => !ids || ids.has(e.site_id));
    const c = { P: 0, H: 0, A: 0, L: 0, OT: 0, done: 0 }; emps.forEach((e) => { const m = marks[e.id]; if (m) { c[m.status]++; c.done++; } });
    const todo = emps.length - c.done;
    h += '<div class="sa-day"><div><span>Today</span><b>' + wkday(d.day) + ', ' + dmy(d.day) + '</b></div><div class="sa-prog"><b>' + c.done + '<small> / ' + emps.length + '</small></b><span>marked</span></div></div><div class="sa-bar"><i style="width:' + (emps.length ? Math.round(c.done / emps.length * 100) : 0) + '%"></i></div>';
    if (!d.sites.length) return h + '<div class="sa-empty">No site is linked to this login yet. Ask HR to add your site.</div></div>';
    if (d.sites.length > 1) h += '<div class="sa-chips">' + [['', 'All sites']].concat(d.sites.map((s) => [s.id, s.name])).map((o) => '<button class="chip' + (SA.site === o[0] ? ' on' : '') + '" data-act="saSite" data-id="' + o[0] + '">' + esc(o[1]) + '</button>').join('') + '</div>';
    h += '<div class="sa-chips">' + [['all', 'All', emps.length], ['todo', 'Not marked', todo], ['P', 'P', c.P], ['H', 'H', c.H], ['A', 'A', c.A], ['L', 'L', c.L], ['OT', 'OT', c.OT]].map((o) => '<button class="chip f-' + o[0] + (SA.filter === o[0] ? ' on' : '') + '" data-act="saFilter" data-f="' + o[0] + '">' + o[1] + ' <b>' + o[2] + '</b></button>').join('') + '</div>';
    h += '<div class="sa-tools"><input id="sa-q" data-sainp="q" placeholder="Search name or code" value="' + esc(SA.q) + '" autocomplete="off">' + (todo ? '<button class="b pri" data-act="saAllP" data-confirm="1">Mark ' + todo + ' not marked as Present</button>' : '') + '</div>';
    h += '<div id="sa-list">' + saList() + '</div>';
    h += '<p class="sa-note">P present · H half day · A absent · L leave · OT present with overtime. ' + (d.same_day_edit ? 'You can correct today’s marks until midnight. After that only HR can change them.' : 'Each mark is locked once saved. Only HR can change it.') + '</p>';
    return h + '</div>';
  }
  async function saSave(marks) {
    // show the marks at once; undo them if the database refuses
    const before = SA.data.marks.slice(), now = new Date().toISOString();
    marks.forEach((m) => { const i = SA.data.marks.findIndex((a) => a.employee_id === m.employee_id), row = { employee_id: m.employee_id, status: m.status, ot_hours: m.status === 'OT' ? numOrNull(m.ot_hours) : null, marked_at: now, source: 'site' }; if (i >= 0) SA.data.marks[i] = row; else SA.data.marks.push(row); });
    SA.busy = true; X.render();
    try { await DB.siteMark(marks); }
    catch (e) { SA.data.marks = before; toast(e.message || String(e)); if (/another day|not on your site|locked|HR has set/i.test(e.message || '')) siteLoad(true); }
    finally { SA.busy = false; X.render(); }
  }

  // ---------- actions ----------
  Object.assign(A, {
    attToday() { UI.attDay = pkDay(); ATT.key = ''; X.render(); },
    attReload() { reloadAtt(); },
    attSite(el) { UI.attSite = el.dataset.id || null; X.render(); if (UI.attSite) { const c = $('#att-detail'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    async hrMark(el) {
      const st = el.dataset.st, emp = el.dataset.emp, day = el.dataset.day;
      let ot = null;
      if (st === 'OT') { const box = document.getElementById('ot-' + emp + '-' + day); ot = numOrNull(box && box.value); if (!ot || ot <= 0 || ot > 16) { if (box) box.focus(); return toast('Type the overtime hours (0.5 to 16) in the box next to OT first.'); } }
      if (day > pkDay()) return toast('A future day cannot be marked.');
      const old = ATT.rows.find((a) => a.employee_id === emp && a.day === day);
      await DB.attSet([{ employee_id: emp, day: day, status: st || null, ot_hours: ot, site_id: old ? old.site_id : null }]);
      ATT.rows = ATT.rows.filter((a) => !(a.employee_id === emp && a.day === day));
      if (st) ATT.rows.push({ id: old ? old.id : uuid(), employee_id: emp, day: day, status: st, ot_hours: ot, site_id: old ? old.site_id : (X.EMP[emp] || {}).site_id, source: 'hr', marked_by_name: who(), marked_at: new Date().toISOString() });
      if (UI.view === 'attlive') { try { ATT.log = await DB.attLog(day); } catch (e) { /* keep the old list */ } }
      X.render(); toast(st ? (X.EMP[emp] || {}).name + ': ' + ATT_ST[st] + (ot ? ' ' + ot + 'h' : '') + ' saved.' : 'Mark cleared.');
    },
    async hrAllP(el) {
      const day = UI.attDay, marks = markMap(ATT.rows, day), list = S.employees.filter((e) => (e.site_id || 'none') === el.dataset.id && e.active !== false && !marks[e.id] && !(e.joining_date && e.joining_date > day));
      await DB.attSet(list.map((e) => ({ employee_id: e.id, day: day, status: 'P' })));
      ATT.stale = true; X.render(); toast(list.length + ' marked Present.');
    },
    regEdit(el) { UI.regEdit = { emp: el.dataset.emp, day: el.dataset.day }; X.render(); },
    regEditClose() { UI.regEdit = null; X.render(); },
    regMonth(el) { const t = pkDay(); let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)) + Number(el.dataset.m); if (m < 1) { m += 12; y--; } const first = y + '-' + String(m).padStart(2, '0') + '-01', last = addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1); UI.regFrom = first; UI.regTo = last > t ? t : last; UI.regEdit = null; X.render(); },
    regExport() {
      const rows = ATT.rows, days = dayList(UI.regFrom, UI.regTo), reg = regData(rows, days);
      X.xlsxOut('Attendance ' + X.siteName(UI.regSite).replace(/[^\w ]/g, '') + ' ' + UI.regFrom + ' to ' + UI.regTo + '.xlsx', [{ name: 'Register', rows: reg.people.map((e) => { const r = { Code: e.emp_code || '', Name: e.name, Designation: e.designation || '' }; days.forEach((d) => { const m = reg.cell[e.id + '|' + d]; r[d.slice(8) + ' ' + wkday(d, 'short')] = m ? (m.status === 'OT' ? 'OT ' + PL.r2(m.ot_hours) : m.status) : ''; }); const t = reg.tot[e.id]; return Object.assign(r, { 'Days (P + OT + half)': t.days, 'Half days': t.H, Absent: t.A, Leave: t.L, 'OT hours': PL.r2(t.ot) }); }) },
        { name: 'All marks', rows: rows.filter((a) => days.includes(a.day) && reg.people.some((e) => e.id === a.employee_id)).map((a) => ({ Date: a.day, Code: (X.EMP[a.employee_id] || {}).emp_code || '', Name: (X.EMP[a.employee_id] || {}).name || '', Mark: a.status, 'OT hours': a.ot_hours || '', Site: X.siteName(a.site_id), 'Marked by': a.marked_by_name || '', 'Marked at': pkStamp(a.marked_at), 'Set by HR': a.source === 'hr' ? 'Yes' : '' })) }]);
    },
    // Salary run: take days and overtime hours from the attendance register.
    async fillFromAtt() {
      const r = X.RUN[UI.runId]; if (!r || !r.date_from || !r.date_to) return toast('Set the from and to dates of the run first.');
      const rows = await DB.attRange(r.date_from, r.date_to), siteIds = PL.siteIdsUnder(S.sites, r.site_id), per = {};
      rows.forEach((a) => { if (!siteIds.has(a.site_id)) return; const p = per[a.employee_id] || (per[a.employee_id] = { days: 0, ot: 0 }); if (DAY_VAL[a.status]) p.days += DAY_VAL[a.status]; if (a.status === 'OT') p.ot += PL.num(a.ot_hours); });
      const lines = S.run_lines.filter((l) => l.run_id === r.id && !PL.linePaid(l)); let none = 0;
      const changed = lines.map((l) => { const p = per[l.employee_id]; if (!p) { none++; return null; } const n = Object.assign({}, l, { days: p.days, ot_hours: p.ot ? PL.r2(p.ot) : null }); return PL.num(n.days) === PL.num(l.days) && PL.num(n.ot_hours) === PL.num(l.ot_hours) ? null : n; }).filter(Boolean);
      if (changed.length) await X.saveMany('run_lines', changed, { summary: 'Days and OT hours filled from attendance for ' + changed.length + ' employees', subject: 'Run: ' + X.siteName(r.site_id) + (r.label ? ' · ' + r.label : '') });
      X.render();
      toast(changed.length + ' employee(s) updated from attendance.' + (none ? ' ' + none + ' had no attendance marked in this period and were left as they were.' : '') + (!changed.length && !none ? ' Everything already matched.' : ''));
    },
    letKind(el) { UI.letKind = el.dataset.k; UI.letData = letterDefaults(UI.letKind, X.EMP[UI.letEmp]); X.render(); },
    letPick(el) { UI.letEmp = el.dataset.id; const e = X.EMP[UI.letEmp]; UI.letQ = e.name + (e.emp_code ? ' (' + e.emp_code + ')' : ''); UI.letData = letterDefaults(UI.letKind, e); X.render(); },
    letClearEmp() { UI.letEmp = null; UI.letQ = ''; UI.letData = letterDefaults(UI.letKind, null); X.render(); },
    letReset() { UI.letEmp = null; UI.letQ = ''; UI.letData = letterDefaults(UI.letKind, null); X.render(); },
    async letMake() {
      const kind = UI.letKind, d = Object.assign({}, UI.letData);
      if (!String(d.name || '').trim()) return toast('Enter the name.');
      if (!d.date) return toast('Enter the letter date.');
      if (kind === 'experience' && (!d.from || !d.to)) return toast('Enter the from and to dates.');
      if (kind === 'termination' && !d.termination_date) return toast('Enter the termination date.');
      // details the letter prints: warn once when some are empty, the second click downloads anyway
      const need = { offer: ['father_name', 'cnic', 'designation', 'department', 'location', 'salary'], warning: ['designation', 'department', 'emp_code'], experience: ['father_name', 'designation', 'department'], termination: ['father_name', 'cnic', 'designation', 'department'] }[kind];
      const label = (k) => (LF.common.concat(LF[kind]).find((f) => f[0] === k) || [k, k])[1];
      const empty = need.filter((k) => !String(d[k] || '').trim()), key = kind + ':' + empty.join(',');
      if (empty.length && UI.letWarned !== key) { UI.letWarned = key; return toast('Empty in this letter: ' + empty.map(label).join(', ') + '. Fill them, or press Download again to make it anyway.'); }
      UI.letWarned = null;
      const sig = M.settings.signatory || {}, blob = await buildLetter(kind, d, sig);
      saveBlob(fileName(kind, d), blob);
      await DB.saveLetter({ id: uuid(), employee_id: UI.letEmp || null, kind: kind, ref_no: d.ref_no || null, issued_on: d.date, person_name: d.name, data: Object.assign({}, d, { signatory: sig }), created_at: new Date().toISOString(), created_by: LIVE ? UI.user : 'Demo user' });
      const e = UI.letEmp && X.EMP[UI.letEmp];
      if (kind === 'termination' && d.mark_left && e && (e.active !== false || e.leaving_date !== d.termination_date)) await X.save('employees', Object.assign({}, e, { active: false, leaving_date: d.termination_date, leaving_reason: d.reason }));
      if (kind === 'offer' && e && !e.joining_date) { /* the joining date is set by HR when he joins */ }
      UI.letData = letterDefaults(kind, e); X.render();
      toast(KINDS[kind].name + ' downloaded and added to the register.' + (kind === 'termination' && d.mark_left && e ? ' ' + e.name + ' is now marked as Left.' : ''));
    },
    async letAgain(el) { const l = M.letters.find((x) => x.id === el.dataset.id); if (!l) return; const d = l.data || {}; saveBlob(fileName(l.kind, d), await buildLetter(l.kind, d, d.signatory || M.settings.signatory || {})); },
    userEdit(el) { UI.userEdit = el.dataset.id; UI.userRole = null; X.render(); window.scrollTo(0, 0); },
    userCancel() { UI.userEdit = null; X.render(); },
    userReload() { STAFF = null; X.render(); },
    async userSave() {
      const f = $('#user-form'), u = STAFF.find((x) => x.id === UI.userEdit); if (!u) return;
      const role = f.querySelector('[name=u-role]').value, sites = Array.from(f.querySelectorAll('[data-site]:checked')).map((x) => x.dataset.site);
      if (role === 'site' && !sites.length) return toast('Tick at least one site for this login.');
      const n = { id: u.id, name: strOrNull(f.querySelector('[name=u-name]').value), role: role, site_ids: role === 'site' ? sites : [], active: f.querySelector('[name=u-active]').value === '1' };
      await DB.setStaff(n); UI.userEdit = null; STAFF = null; X.render(); toast('Access saved for ' + u.email + '.');
    },
    async sigSave() { await DB.saveSetting('signatory', { name: $('#sig-name').value.trim(), title: $('#sig-title').value.trim() }); X.render(); toast('Signatory saved.'); },
    saMenu() { UI.saMenu = !UI.saMenu; X.render(); },
    saReload() { siteLoad(); },
    saSite(el) { SA.site = el.dataset.id; X.render(); },
    saFilter(el) { SA.filter = el.dataset.f; X.render(); },
    saTap(el) {
      const id = el.dataset.id, st = el.dataset.st, m = saMarks()[id];
      if (SA.busy || saLocked(m)) return;
      if (st === 'OT') { SA.ot = id; SA.confirm = null; SA.otVal = m && m.status === 'OT' ? String(m.ot_hours) : SA.otVal || '2'; X.render(); const b = $('#sa-oth'); if (b) b.focus(); return; }
      SA.ot = null;
      if (m && m.status === st) return;
      if (!SA.data.same_day_edit) { SA.confirm = { id: id, st: st }; X.render(); return; }
      saSave([{ employee_id: id, status: st }]);
    },
    saOtStep(el) { const b = $('#sa-oth'), v = Math.max(0.5, Math.min(16, (numOrNull(b.value) || 0) + Number(el.dataset.n))); SA.otVal = String(v); b.value = SA.otVal; },
    saOtSave(el) {
      const b = $('#sa-oth'), v = numOrNull(b && b.value);
      if (!v || v <= 0 || v > 16) return toast('Enter overtime hours from 0.5 to 16.');
      SA.otVal = String(v); SA.ot = null;
      if (!SA.data.same_day_edit) { SA.confirm = { id: el.dataset.id, st: 'OT', ot: v }; X.render(); return; }
      saSave([{ employee_id: el.dataset.id, status: 'OT', ot_hours: v }]);
    },
    saConfirm() { const c = SA.confirm; SA.confirm = null; if (c) saSave([{ employee_id: c.id, status: c.st, ot_hours: c.ot }]); },
    saCancel() { SA.ot = null; SA.confirm = null; X.render(); },
    saAllP() {
      const marks = saMarks(), ids = SA.site ? PL.siteIdsUnder(SA.data.sites, SA.site) : null;
      const list = SA.data.employees.filter((e) => (!ids || ids.has(e.site_id)) && !marks[e.id]);
      if (list.length) saSave(list.map((e) => ({ employee_id: e.id, status: 'P' })));
    }
  });
  Object.assign(C, {
    attDay(el) { UI.attDay = el.value || pkDay(); UI.attSite = null; X.render(); },
    regSet(el) { UI[el.dataset.f] = el.value; UI.regEdit = null; X.render(); },
    userRole(el) { UI.userRole = el.value; const f = $('#user-form'); const keep = f ? Array.from(f.querySelectorAll('[data-site]:checked')).map((x) => x.dataset.site) : null; const u = STAFF.find((x) => x.id === UI.userEdit); if (u && keep) u.site_ids = keep; const nm = f && f.querySelector('[name=u-name]'); if (u && nm) u.name = nm.value; X.render(); },
    async setSameDay(el) { await DB.saveSetting('site_same_day_edit', !!el.checked); X.render(); toast('Saved.'); },
    demoSite(el) { UI.demoSites = [el.value]; SA.site = ''; siteLoad(); }
  });
  // Who may use what. Owner only looks; HR and the accountant change things; site logins only mark.
  const hrOnly = () => X.canHR(), siteOnly = () => UI.role === 'site';
  ['hrMark', 'hrAllP', 'regEdit', 'letKind', 'letPick', 'letClearEmp', 'letReset', 'letMake', 'sigSave'].forEach((k) => { EXT.actAllowed[k] = hrOnly; });
  ['userEdit', 'userSave', 'userCancel'].forEach((k) => { EXT.actAllowed[k] = () => X.isSys(); });
  ['saTap', 'saOtStep', 'saOtSave', 'saConfirm', 'saCancel', 'saAllP', 'saSite', 'saFilter', 'saMenu', 'saReload'].forEach((k) => { EXT.actAllowed[k] = siteOnly; });
  EXT.actAllowed.fillFromAtt = () => X.isAdmin();
  EXT.chgAllowed = { attDay: staffRole, regSet: staffRole, userRole: () => X.isSys(), setSameDay: hrOnly, demoSite: () => !LIVE };

  // typing in the letter form and the search boxes
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.let) { UI.letData[t.dataset.let] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.let === 'so' && UI.letKind === 'experience') { UI.letData.exp_body = expBody(t.value === 'D/O'); X.render(); } return; }
    if (t.dataset && t.dataset.sainp) { SA[t.dataset.sainp] = t.value; const l = $('#sa-list'); if (l) l.innerHTML = saList(); return; }
    if (t.dataset && t.dataset.sachg) { SA[t.dataset.sachg] = t.value; }
  }, true);
  document.addEventListener('change', (ev) => { const t = ev.target; if (t.dataset && t.dataset.let) { UI.letData[t.dataset.let] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.let === 'so' && UI.letKind === 'experience') { UI.letData.exp_body = expBody(t.value === 'D/O'); X.render(); } } });
  // the letter search box redraws only its own list, so the form keeps what was typed
  document.addEventListener('input', (ev) => { if (ev.target.id === 'let-q') { UI.letEmp = null; UI.letQ = ev.target.value; const r = $('#let-results'); if (r) { r.className = 'picker'; r.innerHTML = letPicker(); } } }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    if (ev.target.id === 'let-q') { const first = $('#let-results [data-act=letPick]'); if (first) first.click(); }
    if (ev.target.id === 'sa-oth') { const b = $('[data-act=saOtSave]'); if (b) b.click(); }
  });
  document.addEventListener('click', (ev) => { if (UI.saMenu && !ev.target.closest('.sa-pop') && !ev.target.closest('[data-act=saMenu]')) { UI.saMenu = false; if (UI.role === 'site') X.render(); } }, true);

  // ---------- register with the app ----------
  Object.assign(EXT.views, { attlive: vAttLive, attsheet: vAttSheet, letters: vLetters, users: vUsers });
  EXT.nav.push({ group: 'Overview', item: ['attlive', 'Live attendance', 'live'], first: true }, { group: 'People', item: ['attsheet', 'Attendance register', 'cal'] }, { group: 'People', item: ['letters', 'HR letters', 'doc'] }, { group: 'Administration', item: ['users', 'Users and access', 'key'], first: true });
  EXT.roleViews.owner.push('attlive', 'attsheet', 'letters');
  EXT.roleViews.hr.push('attlive', 'attsheet', 'letters');
  EXT.roleViews.owner.push('users'); // the owner can see who has access; only the admin changes it
  EXT.siteApp = siteApp;
  X.docs = { build: buildDoc, save: (name, blob) => saveBlob(name, blob), longDate: longDate, pkDay: pkDay, pkTime: pkTime, pkStamp: pkStamp, addDays: addDays };
  const hrLoader = async () => {
    if (!LIVE) loadDemo();
    if (UI.role === 'site') { if (!LIVE && !(UI.demoSites || []).length) { const top = X.sortedSites().find((s) => !s.parent_id && S.employees.some((e) => PL.siteIdsUnder(S.sites, s.id).has(e.site_id))); UI.demoSites = top ? [top.id] : []; } await siteLoad(true); return; }
    await DB.meta(); ATT.stale = true; subscribe();
  };
  EXT.loaders.push(hrLoader);
  EXT.onRole = () => { ATT.key = ''; STAFF = null; if (UI.role === 'site') { SA.data = null; hrLoader(); } };
  EXT.onLogout = () => { if (chan) { try { sb().removeChannel(chan); } catch (e) { /* closing anyway */ } chan = null; } SA.data = null; STAFF = null; ATT.key = ''; M.letters = []; };
  // proc.js loads next and starts the app
})();
