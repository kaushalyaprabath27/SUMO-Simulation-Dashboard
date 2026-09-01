// =============================================================================
// data.js — SUMO Traffic Simulation Control Panel Data
// =============================================================================
// Pure data objects. NO DOM manipulation, NO imports.
// All data assigned to global `const` variables.
// =============================================================================

// ---------------------------------------------------------------------------
// Time Intervals
// ---------------------------------------------------------------------------
// 10-min = 600 seconds each. Simulation starts at 6:30 AM, time 0 = 6:30
const TIME_INTERVALS = [
  { begin: 0, end: 600, clock: '6:30 - 6:40' },
  { begin: 600, end: 1200, clock: '6:40 - 6:50' },
  { begin: 1200, end: 1800, clock: '6:50 - 7:00' },
  { begin: 1800, end: 2400, clock: '7:00 - 7:10' },
  { begin: 2400, end: 3000, clock: '7:10 - 7:20' },
  { begin: 3000, end: 3600, clock: '7:20 - 7:30' },
  { begin: 3600, end: 4200, clock: '7:30 - 7:40' },
  { begin: 4200, end: 4800, clock: '7:40 - 7:50' },
  { begin: 4800, end: 5400, clock: '7:50 - 8:00' },
  { begin: 5400, end: 6000, clock: '8:00 - 8:10' }
];

// ---------------------------------------------------------------------------
// Vehicle Types
// ---------------------------------------------------------------------------
const VEHICLE_TYPES = {
  passenger_car: {
    vClass: 'passenger', length: 4.5, width: 1.8, maxSpeed: 13.89,
    accel: 1.5, decel: 4.0, sigma: 0.85, tau: 1.5, minGap: 2.0,
    minGapLat: 0.2, latAlignment: 'arbitrary', speedFactor: 0.85,
    speedDev: 0.15, lcStrategic: 2.0, lcCooperative: 0.5,
    lcOpposite: 1.5, lcSpeedGain: 2.0, lcAssertive: 1.5,
    lcPushy: 0.15, jmCrossingGap: 1.0, jmIgnoreFoeProb: 0.10,
    jmIgnoreKeepClearTime: 0, emissionClass: 'HBEFA4/PC_petrol_Euro-3', color: '#0000ff'
  },
  motorcycle: {
    vClass: 'motorcycle', length: 2.2, width: 0.9, maxSpeed: 16.67,
    accel: 2.5, decel: 4.5, sigma: 0.90, tau: 1.0, minGap: 0.7,
    minGapLat: 0.05, latAlignment: 'arbitrary', speedFactor: 0.90,
    speedDev: 0.20, lcStrategic: 2.0, lcCooperative: 0.2,
    lcOpposite: 3.5, lcAssertive: 2.5, lcPushy: 0.60,
    lcSpeedGain: 3.0, jmCrossingGap: 0.8, jmIgnoreFoeProb: 0.40,
    jmIgnoreKeepClearTime: 0, emissionClass: 'HBEFA4/MC_4S_le250cc_Euro-3', color: '#ff0000'
  },
  tuk_tuk: {
    vClass: 'custom1', length: 2.8, width: 1.3, maxSpeed: 11.11,
    accel: 1.5, decel: 3.5, sigma: 0.85, tau: 1.4, minGap: 1.2,
    minGapLat: 0.1, latAlignment: 'arbitrary', speedFactor: 0.80,
    speedDev: 0.15, lcStrategic: 2.0, lcCooperative: 0.4,
    lcOpposite: 2.5, lcSpeedGain: 2.0, lcAssertive: 2.0,
    lcPushy: 0.40, jmCrossingGap: 0.8, jmIgnoreFoeProb: 0.35,
    // HBEFA has no auto-rickshaw/three-wheeler category (a European-fleet
    // model); the closest available class is small-displacement motorcycle,
    // the same approximation an earlier build of this tool already used.
    jmIgnoreKeepClearTime: 0, emissionClass: 'HBEFA4/MC_4S_le250cc_Euro-3', color: '#00ff00'
  },
  van: {
    vClass: 'passenger', length: 5.0, width: 1.9, maxSpeed: 13.89,
    accel: 1.5, decel: 3.5, sigma: 0.75, tau: 1.5, minGap: 2.0,
    minGapLat: 0.2, latAlignment: 'arbitrary', speedFactor: 0.82,
    speedDev: 0.10, lcStrategic: 2.0, lcCooperative: 0.6,
    lcOpposite: 1.0, lcSpeedGain: 1.5, lcAssertive: 1.5,
    lcPushy: 0.12, jmCrossingGap: 1.2, jmIgnoreFoeProb: 0.12,
    jmIgnoreKeepClearTime: 0, emissionClass: 'HBEFA4/LCV_diesel_N1-II_Euro-3', color: '#ffa500'
  },
  heavy_bus: {
    vClass: 'bus', length: 10.0, width: 2.5, maxSpeed: 11.11,
    accel: 0.8, decel: 2.5, sigma: 0.50, tau: 2.0, minGap: 3.0,
    minGapLat: 0.5, latAlignment: 'center', speedFactor: 0.75,
    speedDev: 0.08, lcStrategic: 2.0, lcCooperative: 0.8,
    lcSpeedGain: 1.0, lcOpposite: 1.0, lcAssertive: 1.0,
    lcPushy: 0.00, jmCrossingGap: 2.0, jmIgnoreFoeProb: 0.08,
    jmIgnoreKeepClearTime: 1, emissionClass: 'HBEFA4/UBus_Std_gt15-18t_Euro-III', color: '#ffff00'
  },
  truck: {
    vClass: 'truck', length: 7.5, width: 2.4, maxSpeed: 11.11,
    accel: 0.8, decel: 2.5, sigma: 0.50, tau: 2.0, minGap: 3.0,
    minGapLat: 0.5, latAlignment: 'center', speedFactor: 0.75,
    speedDev: 0.08, lcStrategic: 2.0, lcCooperative: 0.8,
    lcSpeedGain: 1.0, lcOpposite: 1.0, lcAssertive: 1.0,
    lcPushy: 0.00, jmCrossingGap: 2.0, jmIgnoreFoeProb: 0.08,
    jmIgnoreKeepClearTime: 1, emissionClass: 'HBEFA4/RT_gt7_5-12t_Euro-III', color: '#800080'
  },
  fast_ped: {
    vClass: 'pedestrian', length: 0.5, width: null, maxSpeed: 1.4,
    minGap: 0.2, accel: null, decel: null, sigma: null, tau: null,
    minGapLat: null, latAlignment: null, speedFactor: null,
    speedDev: null, lcStrategic: null, lcCooperative: null,
    lcOpposite: null, lcSpeedGain: null, lcAssertive: null,
    lcPushy: null, jmCrossingGap: null, jmIgnoreFoeProb: null,
    jmIgnoreKeepClearTime: null, emissionClass: 'HBEFA4/zero', color: '#a52a2a'
  }
};

