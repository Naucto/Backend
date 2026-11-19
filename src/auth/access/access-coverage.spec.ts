import { globSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { Access, ACCESS_KEY, ALLOWED_WHILE_SUSPENDED_KEY } from './access.decorators';

const SOURCE_ROOT = join(__dirname, '..', '..');

/**
 * Every write a suspended account keeps: leaving, withdrawing its own content, and looking after
 * its own account. Opening one more is a decision, so it is made here as well as on the route.
 */
const KEPT_WHILE_SUSPENDED = [
  'AnalyticsIngestController.link',
  'AuthController.changePassword',
  'AuthController.logout',
  'MultiplayerController.leave',
  'NotificationsController.markAllAsRead',
  'NotificationsController.markAsRead',
  'ProjectCommentController.deleteComment',
  'ProjectContentController.unpublish',
  'ProjectController.remove',
  'ReportsController.updatePrompt',
  'UserAnalyticsController.erase',
  'UserController.deleteMe',
  'UserController.removeProfileBackground',
  'UserController.removeProfilePicture',
  'WorkSessionController.leave',
];

interface ScannedRoute {
  handler: string;
  method: string;
  allowedWhileSuspended: boolean;
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
          handler: `${exported.name}.${name}`,
          method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '',
          allowedWhileSuspended: Reflect.getMetadata(ALLOWED_WHILE_SUSPENDED_KEY, handler) === true,
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

  // `admin/auth` is how a staff session is opened, so it cannot ask for one.
  it('asks a staff session of every route of the admin console but its sign-in', () => {
    const adminRoutes = routes.filter(
      (route) => route.controllerPath.startsWith('admin/') && route.controllerPath !== 'admin/auth',
    );

    expect(adminRoutes).not.toEqual([]);
    expect(namesOf(adminRoutes.filter((route) => route.access?.kind !== 'staff'))).toEqual([]);
  });

  it('keeps open to a suspended account exactly the writes listed here', () => {
    const kept = routes.filter((route) => route.allowedWhileSuspended);

    expect(kept.map((route) => route.handler).sort()).toEqual(KEPT_WHILE_SUSPENDED);
  });

  // A read is open to a suspended account anyway and a public route never asks who calls, so the
  // mark on either would say something that is not true.
  it('marks as kept only writes that ask for an account', () => {
    const kept = routes.filter((route) => route.allowedWhileSuspended);

    expect(namesOf(kept.filter((route) => route.method === 'GET'))).toEqual([]);
    expect(namesOf(kept.filter((route) => route.access?.kind !== 'auth'))).toEqual([]);
  });

  // The web app only ever holds the token of a site sign-in, which a staff route refuses.
  it('asks a staff session of no route outside the admin console', () => {
    const outside = routes.filter((route) => !route.controllerPath.startsWith('admin/'));

    expect(namesOf(outside.filter((route) => route.access?.kind === 'staff'))).toEqual([]);
  });
});
