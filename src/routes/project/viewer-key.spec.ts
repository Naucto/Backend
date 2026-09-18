import { viewerKeyOf } from "./viewer-key";

describe("viewerKeyOf", () => {
  it("names a signed-in reader by id", () => {
    expect(viewerKeyOf(7, "10.0.0.1", "s")).toBe("u:7");
  });

  it("gives the same anonymous reader the same key, and keeps the address out of it", () => {
    const key = viewerKeyOf(null, "203.0.113.9", "s");

    expect(viewerKeyOf(null, "203.0.113.9", "s")).toBe(key);
    expect(key).not.toContain("203.0.113.9");
    expect(key).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("changes with the secret", () => {
    expect(viewerKeyOf(null, "203.0.113.9", "a")).not.toBe(
      viewerKeyOf(null, "203.0.113.9", "b")
    );
  });
});
