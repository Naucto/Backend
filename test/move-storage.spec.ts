import { projectKeys } from '../src/routes/project/project-keys';
import {
  addressChangesOf,
  IdMap,
  legacyKeyOf,
  ObjectStore,
  ownershipProblemsOf,
  planOf,
  ProjectRow,
  ReportRow,
  StoredObject,
} from '../tool/move-storage';
import { uuidOf } from './uuid';

const GAME = uuidOf(7);
const REPORT = uuidOf(3);
const PERSON = uuidOf(5);

const IDS: IdMap = new Map([
  ['Project:7', GAME],
  ['Report:3', REPORT],
  ['User:5', PERSON],
]);

function storeOf(publicKeys: string[] = []): ObjectStore & { copies: string[] } {
  const copies: string[] = [];
  return {
    copies,
    isPublic: (key) => Promise.resolve(publicKeys.includes(key)),
    copy: (from, to, publicRead) => {
      copies.push(`${from} -> ${to} ${publicRead ? 'public' : 'private'}`);
      return Promise.resolve();
    },
    delete: () => Promise.resolve(),
  };
}

const objectsOf = (...keys: string[]): StoredObject[] =>
  keys.map((key) => ({ key, etag: `"etag of ${key.replace(GAME, '7')}"` }));

const project = (row: Partial<ProjectRow> = {}): ProjectRow => ({
  id: GAME,
  legacyId: 7,
  iconUrl: null,
  clipVersion: null,
  publishedAt: null,
  hiddenAt: null,
  ...row,
});

describe('legacyKeyOf', () => {
  it('knows every key a project owns', () => {
    const { keys, prefixes } = projectKeys.owned('7');
    const moved = projectKeys.owned(GAME);

    keys.forEach((key, index) => {
      expect(legacyKeyOf(key)?.keyFor(GAME)).toBe(moved.keys[index]);
    });
    prefixes.forEach((prefix, index) => {
      expect(legacyKeyOf(`${prefix}slot`)?.keyFor(GAME)).toBe(`${moved.prefixes[index]}slot`);
    });
  });

  it('knows the images of a profile and the screenshot of a report', () => {
    expect(legacyKeyOf('users/5/profile')?.keyFor(PERSON)).toBe(`users/${PERSON}/profile`);
    expect(legacyKeyOf('users/5/background')).toMatchObject({ legacyId: 5, publicRead: true });
    expect(legacyKeyOf('reports/3/screenshot.webp')?.keyFor(REPORT)).toBe(
      `reports/${REPORT}/screenshot.webp`,
    );
  });

  it('never serves a save, a checkpoint, a withheld copy or a screenshot to anyone', () => {
    for (const key of [
      'save/7/1795157322513',
      'checkpoint/7/v1',
      'withheld/7/release',
      'withheld/7/cover',
      'reports/3/screenshot.png',
    ]) {
      expect(legacyKeyOf(key)?.publicRead).toBe(false);
    }
  });

  it('leaves alone a key that carries no integer id', () => {
    expect(legacyKeyOf(`release/${GAME}`)).toBeNull();
    expect(legacyKeyOf(`save/${GAME}/1795157322513`)).toBeNull();
    expect(legacyKeyOf('release/7/extra')).toBeNull();
    expect(legacyKeyOf('unrelated/7')).toBeNull();
  });
});

describe('planOf', () => {
  it('copies an object to the key of the UUID its row has now', async () => {
    const plan = await planOf(storeOf(), objectsOf('save/7/100', 'reports/3/screenshot.png'), IDS);

    expect(plan.moves).toEqual([
      { from: 'save/7/100', to: `save/${GAME}/100`, publicRead: false, state: 'to copy' },
      {
        from: 'reports/3/screenshot.png',
        to: `reports/${REPORT}/screenshot.png`,
        publicRead: false,
        state: 'to copy',
      },
    ]);
  });

  it('keeps public what anyone reads today, and only that', async () => {
    const store = storeOf(['release/7', 'reports/3/screenshot.png']);

    const plan = await planOf(
      store,
      objectsOf('release/7', 'projects/7/image', 'reports/3/screenshot.png'),
      IDS,
    );

    expect(plan.moves.map((move) => [move.from, move.publicRead])).toEqual([
      ['release/7', true],
      // Its kind is served to anyone, but this one is not readable today.
      ['projects/7/image', false],
      // Readable today, but a screenshot is never served to anyone.
      ['reports/3/screenshot.png', false],
    ]);
  });

  it('does not copy over an object already under the UUID key', async () => {
    const objects = [
      ...objectsOf('release/7', `release/${GAME}`, 'projects/7/image'),
      { key: `projects/${GAME}/image`, etag: '"a newer cover"' },
    ];

    const plan = await planOf(storeOf(), objects, IDS);

    expect(plan.moves.map((move) => [move.from, move.state])).toEqual([
      ['release/7', 'copied'],
      ['projects/7/image', 'differs'],
    ]);
  });

  it('lists apart what belongs to no row', async () => {
    const plan = await planOf(storeOf(), objectsOf('release/8', 'users/9/profile'), IDS);

    expect(plan).toEqual({ moves: [], orphans: ['release/8', 'users/9/profile'] });
  });
});

