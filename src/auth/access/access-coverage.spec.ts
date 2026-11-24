import { namesOf, ScannedRoute, scanRoutes } from '../../../test/routes';
import { Access, ACCESS_KEY, ALLOWED_WHILE_SUSPENDED_KEY } from './access.decorators';

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

interface AccessRoute extends ScannedRoute {
  allowedWhileSuspended: boolean;
  /** What the handler declares or, failing that, its controller. */
  access: Access | undefined;
}

const withAccess = (route: ScannedRoute): AccessRoute => ({
  ...route,
  allowedWhileSuspended:
    Reflect.getMetadata(ALLOWED_WHILE_SUSPENDED_KEY, route.targets.handler) === true,
  access:
    Reflect.getMetadata(ACCESS_KEY, route.targets.handler) ??
    Reflect.getMetadata(ACCESS_KEY, route.targets.controller),
});

describe('route access', () => {
  let routes: AccessRoute[];

  beforeAll(async () => {
    routes = (await scanRoutes()).map(withAccess);
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
