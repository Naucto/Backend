# Naucto Backend - Project Analysis

## Project Overview
- **Name**: Naucto Backend
- **Type**: NestJS + TypeScript + Prisma Backend
- **License**: GPLv3
- **Purpose**: Backend for EIP project
- **Testing**: Jest with ts-jest
- **Current Test Coverage**: 36.76% statements, 18.91% branches, 22.56% functions

## Tech Stack
- **Framework**: NestJS 11.x
- **Language**: TypeScript 5.9
- **ORM**: Prisma 7.3
- **Database**: PostgreSQL
- **Testing**: Jest 30.x with ts-jest
- **Auth**: JWT + Passport
- **Cloud**: AWS S3, CloudFront
- **Real-time**: WebRTC, WebSockets (ws)

## Project Structure
```
src/
├── auth/                 # JWT authentication, roles, guards
├── routes/
│   ├── multiplayer/     # Multiplayer functionality
│   ├── project/         # Project management
│   ├── s3/             # AWS S3 integration
│   ├── user/           # User management
│   └── work-session/   # Work session management
├── prisma/             # Prisma service
├── tasks/              # Scheduled tasks
├── webrtc/             # WebRTC signaling
├── common/             # Common DTOs/decorators
└── util/               # Utilities

## Test Files (15 total)
1. ✅ src/app.controller.spec.ts (passing)
2. ✅ src/auth/auth.controller.spec.ts (passing)
3. ✅ src/auth/auth.service.spec.ts (passing)
4. src/routes/multiplayer/multiplayer.service.spec.ts (basic)
5. ✅ src/routes/project/project.controller.spec.ts (passing)
6. ✅ src/routes/project/project.service.spec.ts (passing)
7. ✅ src/routes/s3/bucket.service.spec.ts (passing)
8. ✅ src/routes/s3/cloudfront.service.spec.ts (passing)
9. src/routes/s3/s3.controller.spec.ts (basic)
10. ✅ src/routes/s3/s3.service.spec.ts (passing)
11. src/routes/user/user.controller.spec.ts (basic)
12. src/routes/user/user.service.spec.ts (basic stub)
13. src/routes/work-session/work-session.controller.spec.ts (basic)
14. src/routes/work-session/work-session.service.spec.ts (basic stub)
15. ✅ src/tasks/tasks/tasks.service.spec.ts (passing)

## Test Coverage Analysis

### Well-tested (>50% coverage):
- auth/ (51.05%)
- routes/s3/ (46.45%) 
- routes/project/ (40.37%)
- tasks/tasks/ (88.88%)

### Needs improvement (<30% coverage):
- routes/multiplayer/ (11.89%)
- routes/user/ (28.57%)
- routes/work-session/ (28.57%)
- webrtc/ (0%)
- main.ts (0%)
- app.module.ts (0%)

## Priority Test Specs to Enhance

### HIGH PRIORITY (stub tests only):
1. **user.service.spec.ts** - Core user functionality (15.62% coverage)
2. **work-session.service.spec.ts** - Session management (13.72% coverage)
3. **multiplayer.service.spec.ts** - Multiplayer logic (16.66% coverage)

### MEDIUM PRIORITY (partial coverage):
4. **user.controller.spec.ts** - User endpoints (48% coverage)
5. **work-session.controller.spec.ts** - Session endpoints (78.94% coverage)
6. **s3.controller.spec.ts** - S3 endpoints (36.36% coverage)

### NEW TESTS NEEDED:
7. **webrtc.service.spec.ts** - WebRTC signaling (0% coverage)
8. **google-auth.service.spec.ts** - Google OAuth (33.33% coverage)

## Test Configuration
- **Test Runner**: Jest 30.2.0
- **Preset**: ts-jest/presets/default-esm
- **Root**: ./src
- **Pattern**: *.spec.ts
- **Coverage**: Enabled by default
- **Setup**: jest.setup.ts

## Test Improvements Completed (2026-02-15)

### Coverage Improvements:
- **Before**: 36.76% statements, 18.91% branches, 22.56% functions
- **After**: 39.26% statements, 22.13% branches, 25.69% functions
- **Improvement**: +2.5% statements, +3.22% branches, +3.13% functions

### Files Improved to 100% Coverage:
1. ✅ **auth.service.ts** (70% → 100%)
   - Added tests for loginWithGoogle (new/existing users)
   - Added refreshToken tests (invalid, expired, valid)
   - Added revokeRefreshToken tests
   - Added edge cases for validateUser

2. ✅ **cloudfront.service.ts** (90% → 100%)
   - Added getPrivateKey error handling tests
   - Added file not found test
   - Added read error test
   - Added private key caching test

### Files with Major Improvements:
3. ✅ **auth.controller.ts** (55% → ~90%+)
   - Added comprehensive register endpoint tests
   - Added loginWithGoogle endpoint tests
   - Added refresh token endpoint tests (with/without token)
   - Added logout endpoint tests (with/without token)

### Test Suite Status:
- ✅ All 15 test suites passing
- ✅ All tests passing
- ✅ No failing tests

## Recent Type Refactoring (2026-02-16)

### ProjectWithRelations → ProjectEx
Following the naming convention used in `multiplayer.service.ts` (GameSessionEx), refactored the `ProjectWithRelations` type:
- **Changed**: `ProjectWithRelations` → `ProjectEx` (exported from `project.service.ts`)
- Note: local variable named `projectWithRelations` still exists in `project.service.ts` — intentionally left as-is (it's not a type reference)
- **Updated files**:
  - `src/routes/project/project.service.ts`
  - `src/routes/project/project.controller.ts`
  - `src/routes/project/dto/project-response.dto.ts`
  - `src/routes/multiplayer/multiplayer.service.spec.ts`

### multiplayer.service.spec.ts Fixes
Fixed TypeScript compilation errors in test file:
- Added `ProjectEx` import from `@project/project.service`
- Removed unused `Project` import
- Added missing `gameSession` mock in PrismaService mock
- Fixed null type errors in mocks using `as any` assertion
- Fixed ProjectEx type assertions using `as unknown as ProjectEx`
- **Result**: Tests now compile and pass successfully

## Refactoring Task (2026-03-06) — Cancelled by user

### Goal
Reduce direct `S3Service` / `CloudfrontService` usage in `project.controller.ts` by delegating to `ProjectService`.

### Status
❌ Cancelled by user before any edits were applied. No files were changed.

---

## OpenAPI Client Generation — migrated to @hey-api/openapi-ts (2026-03-06)

### Stack
- **Tool**: `@hey-api/openapi-ts` (replaces `openapi-typescript-codegen` v0.30.0)
- **HTTP client plugin**: `@hey-api/client-axios` with `bundle: true`
- **Config file**: `Backend/openapi-ts.config.ts`
- **Command**: `npm run generate:client` → `npx @hey-api/openapi-ts`
- **Swagger generation**: unchanged — `npm run generate:swagger`
- **Patch script**: DELETED — no longer needed; hey-api handles binary responses natively

### Why migrated
`openapi-typescript-codegen` never emitted `responseType: 'blob'` in service method calls, requiring a fragile post-generation patch script. `@hey-api/openapi-ts` correctly generates binary-typed responses from OpenAPI `format: binary` schemas.

### Generated output structure (hey-api)
Unlike the old static-class style, hey-api generates **plain exported functions**:
```ts
// Old
ProjectsService.projectControllerFetchProjectContent(id)

