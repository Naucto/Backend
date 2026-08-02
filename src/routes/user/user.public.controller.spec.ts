import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { UserPublicController } from "./user.public.controller";
import { UserService } from "./user.service";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "src/routes/s3/edge.service";
import { ProjectService } from "@project/project.service";

describe("UserPublicController", () => {
  let controller: UserPublicController;
  let userService: { findPublicProfileByUsername: jest.Mock };
  let s3Service: { getFileMetadataOrNull: jest.Mock };
  let cloudfrontService: { getCDNUrl: jest.Mock };

  beforeEach(async () => {
    userService = {
      findPublicProfileByUsername: jest.fn()
    };
    s3Service = {
      getFileMetadataOrNull: jest.fn()
    };
    cloudfrontService = {
      getCDNUrl: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserPublicController],
      providers: [
        {
          provide: UserService,
          useValue: userService
        },
        {
          provide: S3Service,
          useValue: s3Service
        },
        {
          provide: CloudfrontService,
          useValue: cloudfrontService
        },
        {
          provide: ProjectService,
          useValue: {}
        }
      ]
    }).compile();

    controller = module.get<UserPublicController>(UserPublicController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("getPublicProfileByUsername", () => {
    it("should return a public user profile response", async () => {
      const publicProfile = {
        id: 1,
        username: "Madeline",
        nickname: "Maddy",
        description: "Hello"
      };

      userService.findPublicProfileByUsername.mockResolvedValue(publicProfile);
      s3Service.getFileMetadataOrNull
        .mockResolvedValueOnce({ ETag: "\"profile-etag\"" })
        .mockResolvedValueOnce(null);
      cloudfrontService.getCDNUrl.mockReturnValue("https://cdn.example.com/profile");

      await expect(controller.getPublicProfileByUsername("Madeline")).resolves.toEqual({
        statusCode: HttpStatus.OK,
        message: "Public user profile retrieved successfully",
        data: {
          ...publicProfile,
          profileImageUrl: "https://cdn.example.com/profile?v=profile-etag",
          backgroundImageUrl: null
        }
      });
      expect(userService.findPublicProfileByUsername).toHaveBeenCalledWith("Madeline");
      expect(s3Service.getFileMetadataOrNull).toHaveBeenCalledWith("users/1/profile");
      expect(s3Service.getFileMetadataOrNull).toHaveBeenCalledWith("users/1/background");
    });
  });
});
