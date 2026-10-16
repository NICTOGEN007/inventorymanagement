# Project report

`Project_Report.docx` (editable) and `Project_Report.pdf` are the Major Project report in the
department's VTU format.

Before submitting, fill in the parts highlighted in yellow: each member's USN and the guide's name.

## Rebuilding

`source/` holds the generator: report text (`content.js`, `literature.js`), the Word builder
(`build.js`) and the screenshots, charts, diagrams and code images it uses.
`source/make.sh` rebuilds the report and fills in the page numbers. It needs the `docx` npm package,
LibreOffice and Poppler.
