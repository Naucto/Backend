# @naucto/api-client

Typed `fetch` client for the Naucto backend, generated from the committed
[`swagger.json`](../swagger.json) with [`@hey-api/openapi-ts`](https://heyapi.dev). The
`@hey-api/client-fetch` runtime is bundled, so the package has no runtime dependencies.

`src/` and `dist/` are **generated and gitignored** — never edit them by hand. The contract is
defined by the backend controllers + DTOs + Swagger decorators.

## Install (GitHub Packages)

```ini
# .npmrc
@naucto:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}   # PAT with read:packages
```

```sh
npm install @naucto/api-client            # latest release (tag api-client/vX.Y.Z)
npm install @naucto/api-client@next       # latest build of main (X.Y.Z-main.N)
npm install @naucto/api-client@pr-42      # build of pull request #42
```

## Usage

```ts
import { client, projectControllerFindAll } from "@naucto/api-client";

client.setConfig({ baseUrl: "https://api.naucto.net", credentials: "include" });
client.interceptors.request.use((request) => {
  request.headers.set("Authorization", `Bearer ${accessToken}`);
  return request;
});

const { data, error } = await projectControllerFindAll();
```

## Publishing

`.github/workflows/api-client.yml` regenerates and publishes the package:

| Trigger | Version | npm dist-tag |
|---|---|---|
| tag `api-client/vX.Y.Z` | `X.Y.Z` (must match `client/package.json`) | `latest` |
| push to `main` | `X.Y.Z-main.N` | `next` |
| pull request #N | `X.Y.Z-pr.N.M` | `pr-N` (install line commented on the PR) |

Bump `version` in `client/package.json` in the PR that changes the contract, then tag
`api-client/vX.Y.Z` on `main` to cut a release.

## Local build

```sh
npm run generate:client   # swagger.json -> client/src
npm run client:build      # client/src -> client/dist
```
