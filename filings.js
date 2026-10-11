/*
 * Adapter from a verified filing extraction (data/filings/<slug>.json) to a scenario for the
 * same base framework used by every other deal. Nothing here is specific to one filing.
 * A null in the extraction means "data not available in this filing" and stays null.
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';

  var TO_CRORE = { 'Rs million': 10, 'Rs lakh': 100, 'Rs crore': 1 };
  function toCrore(v, unit) {
    if (v === null || v === undefined) return null;
    var d = TO_CRORE[unit];
    if (!d) throw new Error('Unknown unit: ' + unit);
    return Math.round(v / d * 1e6) / 1e6;
  }

  var DEFAULT_YEARS = ['Latest full year', 'Previous year', 'Year before'];

  function pick(o) { return o && o.value !== null && o.value !== undefined; }

  // The three yearly operating profit figures in the filing's own units, or null if any is missing.
  function yearly(r) {
    var v = r.operating_profit_each_year && r.operating_profit_each_year.values;
    if (!v || !r.years || r.years.length !== 3) return null;
    var out = [];
    for (var i = 0; i < 3; i++) {
      var x = v[r.years[i]];
      if (x === null || x === undefined) return null;
      out.push(x);
    }
    return out;
  }

  function toScenario(r) {
    var years = (r.years && r.years.length === 3) ? r.years.slice() : DEFAULT_YEARS.slice();
    var series = { nta: [], ma: [], nw: [] };
    var sources = { nta: {}, ma: {}, nw: {}, aop: {} };
    var map = { nta: 'nta', ma: 'monetary_assets', nw: 'net_worth' };
    Object.keys(map).forEach(function (m) {
      years.forEach(function (y) {
        var o = (r[map[m]] || {})[y];
        series[m].push(pick(o) ? toCrore(o.value, r.unit) : null);
        if (pick(o)) sources[m][y] = { page: o.page, quote: o.quote, from: { value: o.value, unit: r.unit } };
      });
    });
    var aop = r.average_operating_profit;
    var each = r.operating_profit_each_year || {};
    var aopCrore = null, aopDerived = null;
    if (pick(aop)) {
      aopCrore = toCrore(aop.value, r.unit);
      sources.aop.all = { page: aop.page, quote: aop.quote, from: { value: aop.value, unit: r.unit } };
    } else {
      var yv = yearly(r);
      if (yv) {
        aopCrore = toCrore(yv.reduce(function (a, b) { return a + b; }, 0) / 3, r.unit);
        aopDerived = 'Computed as the mean of the three yearly operating profit figures printed in the filing' + (each.page ? ' (page ' + each.page + ')' : '') + '.';
        sources.aop.all = { page: each.page || null, quote: each.quote || null, from: null };
      }
    }
    var pb = r.price_band || {};
    return {
      aopDerived: aopDerived,
      id: r.slug,
      kind: 'real',
      name: r.company,
      synthetic: false,
      note: r.document_type + ' (' + r.pdf_pages + ' pages). Route stated by the issuer: ICDR Reg ' + ((r.route && r.route.value) || 'not stated') + '. Source: ' + r.pdf + '.',
      offerStructure: (r.offer && r.offer.structure) || null,
      years: years,
      series: series,
      aop: aopCrore,
      aopEach: { allPositive: each.all_positive === undefined ? null : each.all_positive, page: each.page || null, quote: each.quote || null },
      sources: sources,
      priceBand: {
        floor: pb.floor === undefined ? null : pb.floor,
        cap: pb.cap === undefined ? null : pb.cap,
        faceValue: pick(r.face_value) ? r.face_value.value : 10
      },
      docs: {
        offer: 'ready', financials: 'ready',
        shareholding: (r.shareholding_pattern && r.shareholding_pattern.available === true) ? 'ready' : 'missing',
        auditor: 'ready'
      },
      // Every draft in the collection shows the locked-in tranche table as [●], so it is never "received".
      lockinReceived: false,
      route: r.route || null,
      notes: r.notes || []
    };
  }

  // Twelve inputs the framework needs: 3 x net tangible assets, 3 x monetary assets, 3 x net worth,
  // average operating profit, operating profit in each year, price band, shareholding pattern.
  function coverage(r) {
    var years = (r.years && r.years.length === 3) ? r.years : [];
    var missing = [];
    var total = 0;
    var names = { nta: 'Net tangible assets', monetary_assets: 'Monetary assets', net_worth: 'Net worth' };
    var ofs = r.offer && r.offer.structure === 'ofs';
    ['nta', 'monetary_assets', 'net_worth'].forEach(function (k) {
      if (k === 'monetary_assets' && ofs) return;       // Reg 6(1)(a) second proviso: not required for an offer for sale
      for (var i = 0; i < 3; i++) {
        total++;
        var y = years[i];
        if (!y || !pick((r[k] || {})[y])) missing.push(names[k] + (y ? ', ' + y : ''));
      }
    });
    total++; if (!pick(r.average_operating_profit) && !yearly(r)) missing.push('Average operating profit');
    total++; if (!r.operating_profit_each_year || (r.operating_profit_each_year.all_positive !== true && r.operating_profit_each_year.all_positive !== false)) missing.push('Operating profit in each year');
    total++; if (!r.price_band || r.price_band.floor === null || r.price_band.floor === undefined || r.price_band.cap === null || r.price_band.cap === undefined) missing.push('Price band');
    total++; if (!r.shareholding_pattern || r.shareholding_pattern.available !== true) missing.push('Shareholding pattern');
    return { total: total, available: total - missing.length, missing: missing };
  }

  function all() {
    if (isNode) {
      var fs = require('fs'), path = require('path');
      var src = fs.readFileSync(path.join(__dirname, 'filings-data.js'), 'utf8');
      var m = src.match(/window\.FILINGS_DATA\s*=\s*(\[[\s\S]*\]);?\s*$/);
      return m ? JSON.parse(m[1]) : [];
    }
    return root.FILINGS_DATA || [];
  }

  function scenarios() { return all().map(toScenario); }

  var api = { toCrore: toCrore, toScenario: toScenario, coverage: coverage, all: all, scenarios: scenarios };
  if (isNode) module.exports = api; else root.Filings = api;
})(typeof window !== 'undefined' ? window : this);
