import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateProjectDto } from './create-project.dto';

describe('CreateProjectDto', () => {
  it('does not let a caller say where the cover lives', () => {
    const body = {
      name: 'A game',
      shortDesc: 'Short',
      iconUrl: 'https://elsewhere.example/cover.png',
    };
    const refused = validateSync(plainToInstance(CreateProjectDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }).map((error) => error.property);

    expect(refused).toEqual(['iconUrl']);
  });
});
