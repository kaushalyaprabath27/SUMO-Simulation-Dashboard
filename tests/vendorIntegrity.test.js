// Confirms the vendored third-party libraries (vendor/README.md) haven't
// changed without the manifest changing too — the property SRI is normally
// used for, applied instead to a same-origin vendored file (see
// vendor/README.md for why SRI itself doesn't apply here). Uses Node's
// built-in crypto, no new dependency. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Kept in sync with vendor/README.md's table by hand — if you update a
// vendored file, update both.
const EXPECTED = {
    'chart.umd.min.js': {
        version: '4.4.4',
        sha256: 'b38076762f7363bc9e912b68b8e034826798db5df26bb61f000ec2e7a3137bc7',
        size: 205749,
    },
    'jspdf.umd.min.js': {
        version: '2.5.1',
        sha256: '98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875',
        size: 364463,
    },
    'html2canvas.min.js': {
        version: '1.4.1',
        sha256: 'e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb',
        size: 198689,
    },
};

for (const [file, expected] of Object.entries(EXPECTED)) {
    test(`vendor/${file}: checksum and size match the manifest in vendor/README.md`, () => {
        const filePath = path.join(__dirname, '..', 'vendor', file);
        assert.ok(fs.existsSync(filePath), `${file} is missing from vendor/`);
        const buf = fs.readFileSync(filePath);
        assert.equal(buf.length, expected.size, `${file} size changed — update vendor/README.md and this test if this was an intentional version bump`);
        const actualHash = crypto.createHash('sha256').update(buf).digest('hex');
        assert.equal(actualHash, expected.sha256, `${file} checksum changed — update vendor/README.md and this test if this was an intentional version bump`);
    });
}

test('every file vendor/README.md documents actually loads from index.html', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    for (const file of Object.keys(EXPECTED)) {
        assert.ok(indexHtml.includes(`vendor/${file}`), `index.html no longer references vendor/${file}`);
    }
});

test('no CDN script tag loads any of the three vendored libraries at runtime', () => {
    // The whole point of vendoring: index.html should never fetch chart.js,
    // jspdf, or html2canvas from an external origin.
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const scriptSrcs = [...indexHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
    const externalScripts = scriptSrcs.filter(src => /^https?:\/\//i.test(src));
    assert.deepEqual(externalScripts, [], `expected no externally-loaded <script> tags, found: ${JSON.stringify(externalScripts)}`);
});
