import { globSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

const SOURCE_ROOT = join(__dirname, '..', 'src');

export interface ScannedRoute {
  /** `Controller.handler` */
  handler: string;
  /** `Controller.handler (file)` */
  name: string;
  method: string;
  controllerPath: string;
  /** Where decorators leave their metadata: read it with `Reflect.getMetadata(key, target)`. */
  targets: { controller: object; handler: object };
}

/** Every route of every `*.controller.ts` as its decorators declared it, with no app booted. */
export async function scanRoutes(): Promise<ScannedRoute[]> {
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
          handler: `${exported.name}.${name}`,
          name: `${exported.name}.${name} (${file})`,
          method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '',
          controllerPath: String(Reflect.getMetadata(PATH_METADATA, exported)),
          targets: { controller: exported, handler },
        });
      }
    }
  }

  return routes;
}
