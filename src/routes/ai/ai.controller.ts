import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public, RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { AiService } from './ai.service';
import { AiJobsService } from './ai-jobs.service';
import { AiWorkspaceService } from './ai-workspace.service';
import {
  AiConnectionDto,
  AiDeclarationCreateDto,
  AiDeclarationDto,
  AiJobCompleteDto,
  AiJobCreateDto,
  AiJobDto,
  AiJobFailDto,
  AiJobStartDto,
  AiKeyCreatedDto,
  AiKeyCreateDto,
  AiKeySummaryDto,
  AiProvenanceDto,
  AiReachableProjectDto,
  AiSaveDto,
  AiSaveQueryDto,
  AiSaveWriteDto,
  AiWorkspaceDto,
  AiWorkspaceReviewDto,
} from './dto/ai.dto';

@ApiTags('ai')
@Controller('ai/keys')
@RequiresAuth()
export class AiKeysController {
  constructor(private readonly ai: AiService) {}

  @Post()
  @ApiOperation({ summary: 'Make an assistant key, which reaches every project the account owns' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiKeyCreatedDto })
  async create(@Req() req: RequestWithUser, @Body() dto: AiKeyCreateDto): Promise<AiKeyCreatedDto> {
    return this.ai.createKey(req.user.id, dto.name, dto.expiresInDays);
  }

  @Get()
  @ApiOperation({ summary: 'The account’s live assistant keys' })
  @ApiResponse({ status: HttpStatus.OK, type: [AiKeySummaryDto] })
  async list(@Req() req: RequestWithUser): Promise<AiKeySummaryDto[]> {
    return this.ai.listKeys(req.user.id);
  }

  @Delete(':keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a key everywhere' })
  @ApiParam({ name: 'keyId', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No live key of the caller’s by that id',
  })
  async revoke(
    @Req() req: RequestWithUser,
    @Param('keyId', ParseIdPipe) keyId: string,
  ): Promise<void> {
    await this.ai.revokeKey(req.user.id, keyId);
  }
}

@ApiTags('ai')
@Controller('ai/projects/:id')
@RequiresAuth()
export class AiProjectController {
  constructor(
    private readonly workspace: AiWorkspaceService,
    private readonly jobs: AiJobsService,
  ) {}

  @Get('workspace')
  @ApiOperation({ summary: 'What the assistant made, to set against the open document' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: AiWorkspaceDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not a project of the caller’s' })
  async workspaceOf(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
  ): Promise<AiWorkspaceDto> {
    return this.workspace.forEditor(id, req.user.id);
  }

  @Post('workspace/review')
  @ApiOperation({
    summary: 'Hand back the document with the kept changes in it, and the changes still waiting',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiWorkspaceDto })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'The assistant wrote since it was read',
  })
  async review(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: AiWorkspaceReviewDto,
  ): Promise<AiWorkspaceDto> {
    return this.workspace.review(id, req.user.id, {
      revision: dto.revision,
      base: dto.base,
      draft: dto.draft,
      categories: dto.categories,
    });
  }

  @Get('jobs')
  @ApiOperation({ summary: 'The project’s generation jobs' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: [AiJobDto] })
  async listJobs(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
  ): Promise<AiJobDto[]> {
    return this.jobs.list(id, req.user.id);
  }

  @Post('jobs/:jobId/cancel')
  @ApiOperation({ summary: 'Cancel a queued job, or drop a running one’s result' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiJobDto })
  async cancelJob(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('jobId', ParseIdPipe) jobId: string,
  ): Promise<AiJobDto> {
    return this.jobs.cancelAsEditor(id, req.user.id, jobId);
  }

  @Post('declarations')
  @ApiOperation({ summary: 'Say AI was used outside the assistant' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiDeclarationDto })
  async declare(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: AiDeclarationCreateDto,
  ): Promise<AiDeclarationDto> {
    return this.jobs.declare(id, req.user.id, dto.categories, dto.note);
  }

  @Get('provenance')
  @ApiOperation({ summary: 'What AI made part of the game, and what was declared' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: AiProvenanceDto })
  async provenance(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
  ): Promise<AiProvenanceDto> {
    return this.jobs.provenance(id, req.user.id);
  }
}

/**
 * The Naucto MCP's routes. Public to the session guard only: every handler authenticates an
 * assistant key, which no other route takes, and `X-Naucto-Project` names the project.
 */
