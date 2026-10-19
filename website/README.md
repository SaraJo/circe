# Circe docs site

The [Docusaurus](https://docusaurus.io) site published to GitHub Pages at
https://sarajo.github.io/circe/.

Pages are generated from the repository's Markdown, so edit the original files
(`INSTALL.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/ONBOARDING.md`,
`docs/WINDOWS.md`, `docs/BETA_TEST.md`). `scripts/sync-docs.mjs` copies them
into `website/docs/` and rewrites their links before every `start` and `build`.
Only `docs/intro.md` and the homepage in `src/pages/` live here.

```bash
cd website
npm ci
npm start        # local preview with hot reload
npm run build    # production build into website/build
npm run serve    # serve the production build
```

`.github/workflows/pages.yml` builds the site on pull requests and deploys it
on pushes to `main`.
