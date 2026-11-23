import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { withEnv } from '../../../test/env';
import { uuidOf } from '../../../test/uuid';
import { UserService } from '../../routes/user/user.service';
import { JwtPayload, STAFF_SCOPE } from '../auth.types';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const userService = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    withEnv({ JWT_SECRET: 'jwt-secret' });

    const module = await Test.createTestingModule({
      providers: [JwtStrategy, { provide: UserService, useValue: userService }],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it('returns the user for a live account', async () => {
    const user = { id: uuidOf(1), deletedAt: null };
    userService.findOne.mockResolvedValue(user);

    const [account] = await strategy.validate({ sub: uuidOf(1), email: 'a@b.c' });

    expect(account).toEqual(user);
  });

  it('keeps the password hash off the request', async () => {
    userService.findOne.mockResolvedValue({
      id: uuidOf(1),
      password: 'bcrypt-hash',
      deletedAt: null,
    });

    const [account] = await strategy.validate({ sub: uuidOf(1), email: 'a@b.c' });

    expect(account).not.toHaveProperty('password');
  });

  it('keeps the player number off the request', async () => {
    userService.findOne.mockResolvedValue({ id: uuidOf(1), playerNumber: 12, deletedAt: null });

    const [account] = await strategy.validate({ sub: uuidOf(1), email: 'a@b.c' });

    expect(account).not.toHaveProperty('playerNumber');
  });

  it.each([12, '12', 'not-an-id', null])(
    'answers 401 to a subject that is not an id (%p), without looking it up',
    async (sub) => {
      await expect(
        strategy.validate({ sub, email: 'a@b.c' } as unknown as JwtPayload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userService.findOne).not.toHaveBeenCalled();
    },
  );

  it('marks the token of the staff sign-in, and no other', async () => {
    userService.findOne.mockResolvedValue({ id: uuidOf(1), deletedAt: null });

    const [, site] = await strategy.validate({ sub: uuidOf(1), email: 'a@b.c' });
    const [, staff] = await strategy.validate({
      sub: uuidOf(1),
      email: 'a@b.c',
      scope: STAFF_SCOPE,
    });

    expect(site).toEqual({ staff: false });
    expect(staff).toEqual({ staff: true });
  });

  it('answers 401, not 404, when the token outlives its account', async () => {
    userService.findOne.mockRejectedValue(
      new NotFoundException(`User with ID ${uuidOf(1)} not found`),
    );

    await expect(strategy.validate({ sub: uuidOf(1), email: 'a@b.c' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a soft-deleted account', async () => {
    userService.findOne.mockResolvedValue({ id: uuidOf(1), deletedAt: new Date() });

    await expect(strategy.validate({ sub: uuidOf(1), email: 'a@b.c' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
