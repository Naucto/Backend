import { Test, TestingModule } from "@nestjs/testing";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { AccountDeletionService } from "./account-deletion.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Service } from "@s3/s3.service";
import { EdgeService } from "src/routes/s3/edge.service";
import { ConfigService } from "@nestjs/config";
import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  INestApplication,
  NotFoundException
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import request from "supertest";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RolesGuard } from "@auth/guards/roles.guard";
import { ROLES_KEY } from "@auth/decorators/roles.decorator";

// The signature detector is an ES module this Jest setup cannot load, and the upload validator
// refuses every file without it.
jest.mock("load-esm", () => ({
  loadEsm: async (): Promise<unknown> => ({
    fileTypeFromBuffer: async (buffer: Buffer): Promise<{ mime: string } | undefined> =>
      buffer.subarray(0, 6).toString("latin1") === "GIF89a" ? { mime: "image/gif" } : undefined
  })
}));

describe("UserController", () => {
  let module: TestingModule;
  let controller: UserController;
  let userService: UserService;
  let s3Service: S3Service;
  let edgeService: EdgeService;
  let prisma: {
    user: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; count: jest.Mock };
  };
  const accountDeletion = { deleteAccount: jest.fn() };

  beforeEach(async () => {
    accountDeletion.deleteAccount.mockReset();

    module = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        { provide: AccountDeletionService, useValue: accountDeletion },
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn(),
            user: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              count: jest.fn()
            }
          }
        },
        {
          provide: S3Service,
          useValue: {
            uploadFile: jest.fn(),
            deleteFile: jest.fn(),
            getFileMetadataOrNull: jest.fn(),
            setObjectPublicRead: jest.fn()
          }
        },
        {
          provide: EdgeService,
          useValue: {
            getCDNUrl: jest.fn((key: string) => `https://cdn.example/${key}`)
          }
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn()
          }
        }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext): boolean => {
          context.switchToHttp().getRequest().user = { id: 7 };
          return true;
        }
      })
      .compile();

    controller = module.get<UserController>(UserController);
    userService = module.get<UserService>(UserService);
    s3Service = module.get<S3Service>(S3Service);
    edgeService = module.get<EdgeService>(EdgeService);
    prisma = module.get(PrismaService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("GET /users/profile", () => {
    const row = {
      id: 7,
      email: "louis@example.com",
      username: "louis",
      nickname: null,
      createdAt: new Date("2025-03-14T09:00:00.000Z"),
      password: "bcrypt-hash",
      friendCode: "7K3QW9ZB",
      sessionJoinPolicy: "ANYONE",
      deletedAt: null
    };

    it("answers with the declared fields and nothing else of the row", async () => {
      (s3Service.getFileMetadataOrNull as jest.Mock)
        .mockResolvedValueOnce({ ETag: "\"abc\"" })
        .mockResolvedValueOnce(null);

      await expect(controller.getProfile({ user: row } as any)).resolves.toEqual({
        id: 7,
        email: "louis@example.com",
        username: "louis",
        nickname: null,
        createdAt: row.createdAt,
        profileImageUrl: "https://cdn.example/users/7/profile?v=abc",
        backgroundImageUrl: null
      });
    });

    it("still answers when the image store cannot be read", async () => {
      (s3Service.getFileMetadataOrNull as jest.Mock).mockRejectedValue(new Error("timeout"));

      await expect(controller.getProfile({ user: row } as any)).resolves.toMatchObject({
        id: 7,
        profileImageUrl: null,
        backgroundImageUrl: null
      });
    });
  });

  describe("PATCH /users/profile", () => {
    const req = { user: { id: 7 } } as any;

    beforeEach(() => {
      userService.updateMyProfile = jest.fn().mockResolvedValue({ id: 7, username: "louis" });
      (s3Service.getFileMetadataOrNull as jest.Mock).mockResolvedValue(null);
    });

    it("clears a field sent blank", async () => {
      await controller.updateMyProfile({ description: "   " }, req);

      expect(userService.updateMyProfile).toHaveBeenCalledWith(7, { description: null });
    });

    it("leaves alone a field the request does not carry", async () => {
      await controller.updateMyProfile({ colour: "JADE" }, req);

      expect(userService.updateMyProfile).toHaveBeenCalledWith(7, { colour: "JADE" });
    });

    it("answers with the profile and its two image addresses", async () => {
      const result = await controller.updateMyProfile({ nickname: "Louis" }, req);

      expect(result.data).toEqual({
        id: 7,
        username: "louis",
        profileImageUrl: null,
        backgroundImageUrl: null
      });
    });
  });

  describe("uploadProfileBackground", () => {
    it("throws Forbidden when req.user.id !== id", async () => {
      await expect(
        controller.uploadProfileBackground(
          222,
          { originalname: "bg.png" } as any,
          { user: { id: 111 } } as any
        )
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
  });

  describe("profile image uploads, through the upload pipeline", () => {
    const GIF = Buffer.from("GIF89a<html><script>alert(1)</script></html>");
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    let app: INestApplication;

    beforeEach(async () => {
      app = module.createNestApplication();
      await app.init();
      (s3Service.getFileMetadataOrNull as jest.Mock).mockResolvedValue(null);
    });

    afterEach(async () => {
      await app.close();
    });

    it.each(["profile-picture", "profile-background"])(
      "stores a %s whose declared type and content agree",
      async (route) => {
        await request(app.getHttpServer())
          .post(`/users/7/${route}`)
          .attach("file", GIF, { filename: "a.gif", contentType: "image/gif" })
          .expect(HttpStatus.CREATED);

        expect(s3Service.uploadFile).toHaveBeenCalled();
      }
    );

    it.each(["profile-picture", "profile-background"])(
      "refuses a %s with image content declared as another type",
      async (route) => {
        await request(app.getHttpServer())
          .post(`/users/7/${route}`)
          .attach("file", GIF, { filename: "a.gif", contentType: "text/html" })
          .expect(HttpStatus.UNPROCESSABLE_ENTITY);

        expect(s3Service.uploadFile).not.toHaveBeenCalled();
      }
    );

    it.each(["profile-picture", "profile-background"])(
      "stops reading a %s past the size limit",
      async (route) => {
        await request(app.getHttpServer())
          .post(`/users/7/${route}`)
          .attach("file", Buffer.alloc(MAX_FILE_SIZE + 1), {
            filename: "a.gif",
            contentType: "image/gif"
          })
          .expect(HttpStatus.PAYLOAD_TOO_LARGE);
      }
    );
  });

  describe("removeProfilePicture", () => {
    it("refuses to clear someone else's zone", async () => {
      await expect(
        controller.removeProfilePicture(222, { user: { id: 111 } } as any)
      ).rejects.toBeInstanceOf(HttpException);
    });

    it("answers the same whether or not there was an image", async () => {
      (s3Service.deleteFile as jest.Mock).mockResolvedValue(undefined);

      const result = await controller.removeProfilePicture(7, { user: { id: 7 } } as any);

      expect(s3Service.deleteFile).toHaveBeenCalledWith({ key: "users/7/profile" });
      expect(result).toEqual({ message: "Profile picture removed successfully", id: 7 });
    });
  });

  describe("GET /users/:id/profile-picture", () => {
    it("answers not found when the person has set none", async () => {
      (s3Service.getFileMetadataOrNull as jest.Mock).mockResolvedValue(null);

      await expect(controller.getProfilePicture(7)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it("answers with the versioned address", async () => {
      (s3Service.getFileMetadataOrNull as jest.Mock).mockResolvedValue({ ETag: "\"abc\"" });

      await expect(controller.getProfilePicture(7)).resolves.toEqual({
        resourceUrl: "https://cdn.example/users/7/profile?v=abc"
      });
      expect(edgeService.getCDNUrl).toHaveBeenCalledWith("users/7/profile");
    });
  });

  describe("/users/me", () => {
    const req = { user: { id: 7 } } as any;

    it("returns the account settings", async () => {
      userService.getMe = jest.fn().mockResolvedValue({
        friendCode: "7K3QW9ZB",
        sessionJoinPolicy: "ANYONE"
      });

      await expect(controller.getMe(req)).resolves.toEqual({
        friendCode: "7K3QW9ZB",
        sessionJoinPolicy: "ANYONE"
      });
      expect(userService.getMe).toHaveBeenCalledWith(7);
    });

    it("forwards only the provided fields on update", async () => {
      userService.updateMe = jest.fn().mockResolvedValue({
        friendCode: "7K3QW9ZB",
        sessionJoinPolicy: "FRIENDS"
      });

      await controller.updateMe(req, { sessionJoinPolicy: "FRIENDS" });
      expect(userService.updateMe).toHaveBeenCalledWith(7, {
        sessionJoinPolicy: "FRIENDS"
      });

      await controller.updateMe(req, {});
      expect(userService.updateMe).toHaveBeenLastCalledWith(7, {});
    });

    it("regenerates the friend code", async () => {
      userService.regenerateFriendCode = jest.fn().mockResolvedValue({
        friendCode: "NEWCODE1",
        sessionJoinPolicy: "ANYONE"
      });

      await expect(controller.regenerateFriendCode(req)).resolves.toEqual({
        friendCode: "NEWCODE1",
        sessionJoinPolicy: "ANYONE"
      });
    });
  });

  describe("DELETE /users/me", () => {
    it("deletes the account and clears the refresh cookie", async () => {
      accountDeletion.deleteAccount.mockResolvedValue(undefined);
      const res = { clearCookie: jest.fn() } as any;

      await controller.deleteMe(
        { user: { id: 7 } } as any,
        { confirmation: "DELETE", removePublishedGames: true },
        res
      );

      expect(accountDeletion.deleteAccount).toHaveBeenCalledWith(7, true, undefined);
      expect(res.clearCookie).toHaveBeenCalledWith(
        "refresh_token",
        expect.objectContaining({ path: "/auth/refresh", httpOnly: true })
      );
    });

    it("does not clear the cookie when deletion fails", async () => {
      accountDeletion.deleteAccount.mockRejectedValue(new Error("boom"));
      const res = { clearCookie: jest.fn() } as any;

      await expect(
        controller.deleteMe({ user: { id: 7 } } as any, { confirmation: "DELETE" }, res)
      ).rejects.toThrow("boom");
      expect(res.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe("the account routes", () => {
    const account = { id: 9, email: "ada@example.com", username: "ada" };

    it.each(["findAll", "findOne", "update", "remove"] as const)(
      "%s is open to admins only",
      (handler) => {
        const method = UserController.prototype[handler];

        expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual([JwtAuthGuard, RolesGuard]);
        expect(Reflect.getMetadata(ROLES_KEY, method)).toEqual(["Admin"]);
      }
    );

    it("the list selects its columns, the password hash not among them", async () => {
      prisma.user.findMany.mockResolvedValue([account]);
      prisma.user.count.mockResolvedValue(1);

      await controller.findAll({});

      const { select } = prisma.user.findMany.mock.calls[0][0];
      expect(select).toMatchObject({ id: true, email: true });
      expect(select).not.toHaveProperty("password");
    });

    it("one account selects its columns, the password hash not among them", async () => {
      prisma.user.findUnique.mockResolvedValue(account);

      await controller.findOne(9);

      const { select } = prisma.user.findUnique.mock.calls[0][0];
      expect(select).toMatchObject({ id: true, email: true });
      expect(select).not.toHaveProperty("password");
    });

    it("an update selects its columns, the password hash not among them", async () => {
      prisma.user.update.mockResolvedValue(account);

      await controller.update(9, { nickname: "Ada" });

      const { select } = prisma.user.update.mock.calls[0][0];
      expect(select).toMatchObject({ id: true, email: true });
      expect(select).not.toHaveProperty("password");
    });
  });

  describe("DELETE /users/:id", () => {
    it("goes through account deletion, keeping the published games", async () => {
      accountDeletion.deleteAccount.mockResolvedValue(undefined);

      await expect(controller.remove(9)).resolves.toEqual({
        statusCode: HttpStatus.OK,
        message: "User deleted successfully"
      });
      expect(accountDeletion.deleteAccount).toHaveBeenCalledWith(9, false);
    });

    it("answers not found for an unknown id", async () => {
      accountDeletion.deleteAccount.mockRejectedValue(new NotFoundException("User not found"));

      await expect(controller.remove(9)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
