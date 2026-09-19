import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { RequestWithUser } from "@auth/auth.types";
import { PresenceController, UserPresenceController } from "./presence.controller";
import { PresenceService } from "./presence.service";

describe("PresenceController", () => {
  let controller: PresenceController;
  let userController: UserPresenceController;
  const presenceService = { friendsPresence: jest.fn(), presenceOf: jest.fn() };
  const req = { user: { id: 7 } } as RequestWithUser;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [PresenceController, UserPresenceController],
      providers: [{ provide: PresenceService, useValue: presenceService }]
    }).compile();

    controller = module.get(PresenceController);
    userController = module.get(UserPresenceController);
  });

  it("lists friends presence for the caller", async () => {
    presenceService.friendsPresence.mockResolvedValue([{ userId: 2 }]);

    await expect(controller.friends(req)).resolves.toEqual([{ userId: 2 }]);
    expect(presenceService.friendsPresence).toHaveBeenCalledWith(7);
  });

  it("returns a user's presence or 404 when offline", async () => {
    presenceService.presenceOf.mockResolvedValueOnce({ userId: 2, kind: "IDLE" });
    await expect(userController.presence(req, 2)).resolves.toMatchObject({ userId: 2 });
    expect(presenceService.presenceOf).toHaveBeenCalledWith(7, 2);

    presenceService.presenceOf.mockResolvedValueOnce(null);
    await expect(userController.presence(req, 2)).rejects.toBeInstanceOf(NotFoundException);
  });
});
