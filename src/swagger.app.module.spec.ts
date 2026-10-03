import { DynamicModule, ForwardReference, Type } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { AppModule } from "./app.module";
import { SwaggerAppModule } from "./swagger.app.module";

type ModuleEntry = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

/** Names of the controllers a module serves, itself and everything it imports. */
async function controllersOf(entry: ModuleEntry, seen = new Set<unknown>()): Promise<string[]> {
  const resolved = await entry;
  const dynamic = "module" in resolved ? resolved : undefined;
  const moduleClass: Type<unknown> =
    dynamic?.module ?? ("forwardRef" in resolved ? resolved.forwardRef() : (resolved as Type<unknown>));

  if (seen.has(moduleClass)) {
    return [];
  }
  seen.add(moduleClass);

  const declared = (key: string): unknown[] => Reflect.getMetadata(key, moduleClass) ?? [];
  const controllers = [ ...declared(MODULE_METADATA.CONTROLLERS), ...(dynamic?.controllers ?? []) ];
  const imports = [ ...declared(MODULE_METADATA.IMPORTS), ...(dynamic?.imports ?? []) ];

  const names = controllers.map((controller) => (controller as Type<unknown>).name);
  for (const imported of imports) {
    names.push(...(await controllersOf(imported as ModuleEntry, seen)));
  }

  return names;
}

describe("SwaggerAppModule", () => {
  it("documents every controller the application serves", async () => {
    const served = await controllersOf(AppModule);
    const documented = await controllersOf(SwaggerAppModule);

    expect([ ...new Set(documented) ].sort()).toEqual([ ...new Set(served) ].sort());
  });
});
