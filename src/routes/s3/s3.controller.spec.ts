import { Test, TestingModule } from '@nestjs/testing';
import { AwsController } from './s3.controller';
import { AwsService } from './s3.service';

describe('AwsController', () => {
  let controller: AwsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AwsController],
      providers: [AwsService],
    }).compile();

    controller = module.get<AwsController>(AwsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
