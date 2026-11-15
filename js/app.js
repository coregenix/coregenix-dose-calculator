/*!
 * COREGENIX Dose Calculator — user interface
 * Made by Sant Kumar · COREGENIX · MIT License
 */
(function () {
  'use strict';

  var C = window.CoreCalc;
  var SIZES = C.STANDARD_SIZES;
  var fmt = C.fmt;
  var lastText = {};

  function $(id) { return document.getElementById(id); }
  function num(id) { var v = parseFloat($(id).value); return isNaN(v) ? NaN : v; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= tabs ================= */
  var TAB_NAMES = ['infusion', 'multi', 'pediatric', 'about'];
  function showTab(name) {
    if (TAB_NAMES.indexOf(name) < 0) name = 'infusion';
    document.querySelectorAll('[data-tab]').forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + name; });
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* file:// or sandbox */ }
  }
  document.querySelectorAll('[data-tab]').forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.dataset.tab); });
  });

  /* ================= shared widgets ================= */
  function chips(wrapId, inputId, onChange) {
    var wrap = $(wrapId), input = $(inputId);
    wrap.innerHTML = SIZES.map(function (s) {
      return '<button type="button" class="chip" data-size="' + s + '">' + s + ' mL</button>';
    }).join('');
    function sync() {
      wrap.querySelectorAll('.chip').forEach(function (b) {
        b.classList.toggle('active', parseFloat(b.dataset.size) === parseFloat(input.value));
      });
    }
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      input.value = b.dataset.size;
      sync();
      onChange();
    });
    input.addEventListener('input', sync);
    sync();
  }

  // Switching Hours <-> Minutes keeps the same real duration (24 h -> 1440 min).
  function linkDurationUnit(selId, inputId, onChange) {
    var sel = $(selId), input = $(inputId);
    sel.dataset.prev = sel.value;
    sel.addEventListener('change', function () {
      var v = parseFloat(input.value), prev = sel.dataset.prev, now = sel.value;
      if (!isNaN(v) && prev !== now) {
        input.value = +(now === 'min' ? v * 60 : v / 60).toFixed(4);
      }
      sel.dataset.prev = now;
      onChange();
    });
  }

  function unitNoun(size, n) {
    if (size >= 50) return n === 1 ? 'bottle / bag' : 'bottles / bags';
    return n === 1 ? 'vial / ampoule' : 'vials / ampoules';
  }

  function bottlesHTML(r) {
    var max = 24, n = Math.min(r.containers, max), html = '<div class="bottles" aria-hidden="true">';
    for (var i = 0; i < n; i++) {
      var fill = i < r.fullContainers ? 100 : Math.max(4, Math.round(r.partialMl / r.containerMl * 100));
      html += '<span class="bottle"><i style="height:' + fill + '%"></i></span>';
    }
    if (r.containers > max) html += '<span class="more">+' + (r.containers - max) + ' more</span>';
    return html + '</div>';
  }

  function statsHTML(items) {
    return '<div class="stats">' + items.map(function (i) {
      return '<div class="stat' + (i.cls ? ' ' + i.cls : '') + '"><span>' + esc(i.k) + '</span><b>' + esc(i.v) + '</b></div>';
    }).join('') + '</div>';
  }

  function stepsHTML(steps) {
    return '<h3>Working</h3><ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  }

  function warningsHTML(list) {
    return (list || []).map(function (w) { return '<div class="warn-box">⚠ ' + esc(w) + '</div>'; }).join('');
  }

  function scheduleHTML(r) {
    if (r.containers < 2) return '';
    var rows = r.schedule.map(function (s) {
      return '<tr><td>#' + s.n + '</td><td>' + C.formatDuration(s.startHr) + '</td><td>' + C.formatDuration(s.endHr) +
        '</td><td>' + fmt(s.usedMl) + ' mL</td></tr>';
    }).join('');
    return '<h3>Container change schedule</h3><div class="schedule"><table><thead><tr><th>Unit</th><th>Start</th><th>Change at</th><th>Volume used</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      (r.scheduleTruncated ? '<p class="note">Showing the first 100 containers.</p>' : '');
  }

  function actionsHTML(key) {
    return '<div class="actions no-print"><button type="button" class="btn" data-copy="' + key + '">Copy summary</button>' +
      '<button type="button" class="btn ghost" data-print>Print result</button></div>';
  }

  function emptyHTML(msg) {
    return '<div class="empty"><b>Enter the details to calculate</b>' + esc(msg || '') + '</div>';
  }

  function partialNote(r) {
    if (r.partialMl === 0) return 'Exact fit — no partly used container.';
    var left = r.containerMl - r.partialMl;
    return (r.fullContainers > 0 ? r.fullContainers + ' full + ' : '') +
      '1 partly used (' + fmt(r.partialMl) + ' mL used, ' + fmt(left) + ' mL left over)';
  }

  /* One block that renders any continuous-infusion style result. */
  function infusionHTML(r, label, key) {
    var stats = [
      { k: 'Total volume needed', v: fmt(r.totalMl) + ' mL' },
      { k: 'Exact containers', v: fmt(r.exact, 3) },
      { k: 'Total dispensed', v: fmt(r.dispensedMl) + ' mL' },
      { k: 'Left over (wastage)', v: fmt(r.leftoverMl) + ' mL', cls: r.leftoverMl > 0 ? 'warn' : 'ok' },
      { k: 'Each container lasts', v: C.formatDuration(r.runtimeHr) },
      { k: 'Rate', v: fmt(r.rateMlHr, 2) + ' mL/hr' }
    ];
    if (r.dripGttMin != null) stats.push({ k: 'Drip rate', v: fmt(r.dripGttMin, 0) + ' gtt/min' });

    return '<div class="answer">' +
      '<div class="eyebrow">Dispense for ' + C.formatDuration(r.hours) + '</div>' +
      '<div class="big">' + r.containers + '</div>' +
      '<div class="unit">× ' + fmt(r.containerMl) + ' mL' + (label ? ' ' + esc(label) : '') + ' — ' + unitNoun(r.containerMl, r.containers) + '</div>' +
      '<p class="note">' + esc(partialNote(r)) + '</p>' +
      bottlesHTML(r) + '</div>' +
      statsHTML(stats) + scheduleHTML(r) + stepsHTML(r.steps) + actionsHTML(key);
  }

  function infusionText(r, label, title) {
    return [
      'COREGENIX Dose Calculator' + (title ? ' — ' + title : ''),
      'Fluid / injection : ' + (label || '—'),
      'Rate              : ' + fmt(r.rateMlHr) + ' mL/hr for ' + C.formatDuration(r.hours),
      'Total volume      : ' + fmt(r.totalMl) + ' mL',
      'DISPENSE          : ' + r.containers + ' × ' + fmt(r.containerMl) + ' mL (exact ' + fmt(r.exact, 3) + ')',
      'Left over         : ' + fmt(r.leftoverMl) + ' mL',
      'Made by Sant Kumar · COREGENIX'
    ].join('\n');
  }

  function compareHTML(r) {
    var rows = C.compareSizes(r.totalMl).map(function (x) {
      return '<tr class="' + (x.size === r.containerMl ? 'hl' : '') + '"><td>' + x.size + ' mL</td><td>' + fmt(x.exact, 2) +
        '</td><td>' + fmt(x.containers, 0) + '</td><td>' + fmt(x.dispensedMl) + ' mL</td><td>' + fmt(x.leftoverMl) + ' mL</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Container</th><th>Exact</th><th>Dispense</th><th>Total supplied</th><th>Left over</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
  }

  /* ================= 1. infusion ================= */
  function renderInfusion() {
    var out = $('inf-result'), cmp = $('inf-compare');
    try {
      var r = C.infusion({
        rate: num('inf-rate'), rateUnit: $('inf-rateunit').value,
        duration: num('inf-dur'), durationUnit: $('inf-durunit').value,
        containerMl: num('inf-size'), dropFactor: parseFloat($('inf-drop').value) || 0
      });
      var label = $('inf-fluid').value.trim();
      out.innerHTML = infusionHTML(r, label, 'inf');
      lastText.inf = infusionText(r, label);
      cmp.innerHTML = compareHTML(r);
    } catch (e) {
      out.innerHTML = emptyHTML(e.message);
      cmp.innerHTML = '';
    }
  }

  /* ================= 2. multi ================= */
  var STORE_KEY = 'coregenix-multi-v1';
  var EXAMPLE_ROWS = [
    { name: 'NS 0.9%', size: '500', rate: '100' },
    { name: 'DNS', size: '500', rate: '75' },
    { name: 'Antibiotic infusion', size: '100', rate: '25' },
    { name: 'Injection (10 mL vial)', size: '10', rate: '3' },
    { name: 'Injection (2 mL ampoule)', size: '2', rate: '0.5' }
  ];
  var rows = loadRows() || [{ name: '', size: '', rate: '' }];

  function loadRows() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch (e) { return null; }
  }
  function saveRows() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rows)); } catch (e) { /* storage unavailable */ }
  }

  function drawRows() {
    $('multi-rows').innerHTML = rows.map(function (r, i) {
      return '<tr>' +
        '<td><input type="text" data-i="' + i + '" data-f="name" value="' + esc(r.name) + '" placeholder="e.g. DNS 500 mL" aria-label="Name"></td>' +
        '<td><input type="number" min="0" step="any" list="sizes" data-i="' + i + '" data-f="size" value="' + esc(r.size) + '" aria-label="Container size in mL"></td>' +
        '<td><input type="number" min="0" step="any" data-i="' + i + '" data-f="rate" value="' + esc(r.rate) + '" aria-label="Rate in mL per hour"></td>' +
        '<td><button type="button" class="icon-btn" data-del="' + i + '" aria-label="Remove row">✕</button></td></tr>';
    }).join('');
  }

  function renderMulti() {
    var out = $('multi-result');
    var items = rows.filter(function (r) { return String(r.rate).trim() !== '' || String(r.size).trim() !== ''; })
      .map(function (r) { return { name: r.name, rate: parseFloat(r.rate), containerMl: parseFloat(r.size) }; });
    if (!items.length) { out.innerHTML = emptyHTML('Add at least one injection or fluid.'); lastText.multi = ''; return; }
    try {
      var m = C.multi(items, num('multi-dur'), $('multi-durunit').value);
      var body = m.rows.map(function (x) {
        if (!x.ok) return '<tr><td>' + esc(x.name) + '</td><td colspan="5" class="bad">' + esc(x.error) + '</td></tr>';
        var r = x.r;
        return '<tr><td>' + esc(x.name) + '</td><td>' + fmt(r.totalMl) + ' mL</td><td>' + fmt(r.containerMl) + ' mL</td><td>' +
          fmt(r.exact, 2) + '</td><td><b>' + r.containers + '</b></td><td>' + fmt(r.leftoverMl) + ' mL</td></tr>';
      }).join('');
      out.innerHTML = '<h2><span class="idx">02</span> Dispense for ' + C.formatDuration(m.hours) + '</h2>' +
        '<div class="table-wrap"><table><thead><tr><th>Injection / fluid</th><th>Total volume</th><th>Container</th><th>Exact</th><th>Dispense</th><th>Left over</th></tr></thead><tbody>' +
        body + '</tbody><tfoot><tr><td>Total units</td><td>' + fmt(m.totalMl) + ' mL</td><td></td><td></td><td>' + m.totalContainers +
        '</td><td></td></tr></tfoot></table></div>' + actionsHTML('multi');
      lastText.multi = ['COREGENIX Dose Calculator — all injections, ' + C.formatDuration(m.hours)].concat(
        m.rows.map(function (x) {
          return x.ok
            ? '• ' + x.name + ': ' + x.r.containers + ' × ' + fmt(x.r.containerMl) + ' mL (needs ' + fmt(x.r.totalMl) + ' mL, left over ' + fmt(x.r.leftoverMl) + ' mL)'
            : '• ' + x.name + ': ' + x.error;
        }),
        ['Total units: ' + m.totalContainers, 'Made by Sant Kumar · COREGENIX']
      ).join('\n');
    } catch (e) {
      out.innerHTML = emptyHTML(e.message);
    }
  }

  $('multi-rows').addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.i == null) return;
    rows[+t.dataset.i][t.dataset.f] = t.value;
    saveRows();
    renderMulti();
  });
  $('multi-rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (!b) return;
    rows.splice(+b.dataset.del, 1);
    saveRows(); drawRows(); renderMulti();
  });
  $('multi-add').addEventListener('click', function () {
    rows.push({ name: '', size: '', rate: '' });
    saveRows(); drawRows(); renderMulti();
    var last = $('multi-rows').querySelector('tr:last-child input');
    if (last) last.focus();
  });
  $('multi-example').addEventListener('click', function () {
    rows = EXAMPLE_ROWS.map(function (r) { return Object.assign({}, r); });
    saveRows(); drawRows(); renderMulti();
  });
  $('multi-clear').addEventListener('click', function () {
    rows = [{ name: '', size: '', rate: '' }];
    saveRows(); drawRows(); renderMulti();
  });
  $('multi-dur').addEventListener('input', renderMulti);
  $('multi-durunit').addEventListener('change', renderMulti);

  /* ================= 3. pediatric ================= */
  var pedMode = 'fluid';

  function setPedMode(mode) {
    pedMode = mode;
    document.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.mode === mode); });
    document.querySelectorAll('#ped-form [data-modes]').forEach(function (el) {
      el.hidden = el.dataset.modes.split(' ').indexOf(mode) < 0;
    });
    renderPed();
  }

  function renderPed() {
    var out = $('ped-result');
    try {
      var w = num('ped-weight'), dur = num('ped-dur'), unit = $('ped-durunit').value, html, r, label;
      if (pedMode === 'fluid') {
        var m = C.maintenance(w, num('ped-pct'));
        label = $('ped-fluid').value.trim();
        r = C.infusion({
          rate: m.hourlyMl, rateUnit: 'hr', duration: dur, durationUnit: unit,
          containerMl: num('ped-size'), dropFactor: parseFloat($('ped-drop').value) || 0
        });
        html = '<h3 style="margin-top:0">Maintenance fluid — ' + fmt(w, 2) + ' kg</h3>' +
          statsHTML([
            { k: 'Daily (Holliday–Segar)', v: fmt(m.dailyMl, 0) + ' mL/day' },
            { k: 'Hourly (4-2-1 rule)', v: fmt(m.hourlyMl, 1) + ' mL/hr' }
          ]) +
          '<ol class="steps">' + m.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
          warningsHTML(m.warnings) + '<hr style="border:0;border-top:1px solid var(--border);margin:18px 0">' +
          infusionHTML(r, label, 'ped');
        lastText.ped = infusionText(r, label, 'pediatric maintenance, ' + fmt(w, 2) + ' kg');
      } else if (pedMode === 'perkg') {
        label = $('ped-fluid').value.trim();
        r = C.perKgInfusion({
          weightKg: w, mlPerKgHr: num('ped-mlkghr'), duration: dur, durationUnit: unit,
          containerMl: num('ped-size'), dropFactor: parseFloat($('ped-drop').value) || 0
        });
        html = infusionHTML(r, label, 'ped');
        lastText.ped = infusionText(r, label, 'pediatric ' + fmt(w, 2) + ' kg × ' + fmt(num('ped-mlkghr'), 2) + ' mL/kg/hr');
      } else {
        var d = C.weightDose({
          weightKg: w, doseMgPerKg: num('ped-dose'), dosesPerDay: parseFloat($('ped-freq').value),
          vialMg: num('ped-vialmg'), vialMl: num('ped-vialml'), maxDoseMg: num('ped-max'),
          duration: dur, durationUnit: unit
        });
        html = '<div class="answer">' +
          '<div class="eyebrow">Dispense for ' + C.formatDuration(d.hours) + '</div>' +
          '<div class="big">' + d.singleDoseVials + '</div>' +
          '<div class="unit">vials (single-dose, remainder discarded)</div>' +
          '<p class="note">or <b>' + d.multiDoseVials + '</b> vial' + (d.multiDoseVials === 1 ? '' : 's') + ' if the vial is multi-dose and can be re-used</p></div>' +
          statsHTML([
            { k: 'Dose given', v: fmt(d.givenDoseMg, 2) + ' mg' + (d.capped ? ' (max)' : '') },
            { k: 'Volume per dose', v: fmt(d.mlPerDose, 2) + ' mL' },
            { k: 'Doses in period', v: String(d.doses) },
            { k: 'Total volume', v: fmt(d.totalMl, 2) + ' mL' },
            { k: 'Total drug', v: fmt(d.totalMg, 2) + ' mg' },
            { k: 'Concentration', v: fmt(d.concMgPerMl, 2) + ' mg/mL' }
          ]) + warningsHTML(d.warnings) + stepsHTML(d.steps) + actionsHTML('ped');
        lastText.ped = [
          'COREGENIX Dose Calculator — pediatric injection, ' + fmt(w, 2) + ' kg',
          'Dose        : ' + fmt(d.givenDoseMg, 2) + ' mg (' + fmt(d.mlPerDose, 2) + ' mL) × ' + d.doses + ' dose(s)',
          'DISPENSE    : ' + d.singleDoseVials + ' single-dose vial(s)  |  ' + d.multiDoseVials + ' if multi-dose',
          'Made by Sant Kumar · COREGENIX'
        ].join('\n');
      }
      out.innerHTML = html;
    } catch (e) {
      out.innerHTML = emptyHTML(e.message);
    }
  }

  document.querySelectorAll('.seg-btn').forEach(function (b) {
    b.addEventListener('click', function () { setPedMode(b.dataset.mode); });
  });

  /* ================= copy / print ================= */
  document.addEventListener('click', function (e) {
    var copy = e.target.closest('[data-copy]');
    if (copy) {
      var text = lastText[copy.dataset.copy] || '';
      var done = function () {
        var old = copy.textContent; copy.textContent = 'Copied ✓';
        setTimeout(function () { copy.textContent = old; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    }
    if (e.target.closest('[data-print]')) window.print();
  });

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (err) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /* ================= wire up ================= */
  chips('inf-chips', 'inf-size', renderInfusion);
  chips('ped-chips', 'ped-size', renderPed);
  linkDurationUnit('inf-durunit', 'inf-dur', renderInfusion);
  linkDurationUnit('multi-durunit', 'multi-dur', renderMulti);
  linkDurationUnit('ped-durunit', 'ped-dur', renderPed);

  $('inf-form').addEventListener('input', renderInfusion);
  $('inf-form').addEventListener('change', renderInfusion);
  $('ped-form').addEventListener('input', renderPed);
  $('ped-form').addEventListener('change', renderPed);

  drawRows();
  renderInfusion();
  renderMulti();
  setPedMode('fluid');
  showTab(location.hash.replace('#', ''));
})();
