import { Test } from "@nestjs/testing";
import { RequestWithUser } from "@auth/auth.types";
import { FriendsController, UserFriendshipController } from "./friends.controller";
import { FriendsService } from "./friends.service";

describe("FriendsController", () => {
  let controller: FriendsController;
  let friendshipController: UserFriendshipController;
  const friendsService = {
    list: jest.fn(),
    requests: jest.fn(),
    sendRequest: jest.fn(),
    accept: jest.fn(),
    decline: jest.fn(),
    remove: jest.fn(),
    recentPlayers: jest.fn(),
    friendshipStatus: jest.fn()
  };
  const req = { user: { id: 7 } } as RequestWithUser;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [FriendsController, UserFriendshipController],
      providers: [{ provide: FriendsService, useValue: friendsService }]
    }).compile();

    controller = module.get(FriendsController);
    friendshipController = module.get(UserFriendshipController);
  });

  it("delegates every route to the service with the caller id", async () => {
    friendsService.list.mockResolvedValue([]);
    friendsService.requests.mockResolvedValue([]);
    friendsService.sendRequest.mockResolvedValue(null);
    friendsService.recentPlayers.mockResolvedValue([]);
    friendsService.friendshipStatus.mockResolvedValue("NONE");

    await controller.list(req);
    await controller.requests(req);
    await controller.send(req, { friendCode: "7K3QW9ZB" });
    await controller.accept(req, 4);
    await controller.decline(req, 5);
    await controller.remove(req, 2);
    await controller.recentPlayers(req, 14);
    await expect(friendshipController.friendship(req, 2)).resolves.toEqual({
      status: "NONE"
    });

    expect(friendsService.list).toHaveBeenCalledWith(7);
    expect(friendsService.requests).toHaveBeenCalledWith(7);
    expect(friendsService.sendRequest).toHaveBeenCalledWith(7, {
      friendCode: "7K3QW9ZB"
    });
    expect(friendsService.accept).toHaveBeenCalledWith(7, 4);
    expect(friendsService.decline).toHaveBeenCalledWith(7, 5);
    expect(friendsService.remove).toHaveBeenCalledWith(7, 2);
    expect(friendsService.recentPlayers).toHaveBeenCalledWith(7, 14);
    expect(friendsService.friendshipStatus).toHaveBeenCalledWith(7, 2);
  });
});
