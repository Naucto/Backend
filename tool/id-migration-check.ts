/**
 * Proof that turning the integer ids into UUIDs kept the data, in two steps so it reads both
 * shapes of the database:
 *
 *   npm run migration:check -- --before fingerprint.json   (database still on integer ids)
 *   npx prisma migrate deploy
 *   npm run migration:check -- --after fingerprint.json    (migrated database)
 *
 * A fingerprint names every row by what a person would recognise it by (an email, a project's
 * number, name and creator, a comment's author and text) and never by its id, so the same row
 * reads the same on both sides. Whatever the migration leaves alone is compared as a digest per
 * table. Run the second step before anything else writes to the database, the storage tool
 * included. Reads only; exits non-zero on any difference and prints them.
 */
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { NO_RELEASE_ID } from '../src/common/ids';
import { databaseUrl } from '../src/prisma/database-url';

type Shape = 'before' | 'after';

interface Fingerprint {
  takenAt: string;
  sections: Record<string, string[]>;
}

// The name of the model; the lint rule takes it for the role that reads the same.
// eslint-disable-next-line no-restricted-syntax
const USER = 'User';

/** Every column that held an integer id, per table: what the migration converts. */
const ID_COLUMNS: Record<string, string[]> = {
  User: ['id'],
  RefreshToken: ['id', 'userId'],
  FriendRequest: ['id', 'fromId', 'toId'],
  Friendship: ['id', 'userAId', 'userBId'],
  Project: ['id', 'userId', 'forked_from_id'],
  Comment: ['id', 'authorId', 'projectId', 'parentId'],
  Like: ['id', 'userId', 'projectId'],
  ReleaseView: ['id', 'projectId'],
  FeaturedRelease: ['id', 'projectId', 'featuredById'],
  Notification: ['id', 'userId'],
  Report: ['id', 'userId', 'releaseId', 'projectId', 'ratingId'],
  ReportOccurrence: ['id', 'reportId'],
  FeedbackPrompt: ['userId'],
  GameSession: ['id', 'hostId', 'projectId'],
  WorkSession: ['id', 'hostId', 'projectId'],
  Flag: ['id', 'reporterId', 'targetId', 'targetOwnerId', 'resolvedById', 'resolutionId'],
  ModerationAction: ['id', 'actorId', 'targetId', 'subjectUserId'],
  Collection: ['ownerId'],
  CollectionItem: ['projectId'],
  _ProjectCollaborators: ['A', 'B'],
  _UserJoinedGameSessions: ['A', 'B'],
  _WorkSessionUsers: ['A', 'B'],
  AnalyticsVisitor: ['userId'],
  AnalyticsProjectionWork: ['userId'],
  AnalyticsPlay: ['releaseId'],
  AnalyticsLiveMinute: ['releaseId'],
  AnalyticsAnonTally: ['releaseId'],
  AnalyticsUserDaily: ['userId', 'releaseId'],
  AnalyticsFact: ['actorUserId', 'projectId'],
  AnalyticsMpSession: ['projectId'],
  AnalyticsMarker: ['id', 'releaseId'],
};

/** Columns whose text or JSON embeds an id, and the two integers that keep the old ids. */
const REWRITTEN_COLUMNS: Record<string, string[]> = {
  User: ['playerNumber'],
  Project: ['legacyId'],
  ReleaseView: ['viewerKey'],
  AnalyticsFact: ['dedupeKey'],
  AnalyticsRollup: ['dimension'],
  Flag: ['openKey'],
  ModerationAction: ['dedupeKey'],
  Notification: ['data'],
};

/** Emptied by the migration: the application rebuilds both. */
const EMPTIED_TABLES = ['RefreshToken', 'HubSnapshot'];

/** Not data: the migration history, and the map the migration itself creates. */
const BOOKKEEPING_TABLES = ['_prisma_migrations', 'LegacyIdMap'];

/** Which model each id key of a notification's data names. */
const NOTIFICATION_KEYS: Record<string, { labels: string; model: string }> = {
  requestId: { labels: 'request_label', model: 'FriendRequest' },
  fromUserId: { labels: 'user_label', model: USER },
  userId: { labels: 'user_label', model: USER },
  projectId: { labels: 'project_label', model: 'Project' },
  actionId: { labels: 'action_label', model: 'ModerationAction' },
};