// Parameters that should be displayed in the vehicle type table
const VTYPE_PARAMS = [
  'vClass', 'emissionClass', 'color', 'length', 'width', 'maxSpeed', 'accel', 'decel', 'sigma', 'tau',
  'minGap', 'minGapLat', 'latAlignment', 'speedFactor', 'speedDev',
  'lcStrategic', 'lcCooperative', 'lcOpposite', 'lcSpeedGain',
  'lcAssertive', 'lcPushy', 'jmCrossingGap', 'jmIgnoreFoeProb',
  'jmIgnoreKeepClearTime'
];

// Metadata for each vehicle parameter: description, unit, min/max valid range, and category for grouping
const VTYPE_PARAM_META = {
  vClass: { description: 'SUMO vehicle class (determines allowed roads)', unit: '—', min: null, max: null, category: 'Identity' },
  emissionClass: { description: 'HBEFA emission model class for pollution calculation', unit: '—', min: null, max: null, category: 'Identity' },
  color: { description: 'Vehicle color in SUMO GUI visualization', unit: 'RGB hex', min: null, max: null, category: 'Identity' },
  length: { description: 'Physical length of the vehicle body', unit: 'm', min: 1.0, max: 25.0, category: 'Physical' },
  width: { description: 'Physical width of the vehicle body', unit: 'm', min: 0.5, max: 3.5, category: 'Physical' },
  maxSpeed: { description: 'Maximum achievable speed (absolute cap)', unit: 'm/s', min: 1.0, max: 55.56, category: 'Dynamics' },
  accel: { description: 'Maximum acceleration capability', unit: 'm/s²', min: 0.1, max: 10.0, category: 'Dynamics' },
  decel: { description: 'Maximum comfortable deceleration', unit: 'm/s²', min: 0.1, max: 10.0, category: 'Dynamics' },
  sigma: { description: 'Driver imperfection (0=perfect, 1=max randomness)', unit: '—', min: 0.0, max: 1.0, category: 'Driver Behavior' },
  tau: { description: 'Desired time headway (reaction time)', unit: 's', min: 0.1, max: 5.0, category: 'Driver Behavior' },
  minGap: { description: 'Minimum gap to vehicle in front when standing', unit: 'm', min: 0.0, max: 10.0, category: 'Spacing' },
  minGapLat: { description: 'Minimum lateral gap when passing', unit: 'm', min: 0.0, max: 2.0, category: 'Spacing' },
  latAlignment: { description: 'Lateral positioning within lane (center/arbitrary/right)', unit: '—', min: null, max: null, category: 'Spacing' },
  speedFactor: { description: 'Multiplier for speed limit compliance (1.0=obeys limit)', unit: '×', min: 0.1, max: 2.0, category: 'Dynamics' },
  speedDev: { description: 'Standard deviation of speed factor distribution', unit: '—', min: 0.0, max: 0.5, category: 'Dynamics' },
  lcStrategic: { description: 'Eagerness for lane changes for route-following', unit: '—', min: 0.0, max: 5.0, category: 'Lane Changing' },
  lcCooperative: { description: 'Willingness to cooperate with other lane changes', unit: '—', min: 0.0, max: 1.0, category: 'Lane Changing' },
  lcOpposite: { description: 'Willingness to use oncoming lanes for overtaking', unit: '—', min: 0.0, max: 5.0, category: 'Lane Changing' },
  lcSpeedGain: { description: 'Eagerness to change lanes for speed advantage', unit: '—', min: 0.0, max: 5.0, category: 'Lane Changing' },
  lcAssertive: { description: 'Willingness to accept smaller gaps during lane changes', unit: '—', min: 0.0, max: 5.0, category: 'Lane Changing' },
  lcPushy: { description: 'Tendency to push into gaps during lane changes', unit: '—', min: 0.0, max: 1.0, category: 'Lane Changing' },
  jmCrossingGap: { description: 'Minimum gap accepted at junctions when crossing traffic', unit: 's', min: 0.0, max: 10.0, category: 'Junction Behavior' },
  jmIgnoreFoeProb: { description: 'Probability of ignoring right-of-way rules at junctions', unit: '—', min: 0.0, max: 1.0, category: 'Junction Behavior' },
  jmIgnoreKeepClearTime: { description: 'Time after which junction blocking is tolerated', unit: 's', min: -1, max: 10, category: 'Junction Behavior' }
};

