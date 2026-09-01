# Vendored libraries

These three files are committed to the repository and loaded locally
(`<script src="vendor/...">` in `index.html`), not fetched from a CDN at
runtime. This is what makes the "runs entirely on the analyst's own
machine, no server" claim (Section 1/3.3 of the JSALT manuscript) a
checkable property of the repository rather than an assertion — see
`tests/vendorIntegrity.test.js`, which recomputes the checksums below and
fails if a vendored file changes without this manifest changing.

An `integrity` (Subresource Integrity) attribute was deliberately NOT
added to these `<script>` tags. SRI verifies that a resource fetched from
a **third-party origin** hasn't been tampered with in transit; it says
nothing for a same-origin file the installer already ships, since anyone
who can modify `vendor/chart.umd.min.js` can modify the `index.html` that
carries the hash right next to it. What actually establishes provenance
for a vendored file is what this manifest plus the checksum test do:
recorded exact versions and checksums, checked against the file as
committed, every test run.

| File | Library | Exact version | SHA-256 (as committed) | Size (bytes) | Vendored |
|---|---|---|---|---|---|
| `chart.umd.min.js` | [Chart.js](https://www.chartjs.org) | 4.4.4 | `b38076762f7363bc9e912b68b8e034826798db5df26bb61f000ec2e7a3137bc7` | 205749 | repo's first commit |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | `98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875` | 364463 | repo's first commit |
| `html2canvas.min.js` | [html2canvas](https://html2canvas.hertzen.com) | 1.4.1 | `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb` | 198689 | repo's first commit |

Exact version and checksum confirmed directly from each file: Chart.js's
own minified header states `Chart.js v4.4.4` and a comment left by the
build process names its source as `/npm/chart.js@4.4.4/dist/chart.umd.js`
(a jsDelivr CDN path — the file was fetched from there once, at build
time, then committed, not fetched at runtime). jsPDF's own header states
`Version 2.5.1`. html2canvas's own header states `html2canvas 1.4.1`. All
three checksums were computed directly from the files as committed to this
repository (Node's `crypto.createHash('sha256')`), not copied from an
upstream advisory.

For reference, the same released versions can be found at:
- `https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js`
- `https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js`
- `https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js`

These URLs are given so the exact released version can be independently
verified against a public distribution; this project does not fetch them
at runtime, and doing so is not required to build, run, or verify anything
in this repository.

## Updating a vendored file

1. Download the new version from its official source.
2. Replace the file in this directory.
3. Update this table (version, checksum, size) — compute the new SHA-256
   with `node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('vendor/<file>')).digest('hex'))"`.
4. Run `npm test` — `tests/vendorIntegrity.test.js` will fail until the
   manifest and the file agree.
