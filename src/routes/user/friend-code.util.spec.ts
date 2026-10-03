import {
  FRIEND_CODE_ALPHABET,
  FRIEND_CODE_LENGTH,
  generateFriendCode,
  normalizeFriendCode
} from "./friend-code.util";

describe("friend-code.util", () => {
  it("generates codes of the right length from the Crockford alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateFriendCode();
      expect(code).toHaveLength(FRIEND_CODE_LENGTH);
      for (const char of code) {
        expect(FRIEND_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("normalizes case, separators and decode aliases", () => {
    expect(normalizeFriendCode("7k3q-w9zb")).toBe("7K3QW9ZB");
    expect(normalizeFriendCode("7K3Q W9ZB")).toBe("7K3QW9ZB");
    expect(normalizeFriendCode("oIl1abcd")).toBe("0111ABCD");
  });

  it("rejects malformed codes", () => {
    expect(normalizeFriendCode("short")).toBeNull();
    expect(normalizeFriendCode("7K3QW9ZBX")).toBeNull();
    expect(normalizeFriendCode("7K3QW9ZU")).toBeNull();
  });
});
