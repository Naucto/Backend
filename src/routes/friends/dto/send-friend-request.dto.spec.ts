import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { uuidOf } from '../../../../test/uuid';
import { SendFriendRequestDto } from './send-friend-request.dto';

describe('SendFriendRequestDto', () => {
  const rejected = async (body: object): Promise<string[]> =>
    (await validate(plainToInstance(SendFriendRequestDto, body))).map((error) => error.property);

  it.each(['userId', 'username', 'friendCode'])('rejects a null %s', async (field) => {
    await expect(rejected({ [field]: null })).resolves.toEqual([field]);
  });

  it.each([{ userId: uuidOf(2) }, { username: 'louis' }, { friendCode: '7K3Q-W9ZB' }])(
    'accepts %j on its own',
    async (body) => {
      await expect(rejected(body)).resolves.toEqual([]);
    },
  );

  it.each([2, '2', 'not-an-id'])('rejects %j as a user id', async (userId) => {
    await expect(rejected({ userId })).resolves.toEqual(['userId']);
  });

  it('takes a user id in the lower case the database answers ids in', () => {
    const dto = plainToInstance(SendFriendRequestDto, {
      userId: '3F2B8C1E-9D4A-4E6F-8A7B-1C2D3E4F5A6B',
    });

    expect(dto.userId).toBe('3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b');
  });
});
