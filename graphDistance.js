// Pure lane-graph shortest-path distance calculation, extracted verbatim from
// App._computeDetectorDistance (app.js) so it can be unit-tested under Node
// via tests/graphDistance.test.js. No `this`, no DOM — just graph math.
//
// laneLength: { laneId: lengthMeters }
// adjacency:  { laneId: [neighborLaneId, ...] }  (directed)
// Returns the road distance in meters between a point at `fromPos` on
// `fromLane` and a point at `toPos` on `toLane`, or null if unreachable
// (including: unknown lane, no path within bounds, or same-lane with
// toPos <= fromPos since that would mean going backwards).
function computeLaneGraphDistance(laneLength, adjacency, fromLane, toLane, fromPos, toPos, opts) {
    opts = opts || {};
    const MAX_DIST = opts.maxDist || 8000;
    const MAX_VISITS = opts.maxVisits || 20000;

    if (!(fromLane in laneLength) || !(toLane in laneLength)) return null;

    if (fromLane === toLane) {
        return toPos > fromPos ? Math.round(toPos - fromPos) : null;
    }

    const dist = new Map();
    const visited = new Set();
    dist.set(fromLane, laneLength[fromLane] - fromPos);

    // Simple binary min-heap keyed by distance, sufficient for a one-off
    // manual "auto-calc" click on networks with thousands of lanes.
    const heap = [[dist.get(fromLane), fromLane]];
    const heapPush = (item) => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const heapPop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            while (true) {
                const l = i * 2 + 1, r = i * 2 + 2;
                let smallest = i;
                if (l < heap.length && heap[l][0] < heap[smallest][0]) smallest = l;
                if (r < heap.length && heap[r][0] < heap[smallest][0]) smallest = r;
                if (smallest === i) break;
                [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
                i = smallest;
            }
        }
        return top;
    };

    let visits = 0;
    while (heap.length && visits < MAX_VISITS) {
        const [d, u] = heapPop();
        if (visited.has(u)) continue;
        if (d > MAX_DIST) break;
        visited.add(u);
        visits++;
        if (u === toLane) {
            return Math.round(d - (laneLength[toLane] - toPos));
        }
        const neighbors = adjacency[u] || [];
        for (const v of neighbors) {
            const w = laneLength[v];
            if (w === undefined || visited.has(v)) continue;
            const nd = d + w;
            if (!dist.has(v) || nd < dist.get(v)) {
                dist.set(v, nd);
                heapPush([nd, v]);
            }
        }
    }
    return null;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeLaneGraphDistance };
}
