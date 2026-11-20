import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

import { withEnv } from '../../../test/env';
import { draft, ProjectMocks, released } from '../../../test/project-mocks';
import { PROJECT_CHANGED, ProjectChangedEvent } from '../../common/domain-events';
import { ProjectService } from './project.service';
import { COLLABORATOR_SELECT, CREATOR_SELECT } from './project-select';

describe('ProjectService', () => {
  let service: ProjectService;

  const mocks = new ProjectMocks();
  const {
    prismaMock,
    txMock,
    factsMock,
    s3ServiceMock,
    notificationsMock,
    workSessionsMock,
    eventEmitterMock,
  } = mocks;

  beforeEach(async () => {
    withEnv({
      JWT_SECRET: 'jwt-secret',
      S3_MAX_AUTO_HISTORY_VERSION: '5',
      S3_AUTO_HISTORY_DELAY: '10',
      S3_MAX_CHECKPOINTS: '5',
    });

    const module: TestingModule = await mocks.compile();
    service = module.get<ProjectService>(ProjectService);

    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated projects for a given user', async () => {
      const userId = 1;
      const where = {
        collaborators: {
          some: { id: userId },
        },
      };

      prismaMock.project.count.mockResolvedValue(2);
      prismaMock.project.findMany.mockResolvedValue([draft, released]);

      const result = await service.findAll(userId);

      expect(prismaMock.project.count).toHaveBeenCalledWith({ where });
      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where,
        include: {
          collaborators: { select: COLLABORATOR_SELECT },
          creator: { select: CREATOR_SELECT },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 24,
      });

      expect(result).toEqual({
        projects: [
          { ...draft, coverUrl: null, clipUrl: null, disk: null },
          { ...released, coverUrl: null, clipUrl: null, disk: null },
        ],
        total: 2,
        page: 1,
        limit: 24,
      });
    });

    it('should normalize page and cap limit', async () => {
      const userId = 1;

      prismaMock.project.count.mockResolvedValue(250);
      prismaMock.project.findMany.mockResolvedValue([draft, released]);

      const result = await service.findAll(userId, 2.9, 150.8);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 100,
          take: 100,
        }),
      );
      expect(result).toEqual({
        projects: [
          { ...draft, coverUrl: null, clipUrl: null, disk: null },
          { ...released, coverUrl: null, clipUrl: null, disk: null },
        ],
        total: 250,
        page: 2,
        limit: 100,
      });
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if project not found', async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('opens a project with the disk its author chose', async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        diskColor: '#ff8426',
        diskFinish: 'gradient',
        diskColor2: '#ffd100',
        diskGradDir: 'd2',
      });

      await expect(service.findOne(draft.id)).resolves.toMatchObject({
        disk: { color: '#ff8426', finish: 'gradient', color2: '#ffd100', gradDir: 'd2' },
      });
    });

    it('opens a project nobody styled without a disk, for the client to derive one', async () => {
      prismaMock.project.findUnique.mockResolvedValue(draft);

      await expect(service.findOne(draft.id)).resolves.toMatchObject({ disk: null });
    });
  });

  describe('setDisk', () => {
    const columns = { diskColor: true, diskFinish: true, diskColor2: true, diskGradDir: true };

    beforeEach(() => {
      prismaMock.project.update.mockImplementation(async ({ data }: { data: object }) => data);
    });

    it('writes the style whole, leaving out what it does not name', async () => {
      const stored = await service.setDisk(4, { color: '#16171a', finish: 'holo' });

      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 4 },
        data: { diskColor: '#16171a', diskFinish: 'holo', diskColor2: null, diskGradDir: null },
        select: columns,
      });
      expect(stored).toEqual({ color: '#16171a', finish: 'holo' });
    });

    it('stores the colours in lower case, however they were spelled', async () => {
      const stored = await service.setDisk(4, {
        color: '#FF8426',
        finish: 'stripes',
        color2: '#AbCdEf',
      });

      expect(stored).toEqual({ color: '#ff8426', finish: 'stripes', color2: '#abcdef' });
    });

    it('goes back to no chosen style with null', async () => {
      const stored = await service.setDisk(4, null);

      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 4 },
        data: { diskColor: null, diskFinish: null, diskColor2: null, diskGradDir: null },
        select: columns,
      });
      expect(stored).toBeNull();
    });

    it('leaves the release alone: the disk is live, like the cover', async () => {
      await service.setDisk(4, { color: '#16171a', finish: 'solid' });

      const [{ data }] = prismaMock.project.update.mock.calls[0] as [{ data: object }];
      expect(Object.keys(data).sort()).toEqual([
        'diskColor',
        'diskColor2',
        'diskFinish',
        'diskGradDir',
      ]);
    });
  });

  describe('create', () => {
    const createDto = {
      name: 'New Project',
      shortDesc: 'Short',
    };

    it('should create and return a project', async () => {
      const userId = 1;

      prismaMock.user.findUnique.mockResolvedValue({ id: userId });
      txMock.project.create.mockResolvedValue({
        id: 10,
        ...createDto,
        collaborators: [{ id: userId, username: 'user1' }],
        creator: { id: userId, username: 'user1' },
      });

      const result = await service.create(createDto, userId);

      expect(txMock.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ...createDto,
            collaborators: { connect: [{ id: userId }] },
            creator: { connect: { id: userId } },
          }),
          include: expect.any(Object),
        }),
      );
      expect(result).toHaveProperty('id', 10);
    });

    it('records the creation in the transaction that creates the project', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1 });
      txMock.project.create.mockResolvedValue({ id: 10 });

      await service.create(createDto, 1);

      expect(factsMock.record).toHaveBeenCalledWith(txMock, {
        type: 'PROJECT_CREATED',
        dedupeKey: 'project:10',
        actorUserId: 1,
        projectId: 10,
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto, 999)).rejects.toThrow(NotFoundException);
    });

    it('lets a database failure through as it is', async () => {
      const failure = new Error('DB error');
      prismaMock.user.findUnique.mockResolvedValue({ id: 1 });
      txMock.project.create.mockRejectedValue(failure);

      await expect(service.create(createDto, 1)).rejects.toBe(failure);
      expect(factsMock.record).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const updateDto = {
      name: 'Updated Name',
      shortDesc: 'Updated short desc',
    };

    it('should store tags trimmed, without blanks or repeats', async () => {
      prismaMock.project.findUnique.mockResolvedValue(draft);
      prismaMock.project.update.mockResolvedValue(draft);

      await service.update(1, { ...updateDto, tags: [' Action ', 'action', ''] });

      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { ...updateDto, tags: ['Action'] },
      });
      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        PROJECT_CHANGED,
        new ProjectChangedEvent(1),
      );
    });

    it('stores the palette of the game in lower case, in the order given', async () => {
      prismaMock.project.findUnique.mockResolvedValue(draft);
      prismaMock.project.update.mockResolvedValue(draft);

      await service.update(1, { ...updateDto, palette: ['#FAFDFF', '#16171a'] });

      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { ...updateDto, palette: ['#fafdff', '#16171a'] },
      });
    });

    it('leaves the palette alone when the update does not name it, and empties it when asked', async () => {
      prismaMock.project.findUnique.mockResolvedValue(draft);
      prismaMock.project.update.mockResolvedValue(draft);

      await service.update(1, updateDto);
      await service.update(1, { ...updateDto, palette: [] });

      expect(prismaMock.project.update).toHaveBeenNthCalledWith(1, {
        where: { id: 1 },
        data: updateDto,
      });
      expect(prismaMock.project.update).toHaveBeenNthCalledWith(2, {
        where: { id: 1 },
        data: { ...updateDto, palette: [] },
      });
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.update(999, updateDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('uploadImage', () => {
    it('stores the cover where the edge serves it and records that address on the row', async () => {
      prismaMock.project.findUnique.mockResolvedValue(draft);
      prismaMock.project.update.mockResolvedValue(draft);
      s3ServiceMock.uploadFile.mockResolvedValue(undefined);
      s3ServiceMock.setObjectPublicRead.mockResolvedValue(undefined);
      s3ServiceMock.getFileMetadataOrNull.mockResolvedValue({ ETag: '"5d41"' });
      const file = { originalname: 'cover.png' } as Express.Multer.File;

      await service.uploadImage(1, file, 7);

      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ file, keyName: 'projects/1/image' }),
      );
      expect(s3ServiceMock.setObjectPublicRead).toHaveBeenCalledWith('projects/1/image');
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { iconUrl: 'https://cdn.test/projects/1/image', coverVersion: '"5d41"' },
      });
      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        PROJECT_CHANGED,
        new ProjectChangedEvent(1),
      );
    });
  });

  describe('clip', () => {
    const file = { originalname: 'clip.webm', mimetype: 'video/webm' } as Express.Multer.File;

    beforeEach(() => {
      prismaMock.project.update.mockImplementation(
        async ({ where, data }: { where: { id: number }; data: object }) => ({
          ...draft,
          ...where,
          ...data,
        }),
      );
      s3ServiceMock.getFileMetadataOrNull.mockResolvedValue({ ETag: '"c11p"' });
    });

    it('stores the clip where anyone may read it and keeps its version on the row', async () => {
      const clipUrl = await service.uploadClip(1, file, 7);

      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith({
        file,
        keyName: 'projects/1/clip',
        metadata: { uploadedBy: '7', projectId: '1' },
        cacheControl: 'no-cache',
      });
      expect(s3ServiceMock.setObjectPublicRead).toHaveBeenCalledWith('projects/1/clip');
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { clipVersion: '"c11p"' },
      });
      expect(clipUrl).toBe('https://cdn.test/projects/1/clip?v=c11p');
    });

    it('tells whoever shows the project that it changed, as a new cover does', async () => {
      await service.uploadClip(1, file, 7);

      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        PROJECT_CHANGED,
        new ProjectChangedEvent(1),
      );
    });

    it('still records a clip the store gave no version for', async () => {
      s3ServiceMock.getFileMetadataOrNull.mockResolvedValue(null);

      await expect(service.uploadClip(1, file, 7)).resolves.toMatch(
        /^https:\/\/cdn\.test\/projects\/1\/clip\?v=\d+$/,
      );
    });

    it('records nothing when the store refuses the clip', async () => {
      s3ServiceMock.uploadFile.mockRejectedValue(new Error('store down'));

      await expect(service.uploadClip(1, file, 7)).rejects.toThrow('store down');

      expect(prismaMock.project.update).not.toHaveBeenCalled();
    });

    it('gives a listed or opened project the address of its clip, from the row alone', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ ...draft, clipVersion: '"c11p"' });

      await expect(service.findOne(draft.id)).resolves.toMatchObject({
        clipUrl: 'https://cdn.test/projects/1/clip?v=c11p',
      });
      expect(s3ServiceMock.getFileMetadataOrNull).not.toHaveBeenCalled();
    });

    it('removes the clip from the row before the store, and says the project changed', async () => {
      await service.removeClip(1);

      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { clipVersion: null },
      });
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({ key: 'projects/1/clip' });
      expect(prismaMock.project.update.mock.invocationCallOrder[0]).toBeLessThan(
        s3ServiceMock.deleteFile.mock.invocationCallOrder[0]!,
      );
      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        PROJECT_CHANGED,
        new ProjectChangedEvent(1),
      );
    });
  });

  describe('remove', () => {
    it('runs what a caller records alongside in the transaction that deletes the project', async () => {
      prismaMock.project.findUnique.mockResolvedValue(draft);
      s3ServiceMock.listObjects.mockResolvedValue([]);
      const alongside = jest.fn();

      await service.remove(1, alongside);

      expect(alongside).toHaveBeenCalledWith(txMock);
      expect(txMock.project.delete.mock.invocationCallOrder[0]).toBeLessThan(
        alongside.mock.invocationCallOrder[0]!,
      );
    });

    it('keeps the stored content when what was recorded alongside fails', async () => {
      prismaMock.project.findUnique.mockResolvedValue(draft);

      await expect(
        service.remove(1, () => Promise.reject(new Error('log is down'))),
      ).rejects.toThrow('log is down');
      expect(s3ServiceMock.deleteFile).not.toHaveBeenCalled();
    });

    it('clears the sessions and the project together, then the stored content', async () => {
      const projectId = 1;
      prismaMock.project.findUnique.mockResolvedValue(draft);
      txMock.project.delete.mockResolvedValue(draft);
      s3ServiceMock.deleteFile.mockResolvedValue(undefined);
      s3ServiceMock.listObjects.mockResolvedValue([]);
      s3ServiceMock.deleteFiles.mockResolvedValue(undefined);

      await service.remove(projectId);

      // Asserted because the foreign keys refuse the delete outright while a session still points
      // at the project.
      expect(txMock.gameSession.deleteMany).toHaveBeenCalledWith({
        where: { projectId },
      });
      expect(txMock.workSession.deleteMany).toHaveBeenCalledWith({
        where: { projectId },
      });
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(txMock.project.delete).toHaveBeenCalledWith({
        where: { id: projectId },
      });

      // The order is the load-bearing part: content dropped before the row would be lost to a
      // delete that then fails.
      expect(txMock.project.delete.mock.invocationCallOrder[0]).toBeLessThan(
        s3ServiceMock.deleteFile.mock.invocationCallOrder[0]!,
      );
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({
        key: `release/${projectId}`,
      });
    });

    it('drops everything the project stored: release, cover, clip, saves and checkpoints', async () => {
      prismaMock.project.findUnique.mockResolvedValue(draft);
      txMock.project.delete.mockResolvedValue(draft);
      s3ServiceMock.deleteFile.mockResolvedValue(undefined);
      s3ServiceMock.deleteFiles.mockResolvedValue([]);
      s3ServiceMock.listObjects.mockImplementation(async ({ prefix }: { prefix: string }) => [
        { Key: `${prefix}a` },
        { Key: `${prefix}b` },
      ]);

      await service.remove(1);

      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({ key: 'release/1' });
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({
        key: 'projects/1/image',
      });
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({ key: 'projects/1/clip' });
      expect(s3ServiceMock.deleteFiles).toHaveBeenCalledWith({
        keys: ['checkpoint/1/a', 'checkpoint/1/b'],
      });
      expect(s3ServiceMock.deleteFiles).toHaveBeenCalledWith({
        keys: ['save/1/a', 'save/1/b'],
      });
    });

    it('still deletes the project when its stored content cannot be reached', async () => {
      const projectId = 1;
      prismaMock.project.findUnique.mockResolvedValue(draft);
      txMock.project.delete.mockResolvedValue(draft);
      s3ServiceMock.deleteFile.mockRejectedValue(new Error('S3 error'));

      await expect(service.remove(projectId)).resolves.toBeUndefined();

      expect(txMock.project.delete).toHaveBeenCalledWith({
        where: { id: projectId },
      });
    });

    it('should throw NotFoundException if project does not exist', async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('addCollaborator', () => {
    const addDto = { userId: 2 };

    it('should add collaborator successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        collaborators: [{ id: 1 }, { id: 3 }],
      });
      prismaMock.project.update.mockResolvedValue(draft);

      const result = await service.addCollaborator(1, addDto);

      // Nothing else tells the invitee they were added; the project simply turns up in their list.
      expect(notificationsMock.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: addDto.userId,
          kind: 'COLLABORATOR_ADDED',
          data: { projectId: draft.id },
        }),
      );

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: addDto.userId },
        select: { id: true },
      });
      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            collaborators: { connect: { id: addDto.userId } },
          },
        }),
      );
      expect(result).toEqual(draft);
    });

    it('should refuse a request that names nobody', async () => {
      await expect(service.addCollaborator(1, {})).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if project not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if user already collaborator', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        collaborators: [{ id: 2 }],
      });

      await expect(service.addCollaborator(1, addDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeCollaborator', () => {
    const removeDto = { userId: 2 };

    it('should remove collaborator successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        collaborators: [{ id: 2 }, { id: 3 }],
      });
      prismaMock.project.update.mockResolvedValue(draft);

      const result = await service.removeCollaborator(1, removeDto);

      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            collaborators: { disconnect: { id: removeDto.userId } },
          },
        }),
      );
      expect(result).toEqual(draft);
    });

    it('should tell the removed collaborator and close their live session', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        collaborators: [{ id: 2 }, { id: 3 }],
      });
      prismaMock.project.update.mockResolvedValue(draft);

      await service.removeCollaborator(1, removeDto);

      expect(notificationsMock.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 2,
          kind: 'COLLABORATOR_REMOVED',
        }),
      );
      expect(workSessionsMock.kick).toHaveBeenCalledWith(1, 2);
    });

    it('removes the collaborator even when no session is open to close', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        collaborators: [{ id: 2 }, { id: 3 }],
      });
      prismaMock.project.update.mockResolvedValue(draft);
      workSessionsMock.kick.mockRejectedValueOnce(new NotFoundException());

      await expect(service.removeCollaborator(1, removeDto)).resolves.toEqual(draft);
    });

    it('reports a live session it could not close, without failing the removal', async () => {
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        collaborators: [{ id: 2 }, { id: 3 }],
      });
      prismaMock.project.update.mockResolvedValue(draft);

      workSessionsMock.kick.mockRejectedValueOnce(new NotFoundException());
      await service.removeCollaborator(1, removeDto);
      expect(logged).not.toHaveBeenCalled();

      workSessionsMock.kick.mockRejectedValueOnce(new Error('host election failed'));
      await expect(service.removeCollaborator(1, removeDto)).resolves.toEqual(draft);
      expect(logged).toHaveBeenCalledTimes(1);

      logged.mockRestore();
    });

    it('should throw NotFoundException if user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if project not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if trying to remove creator', async () => {
      const creatorId = draft.userId;
      prismaMock.user.findUnique.mockResolvedValue({ id: creatorId });
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        collaborators: [{ id: creatorId }],
      });

      await expect(service.removeCollaborator(1, { userId: creatorId })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if user not a collaborator', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 2 });
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        collaborators: [{ id: 3 }],
      });

      await expect(service.removeCollaborator(1, removeDto)).rejects.toThrow(BadRequestException);
    });
  });
});
