/*
 * The steps each person can take, in order. One source for the in-app carousel and for the per-person demo script
 * (docs/DEMO_SCRIPT.md is checked against markdown() below). No DOM. Written after guide.test.js.
 *
 * A step ticks only from the deal's own state (or, for a screen that only needs to be looked at, from having visited it).
 * A step never ticks because the carousel was clicked. `needs` names the permission the person must hold.
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  var G = isNode ? require('./guidance.js') : root.Guidance;
  var D = isNode ? require('./demo.js') : root.Demo;
  var M = isNode ? require('./modules.js') : root.Modules;

  function st(ctx, deal) {
    var id = deal || ctx.deal;
    return (ctx.states && ctx.states[id]) || (id === ctx.deal && ctx.state) || D.resetState(id);
  }
  function required(s) { return s.facts.filter(function (f) { return G.isRequired(s, f); }); }
  function modsOf(s) { return s.mods || { runs: [], docs: [], decisions: [], drafts: [], reviews: [], opinions: [], register: [], assignments: [] }; }

  var PEOPLE = { analyst: 'S. Iyer', lead: 'R. Menon', admin: 'A. Kapoor', counsel: 'V. Rao', issuer: 'M. Desai' };

  var STEPS = {
    analyst: [
      { id: 'a_open', title: 'Open Project Torrent Gas', body: 'Start from the deal you are on. The Dashboard tells you what to do next, one decision at a time.', view: 'home', deal: 'torrent',
        done: function (c) { return c.deal === 'torrent'; } },
      { id: 'a_facts', title: 'Confirm the facts', body: 'Check each extracted figure against the page and quote shown, then confirm it. A person confirms every fact.', view: 'facts', deal: 'torrent', needs: 'confirm_fact',
        done: function (c) { var s = st(c, 'torrent'); return required(s).length > 0 && required(s).every(function (f) { return f.status === 'confirmed'; }); } },
      { id: 'a_price', title: 'Confirm the price band', body: 'The filing shows the band as an assumption. Confirm it so ICDR Reg 29 can be checked.', view: 'results', deal: 'torrent', needs: 'change_price_band',
        done: function (c) { return !!st(c, 'torrent').priceBand.confirmed; } },
      { id: 'a_docs', title: 'Add the shareholding pattern and the tranche table', body: 'Reg 14 and Reg 16 wait for these two documents. Add them in the Evidence vault, the deal\'s one folder.', view: 'vault', deal: 'torrent', needs: 'add_documents',
        done: function (c) { var s = st(c, 'torrent'); return s.docs.shareholding === 'ready' && !!s.lockin.tranchesReceived; } },
      { id: 'a_drhp', title: 'Run the DRHP review', body: 'Score the filing against the 18 heads of Schedule VI, Part A. The result is heading presence only.', view: 'drhp', deal: 'torrent', needs: 'run_drhp_review',
        done: function (c) { return modsOf(st(c, 'torrent')).runs.length > 0; } },
      { id: 'a_report', title: 'Generate the review report', body: 'When no check is waiting on information, generate the report. The ECM Head approves it; you cannot approve your own.', view: 'report', deal: 'torrent', needs: 'generate_report',
        done: function (c) { return !!st(c, 'torrent').reportGenerated; } }
    ],
    lead: [
      { id: 'l_all', title: 'See all your deals', body: 'The All deals table ranks your deals by urgency. Open any of them from its row.', view: 'portfolio', visit: true, needs: 'view_portfolio',
        done: function (c) { return !!(c.visited && c.visited.portfolio); } },
      { id: 'l_judge', title: 'Record judgements on Reg 14 and Reg 16', body: 'Judgements are yours to make. Accept and record, or escalate to counsel.', view: 'results', deal: 'torrent', needs: 'record_judgement',
        done: function (c) { return Object.keys(st(c, 'torrent').judgements || {}).length > 0; } },
      { id: 'l_approve', title: 'Approve the review report', body: 'A report someone else generated waits for your approval before the stage can close.', view: 'report', deal: 'torrent', needs: 'approve_report',
        done: function (c) { return !!st(c, 'torrent').reportApprovedBy; } },
      { id: 'l_override', title: 'Override a BRLM reviewer\'s decision', body: 'You do not decide findings yourself. Where you disagree with the BRLM reviewer, override their decision with a note; the item is then locked until you reopen it.', view: 'drhp', deal: 'kaveri', needs: 'override_decision',
        done: function (c) {
          var m = modsOf(st(c, 'kaveri')), head = function (x) { return !!(x && x.head); };
          return m.decisions.some(function (d) { return d.override; }) ||
            (m.runs || []).some(function (r) { return (r.suggestions || []).some(head); }) ||
            (m.reviews || []).some(function (p) { return (p.findings || []).some(head); }) ||
            (m.opinions || []).some(function (o) { return (o.checks || []).some(head); });
        } },
      { id: 'l_material', title: 'Decide whether a litigation matter is material', body: 'Run a KMP check, save a matter to the register, then mark it material or not, with a reason.', view: 'diligence', deal: 'kaveri', needs: 'set_materiality',
        done: function (c) { return modsOf(st(c, 'kaveri')).register.some(function (r) { return r.materiality; }); } },
      { id: 'l_agent', title: 'Assign a diligence agent', body: 'Give legal, financial or tax diligence to a named person, with the task.', view: 'review', deal: 'kaveri', needs: 'assign_agent',
        done: function (c) { return modsOf(st(c, 'kaveri')).assignments.length > 0; } },
      { id: 'l_email', title: 'Save the email to counsel', body: 'The draft is compiled from your decisions and marked as an internal communication. Edit it, then save it.', view: 'drhp', deal: 'kaveri', needs: 'save_draft',
        done: function (c) { return modsOf(st(c, 'kaveri')).drafts.length > 0; } }
    ],
    admin: [
      { id: 'ad_all', title: 'See all eleven deals', body: 'The All deals table shows every deal in the firm, most urgent first.', view: 'portfolio', visit: true, needs: 'view_portfolio',
        done: function (c) { return !!(c.visited && c.visited.portfolio); } },
      { id: 'ad_teams', title: 'Check who is on which deal team', body: 'People see only their own deals. Settings, Deal teams, shows and changes the teams.', view: 'settings', visit: true, needs: 'manage_users',
        done: function (c) { return !!(c.visited && c.visited.settings); } },
      { id: 'ad_rule', title: 'Add a firm house rule', body: 'A house rule joins the Schedule VI checklist and blocks the report until it is assessed.', view: 'drhp', deal: 'torrent', needs: 'edit_house_rules',
        done: function (c) { var s = st(c, 'torrent'); return s.houseRules.length > D.resetState('torrent').houseRules.length; } },
      { id: 'ad_audit', title: 'Read the audit trail', body: 'Every action is time-stamped with the person. Export it for the file.', view: 'audit', visit: true, needs: 'view_audit',
        done: function (c) { return !!(c.visited && c.visited.audit); } }
    ],
    counsel: [
      { id: 'c_check', title: 'Read the Schedule VI checklist', body: 'You can read the heads found in the filing and the gaps. You cannot change anything.', view: 'drhp', visit: true,
        done: function (c) { return !!(c.visited && c.visited.drhp); } },
      { id: 'c_drafts', title: 'Read the drafts addressed to counsel', body: 'Saved drafts from the deal team are under My projects.', view: 'projects', visit: true, needs: 'view_drafts',
        done: function (c) { return !!(c.visited && c.visited.projects); } }
    ],
    issuer: [
      { id: 'i_file', title: 'Upload a document the deal team asked for', body: 'Upload it in the Evidence vault, the deal\'s one folder. You see only this screen; the review is not shown to the issuer.', view: 'vault', deal: 'torrent', needs: 'file_document',
        done: function (c) { return modsOf(st(c, 'torrent')).docs.length > 0; } }
    ]
  };

  function steps(role) {
    return (STEPS[role] || []).map(function (x) {
      return { id: x.id, title: x.title, body: x.body, view: x.view, deal: x.deal, needs: x.needs, visit: !!x.visit };
    });
  }
  function progress(role, ctx) {
    var out = (STEPS[role] || []).map(function (x) {
      var s = steps(role).filter(function (y) { return y.id === x.id; })[0];
      s.done = !!x.done(ctx || {});
      return s;
    });
    var cur = -1, n = 0;
    out.forEach(function (x, i) { if (x.done) n++; else if (cur < 0) cur = i; });
    return { steps: out, total: out.length, doneCount: n, current: cur };
  }
  function clamp(i, total) { return Math.max(0, Math.min(total - 1, i)); }
  function start(p) { return p.current >= 0 ? p.current : Math.max(0, p.total - 1); }

  function markdown() {
    var order = ['analyst', 'lead', 'admin', 'counsel', 'issuer'], L = [];
    order.forEach(function (r) {
      L.push('#### ' + PEOPLE[r] + ', ' + D.ROLE_LABEL[r]);
      L.push('');
      steps(r).forEach(function (x, i) {
        var deal = x.deal ? ' on ' + dealName(x.deal) : '';
        L.push((i + 1) + '. **' + x.title + '**' + deal + '. ' + x.body);
      });
      L.push('');
    });
    return L.join('\n');
  }
  function dealName(id) {
    for (var i = 0; i < D.DEALS.length; i++) if (D.DEALS[i].id === id) return D.DEALS[i].name;
    return id;
  }

  var api = { steps: steps, progress: progress, clamp: clamp, start: start, markdown: markdown, PEOPLE: PEOPLE };
  if (isNode) module.exports = api; else root.Guide = api;
})(typeof window !== 'undefined' ? window : this);
