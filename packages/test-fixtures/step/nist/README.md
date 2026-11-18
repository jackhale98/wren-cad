# NIST MBE PMI test models (STEP AP242)

STEP AP242 files with semantic and presentation PMI from the NIST MBE PMI Validation and
Conformance Testing project, used by Wren's M5 PMI import tests (PLAN §12 M5, ADR-100).

## Source and licence

- **Source:** NIST, "NIST PMI STEP Files",
  <https://www.nist.gov/document/nist-pmi-step-files> (redirects to
  `NIST-PMI-STEP-Files.zip`, dated 2024-06-19, 13 976 599 bytes, SHA-256
  `8fa78429e6d8d9b0d7681d223b6aa9ec98c3772185c55b1a0e3679b21c181911`), from the project page
  <https://www.nist.gov/ctl/smart-connected-systems-division/smart-connected-manufacturing-systems-group/mbe-pmi-0>.
- **Licence:** the project page states: "The test cases, CAD models, and STEP files can be used
  without any restrictions." NIST asks for acknowledgement and does not allow its logo in
  promotional material (no logo is used or shipped). As works of the US Government they are also
  not subject to copyright in the US (17 U.S.C. §105). Recorded in `docs/DEPENDENCIES.md`
  (test fixtures, not shipped in the app).
- **Acknowledgement:** test models courtesy of the National Institute of Standards and
  Technology (NIST), MBE PMI Validation and Conformance Testing project. Use does not imply NIST
  endorsement of Wren.
- `NIST-README.txt` is the zip's own README, unchanged. NIST notes these are not error-free
  reference files: the STEP File Analyzer reports some syntax errors in them.

## Files

Gzipped (`gzip -9n`, the tests decompress with fflate) to keep the repository small. SHA-256 of
the uncompressed files:

| File | Edition | SHA-256 (uncompressed) |
| --- | --- | --- |
| `nist_ctc_01_asme1_ap242-e1.stp.gz` | AP242 ed. 1 | `85a5752da05f53c456ca3a9e038c90358e1d5a3141d1f0d6e5f0970f2356e821` |
| `nist_ctc_03_asme1_ap242-e2.stp.gz` | AP242 ed. 2 | `196b665776e759282f80fc8fb27d7bceb995df77cf78b7ce48347535a4d6cb5f` |
| `nist_ctc_05_asme1_ap242-e1.stp.gz` | AP242 ed. 1 | `59bbc09a34621c03106e4c1b2a5bc909fdb67463117c16c4965ee7a6fe5c1521` |
| `nist_stc_06_asme1_ap242-e3.stp.gz` | AP242 ed. 3 | `71777c28da76da0e8a667e4cbe792d5f72c09b5c56440c9744d3d50ca96ecc8d` |

CTC = Combined Test Case, STC = Simplified Test Case (ASME Y14.5). The other files of the zip
(CTC 02 and 04, FTC 06–11, STC 07–10, the AP203 and geometry-only files, the PDF drawings) are not
committed (about 40 MB); download the zip above to run them by hand. The PDF drawings in the zip
show the expected PMI of each model.

## Tests

- `packages/io/test/pmi-nist.test.ts`: each file is AP242 with semantic and presentation PMI
  (entity census, `stepPmiCensus`).
- `packages/kernel-client`: reading them into annotations needs the kernel façade's PMI reader
  (marker `FACADE-PMI-PENDING`); what OCCT cannot read is listed per entity, see
  `docs/PMI_VALIDATION.md`.
