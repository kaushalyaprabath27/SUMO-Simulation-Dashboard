// Pure regression for the Dwell Time Analysis tab's sensitivity curve fit —
// extracted verbatim from App.calculatePolyReg (app.js), now fitting BOTH a
// linear and a quadratic model side by side. No `this`, no DOM. See
// tests/polyReg.test.js.
//
// History: originally quadratic-only, an unreviewed choice made by the
// coding agent that built this module (see CLAUDE.md's History section and
// the JSALT manuscript's Section 6.2) — "congestion delay grows non-
// linearly" was asserted, never tested against a straight line. This file
// now fits both and reports adjusted R^2 and AIC for each so a reader can
// judge the claim instead of taking it on trust. The quadratic fit itself
// is unchanged and is NOT removed — only put next to an alternative.

// Formats a coefficient to 4 significant figures. Previously `.toFixed(2)`,
// which silently rounded any coefficient smaller than 0.005 to "0.00",
// erasing the term that defines the curve's shape (found with a real
// quadratic 'a' coefficient of ~2.2e-3 rendering as "0.00x²"). toPrecision
// naturally switches to exponential notation for very small/large
// magnitudes, which is exactly the "4 significant figures or scientific
// notation" this is meant to give.
function formatSigFig(n, sigFigs) {
    if (n === 0) return '0.000';
    return Number(n).toPrecision(sigFigs || 4);
}

// Sum-of-squares helper shared by both fits: returns {ssTot, ssRes} for a
// given prediction function, so R^2/adjusted R^2/AIC are computed
// identically for linear and quadratic rather than twice, slightly
// differently.
function sumOfSquares(x, y, predict) {
    const n = x.length;
    const yMean = y.reduce((s, v) => s + v, 0) / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
        const yPred = predict(x[i]);
        ssTot += (y[i] - yMean) * (y[i] - yMean);
        ssRes += (y[i] - yPred) * (y[i] - yPred);
    }
    return { ssTot, ssRes };
}

// R^2 = 1 - ssRes/ssTot, guarding the degenerate all-identical-y case
// (ssTot=0) the same way the original inline code did.
function computeR2(ssTot, ssRes) {
    return 1 - (ssRes / (ssTot || 1));
}

// Adjusted R^2 penalises extra parameters: 1 - (1-R^2)*(n-1)/(n-p-1), where
// p is the number of predictors (not counting the intercept: 1 for linear,
// 2 for quadratic). Undefined (returns null) when n-p-1 <= 0 — not enough
// degrees of freedom for the adjustment to mean anything.
function computeAdjustedR2(r2, n, p) {
    const denom = n - p - 1;
    if (denom <= 0) return null;
    return 1 - (1 - r2) * (n - 1) / denom;
}

// AIC = n*ln(RSS/n) + 2k, the standard least-squares form (k = number of
// fitted parameters INCLUDING the intercept: 2 for linear, 3 for
// quadratic). Lower AIC is preferred. Undefined when RSS is exactly 0
// (perfect fit — ln(0) is -Infinity) or n is too small.
function computeAIC(ssRes, n, k) {
    if (n <= 0) return null;
    if (ssRes <= 0) return -Infinity; // a genuine perfect fit; still "lower is better"
    return n * Math.log(ssRes / n) + 2 * k;
}

// Ordinary least-squares line: y = b*x + a. Closed form, no matrix solve
// needed. Returns null coefficients if every x is identical (vertical line,
// undefined slope).
function fitLinear(x, y) {
    const n = x.length;
    const xMean = x.reduce((s, v) => s + v, 0) / n;
    const yMean = y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
        sxy += (x[i] - xMean) * (y[i] - yMean);
        sxx += (x[i] - xMean) * (x[i] - xMean);
    }
    if (sxx === 0) return null;
    const b = sxy / sxx;
    const a = yMean - b * xMean;
    return { a, b };
}

