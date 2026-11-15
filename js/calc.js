/*!
 * COREGENIX Dose Calculator — core maths (no dependencies)
 * Made by Sant Kumar · COREGENIX · MIT License
 *
 * Works in the browser (window.CoreCalc) and in Node (require) so the same
 * code that powers the website is covered by the unit tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CoreCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STANDARD_SIZES = [1, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000];
  var MAX_ADULT_MAINTENANCE_ML_HR = 100; // 2,400 mL/day cap used by most paediatric references

  /* ---------- helpers ---------- */

  // Remove floating point noise (0.30000000000000004 -> 0.3) before rounding decisions.
  function clean(n) { return Math.round(n * 1e6) / 1e6; }
  function ceilSafe(n) { return Math.ceil(clean(n)); }
  function floorSafe(n) { return Math.floor(clean(n)); }

  function positive(v, label) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
      throw new Error(label + ' must be a number greater than 0');
    }
    return v;
  }

  function fmt(n, d) {
    var digits = d == null ? 2 : d;
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return Number(n.toFixed(digits)).toLocaleString('en-IN', { maximumFractionDigits: digits });
  }

  function toHours(value, unit) {
    positive(value, 'Duration');
    return unit === 'min' ? value / 60 : value;
  }

  function rateToMlHr(rate, unit) {
    positive(rate, 'Rate');
    return unit === 'min' ? rate * 60 : rate;
  }

  function formatDuration(hours) {
    var total = Math.round(hours * 60);
    var h = Math.floor(total / 60);
    var m = total % 60;
    if (h === 0) return m + ' min';
    if (m === 0) return h + ' h';
    return h + ' h ' + m + ' min';
  }

  /* ---------- general infusion / injection ---------- */

  /**
   * @param {object} o
   * @param {number} o.rate         prescribed rate
   * @param {'hr'|'min'} [o.rateUnit]  mL/hr (default) or mL/min
   * @param {number} o.duration     how long to dispense for
   * @param {'hr'|'min'} [o.durationUnit] hours (default) or minutes
   * @param {number} o.containerMl  size of ONE bottle / bag / vial in mL
   * @param {number} [o.dropFactor] gtt/mL of the giving set (optional)
   */
  function infusion(o) {
    var rate = rateToMlHr(o.rate, o.rateUnit);
    var hours = toHours(o.duration, o.durationUnit);
    var size = positive(o.containerMl, 'Container size');

    var totalMl = rate * hours;
    var exact = totalMl / size;
    var containers = ceilSafe(exact);
    var full = floorSafe(exact);
    var partial = clean(totalMl - full * size);
    if (partial < 0.000001) partial = 0;

    var dispensedMl = containers * size;
    var leftoverMl = clean(dispensedMl - totalMl);
    if (leftoverMl < 0.000001) leftoverMl = 0;
    var runtimeHr = size / rate;

    var schedule = [];
    var cap = Math.min(containers, 100);
    for (var i = 0; i < cap; i++) {
      var start = i * runtimeHr;
      var end = Math.min((i + 1) * runtimeHr, hours);
      schedule.push({
        n: i + 1,
        startHr: start,
        endHr: end,
        usedMl: Math.min(size, clean(totalMl - i * size))
      });
    }

    var steps = [];
    if (o.rateUnit === 'min') {
      steps.push('Rate = ' + fmt(o.rate, 3) + ' mL/min × 60 = ' + fmt(rate, 2) + ' mL/hr');
    } else {
      steps.push('Rate = ' + fmt(rate, 2) + ' mL/hr');
    }
    steps.push(o.durationUnit === 'min'
      ? 'Duration = ' + fmt(o.duration, 2) + ' min = ' + fmt(hours, 4) + ' hr'
      : 'Duration = ' + fmt(hours, 2) + ' hr');
    steps.push('Total volume = ' + fmt(rate, 2) + ' × ' + fmt(hours, 4) + ' = ' + fmt(totalMl, 2) + ' mL');
    steps.push('Containers = ' + fmt(totalMl, 2) + ' ÷ ' + fmt(size, 2) + ' = ' + fmt(exact, 3));
    steps.push(partial === 0
      ? 'Exact fit → dispense ' + containers + ' × ' + fmt(size, 2) + ' mL'
      : 'Round up (a partly used container still has to be supplied) → dispense ' +
        containers + ' × ' + fmt(size, 2) + ' mL');

    return {
      rateMlHr: rate,
      hours: hours,
      totalMl: totalMl,
      containerMl: size,
      exact: exact,
      containers: containers,
      fullContainers: full,
      partialMl: partial,
      dispensedMl: dispensedMl,
      leftoverMl: leftoverMl,
      runtimeHr: runtimeHr,
      schedule: schedule,
      scheduleTruncated: containers > cap,
      dripGttMin: o.dropFactor > 0 ? rate * o.dropFactor / 60 : null,
      steps: steps
    };
  }

  /** Same total volume across every standard container size. */
  function compareSizes(totalMl, sizes) {
    return (sizes || STANDARD_SIZES).map(function (size) {
      var exact = totalMl / size;
      var containers = ceilSafe(exact);
      return {
        size: size,
        exact: exact,
        containers: containers,
        dispensedMl: containers * size,
        leftoverMl: Math.max(0, clean(containers * size - totalMl))
      };
    });
  }

  /** Several injections / fluids on one chart, same duration for all. */
  function multi(items, duration, durationUnit) {
    var hours = toHours(duration, durationUnit);
    var rows = [];
    var totalContainers = 0, totalMl = 0, totalDispensed = 0;
    items.forEach(function (it) {
      var name = it.name || 'Injection';
      try {
        var r = infusion({
          rate: it.rate, rateUnit: 'hr',
          duration: duration, durationUnit: durationUnit,
          containerMl: it.containerMl
        });
        rows.push({ name: name, ok: true, r: r });
        totalContainers += r.containers;
        totalMl += r.totalMl;
        totalDispensed += r.dispensedMl;
      } catch (e) {
        rows.push({ name: name, ok: false, error: e.message });
      }
    });
    return { hours: hours, rows: rows, totalContainers: totalContainers, totalMl: totalMl, totalDispensed: totalDispensed };
  }

  /* ---------- pediatric ---------- */

  /**
   * Maintenance fluid by the Holliday–Segar method.
   *   Daily : 100 mL/kg (first 10 kg) + 50 mL/kg (next 10 kg) + 20 mL/kg (each kg after)
   *   Hourly: 4-2-1 rule — 4 / 2 / 1 mL/kg/hr for the same weight bands
   */
  function maintenance(weightKg, percent) {
    var w = positive(weightKg, 'Weight');
    var pct = percent == null || isNaN(percent) ? 100 : positive(percent, 'Maintenance %');
    var bands = [
      { kg: Math.min(w, 10), perDay: 100, perHr: 4 },
      { kg: Math.max(0, Math.min(w - 10, 10)), perDay: 50, perHr: 2 },
      { kg: Math.max(0, w - 20), perDay: 20, perHr: 1 }
    ].filter(function (b) { return b.kg > 0; });

    var day = 0, hr = 0, steps = [];
    bands.forEach(function (b) {
      day += b.kg * b.perDay;
      hr += b.kg * b.perHr;
      steps.push(fmt(b.kg, 2) + ' kg × ' + b.perDay + ' mL/kg/day = ' + fmt(b.kg * b.perDay, 1) +
        ' mL/day  |  × ' + b.perHr + ' mL/kg/hr = ' + fmt(b.kg * b.perHr, 1) + ' mL/hr');
    });

    var warnings = [];
    if (hr > MAX_ADULT_MAINTENANCE_ML_HR) {
      hr = MAX_ADULT_MAINTENANCE_ML_HR;
      day = Math.min(day, 2400);
      warnings.push('Capped at the adult maintenance limit of 100 mL/hr (2,400 mL/day).');
    }
    if (w < 3) {
      warnings.push('Under 3 kg (neonate): maintenance fluid depends on day of life and gestational age — follow the NICU protocol.');
    }
    if (pct !== 100) {
      day = day * pct / 100;
      hr = hr * pct / 100;
      steps.push('Adjusted to ' + fmt(pct, 1) + '% of maintenance');
    }
    return { weightKg: w, percent: pct, dailyMl: day, hourlyMl: hr, steps: steps, warnings: warnings };
  }

  /** Continuous infusion ordered as mL/kg/hr. */
  function perKgInfusion(o) {
    var w = positive(o.weightKg, 'Weight');
    var perKg = positive(o.mlPerKgHr, 'Rate (mL/kg/hr)');
    var rate = w * perKg;
    var r = infusion({
      rate: rate, rateUnit: 'hr',
      duration: o.duration, durationUnit: o.durationUnit,
      containerMl: o.containerMl, dropFactor: o.dropFactor
    });
    r.steps[0] = 'Rate = ' + fmt(w, 2) + ' kg × ' + fmt(perKg, 3) + ' mL/kg/hr = ' + fmt(rate, 2) + ' mL/hr';
    return r;
  }

  /** Intermittent injection ordered as mg/kg/dose. */
  function weightDose(o) {
    var w = positive(o.weightKg, 'Weight');
    var perKg = positive(o.doseMgPerKg, 'Dose (mg/kg)');
    var perDay = positive(o.dosesPerDay, 'Doses per day');
    var strength = positive(o.vialMg, 'Vial strength (mg)');
    var vialMl = positive(o.vialMl, 'Vial volume (mL)');
    var hours = toHours(o.duration, o.durationUnit);

    var conc = strength / vialMl;
    var calcMg = w * perKg;
    var givenMg = calcMg;
    var capped = false;
    if (o.maxDoseMg > 0 && calcMg > o.maxDoseMg) { givenMg = o.maxDoseMg; capped = true; }

    var mlPerDose = givenMg / conc;
    var doses = ceilSafe(perDay * hours / 24);
    var totalMl = mlPerDose * doses;
    var totalMg = givenMg * doses;
    var vialsPerDose = ceilSafe(mlPerDose / vialMl);
    var singleDoseVials = vialsPerDose * doses;
    var multiDoseVials = ceilSafe(totalMl / vialMl);

    var steps = [];
    steps.push('Dose = ' + fmt(w, 2) + ' kg × ' + fmt(perKg, 3) + ' mg/kg = ' + fmt(calcMg, 3) + ' mg');
    if (capped) steps.push('Above the maximum single dose → limited to ' + fmt(givenMg, 3) + ' mg');
    steps.push('Concentration = ' + fmt(strength, 3) + ' mg ÷ ' + fmt(vialMl, 3) + ' mL = ' + fmt(conc, 3) + ' mg/mL');
    steps.push('Volume per dose = ' + fmt(givenMg, 3) + ' ÷ ' + fmt(conc, 3) + ' = ' + fmt(mlPerDose, 3) + ' mL');
    steps.push('Doses in ' + fmt(hours, 2) + ' hr = ' + fmt(perDay, 0) + '/day × ' + fmt(hours, 2) + '/24 → ' + doses);
    steps.push('Total volume = ' + fmt(mlPerDose, 3) + ' × ' + doses + ' = ' + fmt(totalMl, 3) + ' mL');
    steps.push('Single-dose vials: ' + vialsPerDose + ' per dose × ' + doses + ' = ' + singleDoseVials +
      '  |  Multi-dose vial: ' + fmt(totalMl, 3) + ' ÷ ' + fmt(vialMl, 3) + ' → ' + multiDoseVials);

    var warnings = [];
    if (capped) warnings.push('Calculated dose exceeded the maximum single dose you entered, so the maximum was used.');
    if (mlPerDose < 0.1) warnings.push('Volume per dose is under 0.1 mL — consider dilution for an accurate measurement.');

    return {
      concMgPerMl: conc,
      calcDoseMg: calcMg,
      givenDoseMg: givenMg,
      capped: capped,
      mlPerDose: mlPerDose,
      doses: doses,
      totalMl: totalMl,
      totalMg: totalMg,
      vialsPerDose: vialsPerDose,
      singleDoseVials: singleDoseVials,
      multiDoseVials: multiDoseVials,
      hours: hours,
      steps: steps,
      warnings: warnings
    };
  }

  return {
    STANDARD_SIZES: STANDARD_SIZES,
    fmt: fmt,
    formatDuration: formatDuration,
    ceilSafe: ceilSafe,
    infusion: infusion,
    compareSizes: compareSizes,
    multi: multi,
    maintenance: maintenance,
    perKgInfusion: perKgInfusion,
    weightDose: weightDose
  };
});
