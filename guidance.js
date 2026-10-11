/*
 * Next-step guidance for the IPO readiness prototype.
 *
 * Everything here is deterministic. The "next step" shown to the user is computed from
 * the deal state by a fixed priority list, so the same state always gives the same
 * answer and the reason can be shown on screen. No model is involved.
 *
 * Figures are Torrent Gas UDRHP-I values from data/torrent_gas_facts.json (page 494).
 * Thresholds are quoted from the ICDR Regulations 2018 text in data/parsed/regs.json.
 * Regs 14 and 16 are NOT computed here (they need inputs the prototype does not model);
 * they only show whether the inputs are present.
 */
(function (root) {
  'use strict';

  var OUTCOME = {
    COMPLIES: 'Complies',
    NOT_COMPLY: 'Does not comply',
    INFO_REQUIRED: 'Information required',
    REFERRED: 'Referred for judgement',
    NOT_APPLICABLE: 'Not applicable'
  };

  var STAGES = [
    'Kick-off and diligence', 'Financials and certificates', 'Structure decisions',
    'Agreements and approvals', 'Drafting', 'Verification', 'Filing'
  ];
  // After the draft is filed. The plan document ends at the filing, so there are no tasks, owners or dates to show.
  var NO_PLAN = 'Data not available: the plan document ends at the filing of the DRHP.';
  var POST_FILING_STAGES = ['Observations', 'Updated draft red herring prospectus', 'Red herring prospectus', 'Anchor investors', 'Bidding', 'Listing']
    .map(function (n) { return { name: n, planned: false, note: NO_PLAN }; });

  var PRIORITY = [
    'Facts you can confirm now come first, because every check depends on them.',
    'Then judgements and assumptions that are yours to make, such as the price band or a house rule.',
    'Then documents and inputs that must come from someone else.',
    'When nothing is outstanding, generate the report.',
    'The ECM Head approves the report before the stage closes.',
    'After approval, move to the next stage.'
  ];

  var YEARS = ['FY2026', 'FY2025', 'FY2024'];
  var QUOTE = {
    nta: 'Net tangible assets, as 20,464.19 20,777.24 19,306.61',
    ma: 'Monetary assets, as restated(2) 2,175.32 791.85 1,066.10',
    nw: 'Net Worth, as restated(4) 20,919.21 18,113.80 16,765.72',
    aop: 'Our average operating profit, as restated, for Fiscals 2026, 2025 and 2024 is ₹3,670.10 million.'
  };
  var LABEL = {
    nta: 'Net tangible assets, restated',
    ma: 'Monetary assets, restated',
    nw: 'Net worth, restated'
  };
  var FEEDS = { nta: ['r6_1_a'], ma: ['r6_1_a'], nw: ['r6_1_c'] };

  function now() { return new Date().toISOString(); }

  var SYN = 'Synthetic demonstration value. There is no filing behind it.';
  var SCENARIOS = [
    {
      id: 'torrent', kind: 'positive', name: 'Project Torrent Gas', synthetic: false,
      note: 'Real figures from the UDRHP-I (page 494). Meets the eligibility tests.', offerStructure: 'ofs',
      series: { nta: [2046.419, 2077.724, 1930.661], ma: [217.532, 79.185, 106.61], nw: [2091.921, 1811.38, 1676.572] },
      aop: 367.01, priceBand: { floor: 100, cap: 110, faceValue: 10 },
      docs: { offer: 'ready', financials: 'ready', shareholding: 'missing', auditor: 'low_confidence' }
    },
    {
      id: 'yamuna', kind: 'negative', name: 'Project Yamuna', synthetic: true,
      note: 'Synthetic. Fails the net tangible assets, operating profit, net worth and price band tests.',
      series: { nta: [2.4, 3.5, 3.1], ma: [1.0, 1.2, 1.1], nw: [0.8, 1.5, 1.2] },
      aop: 9.5, priceBand: { floor: 100, cap: 130, faceValue: 10 },
      docs: { offer: 'ready', financials: 'ready', shareholding: 'missing', auditor: 'low_confidence' }
    },
    {
      id: 'kaveri', kind: 'neutral', name: 'Project Kaveri', synthetic: true,
      note: 'Synthetic. Monetary assets above 50% need a judgement; the other tests comply.',
      series: { nta: [50, 48, 45], ma: [30, 20, 18], nw: [40, 38, 35] },
      aop: 22, priceBand: { floor: 200, cap: 230, faceValue: 10 },
      docs: { offer: 'ready', financials: 'ready', shareholding: 'ready', auditor: 'ready' }
    }
  ];

  // A scenario is one of SCENARIOS, or an object built from a filing (see filings.js) with the same shape:
  //   years, series {nta, ma, nw: [crore|null x3]}, aop, aopEach, sources, priceBand, docs, lockinReceived, route.
  // The framework is identical for every scenario; only the data differs. A null value is
  // "data not available" and the fact is shown as unavailable until someone enters it.
  function initialState(scenarioOrId) {
    var sc = (scenarioOrId && typeof scenarioOrId === 'object') ? scenarioOrId
      : (SCENARIOS.filter(function (x) { return x.id === (scenarioOrId || 'torrent'); })[0] || SCENARIOS[0]);
    var years = sc.years || YEARS;
    var src = sc.sources || {};
    var facts = [];
    var series = sc.series;
    function pq(metric, y) {
      var o = (src[metric] && src[metric][y]) || null;
      if (o) return { page: o.page, quote: o.quote, from: o.from || null };
      if (sc.synthetic) return { page: null, quote: SYN, from: null };
      if (sc.id === 'torrent') return { page: 494, quote: QUOTE[metric], from: null };
      return { page: null, quote: null, from: null };
    }
    ['nta', 'ma', 'nw'].forEach(function (m) {
      years.forEach(function (y, i) {
        var v = series[m][i];
        var p = pq(m, y);
        facts.push({
          id: m + '_' + y, metric: m, fy: y, label: LABEL[m] + ', ' + y,
          value: v === undefined ? null : v, original: v === undefined ? null : v, unit: '₹ crore',
          page: p.page, quote: p.quote, convertedFrom: p.from,
          status: (v === null || v === undefined) ? 'unavailable' : 'pending', edited: false, feeds: FEEDS[m]
        });
      });
    });
    var span = years.length ? years[years.length - 1] + ' to ' + years[0] : '';
    var ap = pq('aop', 'all');
    facts.push({
      id: 'aop', metric: 'aop', fy: span, label: 'Average operating profit, restated',
      value: sc.aop === undefined ? null : sc.aop, original: sc.aop === undefined ? null : sc.aop, unit: '₹ crore',
      page: sc.id === 'torrent' && !sc.synthetic ? 494 : ap.page, quote: sc.id === 'torrent' && !sc.synthetic ? QUOTE.aop : ap.quote,
      convertedFrom: ap.from, derived: sc.aopDerived || null,
      status: (sc.aop === null || sc.aop === undefined) ? 'unavailable' : 'pending', edited: false, feeds: ['r6_1_b']
    });
    var ae = sc.aopEach || null;
    var aeKnown = ae ? (ae.allPositive === true || ae.allPositive === false) : false;
    facts.push({
      id: 'aop_each', metric: 'attest', fy: span,
      label: 'Operating profit in each of the three preceding years',
      value: aeKnown ? ae.allPositive : null, original: aeKnown ? ae.allPositive : null, unit: '',
      page: ae && ae.page ? ae.page : null, quote: ae && ae.quote ? ae.quote : null,
      statement: 'Operating profit, as restated, is positive in each of the three preceding years.',
      status: (ae && !aeKnown) ? 'unavailable' : 'pending', edited: false, feeds: ['r6_1_b']
    });
    return {
      scenario: sc.id,
      synthetic: sc.synthetic,
      years: years.slice(),
      offerStructure: sc.offerStructure || null,
      route: sc.route || null,
      facts: facts,
      docs: JSON.parse(JSON.stringify(sc.docs)),
      lockin: { tranchesReceived: !!sc.lockinReceived },
      priceBand: {
        floor: sc.priceBand.floor === undefined ? null : sc.priceBand.floor,
        cap: sc.priceBand.cap === undefined ? null : sc.priceBand.cap,
        faceValue: sc.priceBand.faceValue, confirmed: false
      },
      judgements: {},
      houseRules: [],
      intake: null,
      reportGenerated: false,
      reportApprovedBy: null,
      // Task numbers and wording from the Ganges plan (2018). Status is illustrative.
      tasks: [
        { no: 61, offset_days: -54, text: 'Company to complete identification of promoter, promoter group, group companies …', owner: 'Company', status: 'Not started' },
        { no: 51, offset_days: -58, text: 'Company to confirm final Issue Structure (Fresh / OFS), Capital Structure …', owner: 'BRLMs, LC, Company', status: 'Done' },
        { no: 21, offset_days: -86, text: 'Discussion with Statutory Auditor on Financials / Auditor Deliverables / Certificates', owner: 'BRLMs, LC, Auditor, Company', status: 'Done' },
        { no: 36, offset_days: -75, text: 'LC to circulate Independent Auditor certificates pack to Company and Independent CA', owner: 'LC (U), BRLMs', status: 'In progress' },
        { no: 86, offset_days: -33, text: 'Final agreed form of All Auditor Deliverables [Both Stat and Independent]', owner: 'Auditor / BRLMs / LC(U)', status: 'Not started' }
      ],
      users: [
        { id: 'u1', name: 'A. Kapoor', role: 'admin' },
        { id: 'u2', name: 'R. Menon', role: 'lead' },
        { id: 'u3', name: 'S. Iyer', role: 'analyst' }
      ],
      audit: []
    };
  }

  // s.actor is the role of whoever is acting; the UI sets it before each action.
  function log(s, text, t) { s.audit.push({ t: t || now(), who: s.actor || 'analyst', text: text }); }
  function byId(s, id) { for (var i = 0; i < s.facts.length; i++) if (s.facts[i].id === id) return s.facts[i]; return null; }
  // Reg 6(1)(a), second proviso: the 50% monetary assets limit does not apply when the initial
  // public offer is made entirely through an offer for sale, so those figures are not required.
  function isRequired(s, f) { return !(s.offerStructure === 'ofs' && f.metric === 'ma'); }
  function unresolved(s, ids) {
    return ids.map(function (id) { return byId(s, id); })
      .filter(function (f) { return f.status !== 'confirmed' && isRequired(s, f); });
  }
  function names(list) { return list.map(function (f) { return f.label; }); }
  function mk(base, extra) { var o = {}, k; for (k in base) o[k] = base[k]; for (k in extra) o[k] = extra[k]; return o; }
  function r2(n) { return Math.round(n * 100) / 100; }

  function checkNta(s) {
    var ofs = s.offerStructure === 'ofs';
    var ids = []; s.years.forEach(function (y) { ids.push('nta_' + y); if (!ofs) ids.push('ma_' + y); });
    var base = {
      id: 'r6_1_a', reg: 'Reg 6(1)(a)', cites: ['Reg 6(1)(a)'],
      title: 'Eligibility requirements for an initial public offer: net tangible assets and monetary assets',
      thresholds: { 'Net tangible assets, each of three full years': 'at least ₹3 crore', 'Monetary assets share of net tangible assets': 'not more than 50%' }
    };
    var miss = unresolved(s, ids);
    if (miss.length) {
      // A confirmed figure below the threshold is already a failure; it does not wait on other inputs.
      var knownLow = s.years.filter(function (y) {
        var f = byId(s, 'nta_' + y);
        return f.status === 'confirmed' && f.value !== null && f.value < 3;
      });
      if (knownLow.length) {
        return mk(base, { outcome: OUTCOME.NOT_COMPLY, reason: 'Net tangible assets are below ₹3 crore in ' + knownLow.join(', ') + '. Other inputs are still missing but cannot change this.', inputs: {}, needs: names(miss) });
      }
      return mk(base, { outcome: OUTCOME.INFO_REQUIRED, reason: miss.length + ' input(s) not yet confirmed.', needs: names(miss), inputs: {} });
    }
    var inputs = {}, low = [], over = [];
    s.years.forEach(function (y) {
      var n = byId(s, 'nta_' + y).value;
      if (ofs) { inputs[y] = 'NTA ₹' + n + ' crore (monetary assets limit does not apply: offer for sale only)'; if (n < 3) low.push(y); return; }
      var m = byId(s, 'ma_' + y).value, pct = n > 0 ? r2(m / n * 100) : null;
      inputs[y] = 'NTA ₹' + n + ' crore, monetary assets ₹' + m + ' crore (' + pct + '%)';
      if (n < 3) low.push(y);
      if (m / n > 0.5) over.push(y);
    });
    if (low.length) return mk(base, { outcome: OUTCOME.NOT_COMPLY, reason: 'Net tangible assets are below ₹3 crore in ' + low.join(', ') + '.', inputs: inputs, needs: [] });
    if (over.length) return mk(base, { outcome: OUTCOME.REFERRED, reason: 'Monetary assets exceed 50% in ' + over.join(', ') + '. The proviso needs utilisation or firm commitments to be shown.', inputs: inputs, needs: [] });
    return mk(base, { outcome: OUTCOME.COMPLIES, reason: 'Net tangible assets are at least ₹3 crore and monetary assets are within 50% in all three years.', inputs: inputs, needs: [] });
  }

  function checkOperatingProfit(s) {
    var base = {
      id: 'r6_1_b', reg: 'Reg 6(1)(b)', cites: ['Reg 6(1)(b)'],
      title: 'Eligibility requirements for an initial public offer: average operating profit',
      thresholds: { 'Average operating profit, preceding three years': 'at least ₹15 crore', 'Operating profit': 'in each of the three years' }
    };
    var miss = unresolved(s, ['aop', 'aop_each']);
    if (miss.length) return mk(base, { outcome: OUTCOME.INFO_REQUIRED, reason: miss.length + ' input(s) not yet confirmed.', needs: names(miss), inputs: {} });
    var v = byId(s, 'aop').value;
    var inputs = { 'Average operating profit': '₹' + v + ' crore', 'Positive in each year': 'confirmed by the BRLM reviewer' };
    if (byId(s, 'aop_each').value === false) return mk(base, { outcome: OUTCOME.NOT_COMPLY, reason: 'Operating profit is not positive in each of the three years.', inputs: inputs, needs: [] });
    if (v < 15) return mk(base, { outcome: OUTCOME.NOT_COMPLY, reason: 'Average operating profit is below ₹15 crore.', inputs: inputs, needs: [] });
    return mk(base, { outcome: OUTCOME.COMPLIES, reason: 'Average operating profit is at least ₹15 crore and positive in each year.', inputs: inputs, needs: [] });
  }

  function checkNetWorth(s) {
    var ids = s.years.map(function (y) { return 'nw_' + y; });
    var base = {
      id: 'r6_1_c', reg: 'Reg 6(1)(c)', cites: ['Reg 6(1)(c)'],
      title: 'Eligibility requirements for an initial public offer: net worth',
      thresholds: { 'Net worth, each of three full years': 'at least ₹1 crore' }
    };
    var miss = unresolved(s, ids);
    if (miss.length) return mk(base, { outcome: OUTCOME.INFO_REQUIRED, reason: miss.length + ' input(s) not yet confirmed.', needs: names(miss), inputs: {} });
    var inputs = {}, low = [];
    s.years.forEach(function (y) { var n = byId(s, 'nw_' + y).value; inputs[y] = '₹' + n + ' crore'; if (n < 1) low.push(y); });
    if (low.length) return mk(base, { outcome: OUTCOME.NOT_COMPLY, reason: 'Net worth is below ₹1 crore in ' + low.join(', ') + '.', inputs: inputs, needs: [] });
    return mk(base, { outcome: OUTCOME.COMPLIES, reason: 'Net worth is at least ₹1 crore in all three years.', inputs: inputs, needs: [] });
  }

  function checkPromoterContribution(s) {
    var base = {
      id: 'r14', reg: 'Reg 14', cites: ['Reg 14(1)'], title: 'Minimum promoters’ contribution',
      thresholds: { 'Promoters’ holding': 'at least 20% of the post-issue capital' }
    };
    if (s.docs.shareholding !== 'ready') {
      return mk(base, { outcome: OUTCOME.INFO_REQUIRED, reason: 'The shareholding pattern has not been added.', needs: ['Shareholding pattern'], inputs: {}, action: { view: 'vault', label: 'Add the shareholding pattern in the Evidence vault' } });
    }
    return mk(base, { outcome: OUTCOME.REFERRED, reason: 'The shareholding pattern is present. The 20% test needs the post-issue holding, which drafts show as [●]; the full build works it out, this prototype does not.', needs: [], inputs: { 'Shareholding pattern': 'added' } });
  }

  function checkLockin(s) {
    var base = {
      id: 'r16', reg: 'Reg 16', cites: ['Reg 16'], title: 'Lock-in of specified securities held by the promoters',
      thresholds: {}
    };
    if (!s.lockin.tranchesReceived) {
      return mk(base, { outcome: OUTCOME.INFO_REQUIRED, reason: 'The offer document shows [●] for the locked-in tranche table.', needs: ['Locked-in tranche table'], inputs: {} });
    }
    return mk(base, { outcome: OUTCOME.REFERRED, reason: 'Table received. Lock-in dates are worked out by the rules engine in the full build; this prototype does not compute them.', needs: [], inputs: { 'Tranche table': 'received' } });
  }

  function checkPriceBand(s) {
    var p = s.priceBand;
    var base = {
      id: 'r29', reg: 'Reg 29', cites: ['Reg 29(2)', 'Reg 29(3)'], title: 'Price and price band',
      thresholds: {
        'Cap on the price band': 'not more than 120% of the floor price',
        'Cap (proviso)': 'at least 105% of the floor price',
        'Floor price': 'not less than the face value'
      }
    };
    if (!p.confirmed) {
      var na = (p.floor === null || p.cap === null);
      return mk(base, { outcome: OUTCOME.INFO_REQUIRED, reason: na ? 'Data not available: the floor and cap are shown as [●] in the filing.' : 'Floor and cap are assumed values and have not been confirmed.', needs: ['Price band floor and cap'], inputs: {} });
    }
    var inputs = { Floor: '₹' + p.floor, Cap: '₹' + p.cap, 'Face value': '₹' + p.faceValue, 'Cap as % of floor': r2(p.cap / p.floor * 100) + '%' };
    var eps = 1e-9, fails = [];
    if (p.cap > p.floor * 1.2 + eps) fails.push('the cap is more than 120% of the floor');
    if (p.cap < p.floor * 1.05 - eps) fails.push('the cap is less than 105% of the floor');
    if (p.floor < p.faceValue) fails.push('the floor is below the face value');
    if (fails.length) return mk(base, { outcome: OUTCOME.NOT_COMPLY, reason: 'Not met: ' + fails.join('; ') + '.', inputs: inputs, needs: [] });
    return mk(base, { outcome: OUTCOME.COMPLIES, reason: 'The cap is between 105% and 120% of the floor, and the floor is not below the face value.', inputs: inputs, needs: [] });
  }

  function houseRuleCheck(h) {
    var base = {
      id: 'hr_' + h.id, reg: 'House rule', house: true, cites: ['House rule: ' + h.owner],
      title: h.head + ': ' + h.text, thresholds: {}, inputs: { Owner: h.owner }, needs: []
    };
    if (h.satisfied === true) return mk(base, { outcome: OUTCOME.COMPLIES, reason: 'The BRLM reviewer recorded that the firm’s rule is met.' });
    if (h.satisfied === false) return mk(base, { outcome: OUTCOME.NOT_COMPLY, reason: 'The BRLM reviewer recorded that the firm’s rule is not met.' });
    return mk(base, { outcome: OUTCOME.INFO_REQUIRED, reason: 'The firm’s own rule has not been assessed yet.', needs: ['Assessment of the house rule'] });
  }

  function evaluate(s) {
    var checks = [checkNta(s), checkOperatingProfit(s), checkNetWorth(s), checkPromoterContribution(s), checkLockin(s), checkPriceBand(s)];
    (s.houseRules || []).forEach(function (h) { checks.push(houseRuleCheck(h)); });
    checks.forEach(function (c) { c.label = /^Reg /.test(c.reg || '') ? 'ICDR ' + c.reg + ': ' + c.title : c.title; });
    return checks;
  }

  function pendingJudgements(s) {
    return evaluate(s).filter(function (c) { return c.outcome === OUTCOME.REFERRED && !(s.judgements && s.judgements[c.id]); });
  }

  function recordJudgement(s, checkId, decision, note, t) {
    if (decision !== 'accept' && decision !== 'escalate') return false;
    var c = evaluate(s).filter(function (x) { return x.id === checkId; })[0];
    if (!c || c.outcome !== OUTCOME.REFERRED) return false;
    s.judgements[checkId] = { decision: decision, note: note || '' };
    log(s, (decision === 'accept' ? 'Judgement recorded for ' : 'Escalated ') + 'ICDR ' + c.reg + (note ? ': ' + note : '.'), t);
    return true;
  }

  function hasEscalation(s) {
    var esc = false;
    Object.keys(s.judgements || {}).forEach(function (k) { if (s.judgements[k].decision === 'escalate') esc = true; });
    return esc;
  }

  function canGenerateReport(s) {
    var blockers = evaluate(s).filter(function (c) { return c.outcome === OUTCOME.INFO_REQUIRED; })
      .map(function (c) { return c.label; });
    pendingJudgements(s).forEach(function (c) { blockers.push('Judgement needed: ICDR ' + c.reg); });
    return { ok: blockers.length === 0, blockers: blockers };
  }

  function queue(s) {
    var q = [], checks = evaluate(s);
    var open = {};
    checks.forEach(function (c) { if (c.outcome === OUTCOME.INFO_REQUIRED) open[c.id] = c.reg; });
    var pend = s.facts.filter(function (f) { return f.status !== 'confirmed' && isRequired(s, f); });
    // What can be confirmed now comes before what has to be found elsewhere.
    pend = pend.filter(function (f) { return f.status !== 'unavailable'; }).concat(pend.filter(function (f) { return f.status === 'unavailable'; }));
    if (pend.length) {
      var f = pend[0];
      var unlocks = [];
      f.feeds.forEach(function (id) { if (open[id] && unlocks.indexOf(open[id]) < 0) unlocks.push(open[id]); });
      q.push({
        kind: 'confirm_fact', priority: 1, title: 'Confirm ' + f.label, count: pend.length, factId: f.id, view: 'facts',
        who: 'BRLM reviewer',
        why: f.status === 'unavailable' ? 'Data not available in this filing. Enter the figure from the document, or leave it open.'
          : (f.status === 'flagged' ? 'This fact was flagged and is still unresolved.' : 'Checks cannot run on a number that nobody has confirmed against the filing.'),
        unlocks: unlocks
      });
    }
    var scans = ((s.intake && s.intake.scans) || []).filter(function (x) { return !x.confirmed; });
    if (scans.length) {
      q.push({
        kind: 'confirm_scan', priority: 2, title: 'Confirm what the scanned file says: ' + scans[0].file, count: scans.length, view: 'docs',
        who: 'BRLM reviewer', why: scans[0].reason + ' A person confirms it before any value from it is used.', unlocks: []
      });
    }
    if (!s.priceBand.confirmed) {
      q.push({
        kind: 'confirm_assumption', priority: 2, title: 'Confirm the price band', view: 'results', anchor: 'r29', who: 'BRLM reviewer with the ECM Head',
        why: (s.priceBand.floor === null || s.priceBand.cap === null)
          ? 'Data not available: the floor and cap are shown as [●] in the filing. Enter them when known.'
          : 'Floor ₹' + s.priceBand.floor + ' and cap ₹' + s.priceBand.cap + ' were entered as illustrative values.', unlocks: ['Reg 29']
      });
    }
    (s.houseRules || []).forEach(function (h) {
      if (h.satisfied === null || h.satisfied === undefined) {
        q.push({
          kind: 'house_rule', priority: 2, title: 'Assess the house rule: ' + h.text, view: 'results', anchor: 'hr_' + h.id,
          who: 'BRLM reviewer', why: 'The firm added this check (' + h.head + '). The report waits for it.', unlocks: ['House rule']
        });
      }
    });
    pendingJudgements(s).forEach(function (c) {
      q.push({
        kind: 'judgement', priority: 2, title: 'Record a judgement on ICDR ' + c.reg, view: 'results', anchor: c.id,
        who: 'ECM Head', why: c.reason, unlocks: ['Report']
      });
    });
    if (s.docs.shareholding !== 'ready') {
      q.push({
        kind: 'add_document', priority: 3, title: 'Add the shareholding pattern', view: 'vault', who: 'Company, through the deal team',
        why: 'Needed for Reg 14, minimum promoters’ contribution.', unlocks: ['Reg 14']
      });
    }
    if (!s.lockin.tranchesReceived) {
      q.push({
        kind: 'chase_issuer', priority: 3, title: 'Obtain the locked-in tranche table from the issuer', view: 'vault',
        who: 'Company and the issuer’s counsel', why: 'The offer document shows [●] for the table, so lock-in under Reg 16 cannot be worked out.', unlocks: ['Reg 16']
      });
    }
    if (!q.length) {
      if (!s.reportGenerated) {
        q.push({ kind: 'generate_report', priority: 4, title: 'Generate the review report', view: 'report', who: 'BRLM reviewer', why: 'Every input is confirmed and no check is waiting on information.', unlocks: [] });
      } else if (!s.reportApprovedBy) {
        q.push({ kind: 'approve_report', priority: 5, title: 'Approve the review report', view: 'report', who: 'ECM Head', why: 'The BRLM reviewer generated the report. A second person must approve it before the stage closes.', unlocks: [] });
      } else if (checks.some(function (c) { return c.outcome === OUTCOME.NOT_COMPLY; }) || hasEscalation(s)) {
        q.push({ kind: 'escalate', priority: 6, title: 'Discuss the open points with the deal team and counsel', view: 'results', who: 'ECM Head', why: 'The report is approved, but at least one check does not comply or was escalated. The stage should not close yet.', unlocks: [] });
      } else {
        q.push({ kind: 'advance', priority: 6, title: 'Move to Agreements and approvals', view: 'home', who: 'ECM Head', why: 'The structure decisions gate has no open items and the report is approved.', unlocks: [] });
      }
    }
    return q;
  }

  function nextAction(s) {
    var a = queue(s)[0];
    a.rule = PRIORITY[a.priority - 1];
    return a;
  }

  function stepStates(s) {
    var docsDone = s.docs.offer === 'ready' && s.docs.financials === 'ready';
    var docsAttention = docsDone && (s.docs.shareholding !== 'ready' || s.docs.auditor !== 'ready');
    var factsDone = s.facts.every(function (f) { return f.status === 'confirmed' || !isRequired(s, f); });
    var checks = evaluate(s);
    var resultsDone = factsDone && checks.every(function (c) { return c.outcome !== OUTCOME.INFO_REQUIRED; }) && pendingJudgements(s).length === 0;
    var steps = [
      { key: 'setup', label: 'Set up', view: null, done: true },
      { key: 'docs', label: 'Documents uploaded', view: 'docs', done: docsDone, attention: docsAttention },
      { key: 'facts', label: 'Confirm facts', view: 'facts', done: factsDone },
      { key: 'results', label: 'Check results', view: 'results', done: resultsDone },
      { key: 'report', label: 'Report', view: 'report', done: !!(s.reportGenerated && s.reportApprovedBy) }
    ];
    var cur = -1;
    steps.forEach(function (st, i) { if (cur < 0 && !st.done) cur = i; });
    steps.forEach(function (st, i) { st.status = st.done ? 'done' : (i === cur ? 'current' : 'todo'); });
    return steps;
  }

  /* Actions. Each one changes the state and writes an audit line. */
  function confirmFact(s, id, newValue, t) {
    var f = byId(s, id);
    if (!f) return false;
    var unchanged = (newValue === undefined || newValue === null || newValue === '' || Number(newValue) === f.value);
    if (f.status === 'confirmed' && unchanged) return true;       // already confirmed: nothing to record
    if (f.metric === 'attest' && f.status === 'unavailable') {
      f.value = true; f.edited = true; f.status = 'confirmed';
      log(s, 'Attested manually: ' + f.label + ' (not found in the filing).', t);
      return true;
    }
    if (f.status === 'unavailable' && (newValue === undefined || newValue === null || newValue === '')) return false;
    if (newValue !== undefined && newValue !== null && newValue !== '' && f.metric !== 'attest') {
      var n = Number(newValue);
      if (!isFinite(n)) return false;
      if (n !== f.value) {
        log(s, 'Edited ' + f.label + ' from ' + (f.value === null ? 'not available' : f.value) + ' to ' + n + ' and confirmed.', t);
        f.value = n; f.edited = true; f.status = 'confirmed';
        return true;
      }
    }
    f.status = 'confirmed';
    log(s, 'Confirmed ' + f.label + (f.page ? ' against filing page ' + f.page : '') + '.', t);
    return true;
  }
  function flagFact(s, id, t) {
    var f = byId(s, id); if (!f) return false;
    f.status = 'flagged'; log(s, 'Flagged ' + f.label + ' for a colleague.', t); return true;
  }
  function addShareholdingPattern(s, t) { s.docs.shareholding = 'ready'; log(s, 'Added the shareholding pattern.', t); }
  function receiveTranches(s, t) { s.lockin.tranchesReceived = true; log(s, 'Marked the locked-in tranche table as received.', t); }
  function confirmPriceBand(s, floor, cap, t) {
    var fl = Number(floor), cp = Number(cap);
    if (!isFinite(fl) || !isFinite(cp) || fl <= 0 || cp <= 0) return false;
    s.priceBand.floor = fl; s.priceBand.cap = cp; s.priceBand.confirmed = true;
    log(s, 'Confirmed price band: floor ₹' + fl + ', cap ₹' + cp + '.', t); return true;
  }
  function generateReport(s, t) {
    var g = canGenerateReport(s);
    if (!g.ok) return false;
    s.reportGenerated = true; log(s, 'Generated the review report.', t); return true;
  }

  var api = {
    OUTCOME: OUTCOME, STAGES: STAGES, POST_FILING_STAGES: POST_FILING_STAGES, PRIORITY: PRIORITY, YEARS: YEARS, SCENARIOS: SCENARIOS, isRequired: isRequired,
    pendingJudgements: pendingJudgements, recordJudgement: recordJudgement, hasEscalation: hasEscalation,
    initialState: initialState, evaluate: evaluate, canGenerateReport: canGenerateReport,
    queue: queue, nextAction: nextAction, stepStates: stepStates, byId: byId,
    confirmFact: confirmFact, flagFact: flagFact, addShareholdingPattern: addShareholdingPattern,
    receiveTranches: receiveTranches, confirmPriceBand: confirmPriceBand, generateReport: generateReport
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Guidance = api;
})(typeof window !== 'undefined' ? window : this);
