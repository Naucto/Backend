import { Test, TestingModule } from '@nestjs/testing';

import { ProjectContentService } from '../../routes/project/project-content.service';
import { WorkSessionService } from '../../routes/work-session/work-session.service';
import { TasksService, WORK_SESSION_TIMEOUT_MS } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;

  const workSessions = { sweepAbandoned: jest.fn() };
  const contentServiceMock = {
    findProjectsWithoutContentSize: jest.fn(),
    recomputeContentSize: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: WorkSessionService, useValue: workSessions },
        {
          provide: ProjectContentService,
          useValue: contentServiceMock,
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('sweeps the work sessions nobody saved into for the timeout', async () => {
    const before = Date.now();

    await service.cleanTimedOutWorkSessions();

    const [olderThan] = workSessions.sweepAbandoned.mock.calls[0] as [Date];
    expect(olderThan.getTime()).toBeGreaterThanOrEqual(before - WORK_SESSION_TIMEOUT_MS);
    expect(olderThan.getTime()).toBeLessThanOrEqual(Date.now() - WORK_SESSION_TIMEOUT_MS);
  });

  describe('backfillProjectContentSizes', () => {
    it('recomputes every project lacking a breakdown and survives failures', async () => {
      contentServiceMock.findProjectsWithoutContentSize.mockResolvedValue([1, 2, 3]);
      contentServiceMock.recomputeContentSize
        .mockResolvedValueOnce({ total: 1 })
        .mockRejectedValueOnce(new Error('no save'))
        .mockResolvedValueOnce({ total: 3 });

      await expect(service.backfillProjectContentSizes()).resolves.toBe(2);

      expect(contentServiceMock.recomputeContentSize).toHaveBeenCalledTimes(3);
    });

    it('does nothing when every project is already measured', async () => {
      contentServiceMock.findProjectsWithoutContentSize.mockResolvedValue([]);

      await expect(service.backfillProjectContentSizes()).resolves.toBe(0);
      expect(contentServiceMock.recomputeContentSize).not.toHaveBeenCalled();
    });
  });
});