/** A string key that still carries a bare integer id, per rewritten column. */
const BARE_INTEGER_KEYS: { table: string; column: string; pattern: string }[] = [
  { table: 'ReleaseView', column: 'viewerKey', pattern: '^u:\\d+$' },
  { table: 'AnalyticsFact', column: 'dedupeKey', pattern: '^project:\\d+$' },
  { table: 'AnalyticsFact', column: 'dedupeKey', pattern: '^release:\\d+:\\d+$' },
  { table: 'AnalyticsRollup', column: 'dimension', pattern: '^release:\\d+$' },
  { table: 'Flag', column: 'openKey', pattern: '^\\d+:|:\\d+$' },
  { table: 'ModerationAction', column: 'dedupeKey', pattern: '^view:\\d+:|^view:[^:]+:\\d+:' },
];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The id the migration gives a row that no longer exists, as its SQL derives it. */
function derivedId(model: string, legacyId: string): string {
  const hash = createHash('md5').update(`${model}:${legacyId}`).digest('hex');
  const hex = `${hash.slice(0, 12)}3${hash.slice(13, 16)}8${hash.slice(17)}`;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * The label of the row `expression` names, read from the CTE `labels`. An id that names no row
 * reads `gone:<model>:<id>`, and no id at all reads `-`.
 */
function labelOf(labels: string, model: string, expression: string): string {
  return `COALESCE(
    (SELECT known.label FROM ${labels} AS known WHERE known."id"::text = (${expression})::text),
    'gone:${model}:' || (${expression})::text,
    '-')`;
}

/** The labels every section names rows by, as CTEs. Only the two kept numbers differ by shape. */
function labelsOf(shape: Shape): string {
  const userNumber = shape === 'before' ? 'account."id"' : 'account."playerNumber"';
  const projectNumber = shape === 'before' ? 'project."id"' : 'project."legacyId"';

  return `WITH
    user_label AS (
      SELECT account."id", 'user ' || account."email" AS label, ${userNumber} AS number
      FROM "User" AS account),
    project_label AS (
      SELECT project."id",
        'project #' || ${projectNumber} || ' ' || quote_literal(project."name") || ' of ' || creator."email" AS label
      FROM "Project" AS project JOIN "User" AS creator ON creator."id" = project."userId"),
    comment_label AS (
      SELECT comment."id",
        'comment of ' || author."username" || ' at ' || comment."createdAt" || ' on ' || game.label
          || ' ' || md5(comment."content") AS label
      FROM "Comment" AS comment
      JOIN "User" AS author ON author."id" = comment."authorId"
      JOIN project_label AS game ON game."id" = comment."projectId"),
    request_label AS (
      SELECT request."id", 'request ' || sender."email" || ' -> ' || receiver."email" AS label
      FROM "FriendRequest" AS request
      JOIN "User" AS sender ON sender."id" = request."fromId"
      JOIN "User" AS receiver ON receiver."id" = request."toId"),
    report_label AS (
      SELECT report."id",
        'report ' || report."kind" || ' at ' || report."createdAt" || ' '
          || COALESCE(report."groupKey", report."title", '') AS label
      FROM "Report" AS report),
    action_label AS (
      SELECT action."id",
        'action ' || action."action" || ' at ' || action."createdAt" || ' by ' || actor."email" AS label
      FROM "ModerationAction" AS action JOIN "User" AS actor ON actor."id" = action."actorId")`;
}

/** The target of a flag or a moderation action, by the model its type names. */
function targetOf(row: string): string {
  return `CASE ${row}."targetType"
    WHEN 'USER' THEN ${labelOf('user_label', USER, `${row}."targetId"`)}
    WHEN 'PROJECT' THEN ${labelOf('project_label', 'Project', `${row}."targetId"`)}
    WHEN 'COMMENT' THEN ${labelOf('comment_label', 'Comment', `${row}."targetId"`)}
  END`;
}

/**
 * The sections compared row for row. Each query answers one text column, `line`, and reads the
 * same on both shapes: joins go through the id columns whatever their type.
 */
function sectionsOf(shape: Shape): Record<string, string> {
  const noRelease = shape === 'before' ? '0' : `'${NO_RELEASE_ID}'::uuid`;
  const user = (expression: string): string => labelOf('user_label', USER, expression);
  const project = (expression: string): string => labelOf('project_label', 'Project', expression);
  const release = (expression: string): string =>
    `CASE WHEN ${expression} = ${noRelease} THEN 'no game' ELSE ${project(expression)} END`;
  const notificationData = Object.entries(NOTIFICATION_KEYS)
    .map(
      ([key, { labels, model }]) =>
        `CASE WHEN notification."data" ? '${key}'
          THEN ' ${key}=' || ${labelOf(labels, model, `notification."data" ->> '${key}'`)}
          ELSE '' END`,
    )
    .join(' || ');

  return {
    users: `SELECT concat_ws(' | ', known.label, 'number ' || known.number, account."username",
        account."role", account."createdAt", account."deletedAt") AS line
      FROM "User" AS account JOIN user_label AS known ON known."id" = account."id"`,

    projects: `SELECT concat_ws(' | ', game.label, project."status", project."createdAt",
        'published ' || COALESCE(project."publishedAt"::text, '-'),
        'fork of ' || ${project('project."forked_from_id"')}) AS line
      FROM "Project" AS project JOIN project_label AS game ON game."id" = project."id"`,

    collaborators: `SELECT concat_ws(' | ', ${project('link."A"')}, ${user('link."B"')}) AS line
      FROM "_ProjectCollaborators" AS link`,

    comments: `SELECT concat_ws(' | ', known.label, 'reply to ' || ${labelOf('comment_label', 'Comment', 'comment."parentId"')},
        'deleted ' || comment."deleted", 'hidden ' || COALESCE(comment."hiddenAt"::text, '-')) AS line
      FROM "Comment" AS comment JOIN comment_label AS known ON known."id" = comment."id"`,

    likes: `SELECT concat_ws(' | ', ${project('liked."projectId"')}, ${user('liked."userId"')},
        liked."createdAt") AS line
      FROM "Like" AS liked`,

    'release views of accounts': `SELECT concat_ws(' | ', ${project('view."projectId"')},
        ${user(`substr(view."viewerKey", 3)`)}, view."day") AS line
      FROM "ReleaseView" AS view WHERE view."viewerKey" LIKE 'u:%'`,

    'release views of visitors': `SELECT concat_ws(' | ', ${project('view."projectId"')},
        count(*), md5(string_agg(view."viewerKey" || view."day", ',' ORDER BY view."viewerKey", view."day"))) AS line
      FROM "ReleaseView" AS view WHERE view."viewerKey" NOT LIKE 'u:%' GROUP BY view."projectId"`,

    collections: `SELECT concat_ws(' | ', collection."id", ${user('collection."ownerId"')},
        collection."title", collection."visibility") AS line
      FROM "Collection" AS collection`,

    'collection items': `SELECT concat_ws(' | ', item."collectionId", item."position",
        ${project('item."projectId"')}) AS line
      FROM "CollectionItem" AS item`,

    friendships: `SELECT concat_ws(' | ', LEAST(one."username", other."username"),
        GREATEST(one."username", other."username"), friendship."createdAt") AS line
      FROM "Friendship" AS friendship
      JOIN "User" AS one ON one."id" = friendship."userAId"
      JOIN "User" AS other ON other."id" = friendship."userBId"`,

    'friend requests': `SELECT concat_ws(' | ', known.label, request."createdAt") AS line
      FROM "FriendRequest" AS request JOIN request_label AS known ON known."id" = request."id"`,

    notifications: `SELECT concat_ws(' | ', ${user('notification."userId"')}, notification."kind",
        notification."createdAt", notification."title", 'read ' || notification."read",
        'links' || ${notificationData}) AS line
      FROM "Notification" AS notification`,

    'featured releases': `SELECT concat_ws(' | ', ${project('featured."projectId"')},
        ${user('featured."featuredById"')}, featured."startsAt", featured."endsAt") AS line
      FROM "FeaturedRelease" AS featured`,

    'game sessions': `SELECT concat_ws(' | ', session."sessionId", ${user('session."hostId"')},
        ${project('session."projectId"')},
        (SELECT string_agg(joined.label, ', ' ORDER BY joined.label)
         FROM "_UserJoinedGameSessions" AS link JOIN user_label AS joined ON joined."id" = link."B"
         WHERE link."A" = session."id")) AS line
      FROM "GameSession" AS session`,

    'work sessions': `SELECT concat_ws(' | ', session."roomId", ${user('session."hostId"')},
        ${project('session."projectId"')},
        (SELECT string_agg(joined.label, ', ' ORDER BY joined.label)
         FROM "_WorkSessionUsers" AS link JOIN user_label AS joined ON joined."id" = link."A"
         WHERE link."B" = session."id")) AS line
      FROM "WorkSession" AS session`,

    reports: `SELECT concat_ws(' | ', known.label, ${user('report."userId"')},
        'release ' || ${project('report."releaseId"')}, 'project ' || ${project('report."projectId"')},
        'follows ' || ${labelOf('report_label', 'Report', 'report."ratingId"')},
        (SELECT count(*) FROM "ReportOccurrence" AS occurrence WHERE occurrence."reportId" = report."id")
          || ' occurrences') AS line
      FROM "Report" AS report JOIN report_label AS known ON known."id" = report."id"`,

    'feedback prompts': `SELECT concat_ws(' | ', ${user('prompt."userId"')}, prompt."status") AS line
      FROM "FeedbackPrompt" AS prompt`,

    flags: `SELECT concat_ws(' | ', ${user('flag."reporterId"')}, flag."targetType", ${targetOf('flag')},
        'owner ' || ${user('flag."targetOwnerId"')}, flag."reason", flag."status", flag."createdAt",
        'resolved by ' || ${user('flag."resolvedById"')},
        'resolution ' || ${labelOf('action_label', 'ModerationAction', 'flag."resolutionId"')},
        'open ' || (flag."openKey" IS NOT NULL)) AS line
      FROM "Flag" AS flag`,

    'moderation actions': `SELECT concat_ws(' | ', known.label, action."targetType", ${targetOf('action')},
        'subject ' || ${user('action."subjectUserId"')},
        CASE WHEN action."dedupeKey" LIKE 'view:%' THEN 'viewed '
          || ${user(`split_part(action."dedupeKey", ':', 2)`)} || ' '
          || ${project(`split_part(action."dedupeKey", ':', 3)`)} || ' '
          || split_part(action."dedupeKey", ':', 4)
        ELSE COALESCE(action."dedupeKey", '-') END) AS line
      FROM "ModerationAction" AS action JOIN action_label AS known ON known."id" = action."id"`,

    'analytics: plays per game': `SELECT concat_ws(' | ', ${project('play."releaseId"')}, count(*),
        sum(play."activeMs"), sum(play."baselineMs")) AS line
      FROM "AnalyticsPlay" AS play GROUP BY play."releaseId"`,

    'analytics: account history per account and game': `SELECT concat_ws(' | ',
        ${user('daily."userId"')}, ${release('daily."releaseId"')}, count(*), sum(daily."plays"),
        sum(daily."activeMs"), sum(daily."activeMinutes")) AS line
      FROM "AnalyticsUserDaily" AS daily GROUP BY daily."userId", daily."releaseId"`,

    'analytics: anonymous tallies per game': `SELECT concat_ws(' | ', ${release('tally."releaseId"')},
        count(*), sum(tally."beats"), sum(tally."playsStarted"), sum(tally."playMs")) AS line
      FROM "AnalyticsAnonTally" AS tally GROUP BY tally."releaseId"`,

    'analytics: live minutes per game': `SELECT concat_ws(' | ', ${project('live."releaseId"')},
        count(*)) AS line
      FROM "AnalyticsLiveMinute" AS live GROUP BY live."releaseId"`,

    'analytics: facts': `SELECT concat_ws(' | ', fact."type", fact."at", ${user('fact."actorUserId"')},
        ${project('fact."projectId"')},
        CASE
          WHEN fact."dedupeKey" LIKE 'project:%'
            THEN 'project:' || ${project(`split_part(fact."dedupeKey", ':', 2)`)}
          WHEN fact."dedupeKey" LIKE 'release:%'
            THEN 'release:' || ${project(`split_part(fact."dedupeKey", ':', 2)`)} || ':'
              || split_part(fact."dedupeKey", ':', 3)
          ELSE fact."dedupeKey"
        END) AS line
      FROM "AnalyticsFact" AS fact`,

    'analytics: multiplayer sessions per game': `SELECT concat_ws(' | ', ${project('room."projectId"')},
        count(*), sum(room."multiMs"), sum(room."playerMs"), sum(room."peakConnected")) AS line
      FROM "AnalyticsMpSession" AS room GROUP BY room."projectId"`,

    'analytics: rollups per game': `SELECT concat_ws(' | ',
        CASE WHEN split_part(rollup."dimension", ':', 2) = (${noRelease})::text THEN 'no game'
          ELSE ${project(`split_part(rollup."dimension", ':', 2)`)} END,
        rollup."metric", rollup."version", rollup."grain", count(*), sum(rollup."value")) AS line
      FROM "AnalyticsRollup" AS rollup WHERE rollup."dimension" LIKE 'release:%'
      GROUP BY rollup."dimension", rollup."metric", rollup."version", rollup."grain"`,

    'analytics: rollups of other dimensions': `SELECT concat_ws(' | ', rollup."metric", rollup."version",
        rollup."grain", count(*),
        md5(string_agg(rollup."periodStart" || rollup."dimension" || rollup."value", ','
          ORDER BY rollup."periodStart", rollup."dimension"))) AS line
      FROM "AnalyticsRollup" AS rollup WHERE rollup."dimension" NOT LIKE 'release:%'
      GROUP BY rollup."metric", rollup."version", rollup."grain"`,

    'analytics: visitors per account': `SELECT concat_ws(' | ', ${user('visitor."userId"')}, count(*),
        md5(string_agg(visitor."id"::text, ',' ORDER BY visitor."id"))) AS line
      FROM "AnalyticsVisitor" AS visitor GROUP BY visitor."userId"`,

    'analytics: projection work': `SELECT concat_ws(' | ', work."visitorId", ${user('work."userId"')}) AS line
      FROM "AnalyticsProjectionWork" AS work`,

    'analytics: markers': `SELECT concat_ws(' | ', marker."at", marker."label", marker."audience",
        ${project('marker."releaseId"')}) AS line
      FROM "AnalyticsMarker" AS marker`,
  };
}

async function linesOf(db: Client, sql: string, values: unknown[] = []): Promise<string[]> {
  const { rows } = await db.query<{ line: string }>(sql, values);
  return rows.map((row) => row.line).sort();
}

/** How many rows each table holds, the bookkeeping and the emptied ones aside. */
async function rowCounts(db: Client, tables: string[]): Promise<string[]> {
  const lines: string[] = [];
  for (const table of tables) {
    const { rows } = await db.query<{ count: string }>(`SELECT count(*) AS count FROM "${table}"`);
    lines.push(`${table} | ${rows[0]?.count ?? '?'}`);
  }
  return lines;
}

/**
 * One digest per table over everything the migration leaves alone: each row without its id
 * columns and its rewritten columns. A change to any other value changes the digest.
 */
async function untouchedDigests(db: Client, tables: string[]): Promise<string[]> {
  const lines: string[] = [];
  for (const table of tables) {
    const excluded = [...(ID_COLUMNS[table] ?? []), ...(REWRITTEN_COLUMNS[table] ?? [])];
    const { rows } = await db.query<{ digest: string }>(
      // The alias must not be the name of a column, or \`to_jsonb\` reads that column.
      `SELECT COALESCE(md5(string_agg(hashed.hash, '' ORDER BY hashed.hash)), 'empty') AS digest
       FROM (
         SELECT md5((to_jsonb(whole_row) - $1::text[])::text) AS hash FROM "${table}" AS whole_row
       ) AS hashed`,
      [excluded],
    );
    lines.push(`${table} | ${rows[0]?.digest ?? '?'}`);
  }
  return lines;
}

/** How many rows hold no value in each id column: a reference must not be lost on the way. */
async function nullCounts(db: Client): Promise<string[]> {
  const lines: string[] = [];
  for (const [table, columns] of Object.entries(ID_COLUMNS)) {
    for (const column of columns) {
      const { rows } = await db.query<{ count: string }>(
        `SELECT count(*) AS count FROM "${table}" WHERE "${column}" IS NULL`,
      );
      lines.push(`${table}.${column} | ${rows[0]?.count ?? '?'} null`);
    }
  }
  return lines;
}

/** The type each id column has, to tell which shape the database is in. */
async function idColumnTypes(db: Client): Promise<Map<string, string>> {
  const { rows } = await db.query<{ table: string; column: string; type: string }>(
    `SELECT table_name AS "table", column_name AS "column", data_type AS "type"
     FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const types = new Map<string, string>();
  for (const [table, columns] of Object.entries(ID_COLUMNS)) {
    for (const column of columns) {
      const found = rows.find((row) => row.table === table && row.column === column);
      types.set(`${table}.${column}`, found?.type ?? 'missing');
    }
  }
  return types;
}

async function fingerprintOf(db: Client, shape: Shape): Promise<Fingerprint> {
  const { rows: tableRows } = await db.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const tables = tableRows
    .map((row) => row.name)
    .filter((name) => !BOOKKEEPING_TABLES.includes(name) && !EMPTIED_TABLES.includes(name));

  const sections: Record<string, string[]> = {
    'row counts': await rowCounts(db, tables),
    'untouched columns': await untouchedDigests(db, tables),
    'null references': await nullCounts(db),
  };

  const sequence = shape === 'before' ? 'id' : 'playerNumber';
  sections['player number sequence'] = await linesOf(
    db,
    `SELECT 'last value ' || COALESCE(pg_sequence_last_value(pg_get_serial_sequence('"User"', $1))::text, 'none') AS line`,
    [sequence],
  );

  const labels = labelsOf(shape);
  for (const [name, sql] of Object.entries(sectionsOf(shape))) {
    sections[name] = await linesOf(db, `${labels} ${sql}`);
  }

  return { takenAt: new Date().toISOString(), sections };
}

/**
 * An id that names no row reads `gone:<model>:<number>` before and `gone:<model>:<uuid>` after.
 * The migration derives that UUID from the model and the number, so the numbers the first step
 * saw say which UUIDs the second may see, and each is read back as its number.
 */
function withDerivedIdsNamed(after: Fingerprint, before: Fingerprint): Fingerprint {
  const numbers = new Map<string, string>();
  for (const lines of Object.values(before.sections)) {
    for (const line of lines) {
      for (const [, model, legacyId] of line.matchAll(/gone:(\w+):(\d+)/g)) {
        if (model !== undefined && legacyId !== undefined) {
          numbers.set(`${model}:${derivedId(model, legacyId)}`, legacyId);
        }
      }
    }
  }

  const gone = new RegExp(`gone:(\\w+):(${UUID})`, 'g');
  const sections: Record<string, string[]> = {};
  for (const [name, lines] of Object.entries(after.sections)) {
    sections[name] = lines
      .map((line) =>
        line.replace(gone, (whole, model: string, id: string) => {
          const legacyId = numbers.get(`${model}:${id}`);
          return legacyId === undefined ? whole : `gone:${model}:${legacyId}`;
        }),
      )
      .sort();
  }
  return { ...after, sections };
}

/** The lines only one side holds, counting repeats. */
function difference(left: string[], right: string[]): string[] {
  const remaining = new Map<string, number>();
  for (const line of right) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  return left.filter((line) => {
    const count = remaining.get(line) ?? 0;
    remaining.set(line, count - 1);
    return count <= 0;
  });
}

function compare(before: Fingerprint, after: Fingerprint): string[] {
  const problems: string[] = [];
  const names = new Set([...Object.keys(before.sections), ...Object.keys(after.sections)]);

  for (const name of names) {
    const was = before.sections[name] ?? [];
    const is = after.sections[name] ?? [];
    const lost = difference(was, is);
    const appeared = difference(is, was);
    if (lost.length === 0 && appeared.length === 0) {
      console.log(`  same  ${name} (${String(was.length)})`);
      continue;
    }
    problems.push(
      `${name}: ${String(lost.length)} only before, ${String(appeared.length)} only after`,
      ...lost.slice(0, 20).map((line) => `    - ${line}`),
      ...appeared.slice(0, 20).map((line) => `    + ${line}`),
    );
  }
  return problems;
}

/** What only the migrated database can be asked. */
async function migratedStateProblems(db: Client, before: Fingerprint): Promise<string[]> {
  const problems: string[] = [];
  const count = async (sql: string, values: unknown[] = []): Promise<number> => {
    const { rows } = await db.query<{ count: string }>(sql, values);
    return Number(rows[0]?.count ?? 0);
  };

  for (const [column, type] of await idColumnTypes(db)) {
    if (type !== 'uuid') {
      problems.push(`${column} is ${type}, not uuid`);
    }
  }

  for (const table of EMPTIED_TABLES) {
    const rows = await count(`SELECT count(*) AS count FROM "${table}"`);
    if (rows > 0) {
      problems.push(`${table} still holds ${String(rows)} rows`);
    }
  }

  for (const { table, column, pattern } of BARE_INTEGER_KEYS) {
    const rows = await count(`SELECT count(*) AS count FROM "${table}" WHERE "${column}" ~ $1`, [
      pattern,
    ]);
    if (rows > 0) {
      problems.push(
        `${table}.${column}: ${String(rows)} keys still carry an integer id (${pattern})`,
      );
    }
  }

  for (const key of Object.keys(NOTIFICATION_KEYS)) {
    const rows = await count(
      `SELECT count(*) AS count FROM "Notification" WHERE jsonb_typeof("data" -> $1) = 'number'`,
      [key],
    );
    if (rows > 0) {
      problems.push(`Notification.data.${key}: ${String(rows)} still hold an integer id`);
    }
  }

  const unordered = await count(
    `SELECT count(*) AS count FROM "Friendship" WHERE "userAId" >= "userBId"`,
  );
  if (unordered > 0) {
    problems.push(`Friendship: ${String(unordered)} pairs are not stored lower id first`);
  }

  const models = Object.entries(ID_COLUMNS)
    .filter(([table, columns]) => columns.includes('id') && !EMPTIED_TABLES.includes(table))
    .map(([table]) => table);
  for (const model of models) {
    const unmapped = await count(
      `SELECT count(*) AS count FROM "${model}" AS source
       WHERE NOT EXISTS (SELECT 1 FROM "LegacyIdMap" AS map WHERE map."model" = $1 AND map."id" = source."id")`,
      [model],
    );
    const mapped = await count(`SELECT count(*) AS count FROM "LegacyIdMap" WHERE "model" = $1`, [
      model,
    ]);
    const was = before.sections['row counts']?.find((line) => line.startsWith(`${model} | `));
    if (unmapped > 0) {
      problems.push(`${model}: ${String(unmapped)} rows are not in LegacyIdMap`);
    }
    if (was !== `${model} | ${String(mapped)}`) {
      problems.push(
        `LegacyIdMap holds ${String(mapped)} ${model} rows, the table held "${was ?? 'nothing'}"`,
      );
    }
  }

  const mismatched = await count(
    `SELECT count(*) AS count FROM "LegacyIdMap" AS map
     WHERE (map."model" = 'User' AND NOT EXISTS (
              SELECT 1 FROM "User" AS account
              WHERE account."id" = map."id" AND account."playerNumber" = map."legacyId"))
        OR (map."model" = 'Project' AND NOT EXISTS (
              SELECT 1 FROM "Project" AS project
              WHERE project."id" = map."id" AND project."legacyId" = map."legacyId"))`,
  );
  if (mismatched > 0) {
    problems.push(
      `${String(mismatched)} accounts or projects do not carry the number LegacyIdMap gives them`,
    );
  }

  return problems;
}

async function main(): Promise<void> {
  const [mode, file] = process.argv.slice(2);
  if ((mode !== '--before' && mode !== '--after') || file === undefined) {
    throw new Error('Usage: id-migration-check (--before | --after) <fingerprint file>');
  }

  const db = new Client({ connectionString: databaseUrl() });
  await db.connect();
  try {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const types = new Set((await idColumnTypes(db)).values());

    if (mode === '--before') {
      if (!types.has('integer') || types.has('uuid')) {
        throw new Error('--before reads a database whose ids are still integers; this one is not.');
      }
      const fingerprint = await fingerprintOf(db, 'before');
      writeFileSync(file, JSON.stringify(fingerprint, null, 1));
      const lines = Object.values(fingerprint.sections).reduce((sum, list) => sum + list.length, 0);
      console.log(`Fingerprint of ${String(lines)} lines written to ${file}.`);
      return;
    }

    if (types.has('integer')) {
      throw new Error('--after reads a migrated database; this one still has integer ids.');
    }
    const before = JSON.parse(readFileSync(file, 'utf8')) as Fingerprint;
    const after = withDerivedIdsNamed(await fingerprintOf(db, 'after'), before);
    const problems = [...compare(before, after), ...(await migratedStateProblems(db, before))];

    if (problems.length > 0) {
      console.error(`\n${String(problems.length)} lines of differences:\n${problems.join('\n')}`);
      process.exitCode = 1;
      return;
    }
    console.log('\nThe migrated database holds what the fingerprint describes.');
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
