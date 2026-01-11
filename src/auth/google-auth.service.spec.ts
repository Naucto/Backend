import { Test, TestingModule } from "@nestjs/testing";
import { GoogleAuthService } from "./google-auth.service";
import { UnauthorizedException } from "@nestjs/common";

jest.mock("google-auth-library", () => {
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: jest.fn(),
    })),
  };
});

type MockLoginTicket = {
  getPayload: () => any;
};

describe("GoogleAuthService", () => {
  let service: GoogleAuthService;
  let mockOAuth2Client: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GoogleAuthService],
    }).compile();

    service = module.get<GoogleAuthService>(GoogleAuthService);
    mockOAuth2Client = service["client"];
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("verifyGoogleToken", () => {
    it("should throw UnauthorizedException when token verification fails", async () => {
      mockOAuth2Client.verifyIdToken.mockRejectedValue(new Error("Invalid token"));

      await expect(service.verifyGoogleToken("invalid-token"))
        .rejects
        .toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when payload is missing", async () => {
      const mockTicket: MockLoginTicket = {
        getPayload: jest.fn().mockReturnValue(null),
      };
      mockOAuth2Client.verifyIdToken.mockResolvedValue(mockTicket);

      await expect(service.verifyGoogleToken("token-without-payload"))
        .rejects
        .toThrow(UnauthorizedException);
    });

    it("should return user payload when token is valid", async () => {
      const mockPayload = {
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/picture.jpg",
        sub: "google-id-123",
      };

      const mockTicket: MockLoginTicket = {
        getPayload: jest.fn().mockReturnValue(mockPayload),
      };

      mockOAuth2Client.verifyIdToken.mockResolvedValue(mockTicket);

      const result = await service.verifyGoogleToken("valid-token");

      expect(result).toEqual({
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/picture.jpg",
        googleId: "google-id-123",
      });

      expect(mockOAuth2Client.verifyIdToken).toHaveBeenCalledWith({
        idToken: "valid-token",
        audience: process.env["GOOGLE_CLIENT_ID"],
      });
    });

    it("should handle missing optional fields in payload", async () => {
      const mockPayload = {
        email: "test@example.com",
        name: "Test User",
        sub: "google-id-123",
      };

      const mockTicket: MockLoginTicket = {
        getPayload: jest.fn().mockReturnValue(mockPayload),
      };

      mockOAuth2Client.verifyIdToken.mockResolvedValue(mockTicket);

      const result = await service.verifyGoogleToken("valid-token");

      expect(result).toEqual({
        email: "test@example.com",
        name: "Test User",
        picture: undefined,
        googleId: "google-id-123",
      });
    });
  });
});
