import { Test, TestingModule } from "@nestjs/testing";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { AccountDeletionService } from "./account-deletion.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "src/routes/s3/edge.service";
import { ConfigService } from "@nestjs/config";
import { HttpException, HttpStatus } from "@nestjs/common";

describe("UserController", () => {
  let controller: UserController;
  let userService: UserService;
  const accountDeletion = { deleteAccount: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
              delete: jest.fn(),
              count: jest.fn()
            }
          }
        },
        {
          provide: S3Service,
          useValue: {
            uploadFile: jest.fn(),
            fileExists: jest.fn(),
            downloadFile: jest.fn(),
            deleteFile: jest.fn()
          }
        },
        {
          provide: CloudfrontService,
          useValue: {
            getCDNUrl: jest.fn(),
            createSignedCookies: jest.fn(),
            getCookieDomain: jest.fn(),
            generateSignedUrl: jest.fn()
          }
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn()
          }
        }
      ]
    }).compile();

    controller = module.get<UserController>(UserController);
    userService = module.get<UserService>(UserService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("uploadProfileBackground", () => {
    it("throws Forbidden when req.user.id !== id", async () => {
      try {
        await controller.uploadProfileBackground(
          222,
          { originalname: "bg.png" } as any,
          { user: { id: 111 } } as any
        );
        throw new Error("Expected uploadProfileBackground to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      }
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

      expect(accountDeletion.deleteAccount).toHaveBeenCalledWith(7, {
        removePublishedGames: true
      });
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
});
