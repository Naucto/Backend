import { globSync } from 'node:fs';
import { join } from 'node:path';

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { Access, ACCESS_KEY } from './access.decorators';

const SOURCE_ROOT = join(__dirname, '..', '..');

interface ScannedRoute {
  /** `Controller.handler (file)` */
  name: string;
  controllerPath: string;
  /** What the handler declares or, failing that, its controller. */
  access: Access | undefined;
}

async function scanRoutes(): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = [];

  for (const file of globSync('**/*.controller.ts', { cwd: SOURCE_ROOT }).sort()) {
    const exports: Record<string, unknown> = await import(join(SOURCE_ROOT, file));

    for (const exported of Object.values(exports)) {
      if (typeof exported !== 'function' || !Reflect.hasMetadata(PATH_METADATA, exported)) {
        continue;
      }
      const prototype: Record<string, unknown> = exported.prototype;

      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function' || !Reflect.hasMetadata(METHOD_METADATA, handler)) {
          continue;
        }
        routes.push({
          name: `${exported.name}.${name} (${file})`,
          controllerPath: String(Reflect.getMetadata(PATH_METADATA, exported)),
          access:
            Reflect.getMetadata(ACCESS_KEY, handler) ?? Reflect.getMetadata(ACCESS_KEY, exported),
        });
      }
    }
  }

  return routes;
}

const namesOf = (routes: ScannedRoute[]): string[] => routes.map((route) => route.name);

describe('route access', () => {
  let routes: ScannedRoute[];

  beforeAll(async () => {
    routes = await scanRoutes();
  }, 60_000);

  // An unannotated route falls back to admin-only, which is safe but says nothing: every route
  // states who may call it.
  it('is declared on every route, by its handler or its controller', () => {
    expect(routes).not.toEqual([]);
    expect(namesOf(routes.filter((route) => route.access === undefined))).toEqual([]);
  });

  it('asks a staff session of every moderation route of the admin console', () => {
    const moderation = routes.filter((route) =>
      route.controllerPath.startsWith('admin/moderation'),
    );

    expect(moderation).not.toEqual([]);
    expect(namesOf(moderation.filter((route) => route.access?.kind !== 'staff'))).toEqual([]);
  });

  // The web app only ever holds the token of a site sign-in, which a staff route refuses.
  it('asks a staff session of no route outside the admin console', () => {
    const outside = routes.filter((route) => !route.controllerPath.startsWith('admin/'));

    expect(namesOf(outside.filter((route) => route.access?.kind === 'staff'))).toEqual([]);
  });
});
