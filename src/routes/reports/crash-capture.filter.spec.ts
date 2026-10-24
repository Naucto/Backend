import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Request } from 'express';

import { backendCrash, isServerCrash } from './crash-capture.filter';

describe('CrashCaptureFilter', () => {
  it('counts our own failures, not the answers we give on purpose', () => {
    expect(isServerCrash(new Error('boom'))).toBe(true);
    expect(isServerCrash('thrown string')).toBe(true);
    expect(isServerCrash(new InternalServerErrorException())).toBe(true);
    expect(isServerCrash(new BadRequestException())).toBe(false);
  });

  it('names a crash by the route pattern, not by the URL that reached it', () => {
    const error = new TypeError('x is undefined');
    const request = {
      method: 'GET',
      url: '/projects/42?secret=1',
      route: { path: '/projects/:id' },
    } as unknown as Request;

    expect(backendCrash(error, request)).toMatchObject({
      source: 'BACKEND',
      name: 'TypeError',
      message: 'x is undefined',
      route: 'GET /projects/:id',
    });
  });
});
