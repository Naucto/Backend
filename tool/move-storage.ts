/**
 * Copies every stored object from the key that carries an integer id to the key that carries the
 * UUID the row has now, and rewrites the addresses the database keeps of them. It reads
 * `LegacyIdMap`, so it runs after the migration that fills it, and before the application serves
 * from the new keys: a copy made later would bring back what a person removed since.
 *
 * It runs in the backend's runtime image, with the backend's environment (`S3_*`, `DATABASE_URL`):
 *
 *   npm run storage:move:build                      bundles it as build/move-storage.cjs
 *   docker cp build/move-storage.cjs <backend>:/app/
 *   docker exec <backend> node /app/move-storage.cjs            dry run: what it would do
 *   docker exec <backend> node /app/move-storage.cjs --apply    copies, then rewrites the addresses
 *   docker exec <backend> node /app/move-storage.cjs --check    every row owns its objects
 *   docker exec <backend> node /app/move-storage.cjs --purge-old
 *
 * The first three never delete or overwrite anything, and running them again does nothing more.
 * `--purge-old` deletes an object under an integer key only when an object sits under its UUID
 * key, and refuses to start unless every row owns what it should.
 */
import 'dotenv/config';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Client } from 'pg';

import { getEnv } from '../src/config/env';
import { databaseUrl } from '../src/prisma/database-url';
import { projectKeys } from '../src/routes/project/project-keys';

// The name of the model; the lint rule takes it for the role that reads the same.
// eslint-disable-next-line no-restricted-syntax
const USER = 'User';

export type Model = 'Project' | 'Report' | typeof USER;

interface KeyShape {
  model: Model;
  /** Captures what precedes the id, the id, and what follows it. */
  pattern: RegExp;
  /** Whether the application serves this kind of object to anyone. */
  publicRead: boolean;
}

/** Every key the application writes under the id of a row. Report screenshots are never public. */
const KEY_SHAPES: KeyShape[] = [
  { model: 'Project', pattern: /^(release\/)(\d+)()$/, publicRead: true },
  { model: 'Project', pattern: /^(projects\/)(\d+)(\/(?:image|clip))$/, publicRead: true },
  { model: 'Project', pattern: /^(save\/)(\d+)(\/.+)$/, publicRead: false },
  { model: 'Project', pattern: /^(checkpoint\/)(\d+)(\/.+)$/, publicRead: false },
  { model: 'Project', pattern: /^(withheld\/)(\d+)(\/(?:release|cover|clip))$/, publicRead: false },
  { model: 'Report', pattern: /^(reports\/)(\d+)(\/.+)$/, publicRead: false },
  { model: USER, pattern: /^(users\/)(\d+)(\/(?:profile|background))$/, publicRead: true },
];

export interface LegacyKey {
  model: Model;
  legacyId: number;
  publicRead: boolean;
  /** The same key under another id. */
  keyFor: (id: string) => string;
}

/** What a key under an integer id belongs to; null for any other key. */
export function legacyKeyOf(key: string): LegacyKey | null {
  for (const { model, pattern, publicRead } of KEY_SHAPES) {
    const match = pattern.exec(key);
    if (match) {
      const [, before = '', legacyId = '', after = ''] = match;
      return {
        model,
        legacyId: Number(legacyId),
        publicRead,
        keyFor: (id) => `${before}${id}${after}`,
      };
    }
  }
  return null;
}

export interface StoredObject {
  key: string;
  etag: string;
}

/** The part of the object store the tool needs. */
export interface ObjectStore {
  /** Whether anyone can read the object without credentials. */
  isPublic(key: string): Promise<boolean>;
  /** Copies content, content type and metadata within the store; the copy is public or private. */
  copy(from: string, to: string, publicRead: boolean): Promise<void>;
  delete(key: string): Promise<void>;
}

export type IdMap = Map<string, string>;

const mapKey = (model: Model, legacyId: number): string => `${model}:${String(legacyId)}`;

