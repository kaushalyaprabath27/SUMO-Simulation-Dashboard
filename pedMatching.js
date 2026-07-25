// Pure pedestrian-crossing matching logic, extracted from
// App._applyParsedPedData (app.js) — the part that decides which crossing
// (and direction) a parsed personFlow belongs to. The DOM/state side effects
// (rebuilding tables, writing to _pedState, toasts) stay in app.js; only the
// decision logic itself lives here. No `this`, no DOM. See
// tests/pedMatching.test.js.

// A walk's edge list is rarely IDENTICAL to a crossing's `edges` — it
// usually also includes footpath edges leading up to and away from the
// crossing. So this looks for the crossing's edges as a contiguous run
// inside the walk instead of requiring the whole walk to match exactly.
function containsSeq(haystack, needle) {
    if (!needle.length || needle.length > haystack.length) return false;
    for (let i = 0; i <= haystack.length - needle.length; i++) {
        let match = true;
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) { match = false; break; }
        }
        if (match) return true;
    }
    return false;
}

// <personTrip from=".." to=".."/> personFlows carry no edge list at all
// (SUMO computes the path itself) — those are matched instead by the
// personFlow's own id, following this project's "c{crossingIndex}_
// {in|out}_{beginSec}" convention (0-based index). "in" is treated as the
// forward direction, "out" as reverse.
const ID_PATTERN = /^c(\d+)_(in|out)_/i;

// Finds the begins[] index closest to `begin` (nearest-neighbor binning for
// snapping a parsed flow's raw begin-time onto the app's own interval grid).
function findNearestIntervalIndex(begin, begins) {
    let best = -1, bestDiff = Infinity;
    begins.forEach((b, i) => {
        const diff = Math.abs(b - begin);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    return best;
}

// Decides which crossing (and direction) a single personFlow belongs to.
//
// flow: { id, edgesStr } — edgesStr is the <walk edges="..."> value (space-
//   separated edge ids) when present; personTrip-based flows have no edge
//   list, so edgesStr should be falsy/absent for those.
// crossings: array of { id } in display order — array index is the
//   crossing index used both for containsSeq matching order and for the
//   personTrip id-pattern's 0-based index.
// crossingEdgesMap: { [crossingId]: "edge1 edge2 ..." } — the project's own
//   per-crossing edges attribute (from .add.xml), keyed by crossing id.
//
// Returns { crossingIndex, direction } — crossingIndex is -1 if nothing
// matched. direction is 'fwd' or 'rev'.
//
// NOTE on a real, preserved-as-is quirk: when matching by edgesStr, this
// checks EVERY crossing rather than stopping at the first match, so if a
// walk's edge list contains more than one crossing's edges as a
// subsequence, the LAST matching crossing wins, not the first. This is the
// original app.js behavior, kept verbatim rather than "fixed" here.
function matchPedFlowToCrossing(flow, crossings, crossingEdgesMap) {
    let crossingIndex = -1;
    let direction = 'fwd';

    if (flow.edgesStr) {
        const edgesArr = flow.edgesStr.split(/\s+/).filter(Boolean);
        crossings.forEach((c, idx) => {
            const cEdgesStr = ((crossingEdgesMap && crossingEdgesMap[c.id]) || '').trim();
            if (!cEdgesStr) return;
            const cEdgesArr = cEdgesStr.split(/\s+/).filter(Boolean);
            if (containsSeq(edgesArr, cEdgesArr)) { crossingIndex = idx; direction = 'fwd'; }
            else if (containsSeq(edgesArr, cEdgesArr.slice().reverse())) { crossingIndex = idx; direction = 'rev'; }
        });
    } else {
        const m = (flow.id || '').match(ID_PATTERN);
        if (m) {
            const idx = parseInt(m[1], 10);
            if (idx < crossings.length) {
                crossingIndex = idx;
                direction = m[2].toLowerCase() === 'out' ? 'rev' : 'fwd';
            }
        }
    }

    return { crossingIndex, direction };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { containsSeq, findNearestIntervalIndex, matchPedFlowToCrossing, ID_PATTERN };
}