@ApiTags('ai-mcp')
@Controller('ai/mcp')
@Public()
export class AiMcpController {
  constructor(
    private readonly ai: AiService,
    private readonly workspace: AiWorkspaceService,
    private readonly jobs: AiJobsService,
  ) {}

  @Get('connection')
  @ApiOperation({ summary: 'The project a key and X-Naucto-Project point at' })
  @ApiResponse({ status: HttpStatus.OK, type: AiConnectionDto })
  async connection(
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
  ): Promise<AiConnectionDto> {
    const { projectId, userId, name, expiresAt } = await this.ai.connection(auth, project);
    return { projectId, userId, name, expiresAt };
  }

  @Get('projects')
  @ApiOperation({ summary: 'Every project the key reaches' })
  @ApiResponse({ status: HttpStatus.OK, type: [AiReachableProjectDto] })
  async projects(@Headers('authorization') auth?: string): Promise<AiReachableProjectDto[]> {
    return this.ai.reachable(auth);
  }

  @Get('workspace')
  @ApiOperation({
    summary: 'The assistant’s draft, the base it started from, or the latest user save',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AiSaveDto })
  async read(
    @Query() query: AiSaveQueryDto,
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
  ): Promise<AiSaveDto> {
    const { projectId } = await this.ai.connection(auth, project);
    return this.workspace.read(projectId, query.source);
  }

  @Post('workspace')
  @ApiOperation({ summary: 'Write the assistant’s draft; never the user’s project' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiSaveDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Written since it was read' })
  async write(
    @Body() dto: AiSaveWriteDto,
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
  ): Promise<AiSaveDto> {
    const { projectId } = await this.ai.connection(auth, project);
    return this.workspace.write(projectId, dto);
  }

  @Post('jobs')
  @ApiOperation({ summary: 'Queue a generation job within the project’s hourly quota' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiJobDto })
  async createJob(
    @Body() dto: AiJobCreateDto,
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
  ): Promise<AiJobDto> {
    return this.jobs.create(await this.ai.connection(auth, project), dto.kind, dto.request);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'A generation job of the project' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: AiJobDto })
  async getJob(
    @Param('jobId', ParseIdPipe) jobId: string,
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
  ): Promise<AiJobDto> {
    const { projectId } = await this.ai.connection(auth, project);
    return this.jobs.get(projectId, jobId);
  }

  @Post('jobs/:jobId/cancel')
  @ApiOperation({ summary: 'Cancel a generation job of the project' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiJobDto })
  async cancelJob(
    @Param('jobId', ParseIdPipe) jobId: string,
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
  ): Promise<AiJobDto> {
    const { projectId } = await this.ai.connection(auth, project);
    return this.jobs.cancel(projectId, jobId);
  }

  @Post('jobs/:jobId/claim')
  @ApiOperation({ summary: 'Generation service only: start a queued job unless it was cancelled' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiJobStartDto })
  async claimJob(
    @Param('jobId', ParseIdPipe) jobId: string,
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
    @Headers('x-naucto-ai-service') service?: string,
  ): Promise<AiJobStartDto> {
    this.jobs.assertService(service);
    const { projectId } = await this.ai.connection(auth, project);
    return { run: await this.jobs.claim(projectId, jobId) };
  }

  @Post('jobs/:jobId/complete')
  @ApiOperation({ summary: 'Generation service only: store a result and the model that made it' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiJobDto })
  async completeJob(
    @Param('jobId', ParseIdPipe) jobId: string,
    @Body() dto: AiJobCompleteDto,
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
    @Headers('x-naucto-ai-service') service?: string,
  ): Promise<AiJobDto> {
    this.jobs.assertService(service);
    const { projectId } = await this.ai.connection(auth, project);
    return this.jobs.complete(projectId, jobId, dto.result, dto.model);
  }

  @Post('jobs/:jobId/fail')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Generation service only: record a failure, without provider details' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  async failJob(
    @Param('jobId', ParseIdPipe) jobId: string,
    @Body() dto: AiJobFailDto,
    @Headers('authorization') auth?: string,
    @Headers('x-naucto-project') project?: string,
    @Headers('x-naucto-ai-service') service?: string,
  ): Promise<void> {
    this.jobs.assertService(service);
    const { projectId } = await this.ai.connection(auth, project);
    await this.jobs.fail(projectId, jobId, dto.error);
  }
}
