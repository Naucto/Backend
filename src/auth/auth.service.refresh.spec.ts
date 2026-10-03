import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { PrismaService } from "@ourPrisma/prisma.service";
import { UserService } from "@user/user.service";
import { AuthService } from "./auth.service";
import { GithubAuthService } from "./providers/github-auth.service";
import { GoogleAuthService } from "./providers/google-auth.service";
import { MicrosoftAuthService } from "./providers/microsoft-auth.service";

const USER = { id: 7, email: "ada@example.com" };

interface StoredToken {
  id: number;
  token: string;
  userId: number;
  expiresAt: Date;
}

interface TokenWhere {
  id?: number;
  userId?: number;
}

/** The refresh-token table, with the unique column and the missing-row failure the real one has. */
class TokenStore {
  rows: StoredToken[] = [];
  private nextId = 1;

  readonly refreshToken = {
    create: async ({ data }: { data: Omit<StoredToken, "id"> }): Promise<StoredToken> => {
      if (this.rows.some((row) => row.token === data.token)) {
        throw new Error("Unique constraint failed on the fields: (`token`)");
      }

      const row = { id: this.nextId++, ...data };
      this.rows.push(row);

      return row;
    },
    findUnique: async ({ where }: { where: { token: string } }): Promise<unknown> => {
      const row = this.rows.find((candidate) => candidate.token === where.token);

      return row ? { ...row, user: USER } : null;
    },
    delete: async ({ where }: { where: { id: number } }): Promise<StoredToken> => {
      const index = this.rows.findIndex((row) => row.id === where.id);
      const [ removed ] = index < 0 ? [] : this.rows.splice(index, 1);

      if (!removed) {
        throw new Error("Record to delete does not exist");
      }

      return removed;
    },
    deleteMany: async ({ where }: { where: TokenWhere }): Promise<{ count: number }> => {
      const kept = this.rows.filter(
        (row) =>
          (where.id !== undefined && row.id !== where.id) ||
          (where.userId !== undefined && row.userId !== where.userId)
      );
      const count = this.rows.length - kept.length;
      this.rows = kept;

      return { count };
    }
  };

  $transaction<T>(work: (tx: TokenStore) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe("AuthService refresh tokens, against a store that behaves like the table", () => {
  let service: AuthService;
  let store: TokenStore;

  const signIn = async (): Promise<string> =>
    (await service.loginWithGoogleCode("code", "verifier")).refresh_token;

  beforeEach(async () => {
    store = new TokenStore();

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: new JwtService({ secret: "a-secret-only-this-spec-knows" }) },
        { provide: PrismaService, useValue: store },
        { provide: ConfigService, useValue: { get: (): undefined => undefined } },
        { provide: UserService, useValue: { findByEmail: async () => USER } },
        {
          provide: GoogleAuthService,
          useValue: { getUserFromCode: async () => ({ email: USER.email, name: "Ada" }) }
        },
        { provide: GithubAuthService, useValue: {} },
        { provide: MicrosoftAuthService, useValue: {} }
      ]
    }).compile();

    service = module.get(AuthService);
  });

  it("keeps nothing in the table that could be presented as a token", async () => {
    const token = await signIn();

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.token).not.toBe(token);
  });

  it("refuses a token that a refresh has rotated out", async () => {
    const first = await signIn();
    const { refresh_token: second } = await service.refreshToken(first);

    await expect(service.refreshToken(first)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refreshToken(second)).resolves.toEqual(
      expect.objectContaining({ refresh_token: expect.any(String) })
    );
  });

  it("refuses a token from before a logout, even once the user has signed in again", async () => {
    const captured = await signIn();
    await service.revokeAllRefreshTokens(USER.id);
    await signIn();

    await expect(service.refreshToken(captured)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("consumes only the presented token when the user holds two sessions", async () => {
    const laptop = await signIn();
    const phone = await signIn();

    await service.refreshToken(laptop);

    await expect(service.refreshToken(laptop)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refreshToken(phone)).resolves.toBeDefined();
    expect(store.rows).toHaveLength(2);
  });

  it("answers the loser of a concurrent refresh with 401 and leaves no orphan row", async () => {
    const token = await signIn();

    const outcomes = await Promise.allSettled([
      service.refreshToken(token),
      service.refreshToken(token)
    ]);

    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toBeInstanceOf(UnauthorizedException);
    expect(store.rows).toHaveLength(1);
  });
});
