// Coverage for parseEmissionSplitXML (emissionsParser.js) -- the idle/moving
// emissions split. This reads a different SUMO file from
// emissionsParser.test.js's SAMPLE_TRIPINFO: --emission-output (one <vehicle>
// row per vehicle per simulation timestep, nested in <timestep> elements),
// not --tripinfo-output. See the comment above parseEmissionSplitXML in
// emissionsParser.js for why tripinfo alone can't support this split.
//
// Fixture: two 1-second timesteps, two vehicles. Vehicle A (passenger_car)
// is below the 0.1 m/s default threshold only at t=0 (speed 0.05), then
// above it at t=1 (speed 0.2). Vehicle B (heavy_bus) is above it throughout
// (speed 5.0). Hand-computed expected totals below assume the default
// threshold unless a test overrides it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmissionSplitXML } = require('../emissionsParser.js');

const SAMPLE_EMISSION_OUTPUT = `<?xml version="1.0"?>
<emission-export>
    <timestep time="0.00">
        <vehicle id="vA" type="passenger_car" speed="0.05" CO="10" HC="1" PMx="0.5" NOx="2" CO2="100" fuel="50"/>
        <vehicle id="vB" type="heavy_bus" speed="5.0" CO="20" HC="2" PMx="1" NOx="4" CO2="200" fuel="100"/>
    </timestep>
    <timestep time="1.00">
        <vehicle id="vA" type="passenger_car" speed="0.2" CO="10" HC="1" PMx="0.5" NOx="2" CO2="100" fuel="50"/>
        <vehicle id="vB" type="heavy_bus" speed="5.0" CO="20" HC="2" PMx="1" NOx="4" CO2="200" fuel="100"/>
    </timestep>
</emission-export>`;

function approxEqual(actual, expected, epsilon = 1e-9) {
    assert.ok(Math.abs(actual - expected) < epsilon, `expected ${expected}, got ${actual}`);
}

test('splits by the default 0.1 m/s threshold: only vA@t=0 counts as idle', () => {
    const result = parseEmissionSplitXML(SAMPLE_EMISSION_OUTPUT);
    assert.equal(result.idleThresholdMps, 0.1);
    assert.equal(result.vehicleStepCount, 4);
    assert.equal(result.idleVehicleSteps, 1);
    assert.equal(result.movingVehicleSteps, 3);
});

test('infers step length from the file (1.0s here) rather than assuming it', () => {
    const result = parseEmissionSplitXML(SAMPLE_EMISSION_OUTPUT);
    assert.equal(result.stepLengthSec, 1.0);
});

test('idle totals match hand computation: only vA at t=0 (CO 10mg, one 1s step)', () => {
    const result = parseEmissionSplitXML(SAMPLE_EMISSION_OUTPUT);
    approxEqual(result.idle.CO, 0.01);   // 10mg * 1s / 1000 = 0.01g
    approxEqual(result.idle.HC, 0.001);
    approxEqual(result.idle.PMx, 0.0005);
    approxEqual(result.idle.NOx, 0.002);
    approxEqual(result.idle.CO2, 0.0001); // 100mg * 1s / 1e6 = 0.0001kg
    // fuel: 50mg -> 0.00005kg, passenger_car density 0.745 kg/L
    approxEqual(result.idle.fuelLiters, 0.00005 / 0.745, 1e-8);
});

test('moving totals match hand computation: vB both steps + vA at t=1', () => {
    const result = parseEmissionSplitXML(SAMPLE_EMISSION_OUTPUT);
    approxEqual(result.moving.CO, 0.05);   // (20+10+20)mg / 1000
    approxEqual(result.moving.HC, 0.005);
    approxEqual(result.moving.PMx, 0.0025);
    approxEqual(result.moving.NOx, 0.01);
    approxEqual(result.moving.CO2, 0.0005); // (200+100+200)mg / 1e6
    // fuel: vB 200mg/1e6=0.0002kg @ 0.832 (bus) + vA 50mg/1e6=0.00005kg @ 0.745 (passenger_car)
    approxEqual(result.moving.fuelLiters, (0.0002 / 0.832) + (0.00005 / 0.745), 1e-8);
});