export interface Move {
  from: string;
  to: string;
  publicRead: boolean;
  /** `differs` when the UUID key already holds something else: it is the newer one and stays. */
  state: 'to copy' | 'copied' | 'differs';
}

export interface Plan {
  moves: Move[];
  /** Objects under an integer id that no row had when the ids became UUIDs. */
  orphans: string[];
}

/**
 * What to do with every object under an integer key. An object is public under its new key only
 * if its kind is served to anyone and it is readable by anyone today.
 */
export async function planOf(
  store: ObjectStore,
  objects: StoredObject[],
  ids: IdMap,
): Promise<Plan> {
  const etags = new Map(objects.map((object) => [object.key, object.etag]));
  const plan: Plan = { moves: [], orphans: [] };

  for (const { key, etag } of objects) {
    const legacy = legacyKeyOf(key);
    if (!legacy) {
      continue;
    }
    const id = ids.get(mapKey(legacy.model, legacy.legacyId));
    if (id === undefined) {
      plan.orphans.push(key);
      continue;
    }

    const to = legacy.keyFor(id);
    const existing = etags.get(to);
    if (existing !== undefined) {
      plan.moves.push({
        from: key,
        to,
        publicRead: legacy.publicRead,
        state: existing === etag ? 'copied' : 'differs',
      });
      continue;
    }
    plan.moves.push({
      from: key,
      to,
      publicRead: legacy.publicRead && (await store.isPublic(key)),
      state: 'to copy',
    });
  }
  return plan;
}

/** A stored address that still names an integer id, and what it becomes. */
export interface AddressChange {
  table: 'Project' | 'Report';
  column: 'iconUrl' | 'screenshotKey';
  id: string;
  from: string;
  to: string;
}

export interface OwnerRow {
  id: string;
  legacyId: number;
}

export interface ProjectRow extends OwnerRow {
  iconUrl: string | null;
  clipVersion: string | null;
  publishedAt: Date | null;
  hiddenAt: Date | null;
}

export interface ReportRow extends OwnerRow {
  screenshotKey: string | null;
}

/** The addresses to rewrite: a cover's URL ends with its key, a screenshot's key is stored whole. */
export function addressChangesOf(projects: ProjectRow[], reports: ReportRow[]): AddressChange[] {
  const changes: AddressChange[] = [];

  for (const project of projects) {
    const oldKey = projectKeys.cover(String(project.legacyId));
    if (project.iconUrl?.endsWith(`/${oldKey}`)) {
      changes.push({
        table: 'Project',
        column: 'iconUrl',
        id: project.id,
        from: project.iconUrl,
        to: project.iconUrl.slice(0, -oldKey.length) + projectKeys.cover(project.id),
      });
    }
  }
  for (const report of reports) {
    const oldPrefix = `reports/${String(report.legacyId)}/`;
    if (report.screenshotKey?.startsWith(oldPrefix)) {
      changes.push({
        table: 'Report',
        column: 'screenshotKey',
        id: report.id,
        from: report.screenshotKey,
        to: `reports/${report.id}/${report.screenshotKey.slice(oldPrefix.length)}`,
      });
    }
  }
  return changes;
}

/**
 * What is wrong with the store as the rows describe it: each object a row should own, under its
 * UUID key, readable by whom it should be. An object missing under its integer key as well was
 * missing before, and is listed apart.
 */
