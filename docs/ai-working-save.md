# AI working save API

This workflow replaces MCP proposals. It is backend/MCP only: the current frontend is not
rewritten. Legacy human proposal endpoints still review historical proposals; creating a new
proposal through `/ai/mcp/proposals` returns 410. Deploy the new MCP and Backend together and
apply the `ai_working_save` migration before starting them.

## State and permissions

Each project has one persistent `AiWorkspace`: a common base, an AI draft, a monotonically
increasing revision, and an optional pending human review. Both saves are complete native Yjs
states, including samples, bounded to 16 MiB decoded. The engine's `Game` model reads/restores
them. They are stored in PostgreSQL, survive restarts, and are never uploaded to the project's
ordinary save storage by an assistant operation. Keys remain account-owned, project-scoped by
`X-Naucto-Project`, and cannot access projects the account does not own.

Every MCP write uses a compare-and-swap revision. Stale or concurrent writers get 409 and must
reread. Human reviews freeze the draft until confirmed or cancelled. Raw AI imports are restricted
to game content: human locks and historical receipts cannot be replaced by an assistant save.
Prepared human reviews also check the current document's locked pixels/map cells.

## MCP tools

- `read_project`, `read_code`, `read_sound`, `read_sheet_region`, `read_map_region`: default to
  `source: "draft"`; choose `base` or `latest` to inspect the common ancestor or last user save.
- `read_save`: complete base64 snapshot, revision, context and pending review id. Includes samples.
- `write_code`: create/replace a file; `remove_code`: remove it under engine rules.
- `write_pixels`, `write_tiles`, `write_sound`: edit native resources through the engine classes.
- `save_project`: CAS write of a full snapshot **or** a batch of native editor operations. Batches
  are commands against the working save, not proposals; they persist immediately in that save.
- Existing drawing/composition tools still produce drafts/operations to pass to `save_project`.
- `compare_saves`: hashes, changed units and conflicts between base, draft and latest user save.
- `merge_latest_save`: revision + `latestHash` from compare, plus optional `{ unitId: "draft" |
  "latest" }` resolutions. No write if any conflict remains or if the user save changed meanwhile.

There is no MCP tool for human review, approval, publication, or writing the ordinary user save.
A user save still means the latest persisted state, not unsaved edits in open browsers.

## Merge model

This is a semantic three-way merge, not `Y.applyUpdate(oldDraft, current)` over two editing histories.
Only the content delta is restored through `Game.restoreFrom` into the destination document.
Unchanged AI units take user edits; AI-only changes are retained; identical edits converge;
different edits to the same unit require a choice. Deletion versus editing is a conflict too.

Units are `code:<fileId>`, `graphics`, `sound`, `network` and `metadata`. Sound is a complete bank
(samples/instruments/patterns/songs/SFX). Graphics includes palette/sheets/maps/geometry/catalog
and level briefs: sprite renumbering can otherwise break maps or catalog references. These banks
are intentionally conservative. Edits to separate code files merge automatically; edits within
one file are resolved by the assistant reading both versions and rewriting its draft.

For a large user music import, resolve `sound` to `latest` to copy its entire bank with all binary
samples, while retaining independent AI code. To combine both musical ideas instead, inspect both
sources, edit the draft with `write_sound`/`save_project`, then resolve the bank to `draft`.

## Future frontend contract (JWT, project owner or collaborator)

1. `GET /ai/projects/:projectId/workspace` reads the AI snapshot and revision. This does not apply it.
2. `POST .../workspace/preview` with `{ revision, snapshot }` compares against the editor's actual
   current Yjs state (base64), including unsaved work. Returns `latestHash` and changed units.
3. `POST .../workspace/review` with `{ revision, snapshot, currentHash: latestHash, accepted: [ids],
   rejected: [ids], resolutions?: { id: "draft" | "latest" } }`. No implicit decision is made for
   unlisted units. It returns `{ reviewId, revision, snapshot, requiresSaveConfirmation: true }`.
   A resolution is mandatory for accepted conflicts. Refused changes do not enter the result.
4. Apply the returned full state locally with Yjs and save through the normal project save API,
   then call `POST .../workspace/reviews/:reviewId/confirm`. Confirmation requires the receipt to
   appear in the actual stored user save. It atomically resets accepted/rejected AI work to the
   reviewed user state, keeps unreviewed edits and their original conflict base, and rebases on
   later user edits. A repeated confirmed request is idempotent. Provenance is recorded on normal
   save from the server's review record, even if confirmation is delayed.
5. For an abandoned **unsaved** review, discard its returned snapshot in every local retry path,
   then `POST .../workspace/reviews/:reviewId/cancel`. Never cancel after uploading that snapshot;
   confirm it instead. Cancellation does not undo content already delivered to a browser.

Do not mark acceptance complete before ordinary saving and confirmation succeed. On interruption,
GET workspace exposes `pendingReviewId`: `GET .../workspace/reviews/:reviewId` recovers the exact
prepared snapshot and status. Retry its ordinary save and confirmation, or deliberately
abandon the unsaved review. There is no TTL that silently discards a user's review in flight.

Whole-state Yjs application carries dependencies to other collaborators. It is not an exclusive
lock on their live document: concurrent browser edits remain governed by Yjs. A final saved state
can include edits newer than the review; confirmation preserves them or exposes a later conflict.

The OpenAPI document describes all request/response DTOs. No frontend files or UI design are changed.