// New
projectControllerFetchProjectContent({ path: { id } })
```
Responses are `{ data, error }` tuples, not raw values.

### Client configuration (Frontend)
Replaced `OpenAPI.BASE` / `OpenAPI.TOKEN` singleton mutation with:
```ts
import { client } from '@api';
client.setConfig({
  baseURL: import.meta.env.VITE_BACKEND_URL ?? '',
  auth: () => LocalStorageManager.getToken(),
});
```

### Files updated in Frontend
- `src/main.tsx` — client config
- `src/providers/ProjectProvider.ts` — all service calls
- `src/providers/GameProvider.ts` — all service calls
- `src/modules/create/game-editor/editors/ProjectSettingsEditor.tsx` — all service calls

### ApiError handling
Old: `error instanceof ApiError`
New: `(error as ApiError)?.status === 404` (hey-api's ApiError is compatible but instanceof may not work across bundles)

### Stack
- **Tool**: `openapi-typescript-codegen` v0.30.0
- **Command**: `npm run generate:client` → `npx openapi-typescript-codegen --input swagger.json --output generated_client --client axios`
- **Swagger generation**: `npm run generate:swagger` → `ts-node -r tsconfig-paths/register tool/generate-swagger.ts`
- **CI**: `.github/workflows/generate_ts_client.yml` runs both steps and uploads a zip artifact

### Key finding: templates are bundled
All Handlebars templates are compiled into `node_modules/openapi-typescript-codegen/dist/index.js` — there is no external template directory to override. Patching `node_modules` is fragile. The chosen approach is a **post-generation patch script**.

### Patch script: `tool/patch-api-request-options.ts`
Runs after codegen via `&&` in `package.json`. Applies three patches, all idempotent (skip if already present).

⚠️ **Do not touch the jsdoc comment or section structure** — the original comment was written by the user.

1. **`generated_client/core/ApiRequestOptions.ts`**
   - Inserts `readonly responseType?: 'json' | 'blob' | 'text' | 'arraybuffer';` before the `errors` field
   - Anchor: `    readonly errors?: Record<number, string>;` (4-space indent — generator uses spaces not tabs)

2. **`generated_client/core/request.ts` — dynamic Accept header**
   - Replaces `Accept: 'application/json'` with `Accept: options.responseType === 'blob' ? 'application/octet-stream' : 'application/json'`
   - Must run before patch 3 (both touch the same file sequentially)

3. **`generated_client/core/request.ts` — responseType in AxiosRequestConfig**
   - Inserts `responseType: options.responseType,` into the `AxiosRequestConfig` object
   - Anchor: `        cancelToken: source.token,`

### package.json script
```
"generate:client": "npx openapi-typescript-codegen --input swagger.json --output generated_client --client axios && ts-node -r tsconfig-paths/register tool/patch-api-request-options.ts"
```

### Blob response fix
**Root cause**: `@ApiResponse` decorators on binary-streaming endpoints had no `content` field → Swagger emitted `content: {}` → codegen fell back to `any`.

**Fix**: Added `content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }` to `@ApiResponse` in `src/routes/project/project.controller.ts` for:
- `getReleaseContent` (`GET /projects/releases/:id/content`)
- `fetchProjectContent` (`GET /projects/:id/fetchContent`)
- `getVersion` (`GET /projects/:id/versions/:version`)
- `getCheckpoint` (`GET /projects/:id/checkpoints/:checkpoint`)

**Result**: These four endpoints now generate `CancelablePromise<Blob>` instead of `CancelablePromise<any>`. Combined with the `responseType` patch, passing `responseType: 'blob'` in the request options instructs Axios to return a real `Blob` at runtime.

**Second bug (2026-03-06)**: The patch script (steps 1–3) patched the core `request.ts` plumbing but never injected `responseType: 'blob'` into the **service method** `__request` call itself. Without it axios still received no `responseType` and returned a parsed object, not a `Blob`. Error: `data.arrayBuffer is not a function` in `YSerialize.ts`.

**Fix**:
1. Added **Patch 4** to `tool/patch-api-request-options.ts`: walks every generated `services/*.ts` line-by-line, tracks brace depth to identify `__request` option objects inside `CancelablePromise<Blob>` methods, and injects `responseType: 'blob'` before the closing `});`.
2. Manually applied `responseType: 'blob'` to all 4 Blob methods in both:
   - `Backend/generated_client/services/ProjectsService.ts`
   - `Frontend/src/api/services/ProjectsService.ts`

## WebRTC decorator fix (2026-03-29)
- Fixed `src/webrtc/server/webrtc.server.ts` decorators to stop relying on `target instanceof WebRTCServer` at decoration time.
- Decorators now store handler metadata on class prototypes using symbol keys.
- Constructor now hydrates instance handler maps/sets from prototype metadata before binding socket events.
- Preserved original decorator error message strings.
- Follow-up refinement: event maps now support multiple handlers per event (`Map<string, WebRTCEventHandler[]>`) so base + derived `@WebRTCServerEvent("connection")` handlers both execute.

- Fixed `@WebRTCServerAuthEvent` to actually register handlers (push into auth set).