// Fits a linear model (y = b*x + a) and reports adjusted R^2, AIC, and a
// domain-plausibility warning (same non-negative-in-range check as the
// quadratic fit below). Needs n>=2 to fit at all; n<=3 (order 1 + 2) gets a
// prominent low-confidence warning rather than being blocked outright,
// since a straight line through 2-3 points is a legitimate (if unreliable)
// fit in a way a quadratic through 3 points is not (zero residual degrees
// of freedom only starts at n=2 for a line, vs n=3 for a quadratic).
function fitLinearModel(x, y) {
    const n = x.length;
    if (n < 2) {
        return { eq: 'y = Insufficient Data (need at least 2 points)', r2: null, adjR2: null, aic: null, n, lowConfidence: true, impliesNegative: false, warning: null };
    }
    const fit = fitLinear(x, y);
    if (!fit) {
        return { eq: 'y = Undefined (all x-values identical)', r2: null, adjR2: null, aic: null, n, lowConfidence: true, impliesNegative: false, warning: null };
    }
    const { a, b } = fit;
    const predict = (xi) => b * xi + a;
    const { ssTot, ssRes } = sumOfSquares(x, y, predict);
    const r2 = computeR2(ssTot, ssRes);
    const adjR2 = computeAdjustedR2(r2, n, 1);
    const aic = computeAIC(ssRes, n, 2);

    const minX = Math.min(...x);
    const maxX = Math.max(...x);
    const minYInRange = Math.min(predict(minX), predict(maxX));
    const impliesNegative = minYInRange < 0;

    const lowConfidence = n <= 3; // order (1) + 2

    return {
        eq: `y = ${formatSigFig(b)}x ${a >= 0 ? '+' : ''} ${formatSigFig(a)}`,
        r2: r2.toFixed(4),
        adjR2: adjR2 !== null ? adjR2.toFixed(4) : 'N/A',
        aic: isFinite(aic) ? aic.toFixed(2) : (aic === -Infinity ? '-Infinity (perfect fit)' : 'N/A'),
        n,
        lowConfidence,
        impliesNegative,
        warning: lowConfidence
            ? `Only ${n} point${n === 1 ? '' : 's'} used for a 2-parameter (linear) fit — R² is not meaningful evidence of a real relationship this close to zero residual degrees of freedom.`
            : (impliesNegative
                ? `This fitted line predicts a negative value (as low as ${minYInRange.toFixed(2)}) within the displayed range — not physically possible for a quantity like time, speed, distance, or count. Treat this fit with caution.`
                : null)
    };
}

// Fits y = ax^2 + bx + c via Gaussian elimination with partial pivoting on
// the 3x4 normal-equations matrix. Requires n>=5 points (see the n<5 guard
// below) — a quadratic has only 3 parameters, so at n=3 it fits every point
// exactly and reports a meaningless R^2~=1.0, an artefact of zero residual
// degrees of freedom rather than evidence of a real relationship. The
// Dwell sweep always produces exactly 5 points (0/10/20/45/90s dwell
// values), so 5 is the natural minimum to require.
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
    if (n < 5) return { eq: "y = Insufficient Data (Need all 5 dwell scenarios)", r2: "N/A", adjR2: "N/A", aic: "N/A", n, lowConfidence: true, impliesNegative: false, warning: null };

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
        if (m[i][i] === 0) return { eq: "y = Linear/Constant", r2: "N/A", adjR2: "N/A", aic: "N/A", n, lowConfidence: false, impliesNegative: false, warning: null };
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
    const predict = (xi) => a * xi * xi + b * xi + c;
    const { ssTot, ssRes } = sumOfSquares(x, y, predict);
    let r2 = computeR2(ssTot, ssRes);
    const adjR2 = computeAdjustedR2(r2, n, 2);
    const aic = computeAIC(ssRes, n, 3);

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
        eq: `y = ${formatSigFig(a)}x² ${b >= 0 ? '+' : ''} ${formatSigFig(b)}x ${c >= 0 ? '+' : ''} ${formatSigFig(c)}`,
        r2: r2.toFixed(4),
        adjR2: adjR2 !== null ? adjR2.toFixed(4) : 'N/A',
        aic: isFinite(aic) ? aic.toFixed(2) : (aic === -Infinity ? '-Infinity (perfect fit)' : 'N/A'),
        n,
        lowConfidence: false,
        impliesNegative,
        warning: impliesNegative
            ? `This fitted curve predicts a negative value (as low as ${minYInRange.toFixed(2)}) within the displayed range — not physically possible for a quantity like time, speed, distance, or count. Treat this fit with caution.`
            : null
    };
}

// Fits both models and reports which AIC prefers. Does not silently pick
// one — the caller displays both fits; this only adds a label. Ties or
// missing AICs (e.g. quadratic blocked below n=5) are reported plainly
// rather than defaulting to either model.
function compareModels(xData, yData) {
    const linear = fitLinearModel(xData, yData);
    const quadratic = calculatePolyReg(xData, yData);

    let preferred = 'Neither (insufficient data for at least one model)';
    // parseFloat('-Infinity (perfect fit)') correctly parses to -Infinity
    // in JS (parseFloat recognises the "Infinity" token) — a genuine
    // perfect fit, not a missing one. "was this model fitted at all" is
    // therefore "not NaN", not "is finite": isFinite(-Infinity) is false,
    // which would otherwise misclassify every perfect fit as unfitted.
    const linAic = parseFloat(linear.aic);
    const quadAic = parseFloat(quadratic.aic);
    const linFitted = !isNaN(linAic);
    const quadFitted = !isNaN(quadAic);
    if (linFitted && quadFitted) {
        if (linAic === quadAic) preferred = 'Tied (AIC equal)';
        else if (isFinite(linAic - quadAic) && Math.abs(linAic - quadAic) < 1e-9) preferred = 'Tied (AIC equal)';
        else preferred = linAic < quadAic ? 'Linear (lower AIC)' : 'Quadratic (lower AIC)';
    } else if (linFitted && !quadFitted) {
        preferred = 'Linear (quadratic not fitted)';
    } else if (!linFitted && quadFitted) {
        preferred = 'Quadratic (linear not fitted)';
    }

    return { linear, quadratic, preferred };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculatePolyReg, fitLinearModel, compareModels, formatSigFig, computeAdjustedR2, computeAIC };
}
