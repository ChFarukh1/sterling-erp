// Sterling: procurement. Material request -> RFQ -> quotations -> comparative statement -> approval
// -> purchase order -> follow-up -> delivery, inspection and documents. Loads after hr.js.
(function () {
  'use strict';
  const X = window.SEC;
  const { UI, EXT, A, C, LIVE, $, esc, uuid, toast, numOrNull, strOrNull } = X;
  const PKEY = 'sterling_proc_demo_v1';
  const P = { suppliers: [], requests: [], quotes: [], orders: [], receipts: [], events: [], files: [] };
  const TBL = { suppliers: 'suppliers', requests: 'proc_requests', quotes: 'proc_quotes', orders: 'proc_orders', receipts: 'proc_receipts', files: 'proc_files' };
  const D = () => X.docs;
  const today = () => D().pkDay();
  const dmy = X.dmy;
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const money = (v) => Math.round(num(v)).toLocaleString('en-US');
  const money2 = (v) => r2(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const viewer = () => ['admin', 'owner', 'procurement'].includes(UI.role);
  const isProc = () => ['admin', 'procurement'].includes(UI.role);
  const canApprove = () => ['admin', 'owner'].includes(UI.role);
  const who = () => UI.name || UI.user || 'Demo user';
  const byId = (list, id) => list.find((x) => x.id === id);
  const sup = (id) => byId(P.suppliers, id) || { name: 'Unknown supplier' };
  const STAGE = { draft: ['Draft', 'p-inf'], rfq: ['RFQ sent', 'p-inf'], evaluation: ['Evaluating quotes', 'p-warn'], approval: ['Waiting for approval', 'p-warn'], approved: ['Approved', 'p-ok'], ordered: ['PO issued', 'p-ok'], closed: ['Closed', 'p-ok'], cancelled: ['Cancelled', 'p-bad'] };
  const PO_ST = { issued: ['Issued', 'p-inf'], partial: ['Partly received', 'p-warn'], received: ['Received', 'p-ok'], closed: ['Closed', 'p-ok'], cancelled: ['Cancelled', 'p-bad'] };
  const stagePill = (s) => '<span class="pill ' + (STAGE[s] || ['', ''])[1] + '">' + (STAGE[s] || [s])[0] + '</span>';
  const DOCS = [['mtc', 'Material Test Certificate (MTC)'], ['coc', 'Certificate of Conformity (COC)'], ['datasheet', 'Technical datasheet'], ['inspection', 'Inspection report'], ['warranty', 'Warranty certificate'], ['om', 'Operation and maintenance manual']];
  const UNITS = ['No', 'Set', 'Lot', 'Mtr', 'Rft', 'Sqm', 'Sqft', 'Kg', 'Ton', 'Ltr', 'Box', 'Roll', 'Pair', 'Length', 'Bag'];
  const CURR = ['PKR', 'USD', 'AED', 'EUR', 'CNY', 'GBP'];
  const SUBMITTAL = ['Not required', 'To submit', 'Submitted', 'Approved', 'Approved with comments', 'Rejected, resubmit'];

  // ---------- storage ----------
  function loadDemo() { try { const d = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (d) Object.keys(P).forEach((k) => { P[k] = d[k] || []; }); } catch (e) { /* start empty */ } }
  function saveDemo() { if (LIVE) return; try { localStorage.setItem(PKEY, JSON.stringify(P)); } catch (e) { toast('This browser could not store the demo data (files may be too big).'); } }
  const sb = () => X.sb;
  const check = (r) => { if (r.error) throw r.error; return r.data; };
  async function loadAll() {
    if (!viewer()) return;
    if (!LIVE) { loadDemo(); return; }
    const all = async (t, order) => { let out = [], n = 0; for (;;) { const r = check(await sb().from(t).select('*').order(order || 'id').range(n * 1000, n * 1000 + 999)); out = out.concat(r); if (r.length < 1000) return out; n++; } };
    try {
      const [s, r, q, o, rc, f, ev] = await Promise.all([all('suppliers'), all('proc_requests'), all('proc_quotes'), all('proc_orders'), all('proc_receipts'), all('proc_files'), sb().from('proc_events').select('*').order('at', { ascending: false }).limit(3000)]);
      Object.assign(P, { suppliers: s, requests: r, quotes: q, orders: o, receipts: rc, files: f, events: ev.error ? [] : ev.data });
      UI.procErr = '';
    } catch (e) { console.error(e); UI.procErr = e.message || String(e); }
  }
  async function put(key, row) {
    const list = P[key], i = list.findIndex((x) => x.id === row.id), old = i >= 0 ? list[i] : null;
    if (i >= 0) list[i] = row; else list.push(row);
    if (!LIVE) { saveDemo(); return row; }
    try {
      const send = Object.assign({}, row); if (!old) delete send.created_by;
      if (key === 'requests') delete send.updated_at;
      check(await sb().from(TBL[key]).upsert(send));
    } catch (e) { if (old) list[i] = old; else P[key] = list.filter((x) => x.id !== row.id); X.render(); throw e; }
    return row;
  }
  async function del(key, id) {
    const old = byId(P[key], id); P[key] = P[key].filter((x) => x.id !== id);
    if (!LIVE) { saveDemo(); return; }
    try { check(await sb().from(TBL[key]).delete().eq('id', id)); } catch (e) { if (old) P[key].push(old); X.render(); throw e; }
  }
  async function ev(e) {
    const row = Object.assign({ id: Date.now() + Math.random(), at: new Date().toISOString(), who: LIVE ? UI.user : who(), request_id: null, order_id: null, kind: '', note: null, expected_on: null }, e);
    P.events.unshift(row);
    if (!LIVE) { saveDemo(); return; }
    try { const s = Object.assign({}, row); delete s.id; delete s.at; delete s.who; check(await sb().from('proc_events').insert(s)); } catch (err) { console.error(err); toast('Saved, but the activity note could not be recorded.'); }
  }
  async function decide(req, decision, note) {
    if (LIVE) { check(await sb().rpc('proc_decide', { p_request: req.id, p_decision: decision, p_note: note || '' })); await loadAll(); return; }
    Object.assign(req, { approval_status: decision, approval_by: who(), approval_at: new Date().toISOString(), approval_note: note || null, stage: decision === 'approved' ? 'approved' : 'evaluation' });
    P.events.unshift({ id: Date.now(), at: new Date().toISOString(), who: who(), request_id: req.id, kind: decision === 'approved' ? 'Approved' : 'Rejected', note: note || null });
    saveDemo();
  }
  async function upload(file, link, kind) {
    const row = Object.assign({ id: uuid(), request_id: null, quote_id: null, order_id: null, receipt_id: null, kind: kind, name: file.name, size: file.size, created_at: new Date().toISOString(), created_by: LIVE ? UI.user : who() }, link);
    if (LIVE) {
      row.path = (link.order_id || link.request_id || link.quote_id || 'misc') + '/' + row.id + '-' + file.name.replace(/[^\w.\-]+/g, '_');
      const r = await sb().storage.from('procurement').upload(row.path, file, { upsert: false });
      if (r.error) throw new Error('File upload failed: ' + r.error.message + '. Check that the "procurement" storage bucket exists (see README).');
    } else {
      if (file.size > 1500000) { row.path = null; toast('Demo mode keeps only the name of files over 1.5 MB.'); }
      else row.path = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(file); });
    }
    await put('files', row);
    return row;
  }
  async function openFile(f) {
    if (!f.path) return toast('Only the file name was kept for this document.');
    if (!LIVE) { const a = document.createElement('a'); a.href = f.path; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); return; }
    const r = await sb().storage.from('procurement').createSignedUrl(f.path, 300);
    if (r.error) throw r.error;
    window.open(r.data.signedUrl, '_blank');
  }

  // ---------- calculations ----------
  const reqItems = (r) => (r && Array.isArray(r.items) ? r.items : []);
  function quoteTotals(q, req) {
    const items = reqItems(req), lines = q.lines || [];
    let sub = 0; const per = {};
    items.forEach((it) => { const l = lines.find((x) => x.item === it.id); if (!l || !l.price) return; per[it.id] = num(l.price) * num(it.qty); sub += per[it.id]; });
    const tax = sub * num(q.tax_pct) / 100, extra = num(q.transport) + num(q.other), total = sub + tax + extra, fx = num(q.fx) || 1;
    const priced = items.filter((it) => per[it.id] !== undefined).length;
    return { sub, tax, extra, total, pkr: total * fx, per, priced, all: priced === items.length };
  }
  function orderTotals(o) {
    let sub = 0; (o.lines || []).forEach((l) => { sub += num(l.qty) * num(l.rate); });
    const tax = sub * num(o.tax_pct) / 100, extra = num(o.transport) + num(o.other), total = sub + tax + extra;
    return { sub, tax, extra, total, pkr: total * (num(o.fx) || 1) };
  }
  function receivedQty(o) {
    const m = {}; P.receipts.filter((x) => x.order_id === o.id).forEach((rc) => (rc.lines || []).forEach((l) => { m[l.line] = (m[l.line] || 0) + num(l.received); }));
    return m;
  }
  const late = (o) => ['issued', 'partial'].includes(o.status) && o.delivery_date && o.delivery_date < today();
  const reqOrder = (r) => P.orders.find((o) => o.request_id === r.id && o.status !== 'cancelled');
  const reqQuotes = (r) => P.quotes.filter((q) => q.request_id === r.id);
  function nextNo(list, field, prefix, width) {
    let max = 0; list.forEach((x) => { const v = x[field] || ''; if (v.indexOf(prefix) === 0) { const n = parseInt(v.slice(prefix.length), 10); if (!isNaN(n)) max = Math.max(max, n); } });
    return prefix + String(max + 1).padStart(width || 3, '0');
  }
  function words(n) {
    n = Math.round(num(n));
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const h = (x) => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 < 20 ? a[x % 100] : t[Math.floor(x % 100 / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
    if (!n) return 'Zero';
    const parts = []; [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']].forEach(([v, w]) => { const c = Math.floor(n / v); if (c) { parts.push(h(c) + (w ? ' ' + w : '')); n -= c * v; } });
    return parts.join(' ').trim();
  }

  // ---------- shared pieces ----------
  const pageHead = (title, sub, right) => '<div class="page-h"><div><h1>' + title + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (right ? '<div class="page-r">' + right + '</div>' : '') + '</div>';
  const fileList = (files, canDel) => (files.length ? '<div class="files">' + files.map((f) => '<span class="fchip"><button class="link" data-act="pOpenFile" data-id="' + f.id + '">' + esc(f.name) + '</button><small>' + esc(f.kind || '') + '</small></span>').join('') + '</div>' : '');
  const fileInput = (link, kinds) => (isProc() ? '<span class="fup"><select class="fkind">' + kinds.map((k) => '<option>' + k + '</option>').join('') + '</select><label class="b sm">Attach file<input type="file" hidden multiple data-chg="pFile" data-link="' + link + '"></label></span>' : '');
  const evList = (list) => (list.length ? '<div class="tl">' + list.map((e) => '<div class="tli"><span class="tld"></span><div><b>' + esc(e.kind) + '</b> <span class="mut">' + D().pkStamp(e.at) + ' · ' + esc(e.who || '') + '</span>' + (e.note ? '<div>' + esc(e.note) + '</div>' : '') + (e.expected_on ? '<div class="mut">Expected on ' + dmy(e.expected_on) + '</div>' : '') + '</div></div>').join('') + '</div>' : '<p class="mut">Nothing yet.</p>');
  const siteOpts = (sel) => '<option value="">Not set</option>' + X.sortedSites().map((s) => '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(X.siteName(s.id)) + '</option>').join('');

  // ---------- Procurement dashboard ----------
  function vProc() {
    if (UI.procErr) return pageHead('Procurement') + '<div class="banner" style="background:var(--bad-bg);color:var(--bad)">Could not load procurement data: ' + esc(UI.procErr) + '. If the database was just updated, run 1_database_setup.sql again.</div>';
    const open = P.requests.filter((r) => ['draft', 'rfq', 'evaluation', 'approval', 'approved'].includes(r.stage));
    const pending = P.requests.filter((r) => r.approval_status === 'pending');
    const openPO = P.orders.filter((o) => ['issued', 'partial'].includes(o.status)), lateList = openPO.filter(late);
    const month = today().slice(0, 7), poMonth = P.orders.filter((o) => o.status !== 'cancelled' && (o.issued_on || '').slice(0, 7) === month);
    let h = pageHead('Procurement', 'Material requests, quotations, approvals, purchase orders and deliveries for every site.', isProc() ? '<button class="b pri" data-act="pNewReq">New material request</button>' : '');
    h += '<div class="cards kpi">' + X.stat('Open requests', open.length) + X.stat('Waiting for approval', pending.length, pending.length ? 'warn' : '') + X.stat('Open purchase orders', openPO.length) + X.stat('Open PO value (PKR)', money(openPO.reduce((t, o) => t + orderTotals(o).pkr, 0))) + X.stat('Late deliveries', lateList.length, lateList.length ? 'bad' : '') + X.stat('Ordered this month (PKR)', money(poMonth.reduce((t, o) => t + orderTotals(o).pkr, 0))) + '</div>';
    const stages = ['draft', 'rfq', 'evaluation', 'approval', 'approved', 'ordered'];
    h += '<div class="card"><div class="card-h"><h2>Pipeline</h2><span class="mut">Click a stage to see its requests.</span></div><div class="pipe">' + stages.map((s) => '<button class="pst" data-act="pStage" data-s="' + s + '"><b>' + P.requests.filter((r) => r.stage === s).length + '</b><span>' + STAGE[s][0] + '</span></button>').join('<i>›</i>') + '</div></div>';
    h += '<div class="two">';
    h += '<div class="card"><div class="card-h"><h2>Waiting for approval</h2></div>' + (pending.length ? '<table><tr><th>Request</th><th>Recommended</th><th class="num">Total (PKR)</th><th></th></tr>' + pending.map((r) => { const q = byId(P.quotes, r.recommended_quote); return '<tr class="click" data-act="pOpenReq" data-id="' + r.id + '" data-tab="approval"><td><b>' + esc(r.mr_no || '') + '</b> ' + esc(r.title) + '<small>' + esc(r.site_id ? X.siteName(r.site_id) : r.project || '') + '</small></td><td>' + esc(q ? sup(q.supplier_id).name : '') + '</td><td class="num">' + (q ? money(quoteTotals(q, r).pkr) : '') + '</td><td>' + (canApprove() ? '<span class="pill p-warn">Your approval</span>' : '') + '</td></tr>'; }).join('') + '</table>' : '<p class="mut">Nothing is waiting.</p>') + '</div>';
    const soon = openPO.filter((o) => o.delivery_date && o.delivery_date <= D().addDays(today(), 7)).sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || ''));
    h += '<div class="card"><div class="card-h"><h2>Deliveries late or due this week</h2></div>' + (soon.length ? '<table><tr><th>PO</th><th>Supplier</th><th>Due</th><th></th></tr>' + soon.map((o) => '<tr class="click" data-act="pOpenPO" data-id="' + o.id + '"><td><b>' + esc(o.po_no || '') + '</b></td><td>' + esc(sup(o.supplier_id).name) + '</td><td class="nowrap">' + dmy(o.delivery_date) + '</td><td>' + (late(o) ? '<span class="pill p-bad">Late</span>' : '<span class="pill p-inf">Due</span>') + '</td></tr>').join('') + '</table>' : '<p class="mut">No deliveries due.</p>') + '</div>';
    h += '</div>';
    const dueRfq = []; P.requests.filter((r) => ['rfq', 'evaluation'].includes(r.stage)).forEach((r) => (r.rfq || []).forEach((x) => { if (x.status !== 'declined' && !reqQuotes(r).some((q) => q.supplier_id === x.supplier_id) && x.due_on && x.due_on <= D().addDays(today(), 2)) dueRfq.push({ r, x }); }));
    if (dueRfq.length) h += '<div class="card"><div class="card-h"><h2>Quotations due</h2><span class="mut">Suppliers to chase.</span></div><table><tr><th>Request</th><th>Supplier</th><th>Phone</th><th>Due</th></tr>' + dueRfq.map((d) => '<tr class="click" data-act="pOpenReq" data-id="' + d.r.id + '" data-tab="rfq"><td>' + esc(d.r.mr_no || '') + ' ' + esc(d.r.title) + '</td><td>' + esc(sup(d.x.supplier_id).name) + '</td><td>' + esc(sup(d.x.supplier_id).phone || '') + '</td><td>' + dmy(d.x.due_on) + (d.x.due_on < today() ? ' <span class="pill p-bad">Overdue</span>' : '') + '</td></tr>').join('') + '</table></div>';
    h += '<div class="card"><div class="card-h"><h2>Recent activity</h2></div>' + evList(P.events.slice(0, 12).map((e) => Object.assign({}, e, { kind: e.kind + (e.request_id && byId(P.requests, e.request_id) ? ' · ' + (byId(P.requests, e.request_id).mr_no || '') : '') + (e.order_id && byId(P.orders, e.order_id) ? ' · ' + (byId(P.orders, e.order_id).po_no || '') : '') }))) + '</div>';
    return h;
  }

  // ---------- Material requests ----------
  function vReqs() {
    if (UI.prId === 'new' || (UI.prId && byId(P.requests, UI.prId))) return vReq();
    const q = (UI.prQ || '').toLowerCase();
    const list = P.requests.filter((r) => (!UI.prStage || r.stage === UI.prStage) && (!UI.prSite || r.site_id === UI.prSite) && (!q || ((r.mr_no || '') + ' ' + r.title + ' ' + (r.project || '') + ' ' + reqItems(r).map((i) => i.desc).join(' ')).toLowerCase().includes(q)))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    let h = pageHead('Material requests', 'Each request goes through RFQ, quotations, comparison, approval and a purchase order.', isProc() ? '<button class="b pri" data-act="pNewReq">New material request</button>' : '');
    h += '<div class="bar"><label>Search<input id="pr-q" data-inp="prQ" value="' + esc(UI.prQ || '') + '" placeholder="MR no, title or item"></label><label>Stage<select data-chg="ui" data-f="prStage"><option value="">All</option>' + Object.keys(STAGE).map((s) => '<option value="' + s + '"' + (UI.prStage === s ? ' selected' : '') + '>' + STAGE[s][0] + '</option>').join('') + '</select></label><label>Site<select data-chg="ui" data-f="prSite">' + X.siteOptions(UI.prSite, 'All sites') + '</select></label></div>';
    if (!list.length) return h + '<div class="card"><p class="mut">' + (P.requests.length ? 'No request matches.' : 'No material requests yet.' + (isProc() ? ' Press New material request to start.' : '')) + '</p></div>';
    h += '<div class="card"><div class="scroll"><table><tr><th>MR no</th><th>Title</th><th>Site / project</th><th>Required by</th><th class="num">Items</th><th class="num">Quotes</th><th class="num">Best total (PKR)</th><th>Stage</th></tr>';
    list.forEach((r) => {
      const qs = reqQuotes(r), best = qs.map((x) => quoteTotals(x, r)).filter((t) => t.all && t.pkr > 0).map((t) => t.pkr).sort((a, b) => a - b)[0];
      const overdue = r.required_by && r.required_by < today() && !['ordered', 'closed', 'cancelled'].includes(r.stage);
      h += '<tr class="click" data-act="pOpenReq" data-id="' + r.id + '"><td class="nowrap"><b>' + esc(r.mr_no || '') + '</b></td><td>' + esc(r.title) + (r.priority === 'Urgent' ? ' <span class="pill p-bad">Urgent</span>' : '') + '</td><td>' + esc(r.site_id ? X.siteName(r.site_id) : '') + '<small>' + esc(r.project || '') + '</small></td><td class="nowrap">' + dmy(r.required_by) + (overdue ? ' <span class="pill p-bad">Late</span>' : '') + '</td><td class="num">' + reqItems(r).length + '</td><td class="num">' + qs.length + '</td><td class="num">' + (best ? money(best) : '') + '</td><td>' + stagePill(r.stage) + '</td></tr>';
    });
    return h + '</table></div></div>';
  }
  const TABS = [['items', 'Request'], ['rfq', 'RFQ'], ['quotes', 'Quotations'], ['compare', 'Comparison'], ['approval', 'Approval'], ['po', 'Purchase order']];
  const tabFor = (r) => ({ draft: 'items', rfq: 'rfq', evaluation: 'compare', approval: 'approval', approved: 'po', ordered: 'po', closed: 'po', cancelled: 'items' }[r.stage] || 'items');
  const tabDone = (r, t) => ({ items: reqItems(r).length > 0, rfq: (r.rfq || []).length > 0, quotes: reqQuotes(r).length > 0, compare: !!r.recommended_quote, approval: r.approval_status === 'approved', po: !!reqOrder(r) }[t]);
  const locked = (r) => ['approval', 'approved', 'ordered', 'closed', 'cancelled'].includes(r.stage);
  function vReq() {
    const isNew = UI.prId === 'new', r = isNew ? (UI.prDraft || (UI.prDraft = newReq())) : byId(P.requests, UI.prId);
    if (!UI.prTab) UI.prTab = tabFor(r);
    let h = '<p><button class="link" data-act="pBackReqs">Back to all requests</button></p>';
    h += pageHead((isNew ? 'New material request' : esc(r.mr_no || '') + ' · ' + esc(r.title)) + ' ' + (isNew ? '' : stagePill(r.stage)), isNew ? 'List what the site needs. You can send RFQs once it is saved.' : esc([r.site_id ? X.siteName(r.site_id) : '', r.project, r.required_by ? 'needed by ' + X.dmy(r.required_by) : '', 'raised by ' + (r.created_by || '')].filter(Boolean).join(' · ')));
    if (!isNew) h += '<div class="steps-bar">' + TABS.map((t, i) => '<button class="stp' + (UI.prTab === t[0] ? ' on' : '') + (tabDone(r, t[0]) ? ' done' : '') + '" data-act="pTab" data-t="' + t[0] + '"><span>' + (tabDone(r, t[0]) ? '✓' : i + 1) + '</span>' + t[1] + '</button>').join('') + '</div>';
    const tab = isNew ? 'items' : UI.prTab;
    h += ({ items: tItems, rfq: tRfq, quotes: tQuotes, compare: tCompare, approval: tApproval, po: tPo }[tab])(r, isNew);
    return h;
  }
  function newReq() {
    const year = today().slice(0, 4);
    return { id: uuid(), mr_no: nextNo(P.requests, 'mr_no', 'MR-' + year + '-'), site_id: '', project: '', title: '', required_by: '', priority: 'Normal', stage: 'draft', items: [{ id: uuid(), desc: '', spec: '', brand: '', qty: '', unit: 'No' }], rfq: [], submittal_status: 'Not required', submittal_note: '', recommended_quote: null, recommendation: '', approval_status: null, approval_by: null, approval_at: null, approval_note: null, notes: '', created_at: new Date().toISOString(), created_by: LIVE ? UI.user : who() };
  }
  function tItems(r, isNew) {
    const ed = isProc() && !locked(r), d = ed ? '' : ' disabled';
    let h = '<div class="card"><div class="form" id="pr-form"><label>MR no<input name="mr_no" value="' + esc(r.mr_no || '') + '"' + d + '></label><label class="span2">Title<input name="title" value="' + esc(r.title || '') + '" placeholder="Pumps for chiller plant"' + d + '></label><label>Site<select name="site_id"' + d + '>' + siteOpts(r.site_id) + '</select></label><label class="span2">Project<input name="project" value="' + esc(r.project || '') + '" placeholder="PepsiCo Snack Plant Extension (TC-1000)"' + d + '></label><label>Required at site by<input type="date" name="required_by" value="' + esc(r.required_by || '') + '"' + d + '></label><label>Priority<select name="priority"' + d + '>' + ['Normal', 'Urgent', 'Low'].map((p) => '<option' + (r.priority === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label><label class="full">Notes<input name="notes" value="' + esc(r.notes || '') + '" placeholder="BOQ reference, drawing number, special requirements"' + d + '></label></div></div>';
    h += '<div class="card"><div class="card-h"><h2>Items</h2><span class="mut">From the BOQ, specifications and drawings. Brands: client-approved makes.</span></div><div class="scroll"><table class="items"><tr><th style="width:34px">Sr</th><th>Description</th><th>Specification</th><th>Approved brands</th><th class="num" style="width:90px">Qty</th><th style="width:90px">Unit</th>' + (ed ? '<th></th>' : '') + '</tr>';
    reqItems(r).forEach((it, i) => {
      h += '<tr data-row="' + i + '"><td class="mut">' + (i + 1) + '</td><td><input data-it="desc" value="' + esc(it.desc || '') + '" placeholder="Centrifugal pump"' + d + '></td><td><input data-it="spec" value="' + esc(it.spec || '') + '" placeholder="50 m3/h at 32 m head, 7.5 kW"' + d + '></td><td><input data-it="brand" value="' + esc(it.brand || '') + '" placeholder="KSB, Grundfos, Ebara"' + d + '></td><td><input data-it="qty" inputmode="decimal" class="r" value="' + esc(it.qty) + '"' + d + '></td><td><input data-it="unit" list="units" value="' + esc(it.unit || '') + '"' + d + '></td>' + (ed ? '<td><button class="b sm danger" data-act="pDelItem" data-i="' + i + '">Remove</button></td>' : '') + '</tr>';
    });
    h += '</table></div><datalist id="units">' + UNITS.map((u) => '<option value="' + u + '">').join('') + '</datalist>';
    if (ed) h += '<p style="margin:10px 0 0;display:flex;gap:8px;flex-wrap:wrap"><button class="b" data-act="pAddItem">Add item</button><button class="b pri" data-act="pSaveReq">' + (isNew ? 'Save request' : 'Save changes') + '</button>' + (isNew ? '<button class="b" data-act="pBackReqs">Cancel</button>' : '<button class="b danger right" data-act="pCancelReq" data-confirm="1">Cancel this request</button>') + '</p>';
    else if (locked(r) && isProc() && r.stage !== 'cancelled') h += '<p class="mut" style="font-size:12.5px;margin:10px 0 0">Items are locked while the request is with the approver or after approval.</p>';
    h += '</div>';
    if (!isNew) {
      h += '<div class="card"><div class="card-h"><h2>Technical submittal</h2><span class="mut">Datasheets sent to the client or consultant for approval before buying.</span></div><div class="bar" style="margin:0"><label>Status<select id="pr-sub"' + (isProc() ? '' : ' disabled') + '>' + SUBMITTAL.map((s) => '<option' + ((r.submittal_status || 'Not required') === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label><label style="flex:1;min-width:240px">Comments<input id="pr-subnote" value="' + esc(r.submittal_note || '') + '"' + (isProc() ? '' : ' disabled') + '></label>' + (isProc() ? '<button class="b" data-act="pSaveSub">Save</button>' : '') + '</div>' + fileList(P.files.filter((f) => f.request_id === r.id && !f.quote_id), true) + '<p style="margin:8px 0 0">' + fileInput('request_id:' + r.id, ['Submittal', 'BOQ', 'Drawing', 'Specification', 'Client comments', 'Other']) + '</p></div>';
    }
    return h;
  }
  function tRfq(r) {
    const rows = r.rfq || [], qs = reqQuotes(r);
    let h = '<div class="card"><div class="card-h"><h2>Suppliers asked for a quotation</h2><span class="mut">Download the RFQ for each supplier and send it by email or WhatsApp.</span></div>';
    if (!reqItems(r).filter((i) => i.desc).length) h += '<div class="banner">Add the items on the Request tab first.</div>';
    if (rows.length) {
      h += '<div class="scroll"><table><tr><th>Supplier</th><th>Contact</th><th>RFQ ref</th><th>Sent</th><th>Quote due</th><th>Status</th><th></th></tr>';
      rows.forEach((x, i) => {
        const s = sup(x.supplier_id), quoted = qs.some((q) => q.supplier_id === x.supplier_id), st = quoted ? '<span class="pill p-ok">Quoted</span>' : x.status === 'declined' ? '<span class="pill p-bad">Declined</span>' : x.due_on && x.due_on < today() ? '<span class="pill p-bad">Overdue</span>' : '<span class="pill p-inf">Waiting</span>';
        h += '<tr><td><b>' + esc(s.name) + '</b><small>' + esc(s.category || '') + '</small></td><td>' + esc(s.contact_person || '') + '<small>' + esc([s.phone, s.email].filter(Boolean).join(' · ')) + '</small></td><td class="nowrap">' + esc(x.ref || '') + '</td><td class="nowrap">' + dmy(x.sent_on) + '</td><td class="nowrap">' + dmy(x.due_on) + '</td><td>' + st + '</td><td class="nowrap"><button class="b sm" data-act="pRfqDoc" data-i="' + i + '">Download RFQ</button>' + (isProc() && !locked(r) ? (quoted ? '' : '<button class="b sm" data-act="pNewQuote" data-s="' + x.supplier_id + '">Enter quote</button>') + (!quoted && x.status !== 'declined' ? '<button class="b sm danger" data-act="pRfqDecline" data-i="' + i + '">Declined</button>' : '') : '') + '</td></tr>';
      });
      h += '</table></div>';
    } else h += '<p class="mut">No suppliers yet.</p>';
    if (isProc() && !locked(r)) {
      const used = new Set(rows.map((x) => x.supplier_id)), avail = P.suppliers.filter((s) => s.approved !== false && !used.has(s.id)).sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
      h += '<div class="bar" style="margin:14px 0 0"><label>Add supplier<select id="rfq-sup"><option value="">Choose…</option>' + avail.map((s) => '<option value="' + s.id + '">' + esc(s.name) + (s.category ? ' · ' + esc(s.category) : '') + '</option>').join('') + '</select></label><label>Quote due by<input type="date" id="rfq-due" value="' + D().addDays(today(), 5) + '"></label><button class="b pri" data-act="pAddRfq">Add to RFQ</button><button class="link" data-act="pGoSuppliers">New supplier</button></div><p class="mut" style="font-size:12px;margin:6px 0 0">Get at least three quotations where you can.</p>';
    }
    return h + '</div>';
  }
  function tQuotes(r) {
    const qs = reqQuotes(r), items = reqItems(r);
    let h = '';
    if (UI.pqEdit) h += quoteForm(r);
    h += '<div class="card"><div class="card-h"><h2>Quotations received</h2>' + (isProc() && !locked(r) && !UI.pqEdit ? '<button class="b pri" data-act="pNewQuote">Enter a quotation</button>' : '') + '</div>';
    if (!qs.length) return h + '<p class="mut">No quotations yet.</p></div>';
    h += '<div class="scroll"><table><tr><th>Supplier</th><th>Ref</th><th>Received</th><th>Valid until</th><th class="num">Total</th><th class="num">Total PKR</th><th>Delivery</th><th>Technical</th><th>Files</th><th></th></tr>';
    qs.forEach((q) => {
      const t = quoteTotals(q, r), exp = q.valid_until && q.valid_until < today();
      h += '<tr><td><b>' + esc(sup(q.supplier_id).name) + '</b>' + (t.all ? '' : '<small style="color:var(--warn)">' + t.priced + ' of ' + items.length + ' items priced</small>') + '</td><td>' + esc(q.quote_ref || '') + '</td><td class="nowrap">' + dmy(q.received_on) + '</td><td class="nowrap">' + dmy(q.valid_until) + (exp ? ' <span class="pill p-bad">Expired</span>' : '') + '</td><td class="num">' + esc(q.currency || 'PKR') + ' ' + money(t.total) + '</td><td class="num"><b>' + money(t.pkr) + '</b></td><td>' + esc(q.delivery_days ? q.delivery_days + ' days' : q.delivery || '') + '</td><td>' + techPill(q.technical) + '</td><td>' + fileList(P.files.filter((f) => f.quote_id === q.id)) + fileInput('quote_id:' + q.id + ',request_id:' + r.id, ['Quotation', 'Datasheet', 'Certificate', 'Catalogue', 'Other']) + '</td><td class="nowrap">' + (isProc() && !locked(r) ? '<button class="b sm" data-act="pEditQuote" data-id="' + q.id + '">Edit</button><button class="b sm danger" data-act="pDelQuote" data-id="' + q.id + '" data-confirm="1">Delete</button>' : '') + '</td></tr>';
    });
    return h + '</table></div></div>';
  }
  const techPill = (t) => ({ compliant: '<span class="pill p-ok">Compliant</span>', partial: '<span class="pill p-warn">Partly compliant</span>', not: '<span class="pill p-bad">Not compliant</span>' }[t] || '<span class="pill p-inf">Not checked</span>');
  function quoteForm(r) {
    const isNew = String(UI.pqEdit).indexOf('new') === 0, q = isNew ? { id: uuid(), request_id: r.id, supplier_id: UI.pqEdit.split(':')[1] || '', currency: 'PKR', fx: 1, lines: [], received_on: today(), valid_until: D().addDays(today(), 30), technical: 'compliant' } : byId(P.quotes, UI.pqEdit);
    if (!q) { UI.pqEdit = null; return ''; }
    const s = q.supplier_id ? sup(q.supplier_id) : null;
    const asked = new Set((r.rfq || []).map((x) => x.supplier_id)), sups = P.suppliers.slice().sort((a, b) => (asked.has(b.id) - asked.has(a.id)) || a.name.localeCompare(b.name));
    let h = '<div class="card hl" id="q-form" data-id="' + q.id + '" data-new="' + (isNew ? 1 : 0) + '"><h2 style="margin-top:0">' + (isNew ? 'Enter quotation' : 'Edit quotation from ' + esc(s ? s.name : '')) + '</h2><div class="form">';
    h += '<label>Supplier<select name="supplier_id"><option value="">Choose…</option>' + sups.map((x) => '<option value="' + x.id + '"' + (x.id === q.supplier_id ? ' selected' : '') + '>' + esc(x.name) + (asked.has(x.id) ? ' (RFQ sent)' : '') + '</option>').join('') + '</select></label><label>Their quotation ref<input name="quote_ref" value="' + esc(q.quote_ref || '') + '"></label><label>Received on<input type="date" name="received_on" value="' + esc(q.received_on || '') + '"></label><label>Valid until<input type="date" name="valid_until" value="' + esc(q.valid_until || '') + '"></label><label>Currency<select name="currency">' + CURR.map((c) => '<option' + ((q.currency || 'PKR') === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label><label>Rate to PKR<input name="fx" inputmode="decimal" value="' + esc(q.fx || 1) + '" title="1 for PKR. For USD, the dollar rate."></label></div>';
    h += '<div class="scroll" style="margin-top:12px"><table class="items"><tr><th>Item</th><th class="num">Qty</th><th class="num" style="width:150px">Unit rate</th><th style="width:220px">Brand / make offered</th><th style="width:220px">Remarks</th></tr>';
    reqItems(r).forEach((it) => { const l = (q.lines || []).find((x) => x.item === it.id) || {}; h += '<tr data-item="' + it.id + '"><td>' + esc(it.desc) + '<small>' + esc([it.spec, it.brand ? 'Approved: ' + it.brand : ''].filter(Boolean).join(' · ')) + '</small></td><td class="num">' + esc(it.qty) + ' ' + esc(it.unit || '') + '</td><td><input data-ql="price" inputmode="decimal" class="r" value="' + esc(l.price === undefined || l.price === null ? '' : l.price) + '" placeholder="Leave empty if not quoted"></td><td><input data-ql="brand" value="' + esc(l.brand || '') + '"></td><td><input data-ql="remark" value="' + esc(l.remark || '') + '"></td></tr>'; });
    h += '</table></div><div class="form" style="margin-top:12px"><label>Sales tax %<input name="tax_pct" inputmode="decimal" value="' + esc(q.tax_pct === undefined || q.tax_pct === null ? '' : q.tax_pct) + '" placeholder="0 if rates include tax"></label><label>Transport<input name="transport" inputmode="decimal" value="' + esc(q.transport || '') + '"></label><label>Other charges<input name="other" inputmode="decimal" value="' + esc(q.other || '') + '"></label><label>Delivery (days)<input name="delivery_days" inputmode="numeric" value="' + esc(q.delivery_days || '') + '"></label><label>Delivery note<input name="delivery" value="' + esc(q.delivery || '') + '" placeholder="Ex-stock, 5 weeks after PO"></label><label>Payment terms<input name="payment_terms" value="' + esc(q.payment_terms || '') + '" placeholder="30% advance, 70% on delivery"></label><label>Warranty<input name="warranty" value="' + esc(q.warranty || '') + '" placeholder="1 year"></label><label>Technical compliance<select name="technical">' + [['compliant', 'Compliant'], ['partial', 'Partly compliant'], ['not', 'Not compliant'], ['', 'Not checked yet']].map((o) => '<option value="' + o[0] + '"' + ((q.technical || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><label>Certifications<input name="certifications" value="' + esc(q.certifications || '') + '" placeholder="ISO 9001, CE, UL"></label><label class="full">Technical notes<input name="tech_notes" value="' + esc(q.tech_notes || '') + '" placeholder="Pump curve, capacity, pressure rating, material grade checked against the datasheet"></label></div>';
    return h + '<p style="margin:12px 0 0;display:flex;gap:8px"><button class="b pri" data-act="pSaveQuote">Save quotation</button><button class="b" data-act="pCancelQuote">Cancel</button></p></div>';
  }
  function compareData(r) {
    const qs = reqQuotes(r).sort((a, b) => quoteTotals(a, r).pkr - quoteTotals(b, r).pkr), items = reqItems(r);
    const tot = {}; qs.forEach((q) => { tot[q.id] = quoteTotals(q, r); });
    const full = qs.filter((q) => tot[q.id].all), lowest = full.length ? full.reduce((a, b) => (tot[a.id].pkr <= tot[b.id].pkr ? a : b)) : null;
    const low = {}; items.forEach((it) => { let best = null; qs.forEach((q) => { const v = tot[q.id].per[it.id]; if (v !== undefined && (best === null || v * (num(q.fx) || 1) < best.v)) best = { q: q.id, v: v * (num(q.fx) || 1) }; }); low[it.id] = best && best.q; });
    return { qs, items, tot, lowest, low };
  }
  function tCompare(r) {
    const c = compareData(r), ed = isProc() && !locked(r);
    if (!c.qs.length) return '<div class="card"><p class="mut">Enter quotations first. The comparative statement is built from them.</p></div>';
    let h = '<div class="card"><div class="card-h"><h2>Comparative statement</h2><span class="mut">Lowest rate per item in green. The cheapest offer is not always the best: check technical compliance, delivery and warranty.</span><span class="right nowrap"><button class="b sm" data-act="pCompareXlsx">Download Excel</button><button class="b sm" data-act="print">Print</button></span></div>';
    h += '<div class="scroll"><table class="cmp"><thead><tr><th>Description</th><th class="num">Qty</th>' + c.qs.map((q) => '<th class="sc' + (r.recommended_quote === q.id ? ' rec' : '') + '">' + esc(sup(q.supplier_id).name) + (c.lowest && c.lowest.id === q.id ? ' <span class="pill p-ok">Lowest price</span>' : '') + (r.recommended_quote === q.id ? ' <span class="pill p-inf">Recommended</span>' : '') + '<small>' + esc(q.quote_ref || '') + ' · ' + esc(q.currency || 'PKR') + '</small></th>').join('') + '</tr></thead><tbody>';
    c.items.forEach((it) => {
      h += '<tr><td>' + esc(it.desc) + '<small>' + esc(it.spec || '') + '</small></td><td class="num">' + esc(it.qty) + ' ' + esc(it.unit || '') + '</td>' + c.qs.map((q) => { const l = (q.lines || []).find((x) => x.item === it.id) || {}, v = c.tot[q.id].per[it.id]; return '<td class="num' + (c.low[it.id] === q.id ? ' low' : '') + (r.recommended_quote === q.id ? ' rec' : '') + '">' + (v === undefined ? '<span class="mut">Not quoted</span>' : money2(l.price) + ' × ' + esc(it.qty) + '<b>' + money(v) + '</b>') + (l.brand ? '<small>' + esc(l.brand) + '</small>' : '') + '</td>'; }).join('') + '</tr>';
    });
    const row = (label, f, cls) => '<tr class="' + (cls || '') + '"><td colspan="2">' + label + '</td>' + c.qs.map((q) => '<td class="num' + (r.recommended_quote === q.id ? ' rec' : '') + '">' + f(q, c.tot[q.id]) + '</td>').join('') + '</tr>';
    h += row('Subtotal', (q, t) => money(t.sub), 'sumr') + row('Sales tax', (q, t) => (num(q.tax_pct) ? r2(q.tax_pct) + '% = ' + money(t.tax) : 'Included / none')) + row('Transport and other', (q, t) => money(t.extra)) + row('<b>Total</b>', (q, t) => '<b>' + esc(q.currency || 'PKR') + ' ' + money(t.total) + '</b>', 'tot');
    if (c.qs.some((q) => (q.currency || 'PKR') !== 'PKR')) h += row('<b>Total in PKR</b>', (q, t) => '<b>' + money(t.pkr) + '</b>', 'tot');
    h += row('Delivery', (q) => esc(q.delivery_days ? q.delivery_days + ' days' : '') + (q.delivery ? '<small>' + esc(q.delivery) + '</small>' : '')) + row('Payment terms', (q) => esc(q.payment_terms || '')) + row('Warranty', (q) => esc(q.warranty || '')) + row('Quotation valid until', (q) => dmy(q.valid_until) + (q.valid_until && q.valid_until < today() ? ' <span class="pill p-bad">Expired</span>' : '')) + row('Technical compliance', (q) => techPill(q.technical) + (q.tech_notes ? '<small>' + esc(q.tech_notes) + '</small>' : '')) + row('Certifications', (q) => esc(q.certifications || '')) + row('Items priced', (q, t) => t.priced + ' of ' + c.items.length + (t.all ? '' : ' <span class="pill p-warn">Incomplete</span>'));
    if (ed) h += '<tr class="pick"><td colspan="2"><b>Recommend</b></td>' + c.qs.map((q) => '<td><label class="chk"><input type="radio" name="rec" value="' + q.id + '"' + (r.recommended_quote === q.id ? ' checked' : '') + '> This one</label></td>').join('') + '</tr>';
    h += '</tbody></table></div>';
    if (ed) h += '<div class="form" style="margin-top:14px"><label class="full">Reason for the recommendation<textarea id="rec-why" rows="2" placeholder="Lowest technically compliant offer, approved brand, delivery within the site schedule">' + esc(r.recommendation || '') + '</textarea></label></div><p style="margin:12px 0 0;display:flex;gap:8px"><button class="b pri" data-act="pSendApproval">Send for approval</button><button class="b" data-act="pSaveRec">Save without sending</button></p>';
    else if (r.recommended_quote) h += '<p style="margin:12px 0 0"><b>Recommendation:</b> ' + esc(sup((byId(P.quotes, r.recommended_quote) || {}).supplier_id).name) + (r.recommendation ? ' · ' + esc(r.recommendation) : '') + '</p>';
    return h + '</div>';
  }
  function tApproval(r) {
    const q = byId(P.quotes, r.recommended_quote), t = q ? quoteTotals(q, r) : null;
    let h = '<div class="card">';
    if (!r.approval_status) h += '<p class="mut">Not sent for approval yet. Choose a quotation on the Comparison tab and press Send for approval.</p>';
    else {
      h += '<div class="appr ' + r.approval_status + '"><div><span class="k">Recommended supplier</span><b>' + esc(q ? sup(q.supplier_id).name : '') + '</b></div><div><span class="k">Total</span><b>' + (q ? esc(q.currency || 'PKR') + ' ' + money(t.total) + (num(q.fx) !== 1 && q.fx ? ' (PKR ' + money(t.pkr) + ')' : '') : '') + '</b></div><div><span class="k">Delivery</span><b>' + esc(q ? (q.delivery_days ? q.delivery_days + ' days' : q.delivery || '') : '') + '</b></div><div><span class="k">Status</span><b>' + ({ pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' }[r.approval_status]) + '</b></div></div>';
      if (r.recommendation) h += '<p><b>Why:</b> ' + esc(r.recommendation) + '</p>';
      const c = compareData(r);
      if (c.lowest && q && c.lowest.id !== q.id) h += '<div class="banner">This is not the lowest offer. Lowest complete offer: ' + esc(sup(c.lowest.supplier_id).name) + ', PKR ' + money(c.tot[c.lowest.id].pkr) + '.</div>';
      if (q && q.technical && q.technical !== 'compliant') h += '<div class="banner" style="background:var(--bad-bg);color:var(--bad)">The recommended offer is marked ' + (q.technical === 'partial' ? 'partly compliant' : 'not compliant') + ' technically.</div>';
      if (r.approval_status === 'pending' && canApprove()) h += '<div class="form" style="margin-top:12px"><label class="full">Note (optional)<input id="ap-note" placeholder="Approved, negotiate 2% more if possible"></label></div><p style="margin:12px 0 0;display:flex;gap:8px"><button class="b pri" data-act="pDecide" data-d="approved">Approve</button><button class="b danger" data-act="pDecide" data-d="rejected">Reject and send back</button><button class="b" data-act="pTab" data-t="compare">See the full comparison</button></p>';
      else if (r.approval_status === 'pending') h += '<p class="mut">Waiting for the owner or the accountant to approve.' + (isProc() ? ' <button class="link" data-act="pWithdraw">Withdraw to make changes</button>' : '') + '</p>';
      if (r.approval_status !== 'pending' && r.approval_by) h += '<p>' + (r.approval_status === 'approved' ? 'Approved' : 'Rejected') + ' by <b>' + esc(r.approval_by) + '</b> on ' + D().pkStamp(r.approval_at) + (r.approval_note ? ': ' + esc(r.approval_note) : '') + '</p>';
      if (r.approval_status === 'rejected' && isProc()) h += '<p class="mut">Make the changes on the Quotations or Comparison tab, then send it again.</p>';
    }
    h += '</div><div class="card"><div class="card-h"><h2>History</h2></div>' + evList(P.events.filter((e) => e.request_id === r.id)) + '</div>';
    return h;
  }
  function tPo(r) {
    const o = reqOrder(r);
    if (o) return '<div class="card"><div class="card-h"><h2>Purchase order ' + esc(o.po_no || '') + '</h2><span class="pill ' + PO_ST[o.status][1] + '">' + PO_ST[o.status][0] + '</span></div><p>' + esc(sup(o.supplier_id).name) + ' · issued ' + dmy(o.issued_on) + ' · delivery by ' + dmy(o.delivery_date) + ' · ' + esc(o.currency || 'PKR') + ' ' + money(orderTotals(o).total) + '</p><button class="b pri" data-act="pOpenPO" data-id="' + o.id + '">Open purchase order</button></div>';
    if (r.approval_status !== 'approved') return '<div class="card"><p class="mut">A purchase order can be issued once the request is approved.</p></div>';
    if (!isProc()) return '<div class="card"><p class="mut">Approved. The procurement team will issue the purchase order.</p></div>';
    const q = byId(P.quotes, r.recommended_quote), s = sup(q.supplier_id), year = today().slice(0, 4);
    const terms = defaultTerms(r, q).map((t) => t.join(': ')).join('\n');
    let h = '<div class="card" id="po-form"><h2 style="margin-top:0">Issue purchase order to ' + esc(s.name) + '</h2><div class="form"><label>PO number<input name="po_no" value="' + esc(nextNo(P.orders, 'po_no', 'SEC/PO/' + year + '/')) + '"></label><label>Issue date<input type="date" name="issued_on" value="' + today() + '"></label><label>Delivery date<input type="date" name="delivery_date" value="' + D().addDays(today(), num(q.delivery_days) || 14) + '"></label><label class="span2">Deliver to<input name="delivery_to" value="' + esc([r.site_id ? X.siteName(r.site_id) + ' site' : '', r.project].filter(Boolean).join(', ')) + '"></label><label class="span2">Payment terms<input name="payment_terms" value="' + esc(q.payment_terms || s.payment_terms || '') + '"></label><label>Signed by<input name="signatory" value="' + esc(UI.name || '') + '"></label><label>Title<input name="signatory_title" value="Procurement Department"></label><label class="full">Terms and conditions (one per line, "Heading: text")<textarea name="terms" rows="7">' + esc(terms) + '</textarea></label></div>';
    return h + '<p style="margin:12px 0 0"><button class="b pri" data-act="pIssuePO">Issue purchase order and download Word file</button></p></div>';
  }
  function defaultTerms(r, q) {
    const site = r.site_id ? X.siteName(r.site_id) + ' site' : 'the project site';
    return [['Delivery', 'Material to be delivered to ' + site + ' by the delivery date. Partial deliveries only with our written approval.'], ['Quality', 'Material must match the approved specification, brand and datasheets. Non-conforming material will be rejected and replaced at the supplier’s cost.'], ['Documents', 'Each delivery must come with a delivery note quoting this PO number, and Material Test Certificates, Certificate of Conformity and warranty certificates as applicable.'], ['Inspection', 'All material is subject to inspection at site before acceptance.'], ['Payment', (q && q.payment_terms ? q.payment_terms : 'As agreed') + ', against the original invoice and accepted delivery.'], ['Warranty', (q && q.warranty ? q.warranty : 'As per the quotation') + ' from the date of delivery.'], ['Taxes', 'Prices include taxes as stated in this order. Withholding tax will be deducted as per law.']];
  }

  // ---------- Purchase orders ----------
  function vOrders() {
    if (UI.poId && byId(P.orders, UI.poId)) return vOrder(byId(P.orders, UI.poId));
    const q = (UI.poQ || '').toLowerCase();
    const list = P.orders.filter((o) => (!UI.poSt || (UI.poSt === 'late' ? late(o) : o.status === UI.poSt)) && (!q || ((o.po_no || '') + ' ' + sup(o.supplier_id).name + ' ' + ((byId(P.requests, o.request_id) || {}).title || '')).toLowerCase().includes(q))).sort((a, b) => (b.issued_on || '').localeCompare(a.issued_on || ''));
    let h = pageHead('Purchase orders', 'Follow up with suppliers, record deliveries and inspection, and keep the certificates with each order.');
    h += '<div class="bar"><label>Search<input id="po-q" data-inp="poQ" value="' + esc(UI.poQ || '') + '" placeholder="PO no, supplier or title"></label><label>Show<select data-chg="ui" data-f="poSt"><option value="">All</option><option value="late"' + (UI.poSt === 'late' ? ' selected' : '') + '>Late</option>' + Object.keys(PO_ST).map((s) => '<option value="' + s + '"' + (UI.poSt === s ? ' selected' : '') + '>' + PO_ST[s][0] + '</option>').join('') + '</select></label></div>';
    if (!list.length) return h + '<div class="card"><p class="mut">' + (P.orders.length ? 'No purchase order matches.' : 'No purchase orders yet. They are issued from an approved material request.') + '</p></div>';
    h += '<div class="card"><div class="scroll"><table><tr><th>PO no</th><th>Supplier</th><th>For</th><th>Issued</th><th>Delivery by</th><th class="num">Total (PKR)</th><th style="width:120px">Received</th><th>Status</th></tr>';
    list.forEach((o) => {
      const rq = receivedQty(o), ord = (o.lines || []).reduce((t, l) => t + num(l.qty), 0), got = (o.lines || []).reduce((t, l) => t + Math.min(num(l.qty), num(rq[l.id])), 0), rr = byId(P.requests, o.request_id) || {};
      h += '<tr class="click" data-act="pOpenPO" data-id="' + o.id + '"><td class="nowrap"><b>' + esc(o.po_no || '') + '</b></td><td>' + esc(sup(o.supplier_id).name) + '</td><td>' + esc(rr.title || '') + '<small>' + esc(o.site_id ? X.siteName(o.site_id) : '') + '</small></td><td class="nowrap">' + dmy(o.issued_on) + '</td><td class="nowrap">' + dmy(o.delivery_date) + (late(o) ? ' <span class="pill p-bad">Late</span>' : '') + '</td><td class="num">' + money(orderTotals(o).pkr) + '</td><td><div class="meter"><i style="width:' + (ord ? Math.round(got / ord * 100) : 0) + '%"></i></div></td><td><span class="pill ' + PO_ST[o.status][1] + '">' + PO_ST[o.status][0] + '</span></td></tr>';
    });
    return h + '</table></div></div>';
  }
  function vOrder(o) {
    const r = byId(P.requests, o.request_id) || {}, s = sup(o.supplier_id), t = orderTotals(o), rq = receivedQty(o), open = ['issued', 'partial'].includes(o.status), ed = isProc();
    let h = '<p><button class="link" data-act="pBackPOs">Back to all purchase orders</button></p>';
    h += pageHead('PO ' + esc(o.po_no || '') + ' <span class="pill ' + PO_ST[o.status][1] + '">' + PO_ST[o.status][0] + '</span>' + (late(o) ? ' <span class="pill p-bad">Late</span>' : ''), esc(s.name) + ' · for ' + esc(r.mr_no || '') + ' ' + esc(r.title || ''), '<button class="b" data-act="pPODoc">Download PO (Word)</button>' + (ed && open ? '<button class="b pri" data-act="pRecvForm">Record delivery</button>' : ''));
    if (UI.poRecv && ed) h += recvForm(o, rq);
    h += '<div class="two"><div class="card"><div class="card-h"><h2>Order</h2></div><table class="kv"><tr><td>Supplier</td><td><b>' + esc(s.name) + '</b><small>' + esc([s.contact_person, s.phone, s.email].filter(Boolean).join(' · ')) + '</small></td></tr><tr><td>Issued</td><td>' + dmy(o.issued_on) + '</td></tr><tr><td>Delivery by</td><td>' + dmy(o.delivery_date) + '</td></tr><tr><td>Deliver to</td><td>' + esc(o.delivery_to || '') + '</td></tr><tr><td>Payment terms</td><td>' + esc(o.payment_terms || '') + '</td></tr><tr><td>Total</td><td><b>' + esc(o.currency || 'PKR') + ' ' + money(t.total) + '</b>' + ((o.currency || 'PKR') !== 'PKR' ? '<small>PKR ' + money(t.pkr) + '</small>' : '') + '</td></tr></table>';
    if (ed && open) h += '<p style="margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap"><button class="b" data-act="pPOClose" data-confirm="1">Close order</button><button class="b danger" data-act="pPOCancel" data-confirm="1">Cancel order</button></p>';
    h += '</div><div class="card"><div class="card-h"><h2>Follow-up with the supplier</h2></div>';
    if (ed && !['closed', 'cancelled'].includes(o.status)) h += '<div class="bar" style="margin:0 0 10px"><label style="flex:1;min-width:200px">Note<input id="fu-note" placeholder="Called supplier: pumps dispatched, arriving Monday"></label><label>Expected on<input type="date" id="fu-date"></label><button class="b" data-act="pFollowUp">Add</button></div>';
    h += evList(P.events.filter((e) => e.order_id === o.id)) + '</div></div>';
    h += '<div class="card"><div class="card-h"><h2>Items</h2></div><div class="scroll"><table><tr><th>Sr</th><th>Description</th><th>Brand</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Balance</th><th class="num">Rate</th><th class="num">Amount</th></tr>' + (o.lines || []).map((l, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(l.desc) + '<small>' + esc(l.spec || '') + '</small></td><td>' + esc(l.brand || '') + '</td><td class="num">' + esc(l.qty) + ' ' + esc(l.unit || '') + '</td><td class="num">' + r2(rq[l.id] || 0) + '</td><td class="num">' + (num(l.qty) - num(rq[l.id]) > 0 ? '<b style="color:var(--warn)">' + r2(num(l.qty) - num(rq[l.id])) + '</b>' : '<span class="pill p-ok">Done</span>') + '</td><td class="num">' + money2(l.rate) + '</td><td class="num">' + money(num(l.qty) * num(l.rate)) + '</td></tr>').join('') + '<tr class="tot"><td colspan="7">Subtotal' + (num(o.tax_pct) ? ' + tax ' + r2(o.tax_pct) + '%' : '') + (t.extra ? ' + transport and other' : '') + '</td><td class="num">' + money(t.total) + '</td></tr></table></div></div>';
    const recs = P.receipts.filter((x) => x.order_id === o.id).sort((a, b) => (b.received_on || '').localeCompare(a.received_on || ''));
    h += '<div class="card"><div class="card-h"><h2>Deliveries and inspection</h2></div>';
    if (!recs.length) h += '<p class="mut">Nothing received yet.</p>';
    recs.forEach((rc) => {
      const docs = rc.docs || {};
      h += '<div class="rcv"><div class="rcv-h"><b>' + dmy(rc.received_on) + '</b> · received by ' + esc(rc.received_by || '') + ' ' + ({ accepted: '<span class="pill p-ok">Accepted</span>', partial: '<span class="pill p-warn">Partly accepted</span>', rejected: '<span class="pill p-bad">Rejected</span>' }[rc.inspection] || '') + '</div><div class="mut">' + (rc.lines || []).filter((l) => num(l.received)).map((l) => { const ol = (o.lines || []).find((x) => x.id === l.line) || {}; return esc(ol.desc || '') + ': ' + r2(l.received) + ' ' + esc(ol.unit || '') + (num(l.accepted) !== num(l.received) ? ' (' + r2(l.accepted) + ' accepted)' : ''); }).join(' · ') + '</div><div class="docs">' + DOCS.map((d) => '<span class="' + (docs[d[0]] ? 'ok' : 'no') + '">' + (docs[d[0]] ? '✓ ' : '✗ ') + d[1].replace(/ \(.*\)/, '') + '</span>').join('') + '</div>' + (rc.notes ? '<div>' + esc(rc.notes) + '</div>' : '') + fileList(P.files.filter((f) => f.receipt_id === rc.id)) + (ed ? '<div style="margin-top:6px">' + fileInput('receipt_id:' + rc.id + ',order_id:' + o.id, DOCS.map((d) => d[1]).concat(['Delivery note', 'Invoice', 'Photo', 'Other'])) + '</div>' : '') + '</div>';
    });
    h += '</div><div class="card"><div class="card-h"><h2>Order documents</h2></div>' + fileList(P.files.filter((f) => f.order_id === o.id && !f.receipt_id)) + '<p style="margin:8px 0 0">' + fileInput('order_id:' + o.id, ['Signed PO', 'Proforma invoice', 'Invoice', 'Payment proof', 'Correspondence', 'Other']) + '</p></div>';
    return h;
  }
  function recvForm(o, rq) {
    let h = '<div class="card hl" id="rcv-form"><h2 style="margin-top:0">Record a delivery</h2><div class="form"><label>Received on<input type="date" name="received_on" value="' + today() + '"></label><label>Received by<input name="received_by" value="' + esc(UI.name || '') + '" placeholder="Site storekeeper"></label><label>Inspection<select name="inspection"><option value="accepted">Accepted</option><option value="partial">Partly accepted</option><option value="rejected">Rejected</option></select></label></div>';
    h += '<div class="scroll" style="margin-top:10px"><table class="items"><tr><th>Item</th><th class="num">Balance</th><th class="num" style="width:130px">Received now</th><th class="num" style="width:130px">Accepted</th></tr>' + (o.lines || []).map((l) => { const bal = Math.max(0, num(l.qty) - num(rq[l.id])); return '<tr data-line="' + l.id + '"><td>' + esc(l.desc) + '</td><td class="num">' + r2(bal) + ' ' + esc(l.unit || '') + '</td><td><input class="r" data-rl="received" inputmode="decimal" value="' + (bal ? r2(bal) : '') + '"></td><td><input class="r" data-rl="accepted" inputmode="decimal" placeholder="Same as received"></td></tr>'; }).join('') + '</table></div>';
    h += '<h2>Documents received with the material</h2><div class="chks">' + DOCS.map((d) => '<label><input type="checkbox" data-doc="' + d[0] + '"> ' + d[1] + '</label>').join('') + '</div><div class="form" style="margin-top:10px"><label class="full">Notes<input name="notes" placeholder="Delivery note no, condition, shortages, damage"></label></div>';
    return h + '<p style="margin:12px 0 0;display:flex;gap:8px"><button class="b pri" data-act="pSaveRecv">Save delivery</button><button class="b" data-act="pRecvCancel">Cancel</button></p></div>';
  }

  // ---------- Suppliers ----------
  function vSuppliers() {
    const q = (UI.supQ || '').toLowerCase(), cats = Array.from(new Set(P.suppliers.map((s) => s.category).filter(Boolean))).sort();
    const list = P.suppliers.filter((s) => (!UI.supCat || s.category === UI.supCat) && (!q || [s.name, s.category, s.brands, s.contact_person, s.phone].join(' ').toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
    let h = pageHead('Suppliers', 'Manufacturers, authorized distributors and local suppliers, with their record on past orders.', isProc() ? '<button class="b pri" data-act="pNewSup">New supplier</button>' : '');
    if (UI.supEdit) h += supForm();
    h += '<div class="bar"><label>Search<input id="sup-q" data-inp="supQ" value="' + esc(UI.supQ || '') + '" placeholder="Name, brand, contact"></label><label>Category<select data-chg="ui" data-f="supCat"><option value="">All</option>' + cats.map((c) => '<option' + (UI.supCat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></label></div>';
    if (!list.length) return h + '<div class="card"><p class="mut">' + (P.suppliers.length ? 'No supplier matches.' : 'No suppliers yet.') + '</p></div>';
    h += '<div class="card"><div class="scroll"><table><tr><th>Supplier</th><th>Category</th><th>Contact</th><th>Brands</th><th>Rating</th><th class="num">Quotes</th><th class="num">POs (PKR)</th><th>On time</th><th></th></tr>';
    list.forEach((s) => {
      const pos = P.orders.filter((o) => o.supplier_id === s.id && o.status !== 'cancelled'), done = pos.filter((o) => ['received', 'closed'].includes(o.status));
      const onTime = done.filter((o) => { const last = P.receipts.filter((x) => x.order_id === o.id).map((x) => x.received_on).sort().pop(); return last && o.delivery_date && last <= o.delivery_date; }).length;
      h += '<tr><td><b>' + esc(s.name) + '</b>' + (s.approved === false ? ' <span class="pill p-bad">Not approved</span>' : '') + '<small>' + esc(s.ntn ? 'NTN ' + s.ntn : '') + '</small></td><td>' + esc(s.category || '') + '</td><td>' + esc(s.contact_person || '') + '<small>' + esc([s.phone, s.email].filter(Boolean).join(' · ')) + '</small></td><td>' + esc(s.brands || '') + '</td><td class="nowrap stars">' + '★'.repeat(num(s.rating)) + '<span>' + '★'.repeat(5 - num(s.rating)) + '</span></td><td class="num">' + P.quotes.filter((x) => x.supplier_id === s.id).length + '</td><td class="num">' + pos.length + (pos.length ? '<small>' + money(pos.reduce((t, o) => t + orderTotals(o).pkr, 0)) + '</small>' : '') + '</td><td>' + (done.length ? Math.round(onTime / done.length * 100) + '%' : '') + '</td><td>' + (isProc() ? '<button class="b sm" data-act="pEditSup" data-id="' + s.id + '">Edit</button>' : '') + '</td></tr>';
    });
    return h + '</table></div></div>';
  }
  function supForm() {
    const s = UI.supEdit === 'new' ? { approved: true, rating: 3 } : byId(P.suppliers, UI.supEdit) || {};
    const f = (n, l, ph, cls) => '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + l + '<input name="' + n + '" value="' + esc(s[n] || '') + '"' + (ph ? ' placeholder="' + ph + '"' : '') + '></label>';
    return '<div class="card hl" id="sup-form"><h2 style="margin-top:0">' + (UI.supEdit === 'new' ? 'New supplier' : 'Edit ' + esc(s.name)) + '</h2><div class="form">' + f('name', 'Company name') + f('category', 'Category', 'Pumps, Valves and piping, HVAC, Electrical, Civil') + f('contact_person', 'Contact person') + f('phone', 'Phone') + f('email', 'Email') + f('ntn', 'NTN / STRN') + f('brands', 'Brands supplied', 'KSB, Grundfos', 'span2') + f('payment_terms', 'Usual payment terms') + '<label>Rating<select name="rating">' + [5, 4, 3, 2, 1].map((n) => '<option value="' + n + '"' + (num(s.rating) === n ? ' selected' : '') + '>' + '★'.repeat(n) + '</option>').join('') + '</select></label><label>Status<select name="approved"><option value="1"' + (s.approved !== false ? ' selected' : '') + '>Approved supplier</option><option value="0"' + (s.approved === false ? ' selected' : '') + '>Not approved</option></select></label>' + f('address', 'Address', '', 'full') + f('notes', 'Notes', 'Authorized distributor, credentials checked, past issues', 'full') + '</div><p style="margin:12px 0 0;display:flex;gap:8px"><button class="b pri" data-act="pSaveSup">Save</button><button class="b" data-act="pCancelSup">Cancel</button></p></div>';
  }

  // ---------- documents ----------
  function docContact() { return (UI.name || 'Procurement Department') + (LIVE && UI.user ? ', ' + UI.user : '') ; }
  async function rfqDoc(r, x) {
    const s = sup(x.supplier_id);
    const v = { ref_no: x.ref || r.mr_no, date: D().longDate(x.sent_on || today()), supplier: s.name, supplier_contact: s.contact_person ? 'Attn: ' + s.contact_person : '', supplier_address: [s.address, s.phone].filter(Boolean).join(', '), title: r.title, dear: s.contact_person || 'Sir / Madam', project: [r.project, r.site_id ? X.siteName(r.site_id) : ''].filter(Boolean).join(', ') || 'Sterling Engineering', required_by: D().longDate(r.required_by), due_on: D().longDate(x.due_on), contact: docContact(), signatory: UI.name || 'Procurement Department', signatory_title: UI.name ? 'Procurement' : 'Sterling Engineering & Construction Company' };
    const items = reqItems(r).filter((i) => i.desc).map((it, i) => ({ i_no: String(i + 1), i_desc: it.desc, i_spec: [it.spec, it.brand ? 'Approved brands: ' + it.brand : ''].filter(Boolean).join('\n'), i_qty: String(it.qty || ''), i_unit: it.unit || '' }));
    const terms = [['Prices', 'Quote unit rates in PKR, or state the currency. Show sales tax separately.'], ['Brand', 'Quote the approved brands only, or state alternatives clearly with datasheets.'], ['Delivery', 'State the delivery time from the date of the purchase order, and the delivery point.'], ['Validity', 'The quotation should remain valid for at least 30 days.'], ['Documents', 'Attach technical datasheets, catalogues and certificates (ISO, CE, test certificates) as applicable.']];
    D().save('RFQ ' + (r.mr_no || '') + ' - ' + s.name.replace(/[\\/:*?"<>|]/g, '') + '.docx', await D().build('rfq', v, { i_desc: items, t_text: terms.map((t) => ({ t_head: t[0], t_text: t[1] })) }));
  }
  async function poDoc(o) {
    const r = byId(P.requests, o.request_id) || {}, s = sup(o.supplier_id), q = byId(P.quotes, o.quote_id) || {}, t = orderTotals(o), cur = o.currency || 'PKR';
    const v = { ref_no: o.po_no, date: D().longDate(o.issued_on), supplier: s.name, supplier_contact: s.contact_person ? 'Attn: ' + s.contact_person : '', supplier_address: [s.address, s.phone].filter(Boolean).join(', '), title: r.title || '', dear: s.contact_person || 'Sir / Madam', quote_ref: q.quote_ref ? 'ref ' + q.quote_ref + (q.received_on ? ' dated ' + D().longDate(q.received_on) : '') : 'dated ' + D().longDate(q.received_on), project: [r.project, r.site_id ? X.siteName(r.site_id) : ''].filter(Boolean).join(', '), deliver_to: o.delivery_to || '', delivery_date: D().longDate(o.delivery_date), payment_terms: o.payment_terms || '', contact: docContact(), currency: cur, subtotal: money2(t.sub), tax_pct: String(r2(o.tax_pct || 0)), tax: money2(t.tax), transport: money2(t.extra), total: cur + ' ' + money2(t.total), total_words: (cur === 'PKR' ? 'Rupees ' : cur + ' ') + words(t.total) + ' Only', signatory: o.signatory || UI.name || 'Procurement Department', signatory_title: o.signatory_title || 'Procurement Department' };
    const items = (o.lines || []).map((l, i) => ({ i_no: String(i + 1), i_desc: l.desc, i_spec: [l.spec, l.brand ? 'Make: ' + l.brand : ''].filter(Boolean).join('\n'), i_qty: String(l.qty), i_unit: l.unit || '', i_rate: money2(l.rate), i_amount: money2(num(l.qty) * num(l.rate)) }));
    const terms = String(o.terms || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(':'); return i > 0 && i < 40 ? { t_head: x.slice(0, i).trim(), t_text: x.slice(i + 1).trim() } : { t_head: 'Note', t_text: x }; });
    D().save('PO ' + (o.po_no || '').replace(/[\\/]/g, '-') + ' - ' + s.name.replace(/[\\/:*?"<>|]/g, '') + '.docx', await D().build('po', v, { i_desc: items, t_text: terms }));
  }

  // ---------- actions ----------
  const curReq = () => (UI.prId === 'new' ? UI.prDraft : byId(P.requests, UI.prId));
  function readItems(r) {
    document.querySelectorAll('tr[data-row]').forEach((tr) => { const it = r.items[Number(tr.dataset.row)]; if (!it) return; tr.querySelectorAll('[data-it]').forEach((inp) => { it[inp.dataset.it] = inp.dataset.it === 'qty' ? numOrNull(inp.value) : inp.value.trim(); }); });
    const f = $('#pr-form'); if (f) ['mr_no', 'title', 'site_id', 'project', 'required_by', 'priority', 'notes'].forEach((k) => { const el = f.querySelector('[name=' + k + ']'); if (el) r[k] = el.value.trim() || (k === 'site_id' || k === 'required_by' ? null : ''); });
  }
  const copyReq = (r) => JSON.parse(JSON.stringify(r));
  Object.assign(A, {
    pNewReq() { UI.view = 'preq'; UI.prId = 'new'; UI.prDraft = null; UI.prTab = 'items'; X.render(); window.scrollTo(0, 0); },
    pBackReqs() { UI.prId = null; UI.prDraft = null; UI.pqEdit = null; X.render(); },
    pOpenReq(el) { UI.view = 'preq'; UI.prId = el.dataset.id; UI.prTab = el.dataset.tab || null; UI.pqEdit = null; X.render(); window.scrollTo(0, 0); },
    pStage(el) { UI.view = 'preq'; UI.prId = null; UI.prStage = el.dataset.s; X.render(); },
    pTab(el) { UI.prTab = el.dataset.t; UI.pqEdit = null; X.render(); },
    pAddItem() { const r = curReq(); readItems(r); r.items.push({ id: uuid(), desc: '', spec: '', brand: '', qty: '', unit: 'No' }); if (UI.prId !== 'new') UI.prDirty = r; X.render(); const rows = document.querySelectorAll('tr[data-row] [data-it=desc]'); if (rows.length) rows[rows.length - 1].focus(); },
    pDelItem(el) { const r = curReq(); readItems(r); r.items.splice(Number(el.dataset.i), 1); X.render(); },
    async pSaveReq() {
      const isNew = UI.prId === 'new', r = isNew ? UI.prDraft : copyReq(byId(P.requests, UI.prId));
      if (!isNew) r.items = byId(P.requests, UI.prId).items; // the grid edits the stored list; it is saved below
      readItems(r);
      r.items = r.items.filter((i) => i.desc || i.qty);
      if (!r.title) return toast('Enter a title for the request.');
      if (!r.items.length) return toast('Add at least one item.');
      const bad = r.items.find((i) => !i.desc || !num(i.qty)); if (bad) return toast('Every item needs a description and a quantity.');
      await put('requests', r);
      if (isNew) { await ev({ request_id: r.id, kind: 'Request raised', note: r.items.length + ' item(s)' }); UI.prId = r.id; UI.prDraft = null; UI.prTab = 'rfq'; }
      X.render(); toast(isNew ? 'Request saved. Next: choose suppliers for the RFQ.' : 'Saved.');
    },
    async pCancelReq() { const r = copyReq(curReq()); r.stage = 'cancelled'; await put('requests', r); await ev({ request_id: r.id, kind: 'Cancelled' }); X.render(); },
    async pSaveSub() { const r = copyReq(curReq()); r.submittal_status = $('#pr-sub').value; r.submittal_note = strOrNull($('#pr-subnote').value); await put('requests', r); await ev({ request_id: r.id, kind: 'Submittal: ' + r.submittal_status, note: r.submittal_note }); X.render(); toast('Saved.'); },
    async pAddRfq() {
      const r = copyReq(curReq()), sid = $('#rfq-sup').value; if (!sid) return toast('Choose a supplier.');
      r.rfq = (r.rfq || []).concat([{ supplier_id: sid, ref: (r.mr_no || 'RFQ') + '/' + ((r.rfq || []).length + 1), sent_on: today(), due_on: $('#rfq-due').value || null, status: 'sent' }]);
      if (r.stage === 'draft') r.stage = 'rfq';
      await put('requests', r); await ev({ request_id: r.id, kind: 'RFQ sent', note: sup(sid).name }); X.render(); toast('Added. Press Download RFQ and send it to ' + sup(sid).name + '.');
    },
    async pRfqDecline(el) { const r = copyReq(curReq()); r.rfq[Number(el.dataset.i)].status = 'declined'; await put('requests', r); await ev({ request_id: r.id, kind: 'Supplier declined', note: sup(r.rfq[Number(el.dataset.i)].supplier_id).name }); X.render(); },
    async pRfqDoc(el) { const r = curReq(); if (!reqItems(r).some((i) => i.desc)) return toast('Add the items first.'); await rfqDoc(r, r.rfq[Number(el.dataset.i)]); },
    pNewQuote(el) { UI.prTab = 'quotes'; UI.pqEdit = 'new:' + (el.dataset.s || ''); X.render(); const f = $('#q-form'); if (f) f.scrollIntoView({ block: 'start' }); },
    pEditQuote(el) { UI.pqEdit = el.dataset.id; X.render(); const f = $('#q-form'); if (f) f.scrollIntoView({ block: 'start' }); },
    pCancelQuote() { UI.pqEdit = null; X.render(); },
    async pSaveQuote() {
      const f = $('#q-form'), r = curReq(), g = (n) => f.querySelector('[name=' + n + ']').value, isNew = f.dataset.new === '1';
      const base = isNew ? { id: f.dataset.id, request_id: r.id, created_at: new Date().toISOString() } : Object.assign({}, byId(P.quotes, f.dataset.id));
      if (!g('supplier_id')) return toast('Choose the supplier.');
      if (isNew && reqQuotes(r).some((q) => q.supplier_id === g('supplier_id'))) return toast('There is already a quotation from this supplier. Edit that one.');
      const lines = []; f.querySelectorAll('tr[data-item]').forEach((tr) => { const p = numOrNull(tr.querySelector('[data-ql=price]').value); lines.push({ item: tr.dataset.item, price: p, brand: tr.querySelector('[data-ql=brand]').value.trim(), remark: tr.querySelector('[data-ql=remark]').value.trim() }); });
      if (!lines.some((l) => l.price)) return toast('Enter at least one unit rate.');
      const q = Object.assign(base, { supplier_id: g('supplier_id'), quote_ref: strOrNull(g('quote_ref')), received_on: g('received_on') || null, valid_until: g('valid_until') || null, currency: g('currency'), fx: numOrNull(g('fx')) || 1, lines: lines, tax_pct: numOrNull(g('tax_pct')), transport: numOrNull(g('transport')), other: numOrNull(g('other')), delivery_days: numOrNull(g('delivery_days')), delivery: strOrNull(g('delivery')), payment_terms: strOrNull(g('payment_terms')), warranty: strOrNull(g('warranty')), technical: g('technical') || null, certifications: strOrNull(g('certifications')), tech_notes: strOrNull(g('tech_notes')) });
      if (q.currency !== 'PKR' && q.fx === 1) return toast('Enter the rate to PKR for ' + q.currency + '.');
      await put('quotes', q);
      if (isNew) await ev({ request_id: r.id, kind: 'Quotation received', note: sup(q.supplier_id).name + ', ' + q.currency + ' ' + money(quoteTotals(q, r).total) });
      if (['draft', 'rfq'].includes(r.stage)) { const n = copyReq(r); n.stage = 'evaluation'; await put('requests', n); }
      UI.pqEdit = null; X.render(); toast('Quotation saved.' + (reqQuotes(r).length >= 2 ? ' Open the Comparison tab to compare.' : ''));
    },
    async pDelQuote(el) { const r = curReq(); if (r.recommended_quote === el.dataset.id) { const n = copyReq(r); n.recommended_quote = null; await put('requests', n); } await del('quotes', el.dataset.id); X.render(); },
    async pSaveRec() { await saveRec(false); },
    async pSendApproval() { await saveRec(true); },
    async pWithdraw() { const r = copyReq(curReq()); r.approval_status = null; r.stage = 'evaluation'; await put('requests', r); await ev({ request_id: r.id, kind: 'Withdrawn from approval' }); UI.prTab = 'compare'; X.render(); },
    async pDecide(el) {
      const r = curReq(), d = el.dataset.d, note = ($('#ap-note') || {}).value || '';
      if (d === 'rejected' && !note.trim()) { $('#ap-note').focus(); return toast('Write why it is rejected, so the team knows what to change.'); }
      await decide(r, d, note); X.render(); toast(d === 'approved' ? 'Approved. The procurement team can now issue the purchase order.' : 'Sent back to the procurement team.');
    },
    pCompareXlsx() {
      const r = curReq(), c = compareData(r), rows = c.items.map((it) => { const o = { Description: it.desc, Specification: it.spec || '', Qty: it.qty, Unit: it.unit || '' }; c.qs.forEach((q) => { const l = (q.lines || []).find((x) => x.item === it.id) || {}, n = sup(q.supplier_id).name; o[n + ' rate'] = l.price || ''; o[n + ' amount'] = c.tot[q.id].per[it.id] || ''; o[n + ' brand'] = l.brand || ''; }); return o; });
      const sum = [['Subtotal', (q, t) => r2(t.sub)], ['Sales tax', (q, t) => r2(t.tax)], ['Transport and other', (q, t) => r2(t.extra)], ['Total', (q, t) => r2(t.total)], ['Currency', (q) => q.currency || 'PKR'], ['Total PKR', (q, t) => r2(t.pkr)], ['Delivery', (q) => q.delivery_days ? q.delivery_days + ' days' : q.delivery || ''], ['Payment terms', (q) => q.payment_terms || ''], ['Warranty', (q) => q.warranty || ''], ['Valid until', (q) => q.valid_until || ''], ['Technical', (q) => q.technical || ''], ['Certifications', (q) => q.certifications || '']].map(([k, f]) => { const o = { Item: k }; c.qs.forEach((q) => { o[sup(q.supplier_id).name] = f(q, c.tot[q.id]); }); return o; });
      X.xlsxOut('Comparative statement ' + (r.mr_no || '') + '.xlsx', [{ name: 'Items', rows: rows }, { name: 'Commercial', rows: sum }]);
    },
    async pIssuePO() {
      const r = curReq(), q = byId(P.quotes, r.recommended_quote), f = $('#po-form'), g = (n) => f.querySelector('[name=' + n + ']').value.trim();
      if (!g('po_no')) return toast('Enter the PO number.');
      if (P.orders.some((o) => o.po_no === g('po_no'))) return toast('PO number ' + g('po_no') + ' is already used.');
      const lines = reqItems(r).map((it) => { const l = (q.lines || []).find((x) => x.item === it.id) || {}; return l.price ? { id: uuid(), item: it.id, desc: it.desc, spec: it.spec || '', brand: l.brand || it.brand || '', qty: num(it.qty), unit: it.unit || '', rate: num(l.price) } : null; }).filter(Boolean);
      const o = { id: uuid(), po_no: g('po_no'), request_id: r.id, quote_id: q.id, supplier_id: q.supplier_id, site_id: r.site_id || null, issued_on: g('issued_on') || today(), delivery_date: g('delivery_date') || null, delivery_to: g('delivery_to'), payment_terms: g('payment_terms'), terms: f.querySelector('[name=terms]').value, currency: q.currency || 'PKR', fx: q.fx || 1, lines: lines, tax_pct: q.tax_pct, transport: q.transport, other: q.other, status: 'issued', created_at: new Date().toISOString(), created_by: LIVE ? UI.user : who() };
      await put('orders', o);
      const n = copyReq(r); n.stage = 'ordered'; await put('requests', n);
      await ev({ request_id: r.id, order_id: o.id, kind: 'Purchase order issued', note: o.po_no + ' to ' + sup(o.supplier_id).name });
      o.signatory = g('signatory'); o.signatory_title = g('signatory_title');
      await poDoc(o); delete o.signatory; delete o.signatory_title;
      UI.view = 'porders'; UI.poId = o.id; X.render(); window.scrollTo(0, 0); toast('Purchase order ' + o.po_no + ' issued and downloaded.');
    },
    pOpenPO(el) { UI.view = 'porders'; UI.poId = el.dataset.id; UI.poRecv = false; X.render(); window.scrollTo(0, 0); },
    pBackPOs() { UI.poId = null; UI.poRecv = false; X.render(); },
    async pPODoc() { await poDoc(byId(P.orders, UI.poId)); },
    pRecvForm() { UI.poRecv = true; X.render(); const f = $('#rcv-form'); if (f) f.scrollIntoView({ block: 'start' }); },
    pRecvCancel() { UI.poRecv = false; X.render(); },
    async pSaveRecv() {
      const o = byId(P.orders, UI.poId), f = $('#rcv-form'), g = (n) => f.querySelector('[name=' + n + ']').value;
      const lines = []; f.querySelectorAll('tr[data-line]').forEach((tr) => { const rcv = numOrNull(tr.querySelector('[data-rl=received]').value); if (!rcv) return; const acc = numOrNull(tr.querySelector('[data-rl=accepted]').value); lines.push({ line: tr.dataset.line, received: rcv, accepted: acc === null ? (g('inspection') === 'rejected' ? 0 : rcv) : acc }); });
      if (!lines.length) return toast('Enter the quantity received for at least one item.');
      const docs = {}; f.querySelectorAll('[data-doc]').forEach((c) => { docs[c.dataset.doc] = c.checked; });
      const rc = { id: uuid(), order_id: o.id, received_on: g('received_on') || today(), received_by: g('received_by').trim(), lines: lines, inspection: g('inspection'), docs: docs, notes: strOrNull(g('notes')), created_at: new Date().toISOString(), created_by: LIVE ? UI.user : who() };
      await put('receipts', rc);
      const rq = receivedQty(o), allIn = (o.lines || []).every((l) => num(rq[l.id]) >= num(l.qty));
      const n = Object.assign({}, o, { status: allIn ? 'received' : 'partial' }); await put('orders', n);
      const missing = DOCS.filter((d) => !docs[d[0]]).length;
      await ev({ order_id: o.id, request_id: o.request_id, kind: 'Delivery received', note: lines.length + ' item(s), inspection ' + rc.inspection + (missing ? ', ' + missing + ' document(s) not received' : '') });
      UI.poRecv = false; X.render(); toast('Delivery saved.' + (allIn ? ' Everything on this PO is now received.' : ' Balance is still pending.'));
    },
    async pFollowUp() { const note = $('#fu-note').value.trim(); if (!note) return toast('Write what the supplier said.'); await ev({ order_id: UI.poId, kind: 'Follow-up', note: note, expected_on: $('#fu-date').value || null }); X.render(); },
    async pPOClose() { const o = Object.assign({}, byId(P.orders, UI.poId), { status: 'closed' }); await put('orders', o); await ev({ order_id: o.id, request_id: o.request_id, kind: 'Order closed' }); const r = byId(P.requests, o.request_id); if (r) { const n = copyReq(r); n.stage = 'closed'; await put('requests', n); } X.render(); },
    async pPOCancel() { const o = Object.assign({}, byId(P.orders, UI.poId), { status: 'cancelled' }); await put('orders', o); await ev({ order_id: o.id, request_id: o.request_id, kind: 'Order cancelled' }); X.render(); },
    async pOpenFile(el) { const f = byId(P.files, el.dataset.id); if (f) await openFile(f); },
    pNewSup() { UI.supEdit = 'new'; X.render(); window.scrollTo(0, 0); },
    pEditSup(el) { UI.supEdit = el.dataset.id; X.render(); window.scrollTo(0, 0); },
    pCancelSup() { UI.supEdit = null; X.render(); },
    pGoSuppliers() { UI.view = 'suppliers'; UI.supEdit = 'new'; UI.supBack = UI.prId; X.render(); window.scrollTo(0, 0); },
    async pSaveSup() {
      const f = $('#sup-form'), g = (n) => f.querySelector('[name=' + n + ']').value.trim();
      if (!g('name')) return toast('Enter the company name.');
      const base = UI.supEdit === 'new' ? { id: uuid(), created_at: new Date().toISOString() } : Object.assign({}, byId(P.suppliers, UI.supEdit));
      const s = Object.assign(base, { name: g('name'), category: strOrNull(g('category')), contact_person: strOrNull(g('contact_person')), phone: strOrNull(g('phone')), email: strOrNull(g('email')), ntn: strOrNull(g('ntn')), brands: strOrNull(g('brands')), payment_terms: strOrNull(g('payment_terms')), rating: Number(g('rating')), approved: g('approved') === '1', address: strOrNull(g('address')), notes: strOrNull(g('notes')) });
      await put('suppliers', s); UI.supEdit = null;
      if (UI.supBack) { UI.view = 'preq'; UI.prId = UI.supBack; UI.prTab = 'rfq'; UI.supBack = null; }
      X.render(); toast('Supplier saved.');
    }
  });
  async function saveRec(send) {
    const r = copyReq(curReq()), pick = document.querySelector('input[name=rec]:checked'), why = ($('#rec-why') || {}).value || '';
    if (!pick) return toast('Choose the quotation you recommend.');
    const c = compareData(r), q = byId(P.quotes, pick.value);
    if (send) {
      if (!quoteTotals(q, r).all) return toast('This quotation does not price every item. Ask the supplier, or split the request.');
      if (((c.lowest && c.lowest.id !== q.id) || q.technical !== 'compliant') && !why.trim()) { $('#rec-why').focus(); return toast('This is not the lowest compliant offer. Write the reason for the approver.'); }
      if (q.valid_until && q.valid_until < today()) return toast('This quotation has expired. Ask the supplier to extend it and update the date.');
    }
    r.recommended_quote = q.id; r.recommendation = why.trim() || null;
    if (send) { r.approval_status = 'pending'; r.stage = 'approval'; r.approval_note = null; }
    await put('requests', r);
    if (send) { await ev({ request_id: r.id, kind: 'Sent for approval', note: sup(q.supplier_id).name + ', PKR ' + money(quoteTotals(q, r).pkr) + (r.recommendation ? '. ' + r.recommendation : '') }); UI.prTab = 'approval'; }
    X.render(); toast(send ? 'Sent for approval. The owner and the accountant see it on their Procurement page.' : 'Saved.');
  }
  Object.assign(C, {
    async pFile(el) {
      const link = {}; el.dataset.link.split(',').forEach((p) => { const [k, v] = p.split(':'); link[k] = v; });
      const kind = el.closest('.fup').querySelector('.fkind').value;
      for (const file of Array.from(el.files)) await upload(file, link, kind);
      X.render(); toast(el.files.length + ' file(s) attached.');
    }
  });
  const procOnly = isProc;
  ['pNewReq', 'pAddItem', 'pDelItem', 'pSaveReq', 'pCancelReq', 'pSaveSub', 'pAddRfq', 'pRfqDecline', 'pNewQuote', 'pEditQuote', 'pSaveQuote', 'pDelQuote', 'pSaveRec', 'pSendApproval', 'pWithdraw', 'pIssuePO', 'pRecvForm', 'pSaveRecv', 'pFollowUp', 'pPOClose', 'pPOCancel', 'pNewSup', 'pEditSup', 'pSaveSup', 'pGoSuppliers'].forEach((k) => { EXT.actAllowed[k] = procOnly; });
  EXT.actAllowed.pDecide = canApprove;
  EXT.chgAllowed.pFile = procOnly;
  // the payroll change handler only lets these through for staff who may use them

  // ---------- register with the app ----------
  Object.assign(EXT.views, { proc: vProc, preq: vReqs, porders: vOrders, suppliers: vSuppliers });
  EXT.nav.push({ group: 'Procurement', item: ['proc', 'Procurement', 'cart'] }, { group: 'Procurement', item: ['preq', 'Material requests', 'list'] }, { group: 'Procurement', item: ['porders', 'Purchase orders', 'truck'] }, { group: 'Procurement', item: ['suppliers', 'Suppliers', 'store'] });
  EXT.roleViews.owner.push('proc', 'preq', 'porders', 'suppliers');
  EXT.roleViews.procurement.push('proc', 'preq', 'porders', 'suppliers');
  EXT.loaders.push(loadAll);
  const origLogout = EXT.onLogout;
  EXT.onLogout = () => { if (origLogout) origLogout(); Object.keys(P).forEach((k) => { P[k] = []; }); };
  const origRole = EXT.onRole;
  EXT.onRole = () => { if (origRole) origRole(); if (!LIVE) loadDemo(); };
  X.startApp();
})();
