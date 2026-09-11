# Paper introduction and figure sources

The local introduction follows the reading order of 3DCodeBench: explain the
problem and method before asking a reader to use an interactive example. Copy
is based on the active manuscript in `paper-overleaf/main.tex`, which includes
`sec/0_abstract.tex`, `sec/1_intro.tex`, and `sec/3_treestruct3d.tex`.

The similarly named `sec/4_treestruct3d.tex` and `sec/3_ground_truth.tex` are
older, inactive drafts. Their description of the generation inputs must not be
used. The active method predicts a part tree from text; reference programs and
automatically derived comparison trees are reserved for evaluation.

Figure assets come from `paper-overleaf/figures/` and are served from
`public/paper-figures/`:

- `fig_3dcodebench_vs_treestruct3d_pipeline.pdf`: unchanged original used for
  Figure 2 in the supplied paper, with bird renders and the body 0.4× / feet
  1.6× examples. The homepage displays a 2600 × 1358 PNG rendered directly
  from this PDF using `pdftoppm -png -singlefile -scale-to 2600`. Clicking the
  image opens an in-page enlarged preview; the original PDF is retained as an
  asset. The older SVG shows a table example and does not match
  the paper; it must not be used as an equivalent vector version.
- `fig_shared_anchor_mechanism.png`: attachment behavior with and without
  recomputation after resizing the parent, copied unchanged. Retained as an
  asset but removed from the homepage at the owner's request pending a new layout.
- `fig_lobster_anchor_tree_full.png`: active exploded hierarchy with yellow
  anchor endpoints, copied unchanged. Retained as an asset but removed from
  the homepage alongside the shared-anchor mechanism section.
- `fig_qualitative_paired.png`: selected baseline/method editing comparisons,
  copied unchanged, with the same in-page enlarged preview.

Both visible figures use a native modal dialog. Readers can switch between a
window-fitting view and the original image dimensions, scroll the enlarged
image, and dismiss it with Escape, the close button, or the surrounding backdrop.

Illustrative scales are 0.4× and 1.6×. In-loop validation uses 1.35×, while
held-out quantitative evaluation uses 0.8× and 1.2×. The introduction does not
substitute a qualitative example for an aggregate result.

The supplied `3DV2027_Structural_3DCodebench .pdf` is also an anonymous review
copy. Its title and method match the introduction; it has no real author or
affiliation list. On September 11, 2026, the project owner supplied the author
list from the submission record, in this order: Ruiding Feng, Sen Zhang,
Danrui Li, Bingjiang Xia, ZHIJIN ZHU, Mubbasir Kapadia. The homepage displays
that exact order and spelling below the paper title. Affiliations were not
provided, so the page does not add them or claim conference acceptance.

For local review, the Paper button opens `public/papers/treestruct3d.pdf`, an
unchanged copy of that supplied 18-page PDF. The PDF and website changes have
not been pushed or deployed. They require owner review before any remote
publication.
