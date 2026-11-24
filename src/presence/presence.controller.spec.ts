import { Test } from '@nestjs/testing';

import { uuidOf } from '../../test/uuid';
import { RequestWithUser } from '../auth/auth.types';
import { UserPresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

describe('PresenceController', () => {
  let userController: UserPresenceController;
  const presenceService = { presenceOf: jest.fn() };
  const req = { user: { id: uuidOf(7) } } as unknown as RequestWithUser;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [UserPresenceController],
      providers: [{ provide: PresenceService, useValue: presenceService }],
    }).compile();

    userController = module.get(UserPresenceController);
  });

  it("asks for the target's presence as seen by the caller", async () => {
    await userController.presence(req, uuidOf(2));

    expect(presenceService.presenceOf).toHaveBeenCalledWith(uuidOf(7), uuidOf(2));
  });
});