export async function ownershipProblemsOf(
  store: ObjectStore,
  objects: StoredObject[],
  projects: ProjectRow[],
  reports: ReportRow[],
): Promise<{ problems: string[]; missingBefore: string[] }> {
  const keys = new Set(objects.map((object) => object.key));
  const problems: string[] = [];
  const missingBefore: string[] = [];

  const owns = async (key: string, legacyKey: string, publicRead: boolean): Promise<void> => {
    if (keys.has(key)) {
      if ((await store.isPublic(key)) !== publicRead) {
        problems.push(`${key} is ${publicRead ? 'not ' : ''}readable by everyone`);
      }
    } else if (keys.has(legacyKey)) {
      problems.push(`${key} is missing (${legacyKey} is not copied)`);
    } else {
      missingBefore.push(key);
    }
  };

  for (const project of projects) {
    const legacyId = String(project.legacyId);
    if (project.publishedAt && !project.hiddenAt) {
      await owns(projectKeys.release(project.id), projectKeys.release(legacyId), true);
    }
    if (project.publishedAt && project.hiddenAt) {
      await owns(
        projectKeys.withheldRelease(project.id),
        projectKeys.withheldRelease(legacyId),
        false,
      );
    }
    if (project.iconUrl) {
      if (!project.iconUrl.endsWith(`/${projectKeys.cover(project.id)}`)) {
        problems.push(`Project ${project.id}: iconUrl is ${project.iconUrl}`);
      }
      await owns(projectKeys.cover(project.id), projectKeys.cover(legacyId), true);
    }
    if (project.clipVersion) {
      await owns(projectKeys.clip(project.id), projectKeys.clip(legacyId), true);
    }
  }
  for (const report of reports) {
    if (!report.screenshotKey) {
      continue;
    }
    if (!report.screenshotKey.startsWith(`reports/${report.id}/`)) {
      problems.push(`Report ${report.id}: screenshotKey is ${report.screenshotKey}`);
      continue;
    }
    const legacyKey = report.screenshotKey.replace(report.id, String(report.legacyId));
    await owns(report.screenshotKey, legacyKey, false);
  }
  return { problems, missingBefore };
}

// ---- the store and the database ---------------------------------------------------------------

class S3ObjectStore implements ObjectStore {
  private readonly s3: S3Client;
  private readonly bucket = getEnv('S3_BUCKET_NAME');
  private readonly endpoint = getEnv('S3_ENDPOINT').replace(/\/+$/, '');

  constructor() {
    this.s3 = new S3Client({
      region: getEnv('S3_REGION'),
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: getEnv('S3_ACCESS_KEY_ID'),
        secretAccessKey: getEnv('S3_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: true,
    });
  }

  describe(): string {
    return `bucket ${this.bucket} at ${this.endpoint}`;
  }

  async list(): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let token: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key !== undefined) {
          objects.push({ key: object.Key, etag: object.ETag ?? '' });
        }
      }
      token = page.NextContinuationToken;
    } while (token !== undefined);
    return objects;
  }

  private encoded(key: string): string {
    return key.split('/').map(encodeURIComponent).join('/');
  }

  /**
   * Asks the store as a stranger would. It tells the same on a store with per-object ACLs and on
   * one where a bucket policy grants the read, which reading the ACL would not.
   */
  async isPublic(key: string): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/${this.bucket}/${this.encoded(key)}`, {
      method: 'HEAD',
    });
    if (response.ok) {
      return true;
    }
    if (response.status === 403 || response.status === 401) {
      return false;
    }
    throw new Error(`Reading ${key} without credentials answered ${String(response.status)}`);
  }

  async copy(from: string, to: string, publicRead: boolean): Promise<void> {
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: to,
        CopySource: `${this.bucket}/${this.encoded(from)}`,
        MetadataDirective: 'COPY',
        ACL: publicRead ? 'public-read' : 'private',
      }),
    );
    // A copy the store acknowledged and does not hold would be purged against later.
    await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: to }));
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

async function idMapOf(db: Client): Promise<IdMap> {
  const { rows } = await db.query<{ model: Model; legacyId: number; id: string }>(
    `SELECT "model", "legacyId", "id" FROM "LegacyIdMap" WHERE "model" IN ('Project', 'Report', 'User')`,
  );
  return new Map(rows.map((row) => [mapKey(row.model, row.legacyId), row.id]));
}

async function projectRowsOf(db: Client): Promise<ProjectRow[]> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT project."id", map."legacyId", project."iconUrl", project."clipVersion",
            project."publishedAt", project."hiddenAt"
     FROM "Project" AS project
     JOIN "LegacyIdMap" AS map ON map."model" = 'Project' AND map."id" = project."id"`,
  );
  return rows;
}

