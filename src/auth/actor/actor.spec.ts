import { Actor } from "./actor";

const user = (roles: string[]): Actor => new Actor(1, roles);

describe("Actor", () => {
  describe("role interrogation", () => {
    it("treats an admin as a moderator", () => {
      // Admin implies moderator, so no call site has to list both roles.
      expect(user(["Admin"]).isModerator).toBe(true);
      expect(user(["Admin"]).isAdmin).toBe(true);
    });

    it("does not treat a moderator as an admin", () => {
      expect(user(["Moderator"]).isModerator).toBe(true);
      expect(user(["Moderator"]).isAdmin).toBe(false);
    });

    it("treats a plain user as neither", () => {
      expect(user([]).isModerator).toBe(false);
      expect(user(["User"]).isStaff).toBe(false);
    });

    it("builds from a user record's role relation", () => {
      const actor = Actor.from({ id: 7, roles: [{ name: "Moderator" }] });

      expect(actor.id).toBe(7);
      expect(actor.isModerator).toBe(true);
    });

    it("builds from a user record with no roles loaded", () => {
      expect(Actor.from({ id: 7 }).isModerator).toBe(false);
    });
  });

  describe("ownership", () => {
    it("recognises content it authored", () => {
      expect(user([]).owns({ authorId: 1 })).toBe(true);
      expect(user([]).owns({ userId: 1 })).toBe(true);
    });

    it("does not own content with no owner recorded", () => {
      expect(user([]).owns({ authorId: null })).toBe(false);
    });
  });

  describe("canActOn", () => {
    it("lets an author act on their own content", () => {
      expect(user([]).canActOn({ authorId: 1 })).toBe(true);
    });

    it("refuses a plain user acting on someone else's content", () => {
      expect(user([]).canActOn({ authorId: 2 })).toBe(false);
    });

    it("lets a moderator act on someone else's content", () => {
      // This is the whole point: the ordinary route serves both cases.
      expect(user(["Moderator"]).canActOn({ authorId: 2 })).toBe(true);
    });
  });

  describe("actsAsModeratorOn", () => {
    it("is true only when a moderator touches content that is not theirs", () => {
      expect(user(["Moderator"]).actsAsModeratorOn({ authorId: 2 })).toBe(true);
    });

    it("is false when a moderator edits their own content", () => {
      // Editing your own comment is not a moderation action and must not be
      // written to the audit log as one.
      expect(user(["Moderator"]).actsAsModeratorOn({ authorId: 1 })).toBe(false);
    });

    it("is false for a plain user", () => {
      expect(user([]).actsAsModeratorOn({ authorId: 2 })).toBe(false);
    });
  });
});