const VEHICLE_TYPE_NAMES = ['passenger_car', 'motorcycle', 'tuk_tuk', 'van', 'heavy_bus', 'truck', 'fast_ped'];

// Main corridor flow types used in tables
const FLOW_VEHICLE_TYPES = ['motorcycle', 'tuk_tuk', 'passenger_car', 'heavy_bus', 'van', 'truck'];

// ---------------------------------------------------------------------------
// Main Road Flows — vehicles traveling the full corridor
// ---------------------------------------------------------------------------
// Data extracted from Vehicles.rou.xml
// ---------------------------------------------------------------------------
// Bus Stops, Bus Dwell Times, and Parking Areas/Flows are now generic and
// project-driven — see App._busState in app.js (auto-detected from the
// uploaded SUMO folder's .add.xml busStop/parkingArea elements, or entered
// manually). No hardcoded per-project data lives here anymore.
//
// Validation (GEH) detectors and MAPE edges are likewise fully dynamic —
// discovered directly from whatever detector_output.xml / travel_times_output.xml
// the user uploads (see App._buildGEHTables and App._renderMapeFromRaw in app.js).
// ---------------------------------------------------------------------------

// module.exports-guarded, like emissionsParser.js and the other pure-data/
// pure-logic modules, so tests/ can require() VEHICLE_TYPES directly under
// Node rather than needing a DOM to load this via <script>.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VEHICLE_TYPES, VEHICLE_TYPE_NAMES, FLOW_VEHICLE_TYPES };
}

