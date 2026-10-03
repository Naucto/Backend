import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

import {
  MultiplayerForbiddenError,
  MultiplayerGameSessionNotFoundError,
  MultiplayerInvalidJoinCodeError,
  MultiplayerInvalidStateError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserNotFoundError,
  MultiplayerUserNotInSessionError,
} from './multiplayer.error';
import { MultiplayerExceptionFilter } from './multiplayer-exception.filter';

describe('MultiplayerExceptionFilter', () => {
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ method: 'GET', url: '/game-sessions/x' }) }),
  } as unknown as ArgumentsHost;

  let answered: jest.SpyInstance;
  let logged: jest.SpyInstance;

  /** What the filter hands Nest to answer with. */
  function answerTo(exception: unknown): HttpException {
    new MultiplayerExceptionFilter().catch(exception, host);

    return answered.mock.lastCall![0] as HttpException;
  }

  beforeEach(() => {
    answered = jest.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation();
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [new MultiplayerGameSessionNotFoundError('no session'), NotFoundException],
    [new MultiplayerUserNotFoundError('no user'), NotFoundException],
    [new MultiplayerForbiddenError('not yours'), ForbiddenException],
    [new MultiplayerUserAlreadyJoinedError('already in'), ConflictException],
    [new MultiplayerSessionFullError('full'), ConflictException],
    [new MultiplayerInvalidJoinCodeError('wrong code'), BadRequestException],
    [new MultiplayerUserNotInSessionError('not in'), BadRequestException],
  ])('answers %p with its own status and message', (thrown, status) => {
    const answer = answerTo(thrown);

    expect(answer).toBeInstanceOf(status);
    expect(answer.message).toBe(thrown.message);
    expect(logged).not.toHaveBeenCalled();
  });

  it('lets an HTTP exception raised beneath it through unchanged', () => {
    const thrown = new NotFoundException('Project with ID 99 not found');

    expect(answerTo(thrown)).toBe(thrown);
  });

  it.each([
    ['an unknown failure', new Error('Invalid `gameSession.create()` invocation')],
    ['a multiplayer error with no status of its own', new MultiplayerInvalidStateError('retries')],
  ])('answers %s with a 500 that says nothing of its cause', (_label, thrown) => {
    const answer = answerTo(thrown);

    expect(answer).toBeInstanceOf(InternalServerErrorException);
    expect(answer.message).not.toContain(thrown.message);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.any(String), thrown.stack);
  });
});
