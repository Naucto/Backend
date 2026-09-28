import { positiveNumber } from "./s3-numbers";

describe("positiveNumber", () => {
  it("uses the value when it is a positive number", () => {
    expect(positiveNumber("2500", 5000)).toBe(2500);
  });

  it("falls back when the key is absent", () => {
    expect(positiveNumber(undefined, 5000)).toBe(5000);
  });

  it("falls back on a blank value, which is what copying .env.example gives", () => {
    // The whole point. `.env.example` lists every key empty for a person to fill in, so `cp
    // .env.example .env` leaves them set to "". An empty string is not absent: `Number("")` is 0 and
    // `0 ?? default` is 0, so a blank key silently became a save queue that refused every save and a
    // request timeout the HTTP handler then read as "no timeout at all".
    expect(positiveNumber("", 5000)).toBe(5000);
    expect(positiveNumber("   ", 5000)).toBe(5000);
  });

  it("falls back on zero and on a negative number, rather than accepting a deadline of nothing", () => {
    // Zero is worse than a default: the handler skips a falsy timeout, so 0 is not a tight deadline,
    // it is the absence of one.
    expect(positiveNumber("0", 5000)).toBe(5000);
    expect(positiveNumber("-1", 5000)).toBe(5000);
  });

  it("falls back on something that is not a number at all", () => {
    expect(positiveNumber("soon", 5000)).toBe(5000);
    expect(positiveNumber("Infinity", 5000)).toBe(5000);
  });
});
