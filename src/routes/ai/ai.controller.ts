import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { Public } from "@auth/decorators/public.decorator";
import { UserDto } from "@auth/dto/user.dto";
import { AiContext, AiDeclaration, AiJob, AiProposal } from "@prisma/client";
import { AiConnectionResponseDto, AiContextDto, AiDeclarationDto, AiJobCompleteDto, AiJobCreateDto, AiJobFailDto, AiProposalDto, AiReviewDto, AiKeyCreateDto, AiKeyResponseDto, AiKeySummaryDto, AiMcpConnectionDto, AiMcpProjectDto, AiAcceptDto, AiApplyDto, AiPreviewDto, AiSnapshotDto } from "./ai.dto";
import {
  AiContextResponseDto,
  AiDeclarationResponseDto,
  AiJobResponseDto,
  AiProposalResponseDto,
  AiProvenanceResponseDto
} from "./ai-response.dto";
import { AiKeyResponse, AiKeySummary, AiService } from "./ai.service";
import { AiApplyService } from "./ai-apply.service";
import { AiJobsService } from "./ai-jobs.service";

const userOf = (req: Request): number => (req.user as UserDto).id;

@ApiTags("AI keys")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("ai/keys")
export class AiKeysController {
  constructor(private readonly service: AiService) {}

  @Post()
  @ApiOperation({ summary: "Create a long-lived assistant key. No expiry unless you ask for one." })
  @ApiResponse({ status: 201, type: AiKeyResponseDto })
  @ApiBody({ type: AiKeyCreateDto })
  async create(@Req() req: Request, @Body() dto: AiKeyCreateDto): Promise<AiKeyResponse> {
    return this.service.createKey(userOf(req), dto.name, dto.expiresInDays);
  }

  @Get()
  @ApiOperation({ summary: "List this account's keys and the projects each may reach" })
  @ApiResponse({ status: 200, type: [AiKeySummaryDto] })
  async list(@Req() req: Request): Promise<AiKeySummary[]> {
    return this.service.listKeys(userOf(req));
  }

  @Delete(":keyId")
  @ApiOperation({ summary: "Revoke a key everywhere, in every project it reaches" })
  async revoke(@Param("keyId") keyId: string, @Req() req: Request): Promise<{ revoked: boolean }> {
    await this.service.revokeKey(userOf(req), keyId);
    return { revoked: true };
  }

  @Post(":keyId/projects/:projectId")
  @ApiOperation({ summary: "Let a key reach one more project" })
  async grant(@Param("keyId") keyId: string, @Param("projectId", ParseIntPipe) projectId: number, @Req() req: Request): Promise<{ linked: boolean }> {
    await this.service.grantKey(userOf(req), keyId, projectId);
    return { linked: true };
  }

  @Delete(":keyId/projects/:projectId")
  @ApiOperation({ summary: "Stop a key reaching a project, keeping the key itself" })
  async ungrant(@Param("keyId") keyId: string, @Param("projectId", ParseIntPipe) projectId: number, @Req() req: Request): Promise<{ revoked: boolean }> {
    await this.service.revokeGrant(userOf(req), keyId, projectId);
    return { revoked: true };
  }
}

@ApiTags("AI")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("ai/projects/:projectId")
export class AiController {
  constructor(private readonly service: AiService, private readonly jobs: AiJobsService, private readonly applyService: AiApplyService) {}

  @Post("connection")
  @ApiOperation({ summary: "Create a project-scoped proposal-only AI credential" })
  @ApiResponse({ status: 201, type: AiConnectionResponseDto })
  connect(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request): Promise<AiConnectionResponseDto> {
    return this.service.connect(id, userOf(req));
  }

  @Delete("connection")
  @ApiOperation({ summary: "Revoke this user's AI connection and shared context" })
  async revoke(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request): Promise<{ revoked: boolean }> {
    await this.service.revoke(id, userOf(req));
    return { revoked: true };
  }

  @Post("context")
  @ApiOperation({ summary: "Share current editor context with the user's AI connection" })
  context(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request, @Body() dto: AiContextDto): Promise<{ hash: string }> {
    return this.service.context(id, userOf(req), dto.content);
  }

