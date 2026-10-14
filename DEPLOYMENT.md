# Deploy SwitchLab

This repository contains the React/TypeScript source, numerical solver, verification tests and Render Blueprint. It requires Node.js 24 and pnpm 11.25.0. No runtime backend, database or secret environment variables are required.

## Render

Connect this GitHub repository to Render and create a Blueprint using render.yaml. The service is a static site named switchlab. The build installs pinned dependencies from pnpm-lock.yaml, type-checks, runs both verification suites and generates dist/. Render publishes dist/.

For manual static-site setup:

- Branch: main
- Root directory: leave blank
- Build command: npx --yes pnpm@11.25.0 install --frozen-lockfile && npm run check && npm test && npm run build
- Publish directory: dist
- Environment: NODE_VERSION=24

The website will be publicly accessible at its assigned Render URL. A private GitHub repository requires the Render GitHub integration to have access to that repository. Saved cases stay in each visitor's browser storage; cases saved in the standalone local file are not automatically transferred to the hosted website.

## Local development

Run pnpm install --frozen-lockfile, pnpm build, then pnpm dev. The local server is http://127.0.0.1:5173. Run pnpm check and pnpm test for verification.

## References

- https://render.com/docs/static-sites
- https://render.com/docs/blueprint-spec
