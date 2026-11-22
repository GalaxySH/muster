# form-sheet

Bound Apps Script for a Google Form response sheet: **Muster > Copy response for Muster**
copies one response row (answers plus embedded uploads) to the clipboard for pasting into
Muster's per-student page. Install steps, field keys, the payload format and the Muster-side
design are in [`docs/form-paste.md`](../../docs/form-paste.md).

Installed on the 2026 Fall Post-WW Orientation response sheet
(`1gwAtkojZ4EAL25b9jdY9wBzAtOyLd2dG7N3SvbcIGWA`) as script
`1m_qeNwkAq6PCMKyr5iqmkXD6TD9LNDF082S2Xn3O-T5WQrSXHnxuyZNV`. Deploy changes with
`cd ../forms-tool && npm run script-push -- <scriptId> ../muster/integrations/form-sheet`
(the push replaces every file in the project).
