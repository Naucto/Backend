import { globSync } from 'node:fs';
import { join } from 'node:path';

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { ACCESS_KEY } from './access.decorators';

const SOURCE_ROOT = join(__dirname, '..', '..');

/** Every route served, as `Controller.handler (file)`, and those whose handler and controller both state no access. */
async function scanRoutes(): Promise<{ routes: string[]; unannotated: string[] }> {
  const routes: string[] = [];
  const unannotated: string[] = [];

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
        const route = `${exported.name}.${name} (${file})`;
        routes.push(route);
        if (
          !Reflect.hasMetadata(ACCESS_KEY, handler) &&
          !Reflect.hasMetadata(ACCESS_KEY, exported)
        ) {
          unannotated.push(route);
        }
      }
    }
  }

  return { routes, unannotated };
}

describe('route access', () => {
  // An unannotated route falls back to admin-only, which is safe but says nothing: every route
  // states who may call it.
  it('is declared on every route, by its handler or its controller', async () => {
    const { routes, unannotated } = await scanRoutes();

    expect(routes).not.toEqual([]);
    expect(unannotated).toEqual([]);
  }, 60_000);
});