describe('addressChangesOf', () => {
  it('rewrites the address of a cover and the key of a screenshot', () => {
    const reports: ReportRow[] = [
      { id: REPORT, legacyId: 3, screenshotKey: 'reports/3/screenshot.jpg' },
    ];

    const changes = addressChangesOf(
      [project({ iconUrl: 'https://edge.example/bucket/projects/7/image' })],
      reports,
    );

    expect(changes.map((change) => change.to)).toEqual([
      `https://edge.example/bucket/projects/${GAME}/image`,
      `reports/${REPORT}/screenshot.jpg`,
    ]);
  });

  it('leaves an address that already names the UUID, or another project', () => {
    const changes = addressChangesOf(
      [
        project({ iconUrl: `https://edge.example/bucket/projects/${GAME}/image` }),
        project({ iconUrl: 'https://edge.example/bucket/projects/17/image' }),
      ],
      [{ id: REPORT, legacyId: 3, screenshotKey: `reports/${REPORT}/screenshot.jpg` }],
    );

    expect(changes).toEqual([]);
  });
});

describe('ownershipProblemsOf', () => {
  const published = project({
    publishedAt: new Date(),
    iconUrl: `https://edge.example/bucket/projects/${GAME}/image`,
    clipVersion: 'v1',
  });
  const screenshot: ReportRow = {
    id: REPORT,
    legacyId: 3,
    screenshotKey: `reports/${REPORT}/screenshot.png`,
  };
  const owned = [
    `release/${GAME}`,
    `projects/${GAME}/image`,
    `projects/${GAME}/clip`,
    `reports/${REPORT}/screenshot.png`,
  ];
  const publicKeys = owned.slice(0, 3);

  it('finds nothing wrong when every row owns its objects', async () => {
    const result = await ownershipProblemsOf(
      storeOf(publicKeys),
      objectsOf(...owned),
      [published],
      [screenshot],
    );

    expect(result).toEqual({ problems: [], missingBefore: [] });
  });

  it('reports an object that was not copied', async () => {
    const { problems } = await ownershipProblemsOf(
      storeOf(publicKeys),
      objectsOf('release/7', ...owned.slice(1)),
      [published],
      [screenshot],
    );

    expect(problems).toEqual([`release/${GAME} is missing (release/7 is not copied)`]);
  });

  it('lists apart an object that was missing before as well', async () => {
    const result = await ownershipProblemsOf(
      storeOf(publicKeys),
      objectsOf(...owned.slice(1)),
      [published],
      [screenshot],
    );

    expect(result).toEqual({ problems: [], missingBefore: [`release/${GAME}`] });
  });

  it('reports a release nobody can read and a screenshot anybody can', async () => {
    const { problems } = await ownershipProblemsOf(
      storeOf([...publicKeys.slice(1), `reports/${REPORT}/screenshot.png`]),
      objectsOf(...owned),
      [published],
      [screenshot],
    );

    expect(problems).toEqual([
      `release/${GAME} is not readable by everyone`,
      `reports/${REPORT}/screenshot.png is readable by everyone`,
    ]);
  });

  it('expects the release of a withheld game where it is withheld, unread', async () => {
    const withheld = project({ publishedAt: new Date(), hiddenAt: new Date() });

    const { problems } = await ownershipProblemsOf(
      storeOf([`withheld/${GAME}/release`]),
      objectsOf(`withheld/${GAME}/release`),
      [withheld],
      [],
    );

    expect(problems).toEqual([`withheld/${GAME}/release is readable by everyone`]);
  });

  it('reports a stored address that still names the integer id', async () => {
    const { problems } = await ownershipProblemsOf(
      storeOf(),
      [],
      [project({ iconUrl: 'https://edge.example/bucket/projects/7/image' })],
      [{ id: REPORT, legacyId: 3, screenshotKey: 'reports/3/screenshot.png' }],
    );

    expect(problems).toEqual([
      `Project ${GAME}: iconUrl is https://edge.example/bucket/projects/7/image`,
      `Report ${REPORT}: screenshotKey is reports/3/screenshot.png`,
    ]);
  });
});
