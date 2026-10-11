/*
 * The three modules of the reference prototype's flow, as logic with no DOM: DRHP Review, Review Module (match review and
 * the authenticity opinion, our own design) and Diligence Module, plus the Dashboard, My projects and Evidence vault.
 * Hard-coded data only. Where a source is a sample the result says so. Written after modules.test.js.
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  var G = isNode ? require('./guidance.js') : root.Guidance;
  var D = isNode ? require('./demo.js') : root.Demo;

  var COVERAGE = (function () {
    if (isNode) {
      var src = require('fs').readFileSync(require('path').join(__dirname, 'schedule6-coverage-data.js'), 'utf8');
      var m = src.match(/window\.SCHEDULE6_COVERAGE\s*=\s*(\{[\s\S]*\});?\s*$/);
      return m ? JSON.parse(m[1]) : { filings: {}, synthetic: {}, heads: {} };
    }
    return root.SCHEDULE6_COVERAGE || { filings: {}, synthetic: {}, heads: {} };
  })();
  var HEAD_TITLES = COVERAGE.heads || {};
  var SCORED = 15;

  function now() { return new Date().toISOString(); }
  function mods(s) {
    if (!s.mods) s.mods = { runs: [], docs: [], decisions: [], drafts: [], reviews: [], opinions: [], register: [], assignments: [], checks: [], seq: 0 };
    return s.mods;
  }
  function nextId(s, p) { var m = mods(s); m.seq += 1; return p + m.seq; }
  function log(s, role, text, t) { s.audit.push({ t: t || now(), who: s.actor || D.ROLE_LABEL[role] || role, text: text }); }
  function dealName(id) {
    for (var i = 0; i < D.DEALS.length; i++) if (D.DEALS[i].id === id) return D.DEALS[i].name;
    return id;
  }

  /* ---- E15-2/3: one decision model for every finding ----
   * The BRLM reviewer decides each finding; a negative decision needs a note. The ECM Head does not decide: they only
   * override a decision already made, to a different outcome, with a note. An override locks the item until the ECM Head
   * reopens it. Both decisions and every step are kept on the item. */
  var AR = ['accepted', 'rejected'], CD = ['confirmed', 'dismissed'];
  function actor(s, role) { return s.actor || D.ROLE_LABEL[role] || role; }
  // A decision recorded before E15 has a status but no reviewer record: treat it as the BRLM reviewer's.
  function legacy(item) {
    var st = item && (item.st || item.human);
    if (st && st !== 'open' && !item.brlm && !item.head) { item.st = st; item.brlm = { decision: st, note: item.note || '', by: item.by || 'BRLM reviewer', at: item.at || '' }; }
    return item;
  }
  function applyDecision(s, item, role, decision, note, t, kinds, perm) {
    legacy(item);
    var n = String(note || '').trim(), at = t || now(), by = actor(s, role);
    if (kinds.indexOf(decision) < 0) return null;
    item.history = item.history || [];
    if (D.can(role, perm)) {
      if (item.head) return null;
      if (decision === kinds[1] && !n) return null;
      item.brlm = { decision: decision, note: n, by: by, at: at };
      item.st = decision;
      item.history.push({ step: 'decided', decision: decision, note: n, by: by, at: at });
      return 'decided';
    }
    if (D.can(role, 'override_decision')) {
      if (!item.brlm || decision === item.st || !n) return null;
      item.head = { decision: decision, note: n, by: by, at: at };
      item.st = decision;
      item.history.push({ step: 'override', decision: decision, note: n, by: by, at: at });
      return 'override';
    }
    return null;
  }
  function reopenItem(s, item, role, t) {
    if (!item || !D.can(role, 'override_decision') || !item.head) return false;
    item.history.push({ step: 'reopened', decision: item.brlm.decision, note: '', by: actor(s, role), at: t || now() });
    item.head = null;
    item.st = item.brlm.decision;
    return true;
  }
  function latestNote(item) { return item.head ? item.head.note : item.brlm ? item.brlm.note : ''; }
  function copyDecision(from, to) {
    to.st = from.st; to.brlm = from.brlm || null; to.head = from.head || null; to.history = (from.history || []).slice(); to.note = latestNote(from);
  }
  function word(d) { return d.charAt(0).toUpperCase() + d.slice(1); }

  /* ---------------- E10-2 / E10-4: Schedule VI Part A coverage ---------------- */
  function coverage(dealId) {
    var f = (COVERAGE.filings || {})[dealId] || (COVERAGE.synthetic || {})[dealId];
    if (!f) return null;
    var items = f.items.map(function (i) {
      return { no: i.no, title: HEAD_TITLES[i.no] || ('Head ' + i.no), status: i.status, page: i.page, span: i.span, source: 'Schedule VI, Part A' };
    });
    return { dealId: dealId, synthetic: !!f.synthetic, pdf: f.pdf || null, pdfPages: f.pdf_pages || null, items: items,
      score: f.score, of: SCORED, summary: f.summary };
  }

  function checklist(s, dealId) {
    var c = coverage(dealId);
    var list = c ? c.items.slice() : [];
    (s.houseRules || []).forEach(function (h) {
      var st = h.satisfied === true ? 'Present' : h.satisfied === false ? 'Missing' : 'Not assessed';
      list.push({ no: null, title: h.head + ': ' + h.text, status: st, page: null, span: null, source: 'House rule' });
    });
    return list;
  }

  /* ---- E13: the section-by-section scan. Every finding is computed from the coverage, the ICDR checks or a match review. ---- */
  // Which Schedule VI head an ICDR check belongs under: eligibility rests on the restated financials, Regs 14 and 16 on the
  // capital structure, Reg 29 on the price band in the particulars of the issue.
  var CHECK_HEAD = { r6_1_a: 11, r6_1_b: 11, r6_1_c: 11, r14: 8, r16: 8, r29: 9 };
  function partRef(no) { return 'Part A (' + no + ')'; }
  function coverageFinding(c, i) {
    var miss = i.status === 'Missing', where = i.title + (i.page ? ' · page ' + i.page : '') + ' · ' + partRef(i.no);
    return { sev: miss ? 'block' : 'review', source: 'Schedule VI coverage', head: i.no,
      t: miss ? 'No section found for "' + i.title + '"' : '"' + i.title + '" is thin',
      m: miss ? 'No heading for head (' + i.no + ') was found in the filing.' : 'The section runs ' + i.span + ' page' + (i.span === 1 ? '' : 's') + ' from page ' + i.page + '.',
      where: where,
      found: miss ? 'No section heading for head (' + i.no + ') "' + i.title + '" was found in ' + (c.pdf || 'the filing') + (c.pdfPages ? ' (' + c.pdfPages + ' pages)' : '') + '.'
        : 'The "' + i.title + '" section starts on page ' + i.page + ' and runs ' + i.span + ' page' + (i.span === 1 ? '' : 's') + '.',
      expected: 'Schedule VI, Part A requires head (' + i.no + ') "' + i.title + '" in the offer document (regulations 24(2)(b) and 34(1))' +
        (miss ? '.' : '; a complete head usually runs two pages or more.'),
      suggest: miss ? 'Add the "' + i.title + '" section, or point to where it is if the heading uses other words.'
        : 'Check the section against each sub-clause of head (' + i.no + ') and expand what is missing.',
      required: 'Confirm before filing. The scan reads section headings only; it does not assess what a section says.' };
  }
  function checkFinding(s, c, head) {
    var O = G.OUTCOME, sev = c.outcome === O.NOT_COMPLY ? 'block' : c.outcome === O.COMPLIES ? 'ok' : (c.outcome === O.INFO_REQUIRED || c.outcome === O.REFERRED) ? 'review' : null;
    if (!sev) return null;
    var judged = c.outcome === O.REFERRED && s.judgements && s.judgements[c.id];
    if (judged) sev = 'ok';
    var facts = s.facts.filter(function (f) { return (f.feeds || []).indexOf(c.id) >= 0 && f.status === 'confirmed'; });
    var pages = facts.map(function (f) { return f.page; }).filter(function (p, i, a) { return p && a.indexOf(p) === i; });
    var inputs = Object.keys(c.inputs || {}).map(function (k) { return k + ': ' + c.inputs[k]; });
    var thr = Object.keys(c.thresholds || {}).map(function (k) { return k + ' ' + c.thresholds[k]; });
    return { sev: sev, source: 'ICDR check', head: head, checkId: c.id,
      t: c.reg + ': ' + c.outcome, m: c.reason,
      where: (HEAD_TITLES[head] || 'Head ' + head) + (pages.length ? ' · page ' + pages.join(', ') : '') + ' · ' + partRef(head) + ' · ICDR ' + c.reg,
      found: (inputs.length ? inputs.join('; ') + '.' : c.reason) + (pages.length ? ' Confirmed from page ' + pages.join(', ') + '.' : ''),
      expected: thr.length ? c.reg + ': ' + thr.join('; ') + '.' : c.reg + ': ' + c.title + '.',
      suggest: sev === 'ok' ? (judged ? 'No change: the ECM Head has recorded a judgement.' : 'No change: recomputed from confirmed facts.')
        : sev === 'block' ? 'Resolve before filing: ' + c.reason
        : c.outcome === O.REFERRED ? 'Record the ECM Head\'s judgement on this check.' : 'Provide or confirm: ' + (c.needs || []).join(', ') + '.',
      required: sev === 'ok' ? 'None.' : sev === 'block' ? 'The issuer is not eligible on this test as the facts stand.' : 'The check cannot conclude until this is done.' };
  }
  function matchFindings(s) {
    var out = [];
    mods(s).reviews.forEach(function (r) {
      (r.findings || []).forEach(function (f) {
        if (f.status !== 'Differs' || f.resolved) return;
        out.push({ sev: 'review', source: 'Match review', head: 11, reviewId: r.id, factId: f.factId,
          t: f.field + ' does not tie out', m: 'Review project "' + r.name + '": ' + f.gapPct.toFixed(1) + '% apart.',
          where: HEAD_TITLES[11] + (f.page ? ' · page ' + f.page : '') + ' · ' + partRef(11),
          found: 'The DRHP shows ' + f.document + ' ' + (f.unit || '') + (f.page ? ' (page ' + f.page + ')' : '') + '.',
          expected: 'The source of truth (synthetic sample) shows ' + f.source + ' ' + (f.unit || '') + '.',
          suggest: 'Reconcile the figure to the source of truth, or record why the source is wrong.',
          required: 'Resolve the difference before the draft goes to counsel.' });
      });
    });
    return out;
  }
  function scanDrhp(s, dealId) {
    var c = coverage(dealId);
    if (!c) return null;
    var secs = c.items.filter(function (i) { return i.no <= SCORED; }).map(function (i) {
      return { key: 'h' + i.no, no: i.no, nm: i.title, ref: partRef(i.no), status: i.status, findings: (i.status === 'Missing' || i.status === 'Thin') ? [coverageFinding(c, i)] : [] };
    });
    function sec(no) { return secs.filter(function (x) { return x.no === no; })[0]; }
    var extra = null;
    G.evaluate(s).forEach(function (ch) {
      var head = CHECK_HEAD[ch.id];
      if (!head && ch.house) {
        var want = String(ch.title.split(':')[0] || '').toLowerCase();
        secs.forEach(function (x) { if (!head && x.nm.toLowerCase() === want) head = x.no; });
      }
      var f = head ? checkFinding(s, ch, head) : (ch.house ? checkFinding(s, ch, 0) : null);
      if (!f) return;
      if (head) sec(head).findings.push(f);
      else { f.where = 'Firm house rule · ' + ch.title; if (!extra) extra = { key: 'house', no: null, nm: 'Firm house rules', ref: 'House rule', status: null, findings: [] }; extra.findings.push(f); }
    });
    matchFindings(s).forEach(function (f) { sec(11).findings.push(f); });
    if (extra) secs.push(extra);
    return { dealId: dealId, synthetic: c.synthetic, sections: secs };
  }
  function allFindings(sc) { return [].concat.apply([], sc.sections.map(function (x) { return x.findings.map(function (f) { var o = JSON.parse(JSON.stringify(f)); o.section = x.nm; return o; }); })); }

  // docNames: the vault documents chosen for this run; every vault document when not given (E15-7).
  function runDrhpReview(s, role, dealId, t, docNames) {
    if (!D.can(role, 'run_drhp_review')) return false;
    var c = coverage(dealId);
    if (!c) return false;
    var vault = library(s, dealId).map(function (d) { return d.name; });
    var used = docNames ? vault.filter(function (n) { return docNames.indexOf(n) >= 0; }) : vault;
    if (!used.length) return false;
    var m = mods(s);
    var items = checklist(s, dealId), sc = scanDrhp(s, dealId), all = allFindings(sc);
    var act = all.filter(function (f) { return f.sev !== 'ok'; });
    var run = {
      id: 'run' + (m.runs.length + 1), no: m.runs.length + 1, at: t || now(), by: D.ROLE_LABEL[role] || role, deal: dealId,
      score: c.score, of: c.of, items: items,
      gaps: items.filter(function (i) { return i.status === 'Thin' || i.status === 'Missing'; }).length,
      docs: used, sections: sc.sections, blocking: all.filter(function (f) { return f.sev === 'block'; }).length,
      review: all.filter(function (f) { return f.sev === 'review'; }).length, verified: all.filter(function (f) { return f.sev === 'ok'; }).length,
      suggestions: act.map(function (f, i) {
        return { id: 'C-' + (i + 1), t: f.t, loc: f.where, st: 'open', sev: f.sev, source: f.source, section: f.section, found: f.found, expected: f.expected,
          suggest: f.suggest, required: f.required, reviewId: f.reviewId || null, factId: f.factId || null, note: '' };
      })
    };
    m.runs.push(run);
    m.curRun = run.id;
    log(s, role, 'DRHP review run ' + run.no + ': ' + run.score + ' of ' + run.of + ' Schedule VI heads present; ' + all.length + ' findings (' +
      run.blocking + ' blocking, ' + run.review + ' review, ' + run.verified + ' verified).', t);
    return run;
  }
  function runs(s) { return mods(s).runs; }
  function latestRun(s) { var r = mods(s).runs; return r.length ? r[r.length - 1] : null; }
  function currentRun(s) {
    var m = mods(s), id = m.curRun;
    return m.runs.filter(function (r) { return r.id === id; })[0] || latestRun(s);
  }
  function openRun(s, role, id, t) {
    var r = mods(s).runs.filter(function (x) { return x.id === id; })[0];
    if (!r) return false;
    mods(s).curRun = id;
    log(s, role, 'Opened DRHP review run ' + r.no + ' from the run history.', t);
    return r;
  }
  function findSuggestion(s, runId, sugId) {
    var r = mods(s).runs.filter(function (x) { return x.id === runId; })[0];
    return r && (r.suggestions || []).filter(function (x) { return x.id === sugId; })[0];
  }
  // A match difference appears both in its review project and in the run that carried it; one decision covers both.
  function mirrorToFinding(s, c) {
    if (!c.reviewId || !c.factId) return;
    var p = openReview(s, c.reviewId), f = p && p.findings.filter(function (x) { return x.factId === c.factId; })[0];
    if (f) { copyDecision(c, f); f.resolved = f.st === 'accepted'; }
  }
  function decideSuggestion(s, role, runId, sugId, decision, note, t) {
    var c = findSuggestion(s, runId, sugId);
    if (!c) return false;
    var step = applyDecision(s, c, role, decision, note, t, AR, 'decide_change');
    if (!step) return false;
    c.note = latestNote(c); c.by = actor(s, role); c.at = t || now();
    mirrorToFinding(s, c);
    log(s, role, (step === 'override' ? 'ECM Head override on suggested change ' + sugId + ', now ' + word(decision)
      : decision === 'accepted' ? 'Accepted suggested change ' + sugId + ' (implement, added to notes)' : 'Rejected suggested change ' + sugId + ' (red flag, kept in history)') +
      ': ' + c.t + (c.note ? ' (' + c.note + ')' : '') + '.', t);
    return true;
  }
  function reopenSuggestion(s, role, runId, sugId, t) {
    var c = findSuggestion(s, runId, sugId);
    if (!reopenItem(s, c, role, t)) return false;
    c.note = latestNote(c);
    mirrorToFinding(s, c);
    log(s, role, 'Reopened suggested change ' + sugId + ' for the BRLM reviewer: ' + c.t + '.', t);
    return true;
  }

  var CATEGORIES = ['Capital Structure', 'RHP Filing', 'Share Allotment · Scanned PDFs', 'Objects of the Issue', 'Legal & Regulatory', 'Case Images', 'Certificates'];
  function categoryFor(name) {
    var n = String(name || '').toLowerCase();
    if (/\.(png|jpe?g|gif|tiff?)$/.test(n)) return 'Case Images';
    if (/certif/.test(n)) return 'Certificates';
    if (/allot|scan/.test(n)) return 'Share Allotment · Scanned PDFs';
    if (/capital|shareholding|cap table/.test(n)) return 'Capital Structure';
    if (/object|quotation|use of proceeds/.test(n)) return 'Objects of the Issue';
    if (/litig|legal|regulat|case|approval/.test(n)) return 'Legal & Regulatory';
    if (/rhp|drhp|prospectus|offer document/.test(n)) return 'RHP Filing';
    return 'Unsorted';
  }
  // Parse status by file kind, as the reference prototype shows it. The demonstration records names; it reads no file.
  function parseStatus(name) {
    var n = String(name || '').toLowerCase();
    return (/\.(png|jpe?g|gif|tiff?|bmp)$/.test(n) || /scan/.test(n)) ? 'scanned · OCR' : 'parsed';
  }
  /* ---- E15-7: the Evidence vault is the deal's one document folder ----
   * It holds the filing, the documents found in the deal folder (the guided Documents stage) and every upload, each once.
   * Every module picks its documents from here; nothing is uploaded anywhere else. Names only: nothing is read. */
  var STAGE_DOCS = { offer: 'Offer document', financials: 'Restated financial statements', shareholding: 'Shareholding pattern', auditor: 'Auditor certificates' };
  function library(s, dealId) {
    var c = coverage(dealId), out = [];
    if (c && c.pdf) out.push({ name: c.pdf, category: 'RHP Filing', pages: c.pdfPages, own: true, source: 'Filing', parse: c.pdfPages ? 'parsed · ' + c.pdfPages + ' pp' : 'parsed' });
    Object.keys(STAGE_DOCS).forEach(function (k) {
      var st = (s.docs || {})[k];
      if (!st || st === 'missing' || (k === 'offer' && c && c.pdf)) return;
      out.push({ name: STAGE_DOCS[k], category: k === 'offer' ? 'RHP Filing' : categoryFor(STAGE_DOCS[k]), pages: null, own: true, source: 'Deal folder',
        parse: st === 'low_confidence' ? 'scanned · OCR' : 'parsed' });
    });
    ((s.intake && s.intake.scans) || []).forEach(function (x) {
      out.push({ name: x.file, category: categoryFor(x.file), pages: null, own: true, source: 'Deal folder', parse: 'scanned · OCR, ' + (x.confirmed ? 'confirmed' : 'to confirm') });
    });
    mods(s).docs.forEach(function (d) { if (!out.some(function (x) { return x.name === d.name; })) { d.source = d.source || 'Uploaded'; out.push(d); } });
    return out;
  }
  function documents(s, dealId) { return library(s, dealId); }
  function inVault(s, name) { return library(s, s.scenario).some(function (d) { return d.name === name; }); }
  function fileDocument(s, role, name, t) {
    var nm = String(name || '').trim();
    if (!D.can(role, 'file_document') || !nm) return false;
    var have = library(s, s.scenario).filter(function (d) { return d.name === nm; })[0];
    if (have) return have;
    var d = { name: nm, category: categoryFor(nm), pages: null, own: false, source: 'Uploaded', parse: parseStatus(nm) };
    mods(s).docs.push(d);
    log(s, role, 'Uploaded to the Evidence vault, filed under ' + d.category + ': ' + nm + '.', t);
    return d;
  }
  var USE_SIDE = { truth: 'source of truth', review: 'document to review' };
  function docUsage(s, name) {
    var m = mods(s), out = [];
    m.runs.forEach(function (r) { if ((r.docs || []).indexOf(name) >= 0) out.push('DRHP review run ' + r.no); });
    m.reviews.forEach(function (p) {
      ['truth', 'review'].forEach(function (side) { if ((p[side] || []).some(function (f) { return f.name === name; })) out.push('Review project "' + p.name + '": ' + USE_SIDE[side]); });
    });
    m.opinions.forEach(function (o) { if (o.doc === name) out.push('Authenticity opinion: ' + o.title); });
    m.register.forEach(function (e) { if ((e.evidence || []).indexOf(name) >= 0) out.push('Register matter ' + e.ref); });
    return out;
  }
  function filedByCategory(s, dealId) {
    var out = {};
    CATEGORIES.concat(['Unsorted']).forEach(function (c) { out[c] = 0; });
    documents(s, dealId).forEach(function (d) { out[d.category] = (out[d.category] || 0) + 1; });
    return out;
  }

  // The report is of the loaded run (the latest unless one was opened from the history), from header to next steps.
  function reviewReport(s, dealId) {
    var r = currentRun(s);
    if (!r) return null;
    var c = coverage(dealId);
    var L = ['DRHP REVIEW REPORT' + (c && c.synthetic ? ' (synthetic deal)' : ''), dealName(dealId) + ' · run ' + r.no + ' · ' + r.at,
      'Schedule VI, Part A of the ICDR Regulations, 2018. Heading presence only: a head is Present when its section heading is found and runs',
      'at least two pages; the content of a section is not assessed. Heads 16 to 18 are catch-all or conditional and are not scored.', '',
      'Completeness score: ' + r.score + ' of ' + r.of, ''];
    r.items.forEach(function (i) {
      L.push((i.no ? '(' + i.no + ') ' : '') + i.title + ': ' + i.status + (i.page ? ' (page ' + i.page + ')' : '') + (i.source === 'House rule' ? ' [house rule]' : ''));
    });
    var sum = reportSummary(s, dealId);
    L.push('', 'SCAN FINDINGS (run ' + r.no + ')');
    var fs = allFindings({ sections: r.sections || [] });
    if (!fs.length) L.push('   - None.');
    fs.forEach(function (f) { L.push('   - ' + (f.sev === 'ok' ? 'VERIFIED' : f.sev === 'block' ? 'BLOCKING' : 'REVIEW') + ' · ' + f.section + ': ' + f.t + ' — ' + f.m); });
    L.push('', 'DILIGENCE — MATERIAL MATTERS');
    if (!sum.material.length) L.push('   - None decided material.');
    sum.material.forEach(function (e) { L.push('   - ' + e.type + ' — ' + e.party + ' — ₹' + e.amount + ' crore (' + e.stage + ') [' + e.ref + ']'); });
    L.push('', 'RECONCILIATION — UNDISCLOSED MATTERS');
    if (!sum.undisclosed.length) L.push('   - None. The material matters in the register reconcile to the DRHP.');
    sum.undisclosed.forEach(function (e) { L.push('   - ' + e.type + ' [' + e.ref + ']: material and not found in the DRHP. Omission creates SEBI liability.'); });
    L.push('', 'RECOMMENDED NEXT STEPS');
    sum.nextSteps.forEach(function (x) { L.push('   - ' + x); });
    L.push('', 'Generated by the IPO readiness demonstration. Not a regulatory filing.');
    return L.join('\n');
  }
  // The tiles and lists of the review report screen, from the loaded run and the register.
  function reportSummary(s, dealId) {
    var r = currentRun(s);
    if (!r) return null;
    var gaps = r.items.filter(function (i) { return i.status === 'Thin' || i.status === 'Missing' || (i.source === 'House rule' && i.status !== 'Present'); });
    var material = register(s, dealId).filter(function (e) { return e.materiality === 'material'; });
    var und = omissions(s, dealId), sug = (r.suggestions || []);
    var open = sug.filter(function (x) { return x.st !== 'accepted'; });
    var steps = [];
    if (r.blocking) steps.push('Clear the ' + r.blocking + ' blocking finding(s) before the next filing.');
    if (und.length) steps.push('Disclose the ' + und.length + ' undisclosed material matter(s), or record why they need not be disclosed.');
    if (gaps.length) steps.push('Fill the ' + gaps.length + ' thin or missing head(s) and re-run the review.');
    if (open.length) steps.push('Accept or reject the ' + open.length + ' open suggested change(s), then draft the fix list to counsel.');
    if (register(s, dealId).some(function (e) { return e.materiality === null; })) steps.push('The ECM Head decides materiality for the matters still open in the register.');
    if (!steps.length) steps.push('The book is substantially complete on what this review reads; proceed.');
    return { run: r.no, completeness: r.score, of: r.of, gaps: gaps, undisclosed: und, material: material,
      blocking: r.blocking || 0, review: r.review || 0, verified: r.verified || 0, nextSteps: steps };
  }

  /* ---------------- E10-5: compare version, accept / reject, drafts ---------------- */
  var VERSIONS = {
    kaveri: { synthetic: true, label: 'V1 (first filing) and V2 (post-SEBI); both synthetic', changes: [
      { id: 'k1', head: 'Objects of the Offer: repayment of borrowings', v1: '₹7,200.00 million', v2: '₹6,500.00 million', chapter: 'Objects of the Offer', page: 88,
        note: 'Reduced by ₹700.00 million. Confirm against the latest borrowings statement.' },
      { id: 'k2', head: 'Risk Factors: a compliance risk added', v1: 'Not present', v2: 'Added', chapter: 'Risk Factors', page: 52,
        note: 'V2 adds a risk on a compounding application. Confirm that it reconciles to the litigation chapter.' },
      { id: 'k3', head: 'Capital Structure: promoter lock-in table', v1: '20.00%', v2: '20.00%', chapter: 'Capital Structure', page: 96,
        note: 'Identical in V1 and V2.' },
      { id: 'k4', head: 'The Offer: price band', v1: '[●]', v2: '₹95 to ₹100', chapter: 'The Offer', page: 30,
        note: 'The price band is now stated. Re-run the price band check.' }
    ] }
  };
  function versions(dealId) {
    var v = VERSIONS[dealId];
    if (v) return { available: true, synthetic: true, label: v.label, changes: v.changes.map(function (c) { return JSON.parse(JSON.stringify(c)); }) };
    var c = coverage(dealId);
    return { available: false, synthetic: false, changes: [],
      reason: 'Data not available: only one version of this draft is held' + (c && c.pdf ? ' (' + c.pdf + ')' : '') + '. Upload the first filing to compare.' };
  }
  function changeItem(s, changeId) { var m = mods(s); m.vstate = m.vstate || {}; return (m.vstate[changeId] = m.vstate[changeId] || {}); }
  function decideChange(s, role, dealId, changeId, decision, note, t) {
    var v = versions(dealId);
    if (!v.available) return false;
    var ch = v.changes.filter(function (c) { return c.id === changeId; })[0];
    if (!ch) return false;
    var it = changeItem(s, changeId), step = applyDecision(s, it, role, decision, note, t, AR, 'decide_change');
    if (!step) return false;
    mods(s).decisions.push({ changeId: changeId, head: ch.head, decision: decision, note: latestNote(it), by: actor(s, role), at: t || now(), override: step === 'override' });
    log(s, role, (step === 'override' ? 'ECM Head override on change ' + ch.head + ', now ' + word(decision) : (decision === 'accepted' ? 'Accepted' : 'Rejected') + ' change: ' + ch.head) +
      (it.note || latestNote(it) ? ' (' + latestNote(it) + ')' : '') + '.', t);
    return true;
  }
  function reopenChange(s, role, changeId, t) {
    var it = (mods(s).vstate || {})[changeId];
    if (!reopenItem(s, it, role, t)) return false;
    log(s, role, 'Reopened version change ' + changeId + ' for the BRLM reviewer.', t);
    return true;
  }
  function decisions(s, dealId) { return mods(s).decisions.slice(); }
  // The standing decision on a version change: the override if there is one, else the reviewer's.
  function currentDecision(s, changeId) {
    var it = (mods(s).vstate || {})[changeId];
    if (it && it.st) return { decision: it.st, note: latestNote(it), by: (it.head || it.brlm).by, brlm: it.brlm, head: it.head || null, history: it.history };
    var d = mods(s).decisions.filter(function (x) { return x.changeId === changeId; });   // sessions saved before E15
    return d.length ? d[d.length - 1] : null;
  }

  function openFlags(s, dealId) {
    var v = versions(dealId), changes = 0;
    if (v.available) v.changes.forEach(function (c) { var d = currentDecision(s, c.id); if (d && d.decision === 'rejected') changes++; });
    var matches = 0;
    mods(s).reviews.forEach(function (r) {
      (r.findings || []).forEach(function (f) { if (f.status === 'Differs' && !f.resolved) matches++; });
    });
    // From the latest run (the dashboard is a live summary; opening an old run only swaps the changes list): every
    // suggested change not yet accepted, as a rejection is a red flag and stays open. Match differences are counted once,
    // above: accepting one in a run marks it resolved in its review project.
    var run = latestRun(s), gaps = 0, checks = 0;
    if (run) (run.suggestions || []).forEach(function (x) {
      if (x.st === 'accepted') return;
      if (x.source === 'Schedule VI coverage') gaps++; else if (x.source === 'ICDR check') checks++;
    });
    return { changes: changes, matches: matches, gaps: gaps, checks: checks, total: changes + matches + gaps + checks };
  }

  var DISCLAIMER_EMAIL = 'This is an internal communication to advisers. It is not a regulatory or offer document.';
  function counselEmail(s, dealId) {
    var name = dealName(dealId), v = versions(dealId), L = [];
    L.push('Dear counsel,', '', 'For ' + name + ', the BRLM team asks you to look at the following points from our DRHP review.', '');
    var acc = [], rej = [];
    if (v.available) v.changes.forEach(function (c) {
      var d = currentDecision(s, c.id);
      if (d && d.decision === 'accepted') acc.push(c);
      if (d && d.decision === 'rejected') rej.push({ c: c, note: d.note });
    });
    if (acc.length) { L.push('Changes between V1 and V2 we have accepted:'); acc.forEach(function (c) { L.push('- ' + c.head + ': ' + c.v1 + ' to ' + c.v2 + ' (' + c.chapter + ', page ' + c.page + ')'); }); L.push(''); }
    if (rej.length) { L.push('Changes we have not accepted and need to resolve:'); rej.forEach(function (r) { L.push('- ' + r.c.head + ': ' + r.c.v1 + ' to ' + r.c.v2 + (r.note ? '. ' + r.note : '')); }); L.push(''); }
    if (!v.available) { L.push('Version comparison: ' + v.reason, ''); }
    var run = currentRun(s);
    if (run && run.suggestions) {
      var sAcc = run.suggestions.filter(function (x) { return x.st === 'accepted'; }), sRej = run.suggestions.filter(function (x) { return x.st === 'rejected'; });
      if (sAcc.length) { L.push('Please action the following before the next filing (DRHP review run ' + run.no + '):', '', changeLines(sAcc), ''); }
      else L.push('(Accept suggested changes in the DRHP review to list them here.)', '');
      if (sRej.length) { L.push('Red flags we have not accepted and are keeping open:'); sRej.forEach(function (x) { L.push('- [' + x.id + '] ' + x.t + (x.note ? '. ' + x.note : '')); }); L.push(''); }
    }
    if (run) {
      var gaps = run.items.filter(function (i) { return i.status === 'Thin' || i.status === 'Missing'; });
      if (gaps.length) { L.push('Schedule VI heads still thin or missing (run ' + run.no + '):'); gaps.forEach(function (i) { L.push('- ' + (i.no ? '(' + i.no + ') ' : '') + i.title + ': ' + i.status); }); L.push(''); }
    }
    var f = openFlags(s, dealId);
    if (f.matches) { L.push(f.matches + ' value(s) in the tie-out differ from the source of truth; details are in the review project.', ''); }
    L.push('Regards,', 'BRLM team', '', DISCLAIMER_EMAIL);
    return { subject: 'DRHP review points: ' + name, body: L.join('\n') };
  }
  function saveDraft(s, role, dealId, subject, body, t) {
    if (!D.can(role, 'save_draft')) return false;
    var sub = String(subject || '').trim(), b = String(body || '').trim();
    if (!sub || !b) return false;
    var d = { id: nextId(s, 'd'), deal: dealId, subject: sub, body: b, at: t || now(), by: D.ROLE_LABEL[role] || role };
    mods(s).drafts.push(d);
    log(s, role, 'Saved a draft to counsel: ' + sub + '.', t);
    return d;
  }
  function changeLines(list) {
    return list.map(function (c) {
      var x = '• [' + c.id + '] ' + c.t + '\n    Where: ' + c.loc;
      if (c.found) x += '\n    Found: ' + c.found;
      if (c.expected) x += '\n    Should be: ' + c.expected;
      if (c.suggest) x += '\n    Suggested change: ' + c.suggest;
      if (c.required && !/^None/.test(c.required)) x += '\n    Required: ' + c.required;
      return x;
    }).join('\n\n');
  }
  // "Save draft of changes": the accepted suggestions of the loaded run, or all of them when none is accepted yet.
  function saveChangesDraft(s, role, dealId, t) {
    var run = currentRun(s);
    if (!run || !run.suggestions || !run.suggestions.length) return false;
    var acc = run.suggestions.filter(function (x) { return x.st === 'accepted'; });
    var when = String(t || now()).replace('T', ' ').slice(0, 16);
    return saveDraft(s, role, dealId, 'Changes — ' + dealName(dealId) + ' (run ' + run.no + ', ' + when + ')', changeLines(acc.length ? acc : run.suggestions), t);
  }
  function savedDrafts(s, dealId) { return mods(s).drafts.filter(function (d) { return d.deal === dealId; }); }
  function removeDraft(s, role, dealId, id, t) {
    if (!D.can(role, 'save_draft')) return false;
    var m = mods(s), n = m.drafts.length;
    m.drafts = m.drafts.filter(function (d) { return !(d.id === id && d.deal === dealId); });
    if (m.drafts.length === n) return false;
    log(s, role, 'Removed a saved draft to counsel.', t);
    return true;
  }
  function esc(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function draftHtml(e) {
    return '<html><head><meta charset="utf-8"><title>' + esc(e.subject) + '</title></head><body><h1>' + esc(e.subject) + '</h1>' +
      esc(e.body).split('\n').map(function (l) { return '<p>' + l + '</p>'; }).join('') + '</body></html>';
  }
  // E15-5: the review report as a Word document: the summary, then every suggested change with what was found, what it
  // should be, the BRLM reviewer's decision and any ECM Head override, then the verified findings and the diligence results.
  function reviewReportHtml(s, dealId) {
    var r = currentRun(s);
    if (!r) return null;
    var sum = reportSummary(s, dealId), c = coverage(dealId);
    function dec(x) { return x ? esc(x.decision.charAt(0).toUpperCase() + x.decision.slice(1)) + (x.note ? ': ' + esc(x.note) : '') + '<br><small>' + esc(x.by) + ', ' + esc(String(x.at).replace('T', ' ').slice(0, 16)) + '</small>' : ''; }
    var STATUS = { open: 'Open', accepted: 'Accepted', rejected: 'Red flag' };
    var rows = (r.suggestions || []).map(function (x) {
      return '<tr><td>' + esc(x.id) + '</td><td><b>' + esc(x.t) + '</b><br>' + esc(x.loc) + '</td><td>' + esc(x.found) + '</td><td>' + esc(x.expected) + '<br><i>' + esc(x.suggest) + '</i></td>' +
        '<td>' + dec(x.brlm) + '</td><td>' + dec(x.head) + '</td><td>' + esc(STATUS[x.st] || x.st) + '</td></tr>';
    }).join('');
    var verified = allFindings({ sections: r.sections || [] }).filter(function (f) { return f.sev === 'ok'; });
    var body = '<p>' + esc(dealName(dealId)) + (c && c.synthetic ? ' (synthetic deal)' : '') + ', run ' + r.no + ' of ' + esc(String(r.at).replace('T', ' ').slice(0, 16)) + ' by ' + esc(r.by) + '.</p>' +
      '<table><tr><th>Completeness</th><th>Open gaps</th><th>Blocking</th><th>Review</th><th>Verified</th><th>Undisclosed matters</th></tr>' +
      '<tr><td>' + sum.completeness + ' of ' + sum.of + ' heads</td><td>' + sum.gaps.length + '</td><td>' + sum.blocking + '</td><td>' + sum.review + '</td><td>' + sum.verified + '</td><td>' + sum.undisclosed.length + '</td></tr></table>' +
      '<h2>Suggested changes and findings</h2>' + (rows ? '<table><tr><th>ID</th><th>Finding and where</th><th>Found in the DRHP (as-is)</th><th>Should be (to-be) and suggested change</th>' +
        '<th>BRLM reviewer</th><th>ECM Head override</th><th>Status</th></tr>' + rows + '</table>' : '<p>None.</p>') +
      '<h2>Verified findings</h2>' + (verified.length ? '<ul>' + verified.map(function (f) { return '<li>' + esc(f.section + ': ' + f.t + '. ' + f.m) + '</li>'; }).join('') + '</ul>' : '<p>None.</p>') +
      '<h2>Material diligence matters</h2>' + (sum.material.length ? '<ul>' + sum.material.map(function (e) { return '<li>' + esc(e.type + ', ' + e.party + ', ₹' + e.amount + ' crore (' + e.ref + ')') + '</li>'; }).join('') + '</ul>' : '<p>None decided material.</p>') +
      '<h2>Undisclosed matters</h2>' + (sum.undisclosed.length ? '<ul>' + sum.undisclosed.map(function (e) { return '<li>' + esc(e.type + ' (' + e.ref + '): material and not in the DRHP.') + '</li>'; }).join('') + '</ul>' : '<p>None.</p>') +
      '<h2>Recommended next steps</h2><ul>' + sum.nextSteps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<p><small>Generated by the IPO readiness demonstration. Not a regulatory filing. The scan reads section headings; it does not assess what a section says.</small></p>';
    return D.wordDoc('DRHP review report', body);
  }
  function draftText(e) { return 'Subject: ' + e.subject + '\n\n' + e.body + '\n'; }

  /* ---------------- E10-7: review projects and match review ---------------- */
  function newReview(s, role, name, t) {
    var nm = String(name || '').trim();
    if (!D.can(role, 'new_review') || !nm) return false;
    var p = { id: nextId(s, 'rv'), name: nm, status: 'Draft', createdAt: t || now(), updatedAt: t || now(), findings: [], truth: [], review: [], runs: 0, progress: 10 };
    mods(s).reviews.push(p);
    log(s, role, 'New review project: ' + nm + '.', t);
    return p;
  }
  function reviews(s) { return mods(s).reviews; }
  function openReview(s, id) { return mods(s).reviews.filter(function (r) { return r.id === id; })[0] || null; }

  var TOLERANCE_PCT = 0.5;
  function matchValue(source, doc) {
    if (source === null || source === undefined) return { status: 'Not in source', gapPct: null };
    if (doc === null || doc === undefined) return { status: 'Not in document', gapPct: null };
    var gap = source === 0 ? (doc === 0 ? 0 : 100) : Math.abs(doc - source) / Math.abs(source) * 100;
    return { status: gap <= TOLERANCE_PCT ? 'Matches' : 'Differs', gapPct: gap };
  }
  var RELIABILITY = { audited: 3, filing: 2, management: 1 };
  // Band = how far the two values agree, capped by how reliable the source of truth is. A difference is never above Low.
  function confidenceBand(source, doc, reliability) {
    var w = RELIABILITY[reliability] || 1;
    if (source === null || source === undefined || doc === null || doc === undefined) return { band: 'Low', reason: 'One side of the pair is missing.' };
    var m = matchValue(source, doc);
    if (m.status === 'Differs') return { band: 'Low', reason: 'The values are ' + m.gapPct.toFixed(1) + '% apart, more than rounding explains.' };
    if (w >= 2) return { band: 'High', reason: 'The values agree and the source is ' + reliability + '.' };
    return { band: 'Medium', reason: 'The values agree, but the source (' + reliability + ') is not strong enough for High.' };
  }
  // The sample source of truth (synthetic) equals the facts the deal holds, except one planted difference.
  function runMatch(s, role, id, t) {
    if (!D.can(role, 'run_match')) return false;
    var p = openReview(s, id);
    if (!p) return false;
    var withValue = s.facts.filter(function (f) { return f.metric !== 'attest' && f.value !== null && f.value !== undefined; });
    var plant = withValue.filter(function (f) { return f.metric === 'nw'; })[0] || withValue[0];
    p.findings = s.facts.filter(function (f) { return f.metric !== 'attest'; }).map(function (f) {
      var doc = (f.value === undefined) ? null : f.value;
      var src = doc === null ? null : (plant && f.id === plant.id ? Math.round(doc * 1.012 * 100) / 100 : doc);
      var m = matchValue(src, doc);
      var status = (src === null && doc === null) ? 'Data not available' : m.status;
      var cb = confidenceBand(src, doc, 'audited');
      return { factId: f.id, field: f.label, source: src, document: doc, unit: f.unit, status: status, gapPct: m.gapPct, page: f.page, resolved: false,
        reliability: 'audited', band: cb.band, bandReason: cb.reason };
    });
    p.status = 'Reviewed';
    p.ranAt = p.updatedAt = t || now();
    p.runs = (p.runs || 0) + 1;
    p.progress = 100;
    var diff = p.findings.filter(function (f) { return f.status === 'Differs'; }).length;
    log(s, role, 'Match review run on "' + p.name + '": ' + p.findings.length + ' fields, ' + diff + ' differ (sample source of truth).', t);
    return { project: p, findings: p.findings };
  }

  // E13: the two sides of a review project. Files are recorded by name with a parse status; the demonstration reads none.
  var SIDES = { truth: 'source-of-truth', review: 'to review' };
  function sideProgress(p) { return 10 + ((p.truth || []).length ? 25 : 0) + ((p.review || []).length ? 25 : 0); }
  function addReviewFile(s, role, id, side, name, t) {
    var p = openReview(s, id), nm = String(name || '').trim();
    if (!D.can(role, 'new_review') || !p || !SIDES[side] || !nm || !inVault(s, nm)) return false;
    p[side] = p[side] || [];
    if (p[side].some(function (f) { return f.name === nm; })) return false;
    p[side].push({ name: nm, parse: parseStatus(nm), category: categoryFor(nm) });
    if (p.status === 'Draft') p.status = 'In progress';
    if (p.status !== 'Reviewed') p.progress = sideProgress(p);
    p.updatedAt = t || now();
    log(s, role, 'Added a ' + SIDES[side] + ' file to "' + p.name + '": ' + nm + '.', t);
    return true;
  }
  function runReviewProject(s, role, id, t) {
    var p = openReview(s, id);
    if (!p) return false;
    if (!(p.truth || []).length || !(p.review || []).length) return { error: 'Add at least one file to each side first.' };
    return runMatch(s, role, id, t);
  }
  // E15-3: decide a match difference; mirrored to the latest DRHP run's suggested change for the same fact.
  function matchFinding(s, reviewId, factId) {
    var p = openReview(s, reviewId);
    return p && p.findings.filter(function (f) { return f.factId === factId && f.status === 'Differs'; })[0];
  }
  function mirrorToRun(s, reviewId, f) {
    var r = latestRun(s), c = r && (r.suggestions || []).filter(function (x) { return x.reviewId === reviewId && x.factId === f.factId; })[0];
    if (c) copyDecision(f, c);
  }
  function decideMatch(s, role, reviewId, factId, decision, note, t) {
    var f = matchFinding(s, reviewId, factId);
    if (!f) return false;
    var step = applyDecision(s, f, role, decision, note, t, AR, 'decide_change');
    if (!step) return false;
    f.resolved = f.st === 'accepted';
    mirrorToRun(s, reviewId, f);
    log(s, role, (step === 'override' ? 'ECM Head override on match difference, now ' + word(decision) : word(decision) + ' match difference') + ': ' + f.field +
      (latestNote(f) ? ' (' + latestNote(f) + ')' : '') + '.', t);
    return true;
  }
  function reopenMatch(s, role, reviewId, factId, t) {
    var f = matchFinding(s, reviewId, factId);
    if (!reopenItem(s, f, role, t)) return false;
    f.resolved = f.st === 'accepted';
    mirrorToRun(s, reviewId, f);
    log(s, role, 'Reopened match difference for the BRLM reviewer: ' + f.field + '.', t);
    return true;
  }
  function saveReviewProject(s, role, id, t) {
    var p = openReview(s, id);
    if (!D.can(role, 'new_review') || !p) return false;
    p.updatedAt = t || now();
    log(s, role, 'Saved review project "' + p.name + '".', t);
    return true;
  }

  /* ---------------- E10-8: authenticity opinion (our design) ---------------- */
  var RANK = { 'Reasonable': 0, 'Verify': 1, 'Looks off': 2 };
  function worst(outcomes) { return outcomes.reduce(function (w, o) { return RANK[o] > RANK[w] ? o : w; }, 'Reasonable'); }
  function validGstin(g) {
    var s = String(g || '').toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return false;
    var chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', sum = 0;
    for (var i = 0; i < 14; i++) {
      var v = chars.indexOf(s[i]) * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(v / 36) + (v % 36);
    }
    return chars[(36 - (sum % 36)) % 36] === s[14];
  }
  var STATE_CODES = 'AN AP AR AS BR CH CG DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OR PB PY RJ SK TG TN TR UP UK WB'.split(' ');
  function validCin(c) {
    var m = /^([LU])[0-9]{5}([A-Z]{2})([0-9]{4})(PLC|PTC|FTC|GOI|NPL|OPC|ULL|ULT|SGC|FLC)[0-9]{6}$/.exec(String(c || '').toUpperCase());
    return !!m && STATE_CODES.indexOf(m[2]) >= 0;
  }
  function amountCheck(booked, quoted) {
    var gap = booked ? Math.abs(quoted - booked) / Math.abs(booked) * 100 : 100;
    var out = gap <= 1 ? 'Reasonable' : gap <= 5 ? 'Verify' : 'Looks off';
    return { outcome: out, gapPct: gap };
  }
  function sumCheck(parts, total, label) {
    var sum = parts.reduce(function (a, b) { return a + b; }, 0);
    var a = amountCheck(total, sum);
    return { name: label, outcome: a.outcome, reason: 'The lines add up to ' + (Math.round(sum * 100) / 100) + ' against a stated total of ' + total +
      ' (a gap of ' + a.gapPct.toFixed(1) + '%).', source: 'Recomputed from the document' };
  }
  var REGISTRY = [   // sample registry (synthetic), keyed by GSTIN
    { gstin: '27AAPFU0939F1ZV', name: 'Fabrica Utilities Private Limited' }
  ];
  var DOC_TYPES = [
    { id: 'quotation', label: 'Vendor quotation (Objects of the Issue)' },
    { id: 'related_party', label: 'Related-party transactions schedule' },
    { id: 'revenue', label: 'Revenue break-up (geographic)' },
    { id: 'financials', label: 'Restated financials' }
  ];
  var SAMPLES = {
    quotation: { title: 'Vendor quotation (synthetic sample)', party: 'Acme Process Equipment Private Limited', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F',
      date: '2026-08-14', items: [4.1 * 2, 3.2], gstRate: 0.18, total: 13.4, booked: 12.0, unit: '₹ crore' },
    related_party: { title: 'Related-party transactions schedule (synthetic sample)', booked: 42.0, total: 42.0, unit: '₹ crore',
      parties: [{ name: 'Alpha Holdings Private Limited', cin: 'U74999MH2012PTC123456', amount: 18.0 }, { name: 'Beta Trading Private Limited', cin: 'U51909DL2015PTC654321', amount: 14.5 },
        { name: 'Gamma Logistics Private Limited', cin: 'U63090KA2018PTC111222', amount: 9.0 }] },
    revenue: { title: 'Revenue break-up (synthetic sample)', booked: 880.0, total: 880.0, unit: '₹ crore',
      segments: [{ region: 'India', amount: 610.0 }, { region: 'Europe', amount: 150.0 }, { region: 'North America', amount: 120.0 }] },
    financials: { title: 'Restated financials (synthetic sample)', assets: 1250.0, liabilities: 790.0, equity: 460.0, unit: '₹ crore' }
  };
  function samples() { return JSON.parse(JSON.stringify(SAMPLES)); }

  function opinionChecks(s, id) {
    var d = SAMPLES[id], c = [], items;
    if (id === 'quotation') {
      items = d.items.reduce(function (a, b) { return a + b; }, 0);
      var a = amountCheck(d.booked, d.total);
      c.push({ name: 'Amount against the Objects of the Issue line', outcome: a.outcome, reason: 'The quotation total is ' + d.total + ' crore against ' + d.booked + ' crore booked: a gap of ' + a.gapPct.toFixed(1) + '%. Reconcile before filing.', source: 'Quotation total against the DRHP Objects line (sample)' });
      var calc = items * (1 + d.gstRate), ar = amountCheck(d.total, calc);
      c.push({ name: 'Arithmetic of the quotation', outcome: ar.outcome, reason: 'Items of ' + (Math.round(items * 100) / 100) + ' crore plus GST at 18% give ' + (Math.round(calc * 100) / 100) + ' crore against ' + d.total + ' stated.', source: 'Recomputed from the line items' });
      var gv = validGstin(d.gstin);
      c.push({ name: 'GSTIN structure and check character', outcome: gv ? 'Reasonable' : 'Looks off', reason: gv ? 'The GSTIN has a valid structure and check character.' : 'The GSTIN fails its structure or check-character test.', source: 'GSTIN ' + d.gstin });
      var panIn = d.gstin.slice(2, 12);
      c.push({ name: 'PAN inside the GSTIN agrees with the PAN stated', outcome: panIn === d.pan ? 'Reasonable' : 'Looks off', reason: panIn === d.pan ? 'Both read ' + d.pan + '.' : 'The GSTIN contains ' + panIn + ' but the PAN stated is ' + d.pan + '.', source: 'Quotation header' });
      var reg = REGISTRY.filter(function (r) { return r.gstin === d.gstin; })[0];
      c.push({ name: 'Vendor found in the registry sample', outcome: !reg ? 'Verify' : (reg.name.toLowerCase() === d.party.toLowerCase() ? 'Reasonable' : 'Looks off'),
        reason: !reg ? 'The GSTIN is not in the sample registry, so the vendor\'s name and address are not independently confirmed. Obtain the registration certificate.' : (reg.name.toLowerCase() === d.party.toLowerCase() ? 'The name agrees.' : 'The registry names ' + reg.name + '.'), source: 'Sample registry (no live lookup is made)' });
      var days = (Date.parse(D.DEMO_FILING_DATE) - Date.parse(d.date)) / 86400000;
      c.push({ name: 'Quotation date against the filing date', outcome: days < 0 ? 'Looks off' : days <= 180 ? 'Reasonable' : 'Verify',
        reason: days < 0 ? 'The quotation is dated after the filing date.' : days <= 180 ? 'Dated ' + Math.round(days) + ' days before the filing date.' : 'Dated ' + Math.round(days) + ' days before filing; refresh it.', source: 'Quotation header' });
    } else if (id === 'related_party') {
      c.push(sumCheck(d.parties.map(function (p) { return p.amount; }), d.total, 'Parties add up to the stated total'));
      var bad = d.parties.filter(function (p) { return !validCin(p.cin); });
      c.push({ name: 'Company numbers (CIN) are well formed', outcome: bad.length ? 'Looks off' : 'Reasonable', reason: bad.length ? bad.length + ' CIN(s) fail the structure test: ' + bad.map(function (p) { return p.name; }).join(', ') + '.' : 'All ' + d.parties.length + ' CINs have a valid structure.', source: 'CIN column' });
      var seen = {}, dup = d.parties.filter(function (p) { var k = p.name.toLowerCase(); if (seen[k]) return true; seen[k] = 1; return false; });
      c.push({ name: 'No party appears twice', outcome: dup.length ? 'Verify' : 'Reasonable', reason: dup.length ? 'Listed more than once: ' + dup.map(function (p) { return p.name; }).join(', ') + '.' : 'Each party appears once.', source: 'Party column' });
      var bk = amountCheck(d.booked, d.total);
      c.push({ name: 'Total against the amount booked in the DRHP', outcome: bk.outcome, reason: 'Stated total ' + d.total + ' against ' + d.booked + ' booked.', source: 'DRHP related-party note (sample)' });
    } else if (id === 'revenue') {
      c.push(sumCheck(d.segments.map(function (x) { return x.amount; }), d.total, 'Regions add up to the stated revenue'));
      var bk2 = amountCheck(d.booked, d.total);
      c.push({ name: 'Revenue against the restated statement', outcome: bk2.outcome, reason: 'Stated ' + d.total + ' against ' + d.booked + ' in the restated statement.', source: 'Restated financial information (sample)' });
      var top = d.segments.slice().sort(function (a, b) { return b.amount - a.amount; })[0], share = top.amount / d.total * 100;
      c.push({ name: 'Concentration in one region', outcome: share > 60 ? 'Verify' : 'Reasonable', reason: top.region + ' is ' + share.toFixed(1) + '% of revenue' + (share > 60 ? '; consider a risk factor and a statement of the basis.' : '.'), source: 'Region column' });
    } else {
      var tot = d.liabilities + d.equity, bal = amountCheck(d.assets, tot);
      c.push({ name: 'Assets equal liabilities plus equity', outcome: bal.outcome, reason: 'Assets ' + d.assets + ' against liabilities plus equity ' + tot + '.', source: 'Recomputed from the statement' });
      var nw = s.facts.filter(function (f) { return f.metric === 'nw'; })[0];
      if (nw && nw.value !== null && nw.value !== undefined) {
        var m = amountCheck(nw.value, d.equity);
        c.push({ name: 'Equity against the net worth held for the deal', outcome: m.outcome, reason: 'Statement equity ' + d.equity + ' against net worth ' + nw.value + ' crore held in the facts (' + nw.fy + ').', source: 'Fact ' + nw.label + (nw.page ? ', page ' + nw.page : '') });
      } else {
        c.push({ name: 'Equity against the net worth held for the deal', outcome: 'Verify', reason: 'Data not available: the deal holds no net worth to compare.', source: 'Facts' });
      }
      c.push({ name: 'Liabilities are not negative or zero', outcome: d.liabilities > 0 ? 'Reasonable' : 'Looks off', reason: 'Liabilities are ' + d.liabilities + '.', source: 'Statement' });
    }
    return c;
  }
  var OPINION_DISCLAIMER = 'AI authenticity opinion is a decision-support signal, not verification. Every figure is recomputed by a rule; ' +
    'the platform takes no responsibility for a document\'s authenticity. The BRLM reviewer and counsel must confirm.';
  function opinion(s, id) {
    var checks = opinionChecks(s, id);
    return { type: id, title: SAMPLES[id].title, checks: checks, overall: worst(checks.map(function (c) { return c.outcome; })), disclaimer: OPINION_DISCLAIMER, synthetic: true };
  }
  // docName: the vault document the opinion is about; the checks themselves still run on the labelled synthetic sample.
  function runIntelligence(s, role, id, t, docName) {
    if (!D.can(role, 'run_intelligence') || !SAMPLES[id] || (docName && !inVault(s, docName))) return false;
    var o = opinion(s, id);
    o.doc = docName || null;
    o.id = nextId(s, 'op');
    o.at = t || now();
    o.checks.forEach(function (c) { c.human = null; });
    mods(s).opinions.unshift(o);
    log(s, role, 'Authenticity opinion run on ' + o.title + ': overall ' + o.overall + '.', t);
    return o;
  }
  function opinions(s) { return mods(s).opinions; }
  function opinionCheck(s, opinionId, idx) {
    var o = mods(s).opinions.filter(function (x) { return x.id === opinionId; })[0];
    return o && o.checks[idx];
  }
  function confirmFinding(s, role, opinionId, idx, decision, note, t) {
    var c = opinionCheck(s, opinionId, idx);
    if (!c) return false;
    var step = applyDecision(s, c, role, decision, note, t, CD, 'confirm_finding');
    if (!step) return false;
    c.human = c.st;
    log(s, role, (step === 'override' ? 'ECM Head override on authenticity opinion finding, now ' + decision : 'Authenticity opinion finding ' + decision) + ': ' + c.name +
      (latestNote(c) ? ' (' + latestNote(c) + ')' : '') + '.', t);
    return true;
  }
  function reopenFinding(s, role, opinionId, idx, t) {
    var c = opinionCheck(s, opinionId, idx);
    if (!reopenItem(s, c, role, t)) return false;
    c.human = c.st;
    log(s, role, 'Reopened authenticity opinion finding for the BRLM reviewer: ' + c.name + '.', t);
    return true;
  }

  /* ---------------- E10-9: diligence ---------------- */
  var KINDS = ['DIN', 'Director / KMP name', 'Promoter name', 'Company number (CIN)', 'PAN', 'Legislation / Act'];
  var SAMPLE_SOURCE = 'Sample aggregator results (synthetic); no court-data service is called in this demonstration.';
  function sampleMatters(dealId) {
    var c = coverage(dealId), pg = c && c.items[11] && c.items[11].page;
    return [
      { ref: 'TAX/' + dealId + '/1', forum: 'CIT(A) / ITAT', party: 'The issuer', type: 'Tax matters', amount: 4.6, stage: 'Appeal pending', disclosed: true, page: pg || null },
      { ref: 'REG/' + dealId + '/2', forum: 'Regional Director', party: 'The issuer and promoters', type: 'Compounding of a compliance matter', amount: 0.2, stage: 'Application filed', disclosed: true, page: pg ? pg + 1 : null },
      { ref: 'NTC/' + dealId + '/3', forum: 'Regulatory notice', party: 'A group entity', type: 'Show-cause notice', amount: 1.1, stage: 'Reply due', disclosed: false, page: null }
    ];
  }
  function kmpCheck(s, role, dealId, kind, value, t) {
    if (!D.can(role, 'run_check')) return false;
    if (kind === 'Aadhaar') return { refused: true, reason: 'Aadhaar search is disabled (legally restricted).', matches: [] };
    var v = String(value || '').trim();
    if (!v || KINDS.indexOf(kind) < 0) return false;
    var r = { kind: kind, value: v, source: SAMPLE_SOURCE, matches: sampleMatters(dealId), at: t || now() };
    mods(s).checks.push({ kind: kind, value: v, at: r.at });
    log(s, role, 'KMP and litigation check run by ' + kind + ' (sample data): ' + r.matches.length + ' matters.', t);
    return r;
  }
  function register(s, dealId) { return mods(s).register.filter(function (r) { return r.deal === dealId; }); }
  function saveToRegister(s, role, dealId, ref, t) {
    if (!D.can(role, 'save_register')) return false;
    var m = sampleMatters(dealId).filter(function (x) { return x.ref === ref; })[0];
    if (!m) return false;
    if (register(s, dealId).filter(function (r) { return r.ref === ref; }).length) return true;
    var e = JSON.parse(JSON.stringify(m));
    e.deal = dealId; e.materiality = null; e.note = ''; e.savedAt = t || now();
    mods(s).register.push(e);
    log(s, role, 'Saved to the litigation and dispute register: ' + ref + '.', t);
    return true;
  }
  function linkEvidence(s, role, dealId, ref, name, t) {
    if (!D.can(role, 'save_register') || !inVault(s, name)) return false;
    var e = register(s, dealId).filter(function (r) { return r.ref === ref; })[0];
    if (!e) return false;
    e.evidence = e.evidence || [];
    if (e.evidence.indexOf(name) < 0) e.evidence.push(name);
    log(s, role, 'Linked evidence to ' + ref + ' from the Evidence vault: ' + name + '.', t);
    return true;
  }
  function setMateriality(s, role, dealId, ref, value, note, t) {
    if (!D.can(role, 'set_materiality') || (value !== 'material' && value !== 'not_material')) return false;
    if (!String(note || '').trim()) return false;
    var e = register(s, dealId).filter(function (r) { return r.ref === ref; })[0];
    if (!e) return false;
    e.materiality = value; e.note = String(note).trim();
    log(s, role, 'Materiality of ' + ref + ' set to ' + value.replace('_', ' ') + ': ' + e.note + '.', t);
    return true;
  }
  function reconcile(s, dealId) {
    return register(s, dealId).map(function (e) {
      return { ref: e.ref, type: e.type, result: e.disclosed ? 'Disclosed' : 'Not disclosed', page: e.page, materiality: e.materiality };
    });
  }
  function openDiligence(s, dealId) {
    return register(s, dealId).filter(function (e) { return e.materiality === null || (e.materiality === 'material' && !e.disclosed); }).length;
  }
  function promoterProfile(s, dealId) {
    var n = register(s, dealId).length;
    return { synthetic: true, note: 'Sample profile (synthetic): promoter names are not read from the filing in this demonstration.',
      entries: [{ name: 'Promoter 1 (sample)', type: 'Promoter', litigation: n, directorships: 3, blacklist: 'No match in the sample list' },
        { name: 'Promoter group entity A (sample)', type: 'Group entity', litigation: 0, directorships: 1, blacklist: 'No match in the sample list' }] };
  }
  // E13: the reference prototype's eight profile heads. Heads that can be read from the register follow it; the list
  // checks (RBI, fugitive offenders, SEBI orders) and the directorship counts are sample values, labelled so.
  var SAMPLE_LIST = 'Sample list (synthetic); no RBI, fugitive-offender or SEBI list is queried in this demonstration.';
  function screening(s, dealId) {
    var reg = register(s, dealId), pp = promoterProfile(s, dealId);
    function fromReg(k, re) {
      var hit = reg.filter(function (e) { return re.test(e.type) || re.test(e.forum); });
      return { k: k, fromRegister: true, basis: 'Litigation & dispute register (' + reg.length + ' matter' + (reg.length === 1 ? '' : 's') + ')',
        v: !reg.length ? 'No check saved yet' : hit.length ? hit.length + ' in the register' : 'None in the register',
        ok: !reg.length ? 'grey' : hit.length ? 'amber' : 'green', refs: hit.map(function (e) { return e.ref; }) };
    }
    var cbi = fromReg('CBI / ED / SFIO matter', /\b(CBI|ED|SFIO)\b/);
    if (cbi.refs.length) cbi.ok = 'red';
    return [
      { k: 'Wilful defaulter (RBI)', v: 'No match in the sample list', ok: 'green', basis: SAMPLE_LIST, fromRegister: false },
      { k: 'Fugitive economic offender', v: 'No match in the sample list', ok: 'green', basis: SAMPLE_LIST, fromRegister: false },
      { k: 'SEBI / exchange debarment', v: 'No match in the sample list', ok: 'green', basis: SAMPLE_LIST, fromRegister: false },
      cbi,
      fromReg('Income-tax raid / survey', /raid|survey|search and seizure/i),
      fromReg('Section 149(3) compliance', /compounding|149\(3\)|resident director/i),
      { k: 'Other directorships', v: pp.entries.reduce(function (a, e) { return a + e.directorships; }, 0) + ' companies (sample)', ok: 'grey', basis: 'Sample profile (synthetic)', fromRegister: false },
      { k: 'Promoter group entities', v: pp.entries.filter(function (e) { return e.type === 'Group entity'; }).length + ' entity (sample)', ok: 'grey', basis: 'Sample profile (synthetic)', fromRegister: false }
    ];
  }
  function omissions(s, dealId) { return register(s, dealId).filter(function (e) { return e.materiality === 'material' && !e.disclosed; }); }
  function diligenceStatus(s, dealId) {
    var reg = register(s, dealId), und = omissions(s, dealId), open = reg.filter(function (e) { return e.materiality === null; }).length;
    var head = !reg.length ? 'No matters in the register yet' : und.length ? '⚠ ' + und.length + ' undisclosed material matter' + (und.length === 1 ? '' : 's')
      : '✓ 0 undisclosed matters';
    var note = !reg.length ? 'Run a KMP & litigation check and save matters to the register.'
      : und.length ? 'Material matters found but not in the DRHP: see the reconciliation.'
      : open ? open + ' matter(s) await the ECM Head\'s materiality decision.' : 'The material matters in the register reconcile to the DRHP.';
    return { matters: reg.length, undisclosed: und.length, awaiting: open, headline: head, note: note, clean: !!reg.length && !und.length };
  }
  function topFlags(s, dealId) {
    var r = latestRun(s);
    if (!r || !r.suggestions) return [];
    return r.suggestions.filter(function (x) { return x.st !== 'accepted'; })
      .sort(function (a, b) { return (a.sev === 'block' ? 0 : 1) - (b.sev === 'block' ? 0 : 1); }).slice(0, 5)
      .map(function (x) { return { id: x.id, sev: x.sev, t: x.t, st: x.st }; });
  }
  // The deal facts card: the facts held for the deal by year with their pages. Nothing is filled in that the filing does not give.
  var FACT_ROWS = [['nta', 'Net tangible assets'], ['ma', 'Monetary assets'], ['nw', 'Net worth']];
  function dealFacts(s, dealId) {
    var years = (s.years || []).slice();
    var rows = FACT_ROWS.map(function (m) {
      var cells = {};
      years.forEach(function (y) {
        var f = s.facts.filter(function (x) { return x.metric === m[0] && x.fy === y; })[0];
        cells[y] = f && f.value !== null && f.value !== undefined ? { value: f.value, unit: f.unit, page: f.page, status: f.status } : null;
      });
      return { metric: m[0], label: m[1], cells: cells };
    });
    var aop = s.facts.filter(function (x) { return x.metric === 'aop'; })[0];
    return { years: years, rows: rows, offer: s.offerStructure === 'ofs' ? 'Offer for sale only' : s.offerStructure === 'fresh' ? 'Fresh issue only' : s.offerStructure ? 'Fresh issue and offer for sale' : 'Data not available',
      aop: aop && aop.value !== null && aop.value !== undefined ? { value: aop.value, unit: aop.unit, page: aop.page, fy: aop.fy, status: aop.status } : null,
      objects: 'Data not available: the objects of the offer are not among the facts held for this deal.' };
  }

  var AGENTS = [
    { id: 'ag1', name: 'Priya', field: 'Legal diligence' },
    { id: 'ag2', name: 'Rohan', field: 'Financial diligence' },
    { id: 'ag3', name: 'Meera', field: 'Tax diligence' }
  ];
  function assignAgent(s, role, dealId, agentId, task, t) {
    var ag = AGENTS.filter(function (a) { return a.id === agentId; })[0];
    var tk = String(task || '').trim();
    if (!D.can(role, 'assign_agent') || !ag || !tk) return false;
    var a = { id: nextId(s, 'as'), deal: dealId, agent: ag.id, name: ag.name, field: ag.field, task: tk, status: 'Assigned', at: t || now() };
    mods(s).assignments.push(a);
    log(s, role, 'Assigned ' + ag.name + ' (' + ag.field + '): ' + tk + '.', t);
    return a;
  }
  function assignments(s, dealId) { return mods(s).assignments.filter(function (a) { return a.deal === dealId; }); }
  function setAssignmentStatus(s, role, id, status, t) {
    if (!D.can(role, 'assign_agent') || ['Assigned', 'In progress', 'Done'].indexOf(status) < 0) return false;
    var a = mods(s).assignments.filter(function (x) { return x.id === id; })[0];
    if (!a) return false;
    a.status = status;
    log(s, role, 'Diligence assignment to ' + a.name + ' set to ' + status + '.', t);
    return true;
  }

  /* ---------------- E10-10 / E10-3 ---------------- */
  function evidence(s) {
    var matched = {};
    mods(s).reviews.forEach(function (r) { (r.findings || []).forEach(function (f) { if (f.status === 'Matches') matched[f.factId] = true; }); });
    var rows = s.facts.map(function (f) {
      var has = f.value !== null && f.value !== undefined;
      var val = f.metric === 'attest' ? (has ? (f.value ? 'Positive in each year' : 'Not positive in each year') : null) : (has ? f.value + ' ' + f.unit : null);
      var status;
      if (!has) status = 'Itemisation pending';
      else if (f.status !== 'confirmed') status = 'Itemisation pending';
      else if (matched[f.id]) status = 'Cross-matched';
      else if (f.derived) status = 'Verified';
      else status = 'Evidenced';
      return { id: f.id, claim: f.label + (val ? ' — ' + val : ' — Data not available'),
        evidence: f.quote || (has ? 'No quotation recorded' : 'Data not available'),
        source: f.page ? 'DRHP page ' + f.page : 'Data not available', status: status };
    });
    return rows;
  }
  function myProjects(s, dealId) {
    return { reviews: mods(s).reviews.slice(), runs: mods(s).runs.slice(), drafts: savedDrafts(s, dealId), opinions: mods(s).opinions.slice() };
  }
  function nextKeyDate() {
    var today = D.DEMO_TODAY, best = null;
    (D.GANGES.tasks || []).forEach(function (tk) {
      if (tk.offset_days === null || tk.offset_days === undefined || tk.source_status === 'Done') return;
      var due = D.dueDate(tk.offset_days);
      if (due >= today && (!best || due < best.date)) best = { date: due, activity: tk.activity, id: tk.id };
    });
    return best || { date: D.DEMO_FILING_DATE, activity: 'Filing of the DRHP', id: null };
  }
  function dashboard(s, dealId) {
    var r = latestRun(s);
    return { completeness: r ? r.score : null, of: SCORED, openFlags: openFlags(s, dealId).total, openDiligence: openDiligence(s, dealId),
      nextKeyDate: nextKeyDate(), runs: mods(s).runs.length };
  }

  /* ---------------- E11: portfolio ("All deals") ---------------- */
  var STATUS_ORDER = ['Does not comply', 'Facts to confirm', 'Needs judgement', 'Information required', 'Ready'];
  function canViewPortfolio(role) { return D.can(role, 'view_portfolio'); }
  function dealStatus(s) {
    var cs = G.evaluate(s), O = G.OUTCOME;
    if (cs.some(function (c) { return c.outcome === O.NOT_COMPLY; })) return 'Does not comply';
    // A verdict that rests on a value nobody has confirmed is not a status the ECM Head should act on.
    if (s.facts.some(function (f) { return G.isRequired(s, f) && f.status !== 'confirmed'; })) return 'Facts to confirm';
    if (cs.some(function (c) { return c.outcome === O.REFERRED && !(s.judgements && s.judgements[c.id]); })) return 'Needs judgement';
    if (cs.some(function (c) { return c.outcome === O.INFO_REQUIRED; })) return 'Information required';
    return 'Ready';
  }
  function portfolio(states, people, personId, opts) {
    var o = opts || {}, rows = [];
    D.dealsFor(people, personId).forEach(function (d) {
      var s = (states && states[d.id]) || D.resetState(d.id);
      var req = s.facts.filter(function (f) { return G.isRequired(s, f); });
      var cov = coverage(d.id), run = s.mods && s.mods.runs && s.mods.runs.length ? s.mods.runs[s.mods.runs.length - 1] : null;
      var na = G.nextAction(s);
      rows.push({
        id: d.id, name: d.name, kind: d.kind, synthetic: !!d.synthetic, status: dealStatus(s),
        factsConfirmed: req.filter(function (f) { return f.status === 'confirmed'; }).length, factsTotal: req.length,
        report: s.reportApprovedBy ? 'Approved' : s.reportGenerated ? 'Waiting for approval' : 'Not generated',
        schedule6: { score: run ? run.score : (cov ? cov.score : null), of: SCORED, run: !!run },
        openFlags: openFlags(s, d.id).total, openDiligence: openDiligence(s, d.id),
        overdue: s.tasks.filter(function (t) { return D.taskState(t) === 'Overdue'; }).length,
        nextAction: na ? { title: na.title, who: na.who, kind: na.kind } : null
      });
    });
    rows.sort(function (a, b) { return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.name < b.name ? -1 : 1); });
    var totals = { deals: rows.length, byStatus: {}, byReport: {}, openFlags: 0, openDiligence: 0, overdue: 0 };
    rows.forEach(function (r) {
      totals.byStatus[r.status] = (totals.byStatus[r.status] || 0) + 1;
      totals.byReport[r.report] = (totals.byReport[r.report] || 0) + 1;
      totals.openFlags += r.openFlags; totals.openDiligence += r.openDiligence; totals.overdue += r.overdue;
    });
    var shown = rows.filter(function (r) { return (!o.kind || r.kind === o.kind) && (!o.status || r.status === o.status); });
    return { rows: shown, totals: totals, statuses: STATUS_ORDER.slice() };
  }

  var api = {
    CATEGORIES: CATEGORIES, DOC_TYPES: DOC_TYPES, AGENTS: AGENTS, KINDS: KINDS, OPINION_DISCLAIMER: OPINION_DISCLAIMER, SAMPLE_SOURCE: SAMPLE_SOURCE,
    coverage: coverage, checklist: checklist, runDrhpReview: runDrhpReview, runs: runs, latestRun: latestRun, categoryFor: categoryFor,
    documents: documents, library: library, docUsage: docUsage, linkEvidence: linkEvidence, fileDocument: fileDocument, filedByCategory: filedByCategory, reviewReport: reviewReport,
    versions: versions, decideChange: decideChange, decisions: decisions, currentDecision: currentDecision, openFlags: openFlags,
    counselEmail: counselEmail, saveDraft: saveDraft, savedDrafts: savedDrafts, removeDraft: removeDraft, draftHtml: draftHtml, draftText: draftText,
    newReview: newReview, reviews: reviews, openReview: openReview, matchValue: matchValue, runMatch: runMatch, confidenceBand: confidenceBand,
    validGstin: validGstin, validCin: validCin, amountCheck: amountCheck, samples: samples, opinion: opinion, runIntelligence: runIntelligence,
    opinions: opinions, confirmFinding: confirmFinding,
    kmpCheck: kmpCheck, register: register, saveToRegister: saveToRegister, setMateriality: setMateriality, reconcile: reconcile,
    openDiligence: openDiligence, promoterProfile: promoterProfile, assignAgent: assignAgent, assignments: assignments, setAssignmentStatus: setAssignmentStatus,
    evidence: evidence, myProjects: myProjects, nextKeyDate: nextKeyDate, dashboard: dashboard,
    scanDrhp: scanDrhp, currentRun: currentRun, openRun: openRun, decideSuggestion: decideSuggestion, reopenSuggestion: reopenSuggestion, reopenChange: reopenChange,
    decideMatch: decideMatch, reopenMatch: reopenMatch, reopenFinding: reopenFinding, legacyDecision: legacy, changeLines: changeLines, saveChangesDraft: saveChangesDraft,
    reportSummary: reportSummary, reviewReportHtml: reviewReportHtml, dealFacts: dealFacts, addReviewFile: addReviewFile, runReviewProject: runReviewProject, saveReviewProject: saveReviewProject,
    screening: screening, omissions: omissions, diligenceStatus: diligenceStatus, topFlags: topFlags,
    portfolio: portfolio, canViewPortfolio: canViewPortfolio, STATUS_ORDER: STATUS_ORDER
  };
  if (isNode) module.exports = api; else root.Modules = api;
})(typeof window !== 'undefined' ? window : this);
