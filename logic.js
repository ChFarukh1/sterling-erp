// Sterling payroll: calculation rules. No screen code in this file.
(function (root) {
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const has = (v) => v !== null && v !== undefined && v !== '';
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

  // One salary line. A typed amount (days_amount, ot_amount, net_override) always wins over the calculation.
  function calcLine(l) {
    const daysCalc = num(l.days) * num(l.rate);
    const otCalc = num(l.ot_hours) * num(l.ot_rate);
    const daysAmt = has(l.days_amount) ? num(l.days_amount) : daysCalc;
    const otAmt = has(l.ot_amount) ? num(l.ot_amount) : otCalc;
    const gross = daysAmt + otAmt + num(l.allowances);
    const netCalc = gross - num(l.advance) - num(l.deductions);
    const net = has(l.net_override) ? num(l.net_override) : netCalc;
    return { daysCalc: r2(daysCalc), otCalc: r2(otCalc), daysAmt: r2(daysAmt), otAmt: r2(otAmt), gross: r2(gross), netCalc: r2(netCalc), net: r2(net) };
  }

  const linePaid = (l) => has(l.paid_on);

  // Working set for one pass over the data: salary lines grouped by run, advance balances and shared accounts.
  // The app switches the cache on and clears it after every change, so big data is only walked once per screen.
  let cacheOn = false, CACHE = null;
  function ctx(state) {
    if (cacheOn && CACHE && CACHE.state === state) return CACHE;
    const byRun = {};
    state.run_lines.forEach((l) => { (byRun[l.run_id] || (byRun[l.run_id] = [])).push(l); });
    const c = { state, byRun, bal: null, shared: null };
    if (cacheOn) CACHE = c;
    return c;
  }
  const linesOf = (state, runId) => ctx(state).byRun[runId] || [];
  function balMap(state) { const c = ctx(state); if (!c.bal) { c.bal = {}; advanceBalances(state).forEach((b) => { c.bal[b.employee_id] = b.balance; }); } return c.bal; }
  function sharedMap(state) { const c = ctx(state); if (!c.shared) c.shared = sharedAccounts(state); return c.shared; }

  // A run is open, part paid, or paid, depending on how many of its employees are marked paid.
  function runState(state, run) {
    const lines = linesOf(state, run.id), paid = lines.filter(linePaid).length;
    return { total: lines.length, paid, state: lines.length && paid === lines.length ? 'paid' : paid ? 'part' : 'open' };
  }

  // The most recent earlier run of the same site, used by "copy from the last run".
  function lastRun(state, siteId, excludeId) {
    const list = state.runs.map((r, i) => ({ r, i })).filter((x) => x.r.site_id === siteId && x.r.id !== excludeId);
    list.sort((a, b) => (b.r.date_to || b.r.date_from || '').localeCompare(a.r.date_to || a.r.date_from || '') || b.i - a.i);
    return list.length ? list[0].r : null;
  }

  // Working employees who hold the same account number without being linked by "paid through".
  function sharedAccounts(state) {
    const groups = {}, out = {};
    state.employees.forEach((e) => {
      if (e.active === false || e.paid_through || !hasAccount(e)) return;
      const k = String(e.account_no).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (k) (groups[k] || (groups[k] = [])).push(e);
    });
    Object.values(groups).forEach((list) => { if (list.length > 1) list.forEach((e) => { out[e.id] = list.filter((x) => x.id !== e.id); }); });
    return out;
  }

  const byId = (list) => { const m = {}; (list || []).forEach((x) => { m[x.id] = x; }); return m; };

  function siteIdsUnder(sites, id) {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      sites.forEach((s) => { if (s.parent_id && out.has(s.parent_id) && !out.has(s.id)) { out.add(s.id); grew = true; } });
    }
    return out;
  }

  function topSite(sitesById, id) {
    let s = sitesById[id], guard = 0;
    while (s && s.parent_id && sitesById[s.parent_id] && guard++ < 10) s = sitesById[s.parent_id];
    return s;
  }

  function siteLabel(sitesById, id) {
    const s = sitesById[id];
    if (!s) return 'No site';
    const p = s.parent_id && sitesById[s.parent_id];
    if (!p || s.name.toLowerCase().indexOf(p.name.toLowerCase()) === 0) return s.name;
    return p.name + ' – ' + s.name;
  }

  const rangesOverlap = (a1, a2, b1, b2) => !!(a1 && a2 && b1 && b2) && a1 <= b2 && b1 <= a2;

  // Runs matching the filter {siteId, from, to}. Undated runs only match when no dates are asked for.
  function filterRuns(state, f) {
    f = f || {};
    const ids = f.siteId ? siteIdsUnder(state.sites, f.siteId) : null;
    const skippedUndated = [];
    const runs = state.runs.filter((r) => {
      if (ids && !ids.has(r.site_id)) return false;
      if (f.from || f.to) {
        if (!r.date_from || !r.date_to) { skippedUndated.push(r); return false; }
        if (f.from && r.date_to < f.from) return false;
        if (f.to && r.date_from > f.to) return false;
      }
      return true;
    });
    return { runs, skippedUndated };
  }

  // Who actually receives the money for this employee (follows "paid through").
  function payeeOf(empById, emp) {
    let e = emp, guard = 0;
    while (e && e.paid_through && empById[e.paid_through] && guard++ < 6) e = empById[e.paid_through];
    return e || emp;
  }

  const hasAccount = (e) => !!(e && has(e.account_no) && String(e.account_no).trim());

  function channelOf(e) {
    if (!hasAccount(e)) return 'No account';
    if (e.pay_method === 'UBL') return 'UBL';
    if (e.pay_method === 'Wallet') return 'Wallet';
    return 'Other bank';
  }

  function linesOfRuns(state, runs) {
    const set = new Set(runs.map((r) => r.id));
    return state.run_lines.filter((l) => set.has(l.run_id));
  }

  function summarize(state, f) {
    const sitesById = byId(state.sites), empById = byId(state.employees), runById = byId(state.runs);
    const { runs, skippedUndated } = filterRuns(state, f);
    const lines = linesOfRuns(state, runs);
    const t = { gross: 0, advance: 0, deductions: 0, net: 0, paid: 0, pending: 0, people: 0, ready: 0, missing: 0, negative: 0, runs: runs.length, skippedUndated: skippedUndated.length };
    const groups = {}, people = new Set();
    lines.forEach((l) => {
      const c = calcLine(l), run = runById[l.run_id], emp = empById[l.employee_id];
      const g = f && f.siteId ? sitesById[run.site_id] : topSite(sitesById, run.site_id);
      const key = g ? g.id : 'none';
      const row = groups[key] || (groups[key] = { siteId: key, name: g ? g.name : 'No site', sort: g ? num(g.sort) : 999, people: new Set(), gross: 0, advance: 0, deductions: 0, net: 0, paid: 0, pending: 0, missing: 0, negative: 0 });
      row.people.add(l.employee_id); people.add(l.employee_id);
      row.gross += c.gross; row.advance += num(l.advance); row.deductions += num(l.deductions); row.net += c.net;
      t.gross += c.gross; t.advance += num(l.advance); t.deductions += num(l.deductions); t.net += c.net;
      if (linePaid(l)) { row.paid += c.net; t.paid += c.net; } else { row.pending += c.net; t.pending += c.net; }
      if (c.net < 0) { row.negative++; t.negative++; }
      if (c.net > 0 && !linePaid(l)) {
        if (hasAccount(payeeOf(empById, emp))) t.ready++; else { t.missing++; row.missing++; }
      }
    });
    t.people = people.size;
    const sites = Object.values(groups).map((g) => Object.assign(g, { people: g.people.size })).sort((a, b) => a.sort - b.sort);
    ['gross', 'advance', 'deductions', 'net', 'paid', 'pending'].forEach((k) => { t[k] = r2(t[k]); sites.forEach((s) => { s[k] = r2(s[k]); }); });
    return { totals: t, sites, runs };
  }

  function runTotals(state, run) {
    const lines = linesOf(state, run.id);
    const t = { people: lines.length, gross: 0, advance: 0, deductions: 0, net: 0, paid: 0, pending: 0 };
    lines.forEach((l) => { const c = calcLine(l); t.gross += c.gross; t.net += c.net; t.advance += num(l.advance); t.deductions += num(l.deductions); if (linePaid(l)) t.paid += c.net; else t.pending += c.net; });
    ['gross', 'advance', 'deductions', 'net', 'paid', 'pending'].forEach((k) => { t[k] = r2(t[k]); });
    return t;
  }

  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000) + 1;

  // Warnings never block anything. They are shown so the accountant can decide.
  function runWarnings(state, run) {
    const out = [], empById = byId(state.employees);
    const lines = linesOf(state, run.id);
    if (!run.date_from || !run.date_to) out.push('The from and to dates are not set.');
    else if (run.date_from > run.date_to) out.push('The from date is after the to date.');
    else {
      state.runs.forEach((o) => {
        if (o.id !== run.id && o.site_id === run.site_id && rangesOverlap(run.date_from, run.date_to, o.date_from, o.date_to)) {
          out.push('Dates overlap another run for this site (' + (o.label || o.date_from + ' to ' + o.date_to) + ').');
        }
      });
      const len = daysBetween(run.date_from, run.date_to);
      const over = lines.filter((l) => num(l.days) > len).length;
      if (over) out.push(over + ' employee(s) have more days than the ' + len + ' days in this period.');
    }
    let missing = 0, neg = 0, zero = 0, sharedN = 0;
    const shared = sharedMap(state);
    const typedNet = lines.filter((l) => has(l.net_override) && Math.abs(calcLine(l).netCalc - num(l.net_override)) > 0.01).length;
    if (typedNet) out.push(typedNet + ' employee(s) have a net typed by hand that differs from the calculation (yellow boxes).');
    const seen = {}; let dup = 0;
    lines.forEach((l) => {
      const c = calcLine(l), e = empById[l.employee_id];
      if (seen[l.employee_id]) dup++; seen[l.employee_id] = 1;
      if (c.net < 0) neg++;
      if (c.net === 0) zero++;
      if (c.net > 0 && !linePaid(l) && !hasAccount(payeeOf(empById, e))) missing++;
      if (c.net > 0 && !linePaid(l) && e && shared[payeeOf(empById, e).id]) sharedN++;
    });
    if (sharedN) out.push(sharedN + ' employee(s) are paid to an account that another, unlinked employee also uses. Check Bank details.');
    const bal = balMap(state);
    const owing = lines.filter((l) => !linePaid(l) && bal[l.employee_id] > 0);
    if (owing.length) out.push(owing.length + ' employee(s) in this run still owe an advance, ' + Math.round(owing.reduce((t, l) => t + bal[l.employee_id], 0)).toLocaleString('en-US') + ' in total. Use Deduct under the Advance box.');
    if (missing) out.push(missing + ' employee(s) with pay due have no bank or wallet account.');
    if (neg) out.push(neg + ' employee(s) have negative net pay (advance or deductions above earnings).');
    if (dup) out.push(dup + ' employee(s) appear more than once in this run.');
    if (!lines.length) out.push('This run has no employees yet.');
    return out;
  }

  // The list to pay: one row per receiving account, so a supervisor gets one transfer for his team.
  function buildPayments(state, runIds) {
    const set = new Set(runIds), empById = byId(state.employees), runById = byId(state.runs), sitesById = byId(state.sites);
    const rows = {}, missing = [], skipped = [], payIds = [], zeroIds = [];
    state.run_lines.filter((l) => set.has(l.run_id) && !linePaid(l)).forEach((l) => {
      const c = calcLine(l), emp = empById[l.employee_id] || { name: 'Unknown', emp_code: '' };
      const site = siteLabel(sitesById, runById[l.run_id].site_id);
      if (c.net <= 0) { zeroIds.push(l.id); if (c.net < 0) skipped.push({ code: emp.emp_code, name: emp.name, site, amount: c.net }); return; }
      const p = payeeOf(empById, emp);
      if (!hasAccount(p)) { missing.push({ code: emp.emp_code, name: emp.name, site, amount: c.net, via: p.id !== emp.id ? p.name : '' }); return; }
      const key = channelOf(p) + '|' + String(p.account_no).replace(/\W/g, '') + '|' + (p.account_title || p.name);
      const row = rows[key] || (rows[key] = { channel: channelOf(p), title: p.account_title || p.name, bank: p.bank || '', account: p.account_no, amount: 0, covers: [], sites: new Set() });
      payIds.push(l.id); row.amount += c.net; row.covers.push(emp.name + (emp.emp_code ? ' (' + emp.emp_code + ')' : '')); row.sites.add(site);
    });
    const order = { UBL: 0, 'Other bank': 1, Wallet: 2 };
    const list = Object.values(rows).map((r) => Object.assign(r, { amount: r2(r.amount), sites: Array.from(r.sites).join(', ') }))
      .sort((a, b) => order[a.channel] - order[b.channel] || a.sites.localeCompare(b.sites) || a.title.localeCompare(b.title));
    const totals = { UBL: 0, 'Other bank': 0, Wallet: 0, all: 0, missing: 0 };
    list.forEach((r) => { totals[r.channel] += r.amount; totals.all += r.amount; });
    missing.forEach((m) => { totals.missing += m.amount; });
    Object.keys(totals).forEach((k) => { totals[k] = r2(totals[k]); });
    return { rows: list, missing, skipped, totals, payIds, zeroIds };
  }

  function advanceBalances(state) {
    const m = {};
    const get = (id) => m[id] || (m[id] = { employee_id: id, given: 0, recovered: 0 });
    state.advances.forEach((a) => { get(a.employee_id).given += num(a.amount); });
    state.run_lines.forEach((l) => { if (num(l.advance)) get(l.employee_id).recovered += num(l.advance); });
    return Object.values(m).map((x) => ({ employee_id: x.employee_id, given: r2(x.given), recovered: r2(x.recovered), balance: r2(x.given - x.recovered) }));
  }

  // Advances for the dashboard: what was given (inside the date filter) and what is still to be recovered.
  function advanceSummary(state, f) {
    f = f || {};
    const ids = f.siteId ? siteIdsUnder(state.sites, f.siteId) : null, empById = byId(state.employees);
    const inSite = (id) => !ids || (empById[id] && ids.has(empById[id].site_id));
    let given = 0, outstanding = 0, people = 0;
    state.advances.forEach((a) => {
      if (!inSite(a.employee_id)) return;
      if (!a.given_on) return; // opening balances from before the system are not counted as newly given
      if (f.from && (a.given_on || '') < f.from) return;
      if (f.to && (a.given_on || '9999') > f.to) return;
      given += num(a.amount);
    });
    advanceBalances(state).forEach((b) => { if (inSite(b.employee_id) && b.balance > 0) { outstanding += b.balance; people++; } });
    return { given: r2(given), outstanding: r2(outstanding), people };
  }

  // True when paying "emp" through "throughId" would loop back to himself.
  function paidThroughLoops(empById, empId, throughId) {
    let id = throughId, guard = 0;
    while (id && guard++ < 50) { if (id === empId) return true; id = empById[id] && empById[id].paid_through; }
    return false;
  }

  // Next free employee code for a site: the site's own prefix and the next number.
  // A site with no employees yet gets a prefix that no other site is using.
  function nextEmpCode(state, site) {
    // each code is read as a lead ("PEP-" or "A") followed by a number
    const codes = state.employees.filter((e) => e.emp_code).map((e) => ({ site: e.site_id, m: String(e.emp_code).trim().match(/^(.*?-?)(\d+)$/) })).filter((x) => x.m);
    const mine = codes.filter((x) => site && x.site === site.id);
    let lead, width = 3;
    if (mine.length) {
      const count = {}; mine.forEach((x) => { count[x.m[1]] = (count[x.m[1]] || 0) + 1; });
      lead = Object.keys(count).sort((a, b) => count[b] - count[a])[0]; width = 1;
    } else {
      const words = (site ? site.name : 'EMP').toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean), flat = words.join('') || 'EMP';
      const taken = new Set(codes.map((x) => x.m[1].replace(/-$/, '').toUpperCase()));
      const tries = [flat.slice(0, 3), words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : '', flat.slice(0, 2) + flat.slice(-1), flat.slice(0, 4), flat.slice(0, 5)].filter((x) => x.length >= 2);
      let prefix = tries.find((x) => !taken.has(x));
      for (let n = 2; !prefix; n++) if (!taken.has(flat.slice(0, 3) + n)) prefix = flat.slice(0, 3) + n;
      lead = prefix + '-';
    }
    let max = 0;
    codes.forEach((x) => { if (x.m[1].toUpperCase() === lead.toUpperCase()) { max = Math.max(max, Number(x.m[2])); width = Math.max(width, x.m[2].length); } });
    return lead + String(max + 1).padStart(width, '0');
  }

  const api = { setCache: (on) => { cacheOn = !!on; CACHE = null; }, invalidate: () => { CACHE = null; }, linesOf, num, has, r2, calcLine, linePaid, runState, lastRun, sharedAccounts, byId, siteIdsUnder, topSite, siteLabel, rangesOverlap, filterRuns, payeeOf, hasAccount, channelOf, summarize, runTotals, runWarnings, buildPayments, advanceBalances, advanceSummary, paidThroughLoops, nextEmpCode, daysBetween };
  root.PL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
