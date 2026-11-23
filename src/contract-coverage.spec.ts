import { DECORATORS } from '@nestjs/swagger/dist/constants';

import { ScannedRoute, scanRoutes } from '../test/routes';

const namesOf = (routes: ScannedRoute[]): string[] => routes.map((route) => route.name);

// The generated client is built from these annotations alone: a route without them reaches the
// frontend unnamed, ungrouped, or answering `unknown`.
describe('the contract', () => {
  let routes: ScannedRoute[];

  beforeAll(async () => {
    routes = await scanRoutes();
  }, 60_000);

  it('says in one line what every route does', () => {
    const summaryOf = (route: ScannedRoute): unknown =>
      Reflect.getMetadata(DECORATORS.API_OPERATION, route.targets.handler)?.summary;

    expect(routes).not.toEqual([]);
    expect(namesOf(routes.filter((route) => !summaryOf(route)))).toEqual([]);
  });

  it('files every route under a tag, through its controller', () => {
    const tagsOf = (route: ScannedRoute): unknown[] =>
      Reflect.getMetadata(DECORATORS.API_TAGS, route.targets.controller) ?? [];

    expect(namesOf(routes.filter((route) => tagsOf(route).length === 0))).toEqual([]);
  });

  // Nest documents a success of its own when none is declared, with no type: the answer of the
  // route is then missing from the client without anything failing.
  it('declares what every route answers when it succeeds', () => {
    const statusesOf = (route: ScannedRoute): string[] =>
      Object.keys(Reflect.getMetadata(DECORATORS.API_RESPONSE, route.targets.handler) ?? {});

    expect(
      namesOf(routes.filter((route) => !statusesOf(route).some((status) => /^[23]/.test(status)))),
    ).toEqual([]);
  });
});
