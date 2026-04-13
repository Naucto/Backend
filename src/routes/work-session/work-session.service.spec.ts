import { Test, TestingModule } from "@nestjs/testing";
import { WorkSessionService } from "./work-session.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { WebRTCService } from "@webrtc/webrtc.service";
import { YjsWebRTCServer } from "@webrtc/server/webrtc.server.yjs";

jest.mock("@webrtc/server/webrtc.server.yjs");

describe("WorkSessionService", () => {
  let service: WorkSessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkSessionService,
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn()
          }
        },
        {
          provide: WebRTCService,
          useValue: {
            registerServer: jest.fn(),
            shutdownAllServers: jest.fn()
          }
        }
      ]
    }).compile();

    // Ensure the mock was created without starting a server
    expect(YjsWebRTCServer).toHaveBeenCalledTimes(1);

    service = module.get<WorkSessionService>(WorkSessionService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
