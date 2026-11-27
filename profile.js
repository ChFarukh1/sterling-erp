// Sterling: my profile (photo, gender, status) and the team status board. Loads after proc.js and starts the app.
(function () {
  'use strict';
  const X = window.SEC;
  const { UI, EXT, A, C, LIVE, $, esc, toast } = X;
  const ST = { available: ['Available', 'st-av'], busy: ['Busy', 'st-busy'], away: ['Away', 'st-away'], ooo: ['Out of office', 'st-ooo'] };
  const ST_HINT = { available: 'Working and reachable', busy: 'In a meeting or busy, reply later', away: 'Stepped out for a while', ooo: 'On leave or off work' };
  const EDIT = ['admin', 'accountant', 'hr', 'procurement'];
  const ROLE_L = { admin: 'Admin', accountant: 'Accountant', hr: 'HR', procurement: 'Procurement Engineer', owner: 'Owner' };
  const canEdit = () => EDIT.includes(UI.role);
  const canSee = () => ['owner', 'admin'].includes(UI.role);
  const today = () => X.docs.pkDay();
  const DKEY = 'sterling_profile_demo_v1';
  // Office hours: 9 AM to 5 PM Pakistan time, Monday to Saturday (the database uses the same rule)
  function pkNow() { const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; }); return { day: p.weekday, mins: Number(p.hour) * 60 + Number(p.minute) }; }
  const officeOpen = () => { const n = pkNow(); return n.day !== 'Sun' && n.mins >= 9 * 60 && n.mins < 17 * 60; };
  const ME = { avatar: null, gender: '', status: 'available', status_note: '', status_until: null };
  let TEAM = null, teamErr = '', teamAt = null;

  // an "until" date in the past means the person is back
  const eff = (p) => (p.status_until && p.status_until < today() ? Object.assign({}, p, { status: 'available', status_note: null, status_until: null }) : p);
  const online = (p) => p.last_seen && Date.now() - new Date(p.last_seen).getTime() < 5 * 60 * 1000;
  function ago(iso) {
    if (!iso) return 'Not signed in yet';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 5) return 'Online now';
    if (m < 60) return 'Last seen ' + m + ' min ago';
    if (m < 60 * 24) return 'Last seen ' + Math.round(m / 60) + ' h ago';
    return 'Last seen ' + X.docs.pkStamp(iso);
  }
  const initialsOf = (name) => (name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  function avatar(p, name, size, dot) {
    const s = eff(p || {}), img = s.avatar ? '<img src="' + esc(s.avatar) + '" alt="">' : '<span>' + esc(initialsOf(name)) + '</span>';
    return '<span class="pav" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px">' + img + (dot ? '<i class="pdot ' + ST[s.status || 'available'][1] + '" title="' + ST[s.status || 'available'][0] + '"></i>' : '') + '</span>';
  }
  const pill = (st) => '<span class="spill ' + ST[st || 'available'][1] + '"><i></i>' + ST[st || 'available'][0] + '</span>';

  // ---------- data ----------
  const demo = () => { try { return JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch (e) { return {}; } };
  async function myId() { const r = await X.sb.auth.getSession(); return r.data && r.data.session ? r.data.session.user.id : null; }
  async function loadMe() {
    if (!canEdit() && UI.role !== 'owner') return;
    if (!LIVE) { Object.assign(ME, { avatar: null, gender: '', status: 'available', status_note: '', status_until: null }, demo()[UI.role] || {}); demoCheckin(); return; }
    try {
      const id = await myId(); if (!id) return;
      if (canEdit()) await X.sb.rpc('auto_checkin').then(() => {}, () => {}); // daily check-in during office hours
      const r = await X.sb.from('profiles').select('avatar,gender,status,status_note,status_until').eq('id', id).maybeSingle();
      if (!r.error && r.data) Object.assign(ME, r.data);
      if (!canEdit()) ping();
    } catch (e) { console.error(e); }
  }
  async function saveMe(p) {
    if (!LIVE) { const d = demo(), old = d[UI.role] || {}; d[UI.role] = Object.assign({}, old, p, { last_seen: new Date().toISOString(), status_set_on: old.status !== p.status ? today() : old.status_set_on }); localStorage.setItem(DKEY, JSON.stringify(d)); Object.assign(ME, p); return; }
    const r = await X.sb.rpc('my_profile_save', { p_avatar: p.avatar || null, p_gender: p.gender || '', p_status: p.status, p_note: p.status_note || '', p_until: p.status_until || null });
    if (r.error) throw r.error;
    Object.assign(ME, p);
  }
  async function loadTeam() {
    teamErr = '';
    try {
      if (!LIVE) {
        const d = demo(), names = { admin: 'Haroon Iftikhar', accountant: 'Muhammad Wasif', hr: 'HR', procurement: 'Farhan Ali' };
        TEAM = EDIT.map((r) => Object.assign({ id: r, role: r, name: names[r], email: '', status: 'available', last_seen: null }, d[r] || {}));
      } else {
        const r = await X.sb.rpc('team_status'); if (r.error) throw r.error; TEAM = r.data;
      }
      teamAt = new Date();
    } catch (e) { console.error(e); TEAM = TEAM || []; teamErr = e.message || String(e); }
    if (UI.view === 'team' && !X.typing()) X.render();
  }
  function demoCheckin() {
    if (!canEdit() || !officeOpen()) return;
    const d = demo(), p = d[UI.role] || {}, t = today();
    p.last_seen = new Date().toISOString();
    if (p.status_auto_on !== t) {
      p.status_auto_on = t;
      const onLeave = p.status === 'ooo' && (!p.status_until || p.status_until >= t);
      if (!onLeave && p.status_set_on !== t && p.status && p.status !== 'available') { p.status = 'available'; p.status_note = null; p.status_until = null; Object.assign(ME, { status: 'available', status_note: null, status_until: null }); }
    }
    d[UI.role] = p; localStorage.setItem(DKEY, JSON.stringify(d));
  }
  function ping() {
    if (document.hidden) return;
    if (!LIVE) { const before = ME.status; demoCheckin(); if (ME.status !== before && !X.typing()) X.render(); return; }
    if (!X.sb) return;
    if (canEdit()) X.sb.rpc('auto_checkin').then((r) => { if (r && !r.error && r.data && r.data !== ME.status) { Object.assign(ME, { status: r.data }, r.data === 'available' ? { status_note: null, status_until: null } : {}); DRAFT = null; if (!X.typing()) X.render(); } }, () => {});
    else if (UI.role === 'owner') X.sb.rpc('touch_presence').then(() => {}, () => {});
  }
  setInterval(ping, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  setInterval(() => { if (UI.view === 'team' && !document.hidden && canSee()) loadTeam(); }, 60 * 1000);

  // ---------- My profile ----------
  let DRAFT = null;
  function vProfile() {
    if (!DRAFT) DRAFT = Object.assign({}, eff(ME));
    const d = DRAFT, name = UI.name || UI.user || 'Demo user';
    let h = '<div class="page-h"><div><h1>My profile</h1><p class="sub">Your photo and status are shown to the owner and the admin on the Team status page.</p></div></div>';
    h += '<div class="card prof"><div class="prof-l">' + avatar(d, name, 120, false) + '<label class="b sm">' + (d.avatar ? 'Change photo' : 'Upload photo') + '<input type="file" accept="image/*" hidden data-chg="pfPhoto"></label>' + (d.avatar ? '<button class="link" data-act="pfNoPhoto">Remove photo</button>' : '') + '</div>';
    h += '<div class="prof-r"><table class="kv"><tr><td>Name</td><td><b>' + esc(name) + '</b></td></tr>' + (UI.user ? '<tr><td>Email</td><td>' + esc(UI.user) + '</td></tr>' : '') + '<tr><td>Role</td><td>' + esc(ROLE_L[UI.role] || UI.role) + '</td></tr><tr><td>Gender</td><td><select id="pf-gender"><option value="">Prefer not to say</option><option value="M"' + (d.gender === 'M' ? ' selected' : '') + '>Male</option><option value="F"' + (d.gender === 'F' ? ' selected' : '') + '>Female</option></select></td></tr></table><p class="mut" style="font-size:12px;margin:8px 0 0">Your name, email and role are set by the admin.</p></div></div>';
    h += '<div class="card"><h2 style="margin-top:0">Status</h2><div class="stgrid">' + Object.keys(ST).map((k) => '<button class="stopt' + (d.status === k ? ' on' : '') + '" data-act="pfStatus" data-s="' + k + '">' + pill(k) + '<small>' + ST_HINT[k] + '</small></button>').join('') + '</div>';
    h += '<div class="form" style="margin-top:14px"><label class="span2">What are you doing? (optional)<input id="pf-note" maxlength="120" value="' + esc(d.status_note || '') + '" placeholder="' + (d.status === 'ooo' ? 'On leave, back on Monday' : d.status === 'busy' ? 'Meeting with PepsiCo team' : 'At the Nestle site today') + '"></label><label>' + (d.status === 'available' ? 'Clear the note after' : 'Back on / clear after') + '<input type="date" id="pf-until" value="' + esc(d.status_until || '') + '" min="' + today() + '"></label></div>';
    h += '<p class="mut" style="font-size:12px;margin:10px 0 0">Your status saves as soon as you click it. During office hours (9 AM to 5 PM, Monday to Saturday) you are set to Available the first time you open the system each day, unless you are on leave.</p><p style="margin:12px 0 0;display:flex;gap:8px"><button class="b pri" data-act="pfSave">Save</button><button class="b" data-act="pfReset">Undo changes</button></p></div>';
    return h;
  }

  // ---------- Team status (owner and admin) ----------
  function vTeam() {
    if (TEAM === null) { setTimeout(loadTeam, 0); return '<div class="page-h"><div><h1>Team status</h1></div></div><div class="card"><p class="mut">Loading…</p></div>'; }
    const list = TEAM.map(eff), c = { available: 0, busy: 0, away: 0, ooo: 0 }; let on = 0;
    list.forEach((p) => { c[p.status || 'available']++; if (online(p)) on++; });
    let h = '<div class="page-h"><div><h1>Team status</h1><p class="sub">Admin, accountant, HR and procurement. Online means the system is open on their device now.</p></div><div class="page-r"><span class="live"><i></i>Updated ' + (teamAt ? teamAt.toLocaleTimeString('en-GB') : '') + '</span><button class="b" data-act="teamReload">Refresh</button></div></div>';
    if (teamErr) h += '<div class="banner" style="background:var(--bad-bg);color:var(--bad)"><b>Sorry for the inconvenience.</b> The team list could not be loaded. Please contact the developer. <small>' + esc(teamErr) + '</small></div>';
    h += '<div class="cards kpi">' + X.stat('Online now', on, 'ok') + X.stat('Available', c.available) + X.stat('Busy', c.busy) + X.stat('Away', c.away) + X.stat('Out of office', c.ooo) + '</div>';
    if (!list.length) return h + '<div class="card"><p class="mut">No staff logins yet.</p></div>';
    h += '<div class="team">' + list.map((p) => '<div class="tm"><div class="tm-h">' + avatar(p, p.name || p.email, 56, false) + '<i class="pres ' + (online(p) ? 'on' : '') + '" title="' + (online(p) ? 'Online' : 'Offline') + '"></i><div><b>' + esc(p.name || p.email || '') + '</b><span>' + esc(ROLE_L[p.role] || p.role) + '</span></div></div>' + (shown(p) === p.status ? pill(p.status) : '<span class="spill st-off"><i></i>' + shown(p) + '</span>') + (p.status_note ? '<p class="tm-note">' + esc(p.status_note) + '</p>' : '') + (p.status_until ? '<p class="mut tm-until">' + (p.status === 'available' ? 'Until ' : 'Back ') + X.dmy(p.status_until) + '</p>' : '') + '<p class="tm-seen ' + (online(p) ? 'on' : '') + '">' + ago(p.last_seen) + '</p>' + (p.email ? '<a class="tm-mail" href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : '') + '</div>').join('') + '</div>';
    return h;
  }

  // The status a person chose stays, but a stale one is labelled: nobody has seen them today, or the office is closed.
  function shown(p) {
    if (p.status === 'ooo' || online(p)) return p.status;
    const seenToday = p.last_seen && X.docs.pkDay(new Date(p.last_seen)) === today();
    if (!seenToday) return 'Not in today';
    if (!officeOpen()) return 'Off hours';
    return p.status;
  }
  // ---------- photo: cut to a square and shrink, so it stays small ----------
  function shrink(file) {
    return new Promise((ok, no) => {
      if (!/^image\//.test(file.type)) return no(new Error('Choose a photo (JPG or PNG).'));
      const fr = new FileReader();
      fr.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(img.width, img.height), cv = document.createElement('canvas'); cv.width = cv.height = 220; cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 220, 220); ok(cv.toDataURL('image/jpeg', 0.82)); }; img.onerror = () => no(new Error('That photo could not be read. Try a JPG or PNG.')); img.src = fr.result; };
      fr.readAsDataURL(file);
    });
  }
  const readForm = () => { const g = $('#pf-gender'), n = $('#pf-note'), u = $('#pf-until'); if (g) DRAFT.gender = g.value; if (n) DRAFT.status_note = n.value.trim(); if (u) DRAFT.status_until = u.value || null; };
  Object.assign(A, {
    async pfStatus(el) {
      readForm();
      const s = el.dataset.s, clear = s === 'available';
      if (s === ME.status) return;
      // save only the status (and clear the old note when going back to Available); typed but unsaved changes stay on the form
      await saveMe(Object.assign({}, ME, { status: s }, clear ? { status_note: null, status_until: null } : {}));
      DRAFT.status = s; if (clear) { DRAFT.status_note = ''; DRAFT.status_until = null; }
      X.render(); toast('Status: ' + ST[s][0] + '.');
    },
    pfNoPhoto() { readForm(); DRAFT.avatar = null; X.render(); },
    pfReset() { DRAFT = null; X.render(); },
    async pfSave() {
      readForm();
      if (DRAFT.status_until && DRAFT.status_until < today()) return toast('Choose today or a later date.');
      await saveMe({ avatar: DRAFT.avatar || null, gender: DRAFT.gender || '', status: DRAFT.status, status_note: DRAFT.status_note || '', status_until: DRAFT.status_until || null });
      DRAFT = null; X.render(); toast('Saved. Your status is now ' + ST[ME.status][0] + '.');
    },
    teamReload() { loadTeam(); }
  });
  Object.assign(C, { async pfPhoto(el) { const f = el.files && el.files[0]; if (!f) return; readForm(); DRAFT.avatar = await shrink(f); X.render(); toast('Photo ready. Press Save to keep it.'); } });
  ['pfStatus', 'pfNoPhoto', 'pfReset', 'pfSave'].forEach((k) => { EXT.actAllowed[k] = canEdit; });
  EXT.actAllowed.teamReload = canSee;
  EXT.chgAllowed.pfPhoto = canEdit;

  // ---------- register with the app ----------
  Object.assign(EXT.views, { profile: vProfile, team: vTeam });
  EXT.nav.push({ group: 'Overview', item: ['team', 'Team status', 'users'] });
  ['hr', 'procurement'].forEach((r) => EXT.roleViews[r].push('profile'));
  EXT.roleViews.accountant = (EXT.roleViews.accountant || []).concat(['profile']);
  EXT.roleViews.owner.push('team');
  EXT.avatar = (initials) => (canEdit() || UI.role === 'owner' ? avatar(ME, UI.name || UI.user || initials, 34, canEdit()) : '<span class="av">' + esc(initials) + '</span>');
  EXT.statusLine = () => (canEdit() ? '<span class="mstat">' + ST[eff(ME).status][0] + (eff(ME).status_note ? ' · ' + esc(eff(ME).status_note) : '') + '</span>' : '');
  EXT.loaders.push(loadMe);
  const prevRole = EXT.onRole; EXT.onRole = () => { if (prevRole) prevRole(); DRAFT = null; TEAM = null; loadMe().then(() => X.render()); };
  const prevOut = EXT.onLogout; EXT.onLogout = () => { if (prevOut) prevOut(); Object.assign(ME, { avatar: null, gender: '', status: 'available', status_note: '', status_until: null }); TEAM = null; DRAFT = null; };
  X.startApp();
})();
