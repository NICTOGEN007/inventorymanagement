# Project report

`Project_Report.docx` (editable) and `Project_Report.pdf` are the Community Project report in the
department's VTU format.

`First_Review_Report.docx` and `First_Review_Report.pdf` are the same report for the first review:
the front pages, Chapter 1 (Introduction), Chapter 2 (Literature Survey) and Chapter 3 up to
3.3 Methodology, then the references.

The cover, certificate and declaration carry the members' USNs and the guide's name.

## Rebuilding

`source/` holds the generator: report text (`content.js`, `literature.js`), the Word builder
(`build.js`) and the screenshots, charts, diagrams and code images it uses.
`source/make.sh` rebuilds the report and fills in the page numbers. It needs the `docx` npm package,
LibreOffice and Poppler.

For the first-review version, run `OUT=out/first-review REPORT_UPTO=methodology source/make.sh`;
`source/first-review.js` decides what is kept.