test('threshold is configurable: at 1.0 m/s, vA is idle at both steps and vB never is', () => {
    const result = parseEmissionSplitXML(SAMPLE_EMISSION_OUTPUT, 1.0);
    assert.equal(result.idleThresholdMps, 1.0);
    assert.equal(result.idleVehicleSteps, 2);
    assert.equal(result.movingVehicleSteps, 2);
    // idle CO now vA@t=0 (10mg) + vA@t=1 (10mg) = 20mg -> 0.02g
    approxEqual(result.idle.CO, 0.02);
});

test('threshold of 0: nothing counts as idle unless speed is exactly 0', () => {
    const result = parseEmissionSplitXML(SAMPLE_EMISSION_OUTPUT, 0);
    assert.equal(result.idleVehicleSteps, 0);
    assert.equal(result.movingVehicleSteps, 4);
});

test('a file with no <timestep>/<vehicle> records reports a warning, not a silent zero', () => {
    const result = parseEmissionSplitXML('<?xml version="1.0"?><emission-export></emission-export>');
    assert.equal(result.vehicleStepCount, 0);
    assert.ok(result.warnings.some(w => w.includes('No <timestep>/<vehicle> records')));
});

test('a <vehicle> row missing its speed attribute is skipped, not guessed into a bucket', () => {
    const xml = `<?xml version="1.0"?>
<emission-export>
    <timestep time="0.00">
        <vehicle id="vNoSpeed" type="passenger_car" CO="10" HC="1" PMx="0.5" NOx="2" CO2="100" fuel="50"/>
    </timestep>
</emission-export>`;
    const result = parseEmissionSplitXML(xml);
    assert.equal(result.vehicleStepCount, 0);
    approxEqual(result.idle.CO, 0);
    approxEqual(result.moving.CO, 0);
});

test('fuel is split by fuel type (petrol/diesel), not just pooled — previously pooled-only here while the tripinfo parser already split it', () => {
    const result = parseEmissionSplitXML(SAMPLE_EMISSION_OUTPUT);
    // Idle: only vA (passenger_car, petrol) at t=0, 50mg fuel -> 0.00005kg / 0.745 density
    approxEqual(result.idle.fuelLitersPetrol, 0.00005 / 0.745, 1e-8);
    approxEqual(result.idle.fuelLitersDiesel, 0);
    approxEqual(result.idle.fuelLiters, result.idle.fuelLitersPetrol + result.idle.fuelLitersDiesel, 1e-8);

    // Moving: vB (heavy_bus, diesel) at both steps (200mg total) + vA at t=1 (50mg, petrol)
    approxEqual(result.moving.fuelLitersDiesel, 0.0002 / 0.832, 1e-8);
    approxEqual(result.moving.fuelLitersPetrol, 0.00005 / 0.745, 1e-8);
    approxEqual(result.moving.fuelLiters, result.moving.fuelLitersPetrol + result.moving.fuelLitersDiesel, 1e-8);
});

test('mg->L conversion: a known fuel mass produces a hand-checkable litre output for both densities', () => {
    // 1000000 mg = 1 kg exactly, over one 1-second step -> density-only check
    const xmlPetrol = `<?xml version="1.0"?>
<emission-export>
    <timestep time="0.00"><vehicle id="v1" type="passenger_car" speed="5.0" CO="0" HC="0" PMx="0" NOx="0" CO2="0" fuel="1000000"/></timestep>
    <timestep time="1.00"><vehicle id="v1" type="passenger_car" speed="5.0" CO="0" HC="0" PMx="0" NOx="0" CO2="0" fuel="0"/></timestep>
</emission-export>`;
    const rPetrol = parseEmissionSplitXML(xmlPetrol);
    // 1 kg petrol / 0.745 kg/L = 1.342281879... L
    approxEqual(rPetrol.moving.fuelLiters, 1 / 0.745, 1e-9);

    const xmlDiesel = `<?xml version="1.0"?>
<emission-export>
    <timestep time="0.00"><vehicle id="v1" type="heavy_bus" speed="5.0" CO="0" HC="0" PMx="0" NOx="0" CO2="0" fuel="1000000"/></timestep>
    <timestep time="1.00"><vehicle id="v1" type="heavy_bus" speed="5.0" CO="0" HC="0" PMx="0" NOx="0" CO2="0" fuel="0"/></timestep>
</emission-export>`;
    const rDiesel = parseEmissionSplitXML(xmlDiesel);
    // 1 kg diesel / 0.832 kg/L = 1.201923... L
    approxEqual(rDiesel.moving.fuelLiters, 1 / 0.832, 1e-9);
});
