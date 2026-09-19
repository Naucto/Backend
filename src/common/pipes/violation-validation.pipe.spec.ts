import { ArgumentMetadata, BadRequestException, ValidationPipe } from "@nestjs/common";
import { CreateUserDto } from "@user/dto/create-user.dto";
import { ViolationValidationPipe } from "./violation-validation.pipe";

const OPTIONS = { whitelist: true, forbidNonWhitelisted: true, transform: true };
const BODY: ArgumentMetadata = { type: "body", metatype: CreateUserDto, data: undefined };

async function rejectionOf(pipe: ValidationPipe, payload: unknown): Promise<Record<string, unknown>> {
  try {
    await pipe.transform(payload, BODY);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse() as Record<string, unknown>;
  }

  throw new Error("expected the payload to be rejected");
}

describe("ViolationValidationPipe", () => {
  const pipe = new ViolationValidationPipe(OPTIONS);

  it("names the field and the rule alongside the prose", async () => {
    const body = await rejectionOf(pipe, {
      email: "user@example.com",
      username: "someone",
      password: "abc"
    });

    expect(body["statusCode"]).toBe(400);
    expect(body["error"]).toBe("Bad Request");
    // Both rules broke; which comes first is class-validator's business, so do not pin it.
    expect(body["violations"]).toEqual(
      expect.arrayContaining([
        { field: "password", code: "PASSWORD_TOO_SHORT" },
        { field: "password", code: "PASSWORD_TOO_WEAK" }
      ])
    );
    expect(body["violations"]).toHaveLength(2);
  });

  it("says which field it did not expect", async () => {
    const body = await rejectionOf(pipe, {
      email: "user@example.com",
      username: "someone",
      password: "correct-horse-1",
      smuggled: true
    });

    expect(body["violations"]).toEqual([ { field: "smuggled", code: "UNKNOWN_FIELD" } ]);
  });

  /**
   * The lock on everything this pipe governs. It is global, so a reworded `message` would reword
   * every endpoint in the API at once, and no other test would notice.
   */
  it("words the rejection exactly as the stock pipe does", async () => {
    const stock = new ValidationPipe(OPTIONS);
    const payloads = [
      { password: "abc" },
      { email: "nope", username: "x", password: "" },
      { email: "user@example.com", username: "someone", password: "aaaaaaaa", roles: 7 }
    ];

    for (const payload of payloads) {
      const ours = await rejectionOf(pipe, payload);
      const theirs = await rejectionOf(stock, payload);

      expect(ours["message"]).toEqual(theirs["message"]);
    }
  });
});
