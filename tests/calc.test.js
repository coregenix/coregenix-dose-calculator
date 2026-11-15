'use strict';
/* Run with:  node tests/calc.test.js   (or: npm test) */
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + ' ≠ ' + b);

console.log('\nCOREGENIX Dose Calculator — tests\n');

test('100 mL/hr for 24 h with 500 mL bottles → 5 bottles (4.8 exact)', () => {
  const r = C.infusion({ rate: 100, duration: 24, containerMl: 500 });
  assert.equal(r.totalMl, 2400);
  near(r.exact, 4.8);
  assert.equal(r.containers, 5);
  assert.equal(r.fullContainers, 4);
  near(r.partialMl, 400);
  near(r.leftoverMl, 100);
  near(r.runtimeHr, 5);
});

test('exact fit does not round up (125 mL/hr × 24 h ÷ 500 = 6)', () => {
  const r = C.infusion({ rate: 125, duration: 24, containerMl: 500 });
  assert.equal(r.containers, 6);
  assert.equal(r.leftoverMl, 0);
  assert.equal(r.partialMl, 0);
});

test('duration in minutes (90 min at 100 mL/hr = 150 mL → 1 × 500 mL)', () => {
  const r = C.infusion({ rate: 100, duration: 90, durationUnit: 'min', containerMl: 500 });
  near(r.totalMl, 150);
  assert.equal(r.containers, 1);
  near(r.leftoverMl, 350);
});

test('rate in mL/min is converted to mL/hr', () => {
  const r = C.infusion({ rate: 2, rateUnit: 'min', duration: 1, containerMl: 100 });
  assert.equal(r.rateMlHr, 120);
  assert.equal(r.containers, 2);
});

test('small vials: 0.5 mL/hr × 24 h with 2 mL vials → 6 vials', () => {
  const r = C.infusion({ rate: 0.5, duration: 24, containerMl: 2 });
  assert.equal(r.totalMl, 12);
  assert.equal(r.containers, 6);
});

test('10 mL vials: 3 mL/hr × 24 h = 72 mL → 8 vials', () => {
  const r = C.infusion({ rate: 3, duration: 24, containerMl: 10 });
  assert.equal(r.containers, 8);
  near(r.leftoverMl, 8);
});

test('floating-point noise does not add a phantom container', () => {
  const r = C.infusion({ rate: 0.1, duration: 3, containerMl: 0.1 });
  assert.equal(r.containers, 3);
});

test('invalid inputs throw', () => {
  assert.throws(() => C.infusion({ rate: 0, duration: 24, containerMl: 500 }));
  assert.throws(() => C.infusion({ rate: NaN, duration: 24, containerMl: 500 }));
  assert.throws(() => C.infusion({ rate: 100, duration: -1, containerMl: 500 }));
  assert.throws(() => C.infusion({ rate: 100, duration: 24, containerMl: 0 }));
});

test('drip rate (gtt/min)', () => {
  near(C.infusion({ rate: 100, duration: 24, containerMl: 500, dropFactor: 20 }).dripGttMin, 33.333333, 1e-4);
  near(C.infusion({ rate: 100, duration: 24, containerMl: 500, dropFactor: 60 }).dripGttMin, 100);
  assert.equal(C.infusion({ rate: 100, duration: 24, containerMl: 500 }).dripGttMin, null);
});

test('container change schedule', () => {
  const r = C.infusion({ rate: 100, duration: 24, containerMl: 500 });
  assert.equal(r.schedule.length, 5);
  near(r.schedule[0].endHr, 5);
  near(r.schedule[4].startHr, 20);
  near(r.schedule[4].endHr, 24);
  near(r.schedule[4].usedMl, 400);
});

test('compareSizes for 2,400 mL', () => {
  const rows = C.compareSizes(2400);
  const by = Object.fromEntries(rows.map(x => [x.size, x]));
  assert.equal(by[1000].containers, 3);
  assert.equal(by[500].containers, 5);
  assert.equal(by[250].containers, 10);
  assert.equal(by[100].containers, 24);
  assert.equal(by[10].containers, 240);
});

test('multi: several injections, shared duration', () => {
  const m = C.multi([
    { name: 'NS', rate: 100, containerMl: 500 },
    { name: 'DNS', rate: 75, containerMl: 500 },
    { name: 'bad', rate: 0, containerMl: 10 }
  ], 24, 'hr');
  assert.equal(m.rows[0].r.containers, 5);
  assert.equal(m.rows[1].r.containers, 4);   // 1800 / 500 = 3.6
  assert.equal(m.rows[2].ok, false);
  assert.equal(m.totalContainers, 9);
});

test('formatDuration', () => {
  assert.equal(C.formatDuration(24), '24 h');
  assert.equal(C.formatDuration(1.5), '1 h 30 min');
  assert.equal(C.formatDuration(0.25), '15 min');
});

test('pediatric maintenance (Holliday–Segar / 4-2-1)', () => {
  let m = C.maintenance(8);   near(m.dailyMl, 800);  near(m.hourlyMl, 32);
  m = C.maintenance(10);      near(m.dailyMl, 1000); near(m.hourlyMl, 40);
  m = C.maintenance(15);      near(m.dailyMl, 1250); near(m.hourlyMl, 50);
  m = C.maintenance(25);      near(m.dailyMl, 1600); near(m.hourlyMl, 65);
});

test('pediatric maintenance cap and percentage', () => {
  const big = C.maintenance(70);
  near(big.hourlyMl, 100); near(big.dailyMl, 2400);
  assert.ok(big.warnings.length > 0);
  const half = C.maintenance(15, 50);
  near(half.hourlyMl, 25); near(half.dailyMl, 625);
  assert.ok(C.maintenance(2.5).warnings.length > 0);
});

test('mL/kg/hr infusion (5 kg × 4 mL/kg/hr over 24 h, 100 mL bags)', () => {
  const r = C.perKgInfusion({ weightKg: 5, mlPerKgHr: 4, duration: 24, containerMl: 100 });
  near(r.rateMlHr, 20);
  assert.equal(r.containers, 5);   // 480 mL / 100 = 4.8
});

test('weight-based injection (10 kg × 15 mg/kg, 500 mg/10 mL vial, q6h)', () => {
  const d = C.weightDose({ weightKg: 10, doseMgPerKg: 15, dosesPerDay: 4, vialMg: 500, vialMl: 10, duration: 24 });
  near(d.concMgPerMl, 50);
  near(d.givenDoseMg, 150);
  near(d.mlPerDose, 3);
  assert.equal(d.doses, 4);
  near(d.totalMl, 12);
  assert.equal(d.singleDoseVials, 4);
  assert.equal(d.multiDoseVials, 2);
});

test('weight-based injection respects maximum single dose', () => {
  const d = C.weightDose({ weightKg: 40, doseMgPerKg: 50, dosesPerDay: 3, vialMg: 1000, vialMl: 10, maxDoseMg: 1000, duration: 24 });
  assert.equal(d.capped, true);
  near(d.givenDoseMg, 1000);
  near(d.mlPerDose, 10);
  assert.equal(d.singleDoseVials, 3);
});

test('weight-based injection over a partial day rounds doses up (12 h of q8h = 2 doses)', () => {
  const d = C.weightDose({ weightKg: 10, doseMgPerKg: 10, dosesPerDay: 3, vialMg: 100, vialMl: 2, duration: 12 });
  assert.equal(d.doses, 2);
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' — with failures' : ' ✔') + '\n');
