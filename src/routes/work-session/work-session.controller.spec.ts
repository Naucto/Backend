import { Test, TestingModule } from "@nestjs/testing";
import { WorkSessionController } from "./work-session.controller";
import { WorkSessionService } from "./work-session.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { WebRTCService } from "@webrtc/webrtc.service";

jest.mock("@webrtc/server/webrtc.server.yjs");

describe("WorkSessionController", () => {
  let controller: WorkSessionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkSessionController],
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

    controller = module.get<WorkSessionController>(WorkSessionController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
