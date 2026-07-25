// Pure quadratic least-squares regression, extracted verbatim from
// App.calculatePolyReg (app.js) — the Dwell Time Analysis tab's sensitivity
// curve fit. No `this`, no DOM. See tests/polyReg.test.js.
//
// Fits y = ax^2 + bx + c via Gaussian elimination with partial pivoting on
// the 3x4 normal-equations matrix, then reports R^2. Requires n>=5 points
// (see the n<5 guard below) — a quadratic has only 3 parameters, so at
// n=3 it fits every point exactly and reports a meaningless R^2~=1.0, an
// artefact of zero residual degrees of freedom rather than evidence of a
// real relationship. The Dwell sweep always produces exactly 5 points
// (0/10/20/45/90s dwell values), so 5 is the natural minimum to require.
function calculatePolyReg(xData, yData) {
    let x = [];
    let y = [];
    for (let i = 0; i < xData.length; i++) {
        if (xData[i] !== null && yData[i] !== null && !isNaN(xData[i]) && !isNaN(yData[i])) {
            x.push(xData[i]);
            y.push(yData[i]);
        }
    }

    let n = x.length;
    if (n < 5) return { eq: "y = Insufficient Data (Need all 5 dwell scenarios)", r2: "N/A", lowConfidence: true, impliesNegative: false, warning: null };

    let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
    let sumY = 0, sumXY = 0, sumX2Y = 0;

    for (let i = 0; i < n; i++) {
        let xi = x[i];
        let yi = y[i];
        sumX += xi;
        sumX2 += xi * xi;
        sumX3 += xi * xi * xi;
        sumX4 += xi * xi * xi * xi;
        sumY += yi;
        sumXY += xi * yi;
        sumX2Y += xi * xi * yi;
    }

    let m = [
        [sumX4, sumX3, sumX2, sumX2Y],
        [sumX3, sumX2, sumX, sumXY],
        [sumX2, sumX, n, sumY]
    ];

    for (let i = 0; i < 3; i++) {
        let maxEl = Math.abs(m[i][i]), maxRow = i;
        for (let k = i + 1; k < 3; k++) {
            if (Math.abs(m[k][i]) > maxEl) {
                maxEl = Math.abs(m[k][i]);
                maxRow = k;
            }
        }
        let tmp = m[maxRow];
        m[maxRow] = m[i];
        m[i] = tmp;
        if (m[i][i] === 0) return { eq: "y = Linear/Constant", r2: "N/A", lowConfidence: false, impliesNegative: false, warning: null };
        for (let k = i + 1; k < 3; k++) {
            let c = -m[k][i] / m[i][i];
            for (let j = i; j < 4; j++) {
                if (i === j) m[k][j] = 0;
                else m[k][j] += c * m[i][j];
            }
        }
    }

    let ans = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
        ans[i] = m[i][3] / m[i][i];
        for (let k = i - 1; k >= 0; k--) {
            m[k][3] -= m[k][i] * ans[i];
        }
    }

    let a = ans[0], b = ans[1], c = ans[2];

    let yMean = sumY / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
        let yPred = a * x[i] * x[i] + b * x[i] + c;
        ssTot += (y[i] - yMean) * (y[i] - yMean);
        ssRes += (y[i] - yPred) * (y[i] - yPred);
    }
    let r2 = 1 - (ssRes / (ssTot || 1));

    // Domain-plausibility check: does the fitted curve dip below zero
    // anywhere WITHIN the sampled/displayed x-range (not extrapolated
    // beyond it)? Every quantity this fit is used for (time loss,
    // emissions, fuel, stop counts, speed) is physically non-negative, so a
    // negative fitted value in-range is never a real answer — it's pure
    // curve-fitting arithmetic with no concept of what the y-axis means, so
    // nothing else guards against this. The quadratic's extreme value over
    // an interval occurs either at an endpoint or at its vertex (if the
    // vertex falls inside the interval), so checking those candidates is
    // sufficient — no need to sample the whole curve.
    const minX = Math.min(...x);
    const maxX = Math.max(...x);
    const candidateXs = [minX, maxX];
    if (a !== 0) {
        const vertexX = -b / (2 * a);
        if (vertexX > minX && vertexX < maxX) candidateXs.push(vertexX);
    }
    const minYInRange = Math.min(...candidateXs.map(cx => a * cx * cx + b * cx + c));
    const impliesNegative = minYInRange < 0;

    return {
        eq: `y = ${a.toFixed(2)}x² ${b >= 0 ? '+' : ''} ${b.toFixed(2)}x ${c >= 0 ? '+' : ''} ${c.toFixed(2)}`,
        r2: r2.toFixed(4),
        lowConfidence: false,
        impliesNegative,
        warning: impliesNegative
            ? `This fitted curve predicts a negative value (as low as ${minYInRange.toFixed(2)}) within the displayed range — not physically possible for a quantity like time, speed, distance, or count. Treat this fit with caution.`
            : null
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculatePolyReg };
}
