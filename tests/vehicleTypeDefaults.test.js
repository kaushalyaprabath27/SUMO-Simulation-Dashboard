// Regression coverage for the default emissionClass values in data.js.
//
// Earlier defaults were HBEFA3 and, for motorcycle/tuk_tuk/van, a generic
// light-duty-vehicle class (HBEFA3/LDV_G_EU4) with no motorcycle-specific
// factors at all -- a defect found via a referee review of the JSALT
// manuscript (round 7): the tool's own defaults, left unchanged since the
// repo's first commit and never reviewed, would model the corridor's
// dominant vehicle type (61.9% motorcycles, per the manuscript's Section 5)
// with car-like emission factors. Confirmed against SUMO 1.27.1's real
// HBEFA4 model (emissionsMap) that MC_4S_gt250cc_preEuro's HC factor at
// 10 m/s is roughly 77x MC_4S_le250cc_Euro-3's. This test exists so that
// regressing back to a non-HBEFA4 or non-motorcycle-specific default is a
// test failure, not something only caught by re-reading the paper.
//
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { VEHICLE_TYPES, VEHICLE_TYPE_NAMES } = require('../data.js');

test('every built-in vehicle type has an HBEFA4 emissionClass, not HBEFA3', () => {
    for (const name of VEHICLE_TYPE_NAMES) {
        const cls = VEHICLE_TYPES[name].emissionClass;
        assert.ok(cls, `${name} has no emissionClass at all`);
        assert.ok(cls.startsWith('HBEFA4/'), `${name}'s emissionClass "${cls}" is not HBEFA4`);
    }
});

test('motorcycle and tuk_tuk use a motorcycle-specific class, not a generic light-duty-vehicle one', () => {
    assert.match(VEHICLE_TYPES.motorcycle.emissionClass, /^HBEFA4\/MC_/);
    assert.match(VEHICLE_TYPES.tuk_tuk.emissionClass, /^HBEFA4\/MC_/);
});

test('every vehicle type\'s emissionClass is distinct from the ones known to be wrong', () => {
    const banned = ['HBEFA3/PC_G_EU4', 'HBEFA3/LDV_G_EU4', 'HBEFA3/Bus', 'HBEFA3/HDV', 'HBEFA3/zero'];
    for (const name of VEHICLE_TYPE_NAMES) {
        assert.ok(!banned.includes(VEHICLE_TYPES[name].emissionClass), `${name} still uses a banned pre-fix class`);
    }
});

test('pedestrian type uses the zero-emission class', () => {
    assert.equal(VEHICLE_TYPES.fast_ped.emissionClass, 'HBEFA4/zero');
});
