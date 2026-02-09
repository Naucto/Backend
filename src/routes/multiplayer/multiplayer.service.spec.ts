import { ProjectService } from "@project/project.service";
import { UserService } from "@user/user.service";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { MultiplayerService } from "./multiplayer.service";
import { Test } from "@nestjs/testing";

describe("MultiplayerService", () => {
  let service: MultiplayerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [MultiplayerService, ProjectService, UserService]
    }).compile();

    service = module.get<MultiplayerService>(MultiplayerService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("lookupHosts", () => {

  });
});
