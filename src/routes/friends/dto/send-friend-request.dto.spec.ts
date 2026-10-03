import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SendFriendRequestDto } from './send-friend-request.dto';

describe('SendFriendRequestDto', () => {
  const rejected = async (body: object): Promise<string[]> =>
    (await validate(plainToInstance(SendFriendRequestDto, body))).map((error) => error.property);

  it.each(['userId', 'username', 'friendCode'])('rejects a null %s', async (field) => {
    await expect(rejected({ [field]: null })).resolves.toEqual([field]);
  });

  it.each([{ userId: 2 }, { username: 'louis' }, { friendCode: '7K3Q-W9ZB' }])(
    'accepts %j on its own',
    async (body) => {
      await expect(rejected(body)).resolves.toEqual([]);
    },
  );
});