  @Get("proposals")
  @ApiResponse({ status: 200, type: [AiProposalResponseDto] })
  @ApiOperation({ summary: "List project AI proposals" })
  list(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request): Promise<AiProposal[]> {
    return this.service.list(id, userOf(req));
  }

  @Post("proposals/:proposalId/review")
  @ApiOperation({ summary: "Reject an immutable proposal. Approval happens by applying it." })
  async review(@Param("projectId", ParseIntPipe) id: number, @Param("proposalId") proposalId: string, @Req() req: Request, @Body() dto: AiReviewDto): Promise<{ reviewed: boolean }> {
    await this.service.review(id, userOf(req), proposalId, dto);
    return { reviewed: true };
  }

  @Post("proposals/:proposalId/preview")
  @ApiResponse({ status: 201, type: AiPreviewDto })
  @ApiOperation({ summary: "Validate against the caller's own document and return the merged result; never modifies anything" })
  preview(@Param("projectId", ParseIntPipe) id: number, @Param("proposalId") proposalId: string, @Req() req: Request, @Body() dto: AiSnapshotDto): Promise<AiPreviewDto> {
    return this.applyService.preview(id, userOf(req), proposalId, dto.snapshot);
  }

  @Post("proposals/:proposalId/revert")
  @ApiResponse({ status: 201, type: AiProposalResponseDto })
  @ApiOperation({ summary: "Prepare a reviewable inverse proposal; preserves historical provenance" })
  revert(@Param("projectId", ParseIntPipe) id: number, @Param("proposalId") proposalId: string, @Req() req: Request): Promise<AiProposal> {
    return this.service.proposeRevert(id, userOf(req), proposalId);
  }

  @Post("proposals/:proposalId/apply")
  @HttpCode(200)
  @ApiResponse({ status: 200, type: AiApplyDto })
  @ApiOperation({ summary: "Accept the proposal against the caller's own document and return the merged state" })
  apply(@Param("projectId", ParseIntPipe) id: number, @Param("proposalId") proposalId: string, @Req() req: Request, @Body() dto: AiAcceptDto): Promise<AiApplyDto> {
    if (dto.decision !== "APPROVED") throw new BadRequestException("Applying requires approval");
    return this.applyService.apply(id, userOf(req), proposalId, dto.contentHash, dto.snapshot, dto.hunks);
  }

  @Get("jobs")
  @ApiResponse({ status: 200, type: [AiJobResponseDto] })
  @ApiOperation({ summary: "List this project's specialist generation jobs" })
  listJobs(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request): Promise<AiJob[]> {
    return this.jobs.list(id, userOf(req));
  }

  @Post("jobs/:jobId/cancel")
  @ApiResponse({ status: 201, type: AiJobResponseDto })
  @ApiOperation({ summary: "Cancel a pending job or discard a running one's result" })
  cancelJob(@Param("projectId", ParseIntPipe) id: number, @Param("jobId") jobId: string, @Req() req: Request): Promise<AiJob> {
    return this.jobs.cancelAsEditor(id, userOf(req), jobId);
  }

  @Post("declarations")
  @ApiResponse({ status: 201, type: AiDeclarationResponseDto })
  @ApiOperation({ summary: "Declare AI assistance used outside Naucto's tracked workflow" })
  declare(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request, @Body() dto: AiDeclarationDto): Promise<AiDeclaration> {
    return this.jobs.declare(id, userOf(req), dto.categories, dto.note);
  }

  @Get("provenance")
  @ApiResponse({ status: 200, type: AiProvenanceResponseDto })
  @ApiOperation({ summary: "AI categories, declarations and applied changes of this project" })
  provenance(@Param("projectId", ParseIntPipe) id: number, @Req() req: Request): ReturnType<AiJobsService["provenance"]> {
    return this.jobs.provenance(id, userOf(req));
  }
}

// Public only with respect to the ordinary JWT guard: every handler authenticates an opaque
// project-scoped credential, which no ordinary route accepts.
@Public()
@ApiTags("AI MCP")
@Controller("ai/mcp")
export class AiMcpController {
  constructor(private readonly service: AiService, private readonly jobs: AiJobsService) {}

