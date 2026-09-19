import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { UpdateProjectDto } from "./update-project.dto";

const errorsOn = (body: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(UpdateProjectDto, body), { whitelist: true })
    .map((e) => e.property);

/**
 * The update route is a PUT, so a caller sends the whole project. The optional fields are the ones
 * a caller may still leave out, and every one of them has to say so: without `@IsOptional()` an
 * absent field is validated as `undefined` and fails every other rule on it, which is reported as
 * a complaint about a value nobody sent.
 */
describe("UpdateProjectDto", () => {
  const required = { name: "A game", shortDesc: "Short" };

  it("accepts an update that leaves the optional fields out", () => {
    expect(errorsOn({ ...required, status: "COMPLETED" })).toEqual([]);
  });

  it.each([
    [ "a description", "longDesc" ],
    [ "tags", "tags" ],
    [ "an icon", "iconUrl" ],
    [ "a status", "status" ],
    [ "a monetization", "monetization" ],
    [ "a price", "price" ]
  ])("does not ask for %s that was not sent", (_case, field) => {
    expect(errorsOn(required)).not.toContain(field);
  });

  it("still refuses a description past its limit", () => {
    expect(errorsOn({ ...required, longDesc: "x".repeat(301) })).toContain("longDesc");
  });

  it("still asks for the fields a project cannot be without", () => {
    expect(errorsOn({}).sort()).toEqual([ "name", "shortDesc" ]);
  });
});
