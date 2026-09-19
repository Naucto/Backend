import { IsEmail, IsInt, MinLength, ValidateNested, validateSync } from "class-validator";
import { Type } from "class-transformer";
import { collectViolations, violation } from "./violation";

class Inner {
  @IsInt()
    port!: number;
}

class Outer {
  @IsEmail({}, { context: violation("EMAIL_INVALID") })
    email!: string;

  @MinLength(8)
    password!: string;

  @ValidateNested({ each: true })
  @Type(() => Inner)
    servers!: Inner[];
}

function violationsOf(instance: object): ReturnType<typeof collectViolations> {
  return collectViolations(validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }));
}

describe("collectViolations", () => {
  it("prefers the code a validator was given over anything derived", () => {
    const instance = Object.assign(new Outer(), { email: "nope", password: "abcdefgh", servers: [] });

    expect(violationsOf(instance)).toEqual([ { field: "email", code: "EMAIL_INVALID" } ]);
  });

  it("names the constraint when no code was given, and never the property", () => {
    const instance = Object.assign(new Outer(), { email: "a@b.co", password: "short", servers: [] });

    expect(violationsOf(instance)).toEqual([ { field: "password", code: "MIN_LENGTH" } ]);
  });

  it("reaches a field inside an array by the path a form would mark", () => {
    const instance = Object.assign(new Outer(), {
      email: "a@b.co",
      password: "abcdefgh",
      servers: [ Object.assign(new Inner(), { port: "not a port" }) ]
    });

    expect(violationsOf(instance)).toEqual([ { field: "servers.0.port", code: "IS_INT" } ]);
  });

  it("says which unknown field was refused", () => {
    const instance = Object.assign(new Outer(), {
      email: "a@b.co",
      password: "abcdefgh",
      servers: [],
      smuggled: true
    });

    expect(violationsOf(instance)).toContainEqual({ field: "smuggled", code: "UNKNOWN_FIELD" });
  });

  it("reports every field that broke a rule", () => {
    const instance = Object.assign(new Outer(), { email: "nope", password: "x", servers: [] });

    expect(violationsOf(instance)).toEqual([
      { field: "email", code: "EMAIL_INVALID" },
      { field: "password", code: "MIN_LENGTH" }
    ]);
  });
});
