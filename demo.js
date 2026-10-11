/*
 * Demo behaviour layered on guidance.js: sessions, deals, roles, house rules,
 * maker-checker, intake, tasks, report text, audit text, and the scripted Ask answers.
 * All data is hard-coded. Nothing here talks to a server.
 */
(function (root) {
  'use strict';
  var G = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./guidance.js') : root.Guidance;

  // Each deal is backed by a scenario in guidance.js: positive (real filing figures),
  // negative and neutral (synthetic). All three sit at "Structure decisions".
  var FIL = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./filings.js') : root.Filings;
  var ALL_SCENARIOS = G.SCENARIOS.concat(FIL ? FIL.scenarios() : []);
  var DEALS = ALL_SCENARIOS.map(function (sc) {
    return { id: sc.id, name: sc.name, kind: sc.kind, synthetic: sc.synthetic, stage: 2, interactive: true, summary: sc.note };
  });
  function scenarioFor(id) {
    for (var i = 0; i < ALL_SCENARIOS.length; i++) if (ALL_SCENARIOS[i].id === id) return ALL_SCENARIOS[i];
    return ALL_SCENARIOS[0];
  }

  var ROLE_LABEL = { admin: 'firm admin', lead: 'ECM Head', analyst: 'BRLM reviewer', counsel: 'external counsel', issuer: 'issuer contact' };
  var PERM = {
    analyst: ['confirm_fact', 'edit_fact', 'flag_fact', 'add_documents', 'change_price_band', 'generate_report', 'assess_house_rule', 'review_key', 'view_audit', 'ask',
      'run_drhp_review', 'file_document', 'decide_change', 'save_draft', 'new_review', 'run_match', 'run_intelligence', 'confirm_finding', 'run_check', 'save_register'],
    // The ECM Head does not decide findings; they override a BRLM reviewer's decision, with a note (E15-2).
    lead: ['confirm_fact', 'edit_fact', 'flag_fact', 'add_documents', 'change_price_band', 'generate_report', 'assess_house_rule', 'record_judgement', 'review_dependency', 'review_key', 'approve_report', 'view_audit', 'export_audit', 'ask',
      'run_drhp_review', 'file_document', 'override_decision', 'save_draft', 'new_review', 'run_match', 'run_intelligence', 'run_check', 'save_register',
      'set_materiality', 'assign_agent', 'view_portfolio'],
    admin: ['manage_users', 'edit_house_rules', 'view_audit', 'export_audit', 'ask', 'view_portfolio'],
    counsel: ['view_drafts', 'ask'],            // external: reads the checklist and drafts addressed to it; changes nothing
    issuer: ['file_document', 'add_documents', 'ask']   // external: files documents the deal team asked for; sees nothing else
  };
  // Screens each external role may open; null means all of the firm's own screens.
  var VIEWS_FOR = { counsel: ['drhp', 'projects'], issuer: ['vault'] };   // E15-7: the issuer uploads in the Evidence vault
  function allowedViews(role) { return VIEWS_FOR[role] ? VIEWS_FOR[role].slice() : null; }
  function can(role, action) { var p = PERM[role]; return !!p && p.indexOf(action) >= 0; }

  function newSession(hasSession) { return { view: hasSession ? 'home' : 'splash' }; }
  function signIn(sess) { sess.view = 'home'; return sess; }

  function now() { return new Date().toISOString(); }
  function log(s, role, text, t) {
    s.audit.push({ t: t || now(), who: (s.actor || ROLE_LABEL[role] || role || 'user'), text: text });
  }

  var SOURCE_KINDS = { folder: 'Folder', link: 'Link', files: 'Files' };
  function ingestSource(s, kind, label, t) {
    if (!SOURCE_KINDS[kind]) throw new Error('Unknown source kind: ' + kind);
    // Hard-coded demo result: the same 38 files read, 12 skipped as not relevant.
    s.intake = { kind: kind, label: label, filesRead: 38, skipped: 12, scans: [
      { file: 'scan_0007.pdf', reason: 'Scanned pages: the words were read from an image. OCR confidence 62% is below 80%.', confirmed: false },
      { file: 'Share allotment resolutions (scan).pdf', reason: 'Scanned pages: the words were read from an image. OCR confidence 71% is below 80%.', confirmed: false }] };
    log(s, 'analyst', SOURCE_KINDS[kind] + ' added: ' + label + '. 38 files read, 12 skipped as not relevant (demo).', t);
    return s.intake;
  }

  function confirmScan(s, role, file, t) {
    if (!can(role, 'add_documents') || !s.intake || !s.intake.scans) return false;
    var x = s.intake.scans.filter(function (y) { return y.file === file; })[0];
    if (!x) return false;
    if (!x.confirmed) { x.confirmed = true; log(s, role, 'Confirmed scanned file: ' + file + '.', t); }
    return true;
  }

  function addHouseRule(s, role, rule, t) {
    if (!can(role, 'edit_house_rules')) return false;
    var text = (rule && rule.text || '').trim();
    if (!text) return false;
    var max = 0;
    s.houseRules.forEach(function (h) { var n = parseInt(String(h.id).replace(/\D/g, ''), 10); if (n > max) max = n; });
    s.houseRules.push({ id: 'h' + (max + 1), head: (rule.head || 'General').trim(), text: text, owner: (rule.owner || 'Compliance').trim(), satisfied: null });
    log(s, role, 'Added house rule: ' + text, t);
    return true;
  }

  function setHouseRuleResult(s, role, id, satisfied, t) {
    if (!can(role, 'assess_house_rule')) return false;
    var key = String(id).replace(/^hr_/, '');
    for (var i = 0; i < s.houseRules.length; i++) {
      if (s.houseRules[i].id === key) {
        s.houseRules[i].satisfied = !!satisfied;
        log(s, role, 'Assessed house rule "' + s.houseRules[i].text + '" as ' + (satisfied ? 'met' : 'not met') + '.', t);
        return true;
      }
    }
    return false;
  }

  function recordJudgement(s, role, checkId, decision, note, t) {
    if (!can(role, 'record_judgement')) return false;
    // Keep the person's name when the UI has set it for this role ("R. Menon (ECM Head)"); otherwise name the role.
    if (!(s.actor && s.actor.indexOf('(' + ROLE_LABEL[role] + ')') >= 0)) s.actor = ROLE_LABEL[role];
    return G.recordJudgement(s, checkId, decision, note, t);
  }

  function approveReport(s, role, t) {
    if (!can(role, 'approve_report') || !s.reportGenerated || s.reportApprovedBy) return false;
    s.reportApprovedBy = role;
    log(s, role, 'Approved the review report.', t);
    return true;
  }

  var TASK_ORDER = ['Not started', 'In progress', 'Done'];
  function cycleTask(s, no, t) {
    for (var i = 0; i < s.tasks.length; i++) {
      if (s.tasks[i].no === no) {
        var next = TASK_ORDER[(TASK_ORDER.indexOf(s.tasks[i].status) + 1) % TASK_ORDER.length];
        s.tasks[i].status = next;
        log(s, 'analyst', 'Task #' + no + ' set to ' + next + '.', t);
        return true;
      }
    }
    return false;
  }

  function setUserRole(s, role, userId, newRole, t) {
    if (!can(role, 'manage_users') || !PERM[newRole]) return false;
    for (var i = 0; i < s.users.length; i++) {
      if (s.users[i].id === userId) {
        s.users[i].role = newRole;
        log(s, role, 'Changed the role of ' + s.users[i].name + ' to ' + ROLE_LABEL[newRole] + '.', t);
        return true;
      }
    }
    return false;
  }

  // People and deal teams (hard-coded). Membership is what keeps one deal team out of another's deals.
  function newPeople() {
    var all = DEALS.map(function (d) { return d.id; });
    var lead = ['torrent', 'kaveri', 'vishal_mega_mart', 'rotomag_enertec', 'manipal_payment', 'urban_company'];
    var analyst = ['torrent', 'yamuna', 'kaveri', 'anand_rathi', 'advance_agrolife', 'bonbloc', 'rodec_pharma'];
    return [
      { id: 'p1', name: 'A. Kapoor', role: 'admin', deals: all.slice() },
      { id: 'p2', name: 'R. Menon', role: 'lead', deals: lead },
      { id: 'p3', name: 'S. Iyer', role: 'analyst', deals: analyst },
      { id: 'p5', name: 'V. Rao (counsel firm)', role: 'counsel', deals: ['torrent', 'kaveri'] },
      { id: 'p6', name: 'M. Desai (issuer)', role: 'issuer', deals: ['torrent'] }
    ];
  }
  function dealsFor(people, personId) {
    var p = people.filter(function (x) { return x.id === personId; })[0];
    if (!p) return [];
    // The head of ECM and the firm admin see the whole book by codename; the wall holds for everyone else.
    if (p.role === 'lead' || p.role === 'admin') return DEALS.slice();
    return DEALS.filter(function (d) { return p.deals.indexOf(d.id) >= 0; });
  }
  function setMember(people, actorRole, personId, dealId, on, t) {
    if (!can(actorRole, 'manage_users')) return false;
    var p = people.filter(function (x) { return x.id === personId; })[0];
    if (!p || !DEALS.some(function (d) { return d.id === dealId; })) return false;
    var i = p.deals.indexOf(dealId);
    if (on && i < 0) p.deals.push(dealId);
    if (!on && i >= 0) p.deals.splice(i, 1);
    return true;
  }
  function setPersonRole(people, actorRole, personId, newRole, t) {
    if (!can(actorRole, 'manage_users') || !PERM[newRole]) return false;
    var p = people.filter(function (x) { return x.id === personId; })[0];
    if (!p) return false;
    p.role = newRole;
    return true;
  }

  // The answer key: every extracted field of the 8 filings, for a person to confirm against the source page.
  function newKeyReview() {
    var FIL = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./filings.js') : root.Filings;
    var items = [];
    function add(slug, field, o, valueKey) {
      var v = o ? (valueKey ? o[valueKey] : o.value) : null;
      var stated = v !== null && v !== undefined;
      items.push({ slug: slug, field: field, value: stated ? v : null, page: stated && o.page ? o.page : null,
        quote: stated && o.quote ? o.quote : null, kind: stated ? 'stated' : 'not_available',
        status: 'pending', note: '', by: '' });
    }
    FIL.all().forEach(function (r) {
      (r.years || []).forEach(function (y) {
        add(r.slug, 'nta.' + y, (r.nta || {})[y]);
        add(r.slug, 'monetary_assets.' + y, (r.monetary_assets || {})[y]);
        add(r.slug, 'net_worth.' + y, (r.net_worth || {})[y]);
      });
      add(r.slug, 'average_operating_profit', r.average_operating_profit);
      add(r.slug, 'operating_profit_each_year', r.operating_profit_each_year, 'all_positive');
      add(r.slug, 'price_band.floor', r.price_band, 'floor');
      add(r.slug, 'price_band.cap', r.price_band, 'cap');
      add(r.slug, 'route', r.route);
      add(r.slug, 'offer.structure', r.offer, 'structure');
    });
    return { items: items };
  }
  function reviewKeyField(kr, role, slug, field, status, note, t) {
    if (!can(role, 'review_key') || ['confirmed', 'disputed', 'pending'].indexOf(status) < 0) return false;
    if (status === 'disputed' && !(note || '').trim()) return false;
    for (var i = 0; i < kr.items.length; i++) {
      if (kr.items[i].slug === slug && kr.items[i].field === field) {
        kr.items[i].status = status; kr.items[i].note = (note || '').trim(); kr.items[i].by = status === 'pending' ? '' : (ROLE_LABEL[role] || role);
        return true;
      }
    }
    return false;
  }
  function keyReviewStats(kr) {
    var o = { total: kr.items.length, confirmed: 0, disputed: 0, pending: 0 };
    kr.items.forEach(function (i) { o[i.status]++; });
    return o;
  }
  function keyReviewCsv(kr) {
    var q = function (x) { x = String(x === null || x === undefined ? '' : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var lines = ['filing,field,value,page,status,note,reviewed_by'];
    kr.items.forEach(function (i) { lines.push([i.slug, i.field, i.value, i.page, i.status, i.note, i.by].map(q).join(',')); });
    return lines.join('\n');
  }

  // The plan: tasks (with our draft stage and role) and the inferred dependencies, bundled from data/ganges_*.csv.
  var GANGES = (function () {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      var src = require('fs').readFileSync(require('path').join(__dirname, 'ganges-data.js'), 'utf8');
      var m = src.match(/window\.GANGES_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
      return m ? JSON.parse(m[1]) : { tasks: [], deps: [] };
    }
    return root.GANGES_DATA || { tasks: [], deps: [] };
  })();
  // Fixed dates so the demonstration reads the same every day.
  var DEMO_TODAY = '2026-10-11', DEMO_FILING_DATE = '2026-10-28';
  function addDays(iso, n) {
    var p = iso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function dueDate(offset) { return offset === null || offset === undefined ? null : addDays(DEMO_FILING_DATE, offset); }
  function taskState(task) {
    if (task.status === 'Done') return 'Done';
    var due = dueDate(task.offset_days);
    if (!due) return 'Upcoming';
    if (due < DEMO_TODAY) return 'Overdue';
    if (due <= addDays(DEMO_TODAY, 7)) return 'Due this week';
    return 'Upcoming';
  }
  function newDeps() { return GANGES.deps.map(function (d) { return { task_id: d.task_id, depends_on: d.depends_on, review_status: d.review_status }; }); }
  function reviewDependency(deps, role, taskId, dependsOn, status, audit, t) {
    if (!can(role, 'review_dependency') || ['accepted', 'rejected', 'proposed'].indexOf(status) < 0) return false;
    for (var i = 0; i < deps.length; i++) {
      if (deps[i].task_id === taskId && deps[i].depends_on === dependsOn) {
        deps[i].review_status = status;
        audit.push({ t: t || now(), who: ROLE_LABEL[role] || role, text: 'Dependency #' + taskId + ' on #' + dependsOn + ' set to ' + status + '.' });
        return true;
      }
    }
    return false;
  }
  // Only links a person accepted may be used to claim that one task holds up another.
  function dependencyClaims(deps) { return deps.filter(function (d) { return d.review_status === 'accepted'; }); }
  function dependencyView(deps, taskNo) {
    var mine = deps.filter(function (d) { return d.task_id === taskNo; });
    return {
      blockers: mine.filter(function (d) { return d.review_status === 'accepted'; }).map(function (d) { return d.depends_on; }),
      possible: mine.filter(function (d) { return d.review_status === 'proposed'; }).map(function (d) { return d.depends_on; })
    };
  }

  function reportText(s) {
    var L = [];
    L.push('REVIEW REPORT (illustrative, hard-coded Torrent Gas values)');
    L.push('Scope: Chapter II of the ICDR Regulations 2018, Regs 6(1)(a) to (c), 14, 16 and 29 only.');
    L.push('');
    G.evaluate(s).forEach(function (c) {
      L.push('[' + c.outcome + '] ' + c.label);
      L.push('    ' + c.reason);
      L.push('    Cites: ' + c.cites.join(', '));
    });
    var js = Object.keys(s.judgements || {});
    if (js.length) {
      L.push('');
      js.forEach(function (k) {
        var j = s.judgements[k];
        L.push((j.decision === 'escalate' ? 'Escalated: ' : 'Judgement accepted: ') + k + (j.note ? ': ' + j.note : ''));
      });
    }
    var confirmed = s.facts.filter(function (f) { return f.status === 'confirmed'; }).length;
    L.push('');
    L.push('Facts confirmed: ' + confirmed + ' of ' + s.facts.length);
    L.push('Actions recorded: ' + s.audit.length);
    L.push(s.reportApprovedBy ? 'Approved by: ' + ROLE_LABEL[s.reportApprovedBy] : 'Approval: pending');
    L.push('This is a demonstration. It is not a compliance opinion.');
    return L.join('\n');
  }

  function esc(x) { return String(x === null || x === undefined ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // HTML with Word's namespaces opens in Word as a document. No file-format library is needed.
  function wordDoc(title, body) {
    return '<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + esc(title) + '</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eee}</style></head><body>' +
      '<h1>' + esc(title) + '</h1>' + body + '</body></html>';
  }
  function reportHtml(s) {
    var rows = G.evaluate(s).map(function (c) {
      return '<tr><td>' + esc('ICDR ' + c.reg) + '</td><td>' + esc(c.title) + '</td><td>' + esc(c.outcome) + '</td><td>' + esc(c.reason) + '</td><td>' + esc(c.cites.join(', ')) + '</td></tr>';
    }).join('');
    var confirmed = s.facts.filter(function (f) { return f.status === 'confirmed'; }).length;
    var js = Object.keys(s.judgements || {}).map(function (k) {
      var j = s.judgements[k];
      return '<li>' + esc(j.decision === 'escalate' ? 'Escalated' : 'Judgement accepted') + ': ' + esc(k) + (j.note ? ': ' + esc(j.note) : '') + '</li>';
    }).join('');
    var body = '<p>Illustrative output of the demonstration, built on hard-coded values. It is not a compliance opinion.</p>' +
      '<p>Scope: Chapter II of the ICDR Regulations 2018, Regs 6(1)(a) to (c), 14, 16 and 29, plus house rules.</p>' +
      '<table><tr><th scope="col">Regulation</th><th scope="col">Requirement</th><th scope="col">Outcome</th><th scope="col">Reason</th><th scope="col">Source</th></tr>' + rows + '</table>' +
      (js ? '<h2>Judgements</h2><ul>' + js + '</ul>' : '') +
      '<p>Facts confirmed: ' + confirmed + ' of ' + s.facts.length + '. Actions recorded: ' + s.audit.length + '.</p>' +
      '<p>' + (s.reportApprovedBy ? 'Approved by: ' + esc(ROLE_LABEL[s.reportApprovedBy]) : 'Approval: pending') + '</p>';
    return wordDoc('Review report', body);
  }
  // E15-5: who acted, and the trail for one of them.
  function auditPeople(s) {
    var seen = {};
    s.audit.forEach(function (a) { seen[a.who] = true; });
    return Object.keys(seen).sort();
  }
  function auditOf(s, who) { return who ? s.audit.filter(function (a) { return a.who === who; }) : s.audit; }
  function auditHtml(s, who) {
    var rows = auditOf(s, who).map(function (a) { return '<tr class="a"><td>' + esc(a.t) + '</td><td>' + esc(a.who) + '</td><td>' + esc(a.text) + '</td></tr>'; }).join('');
    return wordDoc('Audit trail' + (who ? ': ' + who : ''), '<table><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th></tr>' + rows + '</table>');
  }

  function auditToText(s, who) {
    return auditOf(s, who).map(function (a) { return a.t + '  ' + a.who + '  ' + a.text; }).join('\n');
  }

  // Regulation text for the regulations the checks cite (bundled from data/parsed/regs.json).
  var REGS = (function () {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      var src = require('fs').readFileSync(require('path').join(__dirname, 'regs-data.js'), 'utf8');
      var m = src.match(/window\.REGS_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
      return m ? JSON.parse(m[1]) : {};
    }
    return root.REGS_DATA || {};
  })();
  function regulation(n) { return REGS[String(n)] || null; }
  function pageCite(r) {
    var p = r.pages || [r.start_page];
    return 'ICDR Reg ' + r.reg_no + ', ' + (p.length > 1 ? 'p.' + p[0] + '-' + p[p.length - 1] : 'p.' + p[0]);
  }

  // Turns what someone typed into a lookup key. Order matters: a named regulation wins.
  function askKey(text) {
    var t = String(text || '').toLowerCase();
    var m = t.match(/\breg(?:ulation)?\.?\s*(\d{1,3})/);
    if (m) return 'reg:' + m[1];
    if (/next|what.*do/.test(t)) return 'next';
    if (/lock|tranche/.test(t)) return 'r16';
    if (/net worth/.test(t)) return 'r6_1_c';
    if (/ready|report/.test(t)) return 'ready';
    if (/change|did i|audit/.test(t)) return 'changes';
    return 'unknown';
  }

  // Recording a question is a separate act from answering it, so answering stays read-only.
  function logQuestion(s, role, question, ans, t) {
    log(s, role, 'Asked: ' + question + ' (' + (ans.found ? 'answered, source ' + ans.cites.join('; ') : 'not found') + ')', t);
  }

  var REG6C = 'An issuer is eligible to make an initial public offer only if it has a net worth of at least one crore rupees in each of the preceding three full years, calculated on a restated and consolidated basis.';
  function answer(s, q) {
    var checks = G.evaluate(s);
    function find(id) { return checks.filter(function (c) { return c.id === id; })[0]; }
    var na, c, g;
    if (typeof q === 'string' && q.indexOf('reg:') === 0) {
      var rg = regulation(q.slice(4));
      if (!rg) return { found: false, text: 'Not found: Regulation ' + q.slice(4) + ' is outside the regulations bundled with this demonstration (Regs 4 to 8, 14 to 22, 29 and 32).', cites: [] };
      var body = rg.text.replace(/\s+/g, ' ').trim();
      var heading = rg.heading || 'Regulation ' + rg.reg_no;
      return { found: true, text: heading + ': ' + (body.length > 700 ? body.slice(0, 700) + ' …' : body), cites: [pageCite(rg)] };
    }
    switch (q) {
      case 'next':
        na = G.nextAction(s);
        return { found: true, text: 'Next step: ' + na.title + '. ' + na.why + ' Owner: ' + na.who + '.', cites: ['Guidance rule: ' + na.rule] };
      case 'r16':
        c = find('r16');
        return { found: true, text: c.title + ': ' + c.outcome + '. ' + c.reason + (c.needs.length ? ' Needed: the locked-in tranche table.' : ''), cites: ['Reg 16'] };
      case 'r6_1_c':
        c = find('r6_1_c');
        return { found: true, text: REG6C + ' Current result: ' + c.outcome + '.', cites: ['Reg 6(1)(c)'] };
      case 'ready':
        g = G.canGenerateReport(s);
        return { found: true, text: g.ok ? 'Nothing is waiting on information. The report can be generated.' : 'Not yet. Waiting on: ' + g.blockers.join('; ') + '.', cites: ['Check results'] };
      case 'changes':
        return { found: true, text: s.audit.length + ' action(s) recorded in this session.', cites: ['Audit trail'] };
      default:
        return { found: false, text: 'Not found in this deal or in the regulation text covered by this demo.', cites: [] };
    }
  }

  function resetState(scenarioId) { return G.initialState(scenarioFor(scenarioId || 'torrent')); }

  var api = {
    DEALS: DEALS, ROLE_LABEL: ROLE_LABEL, PERM: PERM, TASK_ORDER: TASK_ORDER,
    can: can, allowedViews: allowedViews, newSession: newSession, signIn: signIn, ingestSource: ingestSource, confirmScan: confirmScan,
    addHouseRule: addHouseRule, setHouseRuleResult: setHouseRuleResult, approveReport: approveReport, recordJudgement: recordJudgement,
    cycleTask: cycleTask, setUserRole: setUserRole, reportText: reportText, auditToText: auditToText,
    answer: answer, resetState: resetState, regulation: regulation, askKey: askKey, logQuestion: logQuestion, reportHtml: reportHtml, auditHtml: auditHtml, auditPeople: auditPeople, wordDoc: wordDoc,
    newPeople: newPeople, dealsFor: dealsFor, setMember: setMember, setPersonRole: setPersonRole,
    GANGES: GANGES, DEMO_TODAY: DEMO_TODAY, DEMO_FILING_DATE: DEMO_FILING_DATE, dueDate: dueDate, taskState: taskState,
    newDeps: newDeps, reviewDependency: reviewDependency, dependencyClaims: dependencyClaims, dependencyView: dependencyView,
    newKeyReview: newKeyReview, reviewKeyField: reviewKeyField, keyReviewStats: keyReviewStats, keyReviewCsv: keyReviewCsv
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Demo = api;
})(typeof window !== 'undefined' ? window : this);