async function reportRowsOf(db: Client): Promise<ReportRow[]> {
  const { rows } = await db.query<ReportRow>(
    `SELECT report."id", map."legacyId", report."screenshotKey"
     FROM "Report" AS report
     JOIN "LegacyIdMap" AS map ON map."model" = 'Report' AND map."id" = report."id"`,
  );
  return rows;
}

function countsOf(moves: Move[]): string {
  const count = (state: Move['state']): number =>
    moves.filter((move) => move.state === state).length;
  return `${String(count('to copy'))} to copy, ${String(count('copied'))} already copied, ${String(count('differs'))} changed under their UUID key since`;
}

async function main(): Promise<void> {
  const [mode = '--dry-run', ...rest] = process.argv.slice(2);
  if (!['--dry-run', '--apply', '--check', '--purge-old'].includes(mode) || rest.length > 0) {
    throw new Error('Usage: move-storage [--apply | --check | --purge-old]');
  }

  const store = new S3ObjectStore();
  const db = new Client({ connectionString: databaseUrl() });
  await db.connect();
  try {
    console.log(`${mode.slice(2)} on ${store.describe()}`);
    const objects = await store.list();
    const plan = await planOf(store, objects, await idMapOf(db));
    const pending = plan.moves.filter((move) => move.state === 'to copy');
    const projects = await projectRowsOf(db);
    const reports = await reportRowsOf(db);
    const changes = addressChangesOf(projects, reports);

    if (mode === '--dry-run' || mode === '--apply') {
      for (const move of pending) {
        console.log(`copy  ${move.from} -> ${move.to}${move.publicRead ? '  (public)' : ''}`);
        if (mode === '--apply') {
          await store.copy(move.from, move.to, move.publicRead);
        }
      }
      for (const change of changes) {
        console.log(`write ${change.table}.${change.column}  ${change.from} -> ${change.to}`);
        if (mode === '--apply') {
          await db.query(`UPDATE "${change.table}" SET "${change.column}" = $1 WHERE "id" = $2`, [
            change.to,
            change.id,
          ]);
        }
      }
      for (const key of plan.orphans) {
        console.log(`orphan ${key}  (its row was gone before the ids changed; left where it is)`);
      }
      console.log(
        `${String(plan.moves.length)} objects under an integer id: ${countsOf(plan.moves)}; ` +
          `${String(changes.length)} stored addresses to rewrite; ${String(plan.orphans.length)} orphans.` +
          (mode === '--dry-run' ? ' Nothing was written.' : ''),
      );
      return;
    }

    const { problems, missingBefore } = await ownershipProblemsOf(
      store,
      objects,
      projects,
      reports,
    );
    problems.push(
      ...changes.map((change) => `${change.table}.${change.column} still reads ${change.from}`),
    );
    for (const key of missingBefore) {
      console.log(
        `absent ${key}  (its row expects it, and it was not under the integer key either)`,
      );
    }

    if (mode === '--check') {
      problems.push(...pending.map((move) => `${move.from} is not copied to ${move.to}`));
    }
    if (problems.length > 0) {
      console.error(`${String(problems.length)} problems:\n${problems.join('\n')}`);
      process.exitCode = 1;
      return;
    }
    if (mode === '--check') {
      console.log(
        `Every row owns its objects under its UUID key (${countsOf(plan.moves)}; ` +
          `${String(plan.orphans.length)} orphans).`,
      );
      return;
    }

    // An object without a copy is kept: nothing else holds its content.
    for (const move of plan.moves) {
      if (move.state === 'to copy') {
        console.log(`kept   ${move.from}  (no object under ${move.to})`);
        continue;
      }
      await store.delete(move.from);
      console.log(`delete ${move.from}`);
    }
    for (const key of plan.orphans) {
      console.log(`kept   ${key}  (orphan)`);
    }
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
