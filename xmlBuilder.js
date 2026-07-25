// ============================================================
// xmlBuilder.js — Overrides App._buildFullXML()
// Generates a combined <routes> demand file (vTypes + flows +
// pedestrians + bus dwell + parking) from the generic, project-driven
// state (App._flowsState / App._pedState / App._busState). It does NOT
// redefine <route> elements — those already exist in the user's own
// uploaded .rou.xml, and this file is meant to be merged alongside it
// (or used as a standalone "additional demand" file referencing the
// same route ids).
// Loaded AFTER app.js.
//
// The actual generation logic lives in xmlBuilderCore.js's buildFullXML()
// — extracted into a pure function (explicit parameters instead of reading
// App/document directly) so it's unit-testable under Node; see
// tests/xmlBuilderCore.test.js. This file just gathers App's live state
// and delegates.
// ============================================================

App._buildFullXML = function () {
    const now = new Date().toLocaleString('sv').replace(' ', 'T') + '+05:30';
    return buildFullXML({
        vehicleTypeNames: VEHICLE_TYPE_NAMES,
        customVehicleTypeNames: Object.keys(this._customVehicleTypes || {}),
        buildVTypeXML: (id) => this._buildVTypeXML(id),
        simStartTime: document.getElementById('sim-start-time')?.value || '06:30',
        flowsState: this._flowsState,
        pedState: this._pedState,
        busState: this._busState,
        crossingEdges: this.project.crossingEdges,
        now
    });
};
