import { Test, TestingModule } from "@nestjs/testing";
import { WorkSessionService } from "./work-session.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { WebRTCService } from "@webrtc/webrtc.service";
import { YjsWebRTCServer } from "@webrtc/server/webrtc.server.yjs";

jest.mock("@webrtc/server/webrtc.server.yjs");

describe("WorkSessionService", () => {
  let service: WorkSessionService;

  const prismaMock = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    workSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    }
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkSessionService,
        {
          provide: PrismaService,
          useValue: prismaMock
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

  describe("host election", () => {
    const room = (hostId: number, present: number[]): void => {
      prismaMock.workSession.findFirst.mockResolvedValue({
        id: 1,
        projectId: 5,
        hostId,
        users: present.map((id) => ({ id }))
      });
      prismaMock.workSession.update.mockResolvedValue({});
    };
    const after = (hostId: number, present: number[]): void => {
      prismaMock.workSession.findUnique.mockResolvedValue({
        id: 1,
        hostId,
        users: present.map((id) => ({ id }))
      });
    };
    const me = { id: 7 } as Parameters<WorkSessionService["leave"]>[1];

    it("hands the room to the lowest present member when the host leaves", async () => {
      room(7, [7, 9, 3]);
      after(7, [9, 3]);

      await service.leave(5, me);

      expect(prismaMock.workSession.update).toHaveBeenLastCalledWith({
        where: { id: 1 },
        data: { host: { connect: { id: 3 } } }
      });
    });

    it("leaves the host alone when somebody else leaves", async () => {
      room(3, [7, 9, 3]);
      after(3, [9, 3]);

      await service.leave(5, me);

      expect(prismaMock.workSession.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.workSession.update.mock.calls[0]![0].data).not.toHaveProperty("host");
    });

    it("elects when the host is kicked", async () => {
      room(7, [7, 9, 3]);
      after(7, [9, 3]);

      await service.kick(5, 7);

      expect(prismaMock.workSession.update).toHaveBeenLastCalledWith({
        where: { id: 1 },
        data: { host: { connect: { id: 3 } } }
      });
    });

    it("keeps the recorded host over an empty room", async () => {
      room(7, [7]);
      after(7, []);

      await service.leave(5, me);

      expect(prismaMock.workSession.update).toHaveBeenCalledTimes(1);
    });
  });
});
