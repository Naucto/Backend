import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ADMIN, MODERATOR, USER } from '../../../auth/access/roles';
import { CreateUserDto } from './create-user.dto';
import { DeleteAccountDto } from './delete-account.dto';
import { UpdateMeDto } from './me.dto';
import { UpdateUserDto } from './update-user.dto';
import { UpdateUserProfileDto } from './update-user-profile.dto';
import { UserFilterDto } from './user-filter.dto';

async function rejected<T extends object>(
  dto: ClassConstructor<T>,
  body: object,
): Promise<string[]> {
  return (await validate(plainToInstance(dto, body))).map((error) => error.property);
}

describe('an optional field sent as null', () => {
  it.each(['nickname', 'description', 'username', 'colour'])(
    'is rejected on a profile update: %s',
    async (field) => {
      await expect(rejected(UpdateUserProfileDto, { [field]: null })).resolves.toEqual([field]);
    },
  );

  it('is rejected on an account settings update', async () => {
    await expect(rejected(UpdateMeDto, { sessionJoinPolicy: null })).resolves.toEqual([
      'sessionJoinPolicy',
    ]);
  });

  it.each(['removePublishedGames', 'password'])(
    'is rejected on an account deletion: %s',
    async (field) => {
      await expect(
        rejected(DeleteAccountDto, { confirmation: 'DELETE', [field]: null }),
      ).resolves.toEqual([field]);
    },
  );
});

describe('an optional field left out', () => {
  it('is accepted on each of the three bodies', async () => {
    await expect(rejected(UpdateUserProfileDto, {})).resolves.toEqual([]);
    await expect(rejected(UpdateMeDto, {})).resolves.toEqual([]);
    await expect(rejected(DeleteAccountDto, { confirmation: 'DELETE' })).resolves.toEqual([]);
  });
});

describe('UserFilterDto', () => {
  it('caps the page size', async () => {
    await expect(rejected(UserFilterDto, { limit: '100' })).resolves.toEqual([]);
    await expect(rejected(UserFilterDto, { limit: '101' })).resolves.toEqual(['limit']);
  });
});

describe('UpdateUserDto', () => {
  it.each([USER, MODERATOR, ADMIN])('accepts the role %s', async (role) => {
    await expect(rejected(UpdateUserDto, { role })).resolves.toEqual([]);
  });

  it.each(['Superuser', ADMIN.toLowerCase()])('rejects the role %s', async (role) => {
    await expect(rejected(UpdateUserDto, { role })).resolves.toEqual(['role']);
  });
});

describe('the handle on sign-up', () => {
  const signUp = (username: string): object => ({
    email: 'ada@example.com',
    username,
    password: 'correct-horse-9',
  });

  it.each(['ada', 'ada.lovelace-1_x', 'a'.repeat(24)])('accepts %s', async (username) => {
    await expect(rejected(CreateUserDto, signUp(username))).resolves.toEqual([]);
  });

  it.each(['ab', 'a'.repeat(25), 'a b!', 'José'])('rejects %s', async (username) => {
    await expect(rejected(CreateUserDto, signUp(username))).resolves.toEqual(['username']);
  });
});
