import { Body, ConflictException, Controller, Get, Headers, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { Public } from "@auth/decorators/public.decorator";
import { UserDto } from "@auth/dto/user.dto";
import { AiService } from "./ai.service";
import { AiWorkspaceService } from "./ai-workspace.service";
import { WorkspaceSaveResponseDto, WorkspaceComparisonDto, WorkspaceMergeResponseDto, WorkspaceReviewResponseDto, WorkspaceConfirmedDto, WorkspaceStoredReviewDto } from "./ai-workspace-response.dto";
import { WorkspaceMergeDto, WorkspacePreviewDto, WorkspaceReadDto, WorkspaceReviewDto, WorkspaceSaveDto } from "./ai-workspace.dto";

@ApiTags("AI working save")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("ai/projects/:projectId/workspace")
export class AiWorkspaceController {
  constructor(private readonly work: AiWorkspaceService, private readonly ai: AiService) {}
  @Get()
  @ApiOperation({ summary: "Read the isolated AI save; never writes the user project" })
  @ApiResponse({ status: 200, type: WorkspaceSaveResponseDto })
  async read(@Param("projectId", ParseIntPipe) projectId: number, @Req() req: Request): Promise<WorkspaceSaveResponseDto> {
    await this.ai.authorize(projectId, (req.user as UserDto).id);
    return this.work.read(projectId);
  }
  @Post("preview")
  @ApiOperation({ summary: "Diff the AI working save against this editor snapshot; no changes are applied" })
  @ApiBody({ type: WorkspacePreviewDto }) @ApiResponse({ status: 201, type: WorkspaceComparisonDto })
  async preview(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request, @Body() dto: WorkspacePreviewDto): Promise<WorkspaceComparisonDto> {
    await this.ai.authorize(id, (req.user as UserDto).id);
    const result = await this.work.compare(id, dto.snapshot);
    if (result["revision"] !== dto.revision) throw new ConflictException("AI save changed; preview again");
    return result;
  }
  @Post("review")
  @ApiOperation({ summary: "Human only: prepare accepted/rejected units. Apply and save the returned snapshot normally, then confirm." })
  @ApiBody({ type: WorkspaceReviewDto }) @ApiResponse({ status: 201, type: WorkspaceReviewResponseDto })
  review(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request, @Body() dto: WorkspaceReviewDto): Promise<WorkspaceReviewResponseDto> {
    return this.work.prepare(id, (req.user as UserDto).id, dto);
  }
  @Get("reviews/:reviewId")
  @ApiOperation({ summary: "Human only: recover an immutable review result after an interrupted response" })
  @ApiResponse({ status: 200, type: WorkspaceStoredReviewDto })
  readReview(@Param("projectId", ParseIntPipe) id: number, @Param("reviewId") reviewId: string, @Req() req: Request): Promise<WorkspaceStoredReviewDto> {
    return this.work.readReview(id, (req.user as UserDto).id, reviewId);
  }
  @Post("reviews/:reviewId/confirm")
  @ApiOperation({ summary: "Human only: reset the AI base/draft after the reviewed snapshot is actually saved" })
  @ApiResponse({ status: 201, type: WorkspaceConfirmedDto })
  confirm(@Param("projectId", ParseIntPipe) id: number, @Param("reviewId") reviewId: string, @Req() req: Request): Promise<WorkspaceConfirmedDto> {
    return this.work.confirm(id, (req.user as UserDto).id, reviewId);
  }
  @Post("reviews/:reviewId/cancel")
  @ApiOperation({ summary: "Human only: abandon an unsaved review and unlock the unchanged AI draft. Discard its returned snapshot." })
  @ApiResponse({ status: 201, type: Object })
  cancel(@Param("projectId", ParseIntPipe) id: number, @Param("reviewId") reviewId: string, @Req() req: Request): Promise<{ cancelled: boolean }> {
    return this.work.cancel(id, (req.user as UserDto).id, reviewId);
  }
}

@Public()
@ApiTags("AI MCP working save")
@Controller("ai/mcp/workspace")
export class AiWorkspaceMcpController {
  constructor(private readonly work: AiWorkspaceService, private readonly ai: AiService) {}
  @Get()
  @ApiOperation({ summary: "Read draft, common base or latest user save. Authenticated with an account assistant key." })
  @ApiResponse({ status: 200, type: WorkspaceSaveResponseDto })
  async read(@Query() query: WorkspaceReadDto, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<WorkspaceSaveResponseDto> {
    const c = await this.ai.connection(auth, project); return this.work.read(c.projectId, query.source ?? "draft");
  }
  @Post()
  @ApiOperation({ summary: "Edit the AI save only. CAS revision required. Cannot accept or publish changes." })
  @ApiBody({ type: WorkspaceSaveDto }) @ApiResponse({ status: 201, type: WorkspaceSaveResponseDto })
  async save(@Body() dto: WorkspaceSaveDto, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<WorkspaceSaveResponseDto> {
    const c = await this.ai.connection(auth, project); return this.work.save(c.projectId, dto);
  }
  @Get("compare")
  @ApiOperation({ summary: "Three-way differences between base, AI save and latest saved user project" })
  @ApiResponse({ status: 200, type: WorkspaceComparisonDto })
  async compare(@Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<WorkspaceComparisonDto> {
    const c = await this.ai.connection(auth, project); return this.work.compare(c.projectId);
  }
  @Post("merge")
  @ApiOperation({ summary: "Merge the latest user save into the AI save; conflicts require explicit draft/latest resolutions" })
  @ApiBody({ type: WorkspaceMergeDto }) @ApiResponse({ status: 201, type: WorkspaceMergeResponseDto })
  async merge(@Body() dto: WorkspaceMergeDto, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<WorkspaceMergeResponseDto> {
    const c = await this.ai.connection(auth, project); return this.work.merge(c.projectId, dto.revision, dto.latestHash, dto.resolutions ?? {});
  }
}
