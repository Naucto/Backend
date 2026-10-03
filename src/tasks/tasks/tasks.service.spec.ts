import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { ProjectContentService } from '../../routes/project/project-content.service';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;

  const contentServiceMock = {
    findProjectsWithoutContentSize: jest.fn(),
    recomputeContentSize: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn(),
          },
        },
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