  @Get("connection")
  @ApiResponse({ status: 200, type: AiMcpConnectionDto })
  @ApiOperation({ summary: "Validate a scoped AI connection" })
  async connection(@Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<AiMcpConnectionDto> {
    const c = await this.service.connection(auth, project);
    // A key that never expires reports null. The service keeps a far-future sentinel so callers
    // that compare the date keep working, but the year 275760 is not a date many clients parse.
    return { projectId: c.projectId, userId: c.userId, expiresAt: c.expiresAt.getUTCFullYear() > 9999 ? null : c.expiresAt };
  }

  @Get("projects")
  @ApiOperation({ summary: "Every project this credential may reach, with what is waiting in each" })
  async projects(@Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<AiMcpProjectDto[]> {
    return this.service.reachableProjects(auth, project);
  }

  @Get("context")
  @ApiResponse({ status: 200, type: AiContextResponseDto })
  @ApiOperation({ summary: "Read the project's last shared state and how old it is" })
  async context(@Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<AiContext> {
    // Age travels with the context on purpose: an assistant may be working on a project nobody has
    // open, and it should know how far back the state it is reasoning about reaches.
    const stored = await this.service.storedContext(await this.service.connection(auth, project));
    if (!stored) throw new ConflictException("Open the editor once so this project has a state to work from");
    return { ...stored.context, ageMs: stored.ageMs } as AiContext;
  }

  @Get("proposals")
  @ApiResponse({ status: 200, type: [AiProposalResponseDto] })
  @ApiOperation({ summary: "Read proposal status" })
  async list(@Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<AiProposal[]> {
    const c = await this.service.connection(auth, project);
    return this.service.list(c.projectId, c.userId);
  }

  @Post("proposals")
  @ApiResponse({ status: 201, type: AiProposalResponseDto })
  @ApiOperation({ summary: "Stage a proposal; cannot approve or apply" })
  async propose(@Body() dto: AiProposalDto, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<AiProposal> {
    return this.service.propose(await this.service.connection(auth, project), dto);
  }

  @Post("jobs")
  @ApiResponse({ status: 201, type: AiJobResponseDto })
  @ApiOperation({ summary: "Queue a generation job within the project quota" })
  async createJob(@Body() dto: AiJobCreateDto, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<AiJob> {
    return this.jobs.create(await this.service.connection(auth, project), dto.kind, dto.request);
  }

  @Get("jobs/:jobId")
  @ApiResponse({ status: 200, type: AiJobResponseDto })
  @ApiOperation({ summary: "Read a generation job of this project" })
  async getJob(@Param("jobId") jobId: string, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<AiJob> {
    return this.jobs.get(await this.service.connection(auth, project), jobId);
  }

  @Post("jobs/:jobId/cancel")
  @ApiResponse({ status: 201, type: AiJobResponseDto })
  @ApiOperation({ summary: "Cancel a generation job of this project" })
  async cancelJob(@Param("jobId") jobId: string, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string): Promise<AiJob> {
    const c = await this.service.connection(auth, project);
    return this.jobs.cancel(c.projectId, jobId);
  }

  @Post("jobs/:jobId/claim")
  @ApiOperation({ summary: "Service only: start a queued job unless it was cancelled" })
  async claimJob(@Param("jobId") jobId: string, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string, @Headers("x-naucto-ai-service") service?: string): Promise<{ run: boolean }> {
    this.jobs.assertService(service);
    return { run: await this.jobs.claim(await this.service.connection(auth, project), jobId) };
  }

  @Post("jobs/:jobId/complete")
  @ApiResponse({ status: 201, type: AiJobResponseDto })
  @ApiOperation({ summary: "Service only: store a validated result and the model that produced it" })
  async completeJob(@Param("jobId") jobId: string, @Body() dto: AiJobCompleteDto, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string, @Headers("x-naucto-ai-service") service?: string): Promise<AiJob> {
    this.jobs.assertService(service);
    return this.jobs.complete(await this.service.connection(auth, project), jobId, dto.result, dto.model);
  }

  @Post("jobs/:jobId/fail")
  @ApiOperation({ summary: "Service only: record a failure without provider details" })
  async failJob(@Param("jobId") jobId: string, @Body() dto: AiJobFailDto, @Headers("authorization") auth?: string, @Headers("x-naucto-project") project?: string, @Headers("x-naucto-ai-service") service?: string): Promise<{ failed: boolean }> {
    this.jobs.assertService(service);
    await this.jobs.fail(await this.service.connection(auth, project), jobId, dto.error);
    return { failed: true };
  }
}
