// Trims the report to the first-review chapters: Introduction, Literature Survey and the
// Proposed System up to and including 3.3 Methodology. References stay.
// Used when the build runs with REPORT_UPTO=methodology (see make.sh).

/** Sentences that point at figures and tables of the chapters left out. */
const REWORDS = [
  ['stores the collections listed in Table 3.2.', 'stores the users, products, stock movements, purchase orders, sales and other collections.'],
  [' (Fig 5.3)', ''],
];

module.exports = function firstReview(content) {
  content.chapters = content.chapters.slice(0, 3);
  const proposed = content.chapters[2];
  const end = proposed.blocks.findIndex((b) => b[0] === 'h2' && b[1] === '3.4');
  if (end === -1) throw new Error('Section 3.4 not found: update first-review.js');
  proposed.blocks = proposed.blocks.slice(0, end);

  const used = new Set();
  const reword = (value) => {
    if (typeof value === 'string') {
      let out = value;
      for (const [from, to] of REWORDS) {
        if (out.includes(from)) {
          out = out.replace(from, to);
          used.add(from);
        }
      }
      return out;
    }
    return Array.isArray(value) ? value.map(reword) : value;
  };
  for (const ch of content.chapters) ch.blocks = ch.blocks.map(reword);
  for (const [from] of REWORDS) {
    if (!used.has(from)) throw new Error(`Text not found, update first-review.js: ${from}`);
  }
  return content;
};
