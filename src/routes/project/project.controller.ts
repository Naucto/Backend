import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  Put,
  Res,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpException,
  NotFoundException
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { pipeline } from "node:stream/promises";
import {
  ProjectService,
  RELEASE_SORTS,
  RELEASE_WINDOWS,
  USER_PROJECT_STATUSES
} from "@project/project.service";
import type {
  PublishedProjectFilters,
  ReleaseSort,
  ReleaseWindow,
  UserProjectStatus,
  UserProjectFilters
} from "@project/project.service";
import {
  ProjectCheckpointsResponseDto,
  ProjectVersionsResponseDto
} from "@project/dto/project-saves.dto";
import {
  ProjectActionResponseDto,
  VersionDeletedResponseDto
} from "@project/dto/project-action-response.dto";
import { CreateProjectDto } from "@project/dto/create-project.dto";
import { UpdateProjectDto } from "@project/dto/update-project.dto";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import {
  ProjectCollaboratorGuard,
  ProjectCreatorGuard
} from "@auth/guards/project.guard";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import {
  AddCollaboratorDto,
  RemoveCollaboratorDto
} from "@project/dto/collaborator-project.dto";
import { Request } from "express";
import { UserDto } from "@auth/dto/user.dto";
import {
  ProjectResponseDto,
  ProjectExResponseDto,
  ForkProjectResponseDto,
  PaginatedProjectsResponseDto,
  ProjectsCountResponseDto,
  SignedUrlResponseDto
} from "./dto/project-response.dto";
import { OptionalJwtAuthGuard } from "@auth/guards/optional-jwt-auth.guard";
import { S3ObjectNotFoundException } from "@s3/s3.error";
import { DownloadedFile } from "@s3/s3.interface";
import { S3Service } from "@s3/s3.service";
import { EdgeService, versionedUrl } from "src/routes/s3/edge.service";
import { Public } from "@auth/decorators/public.decorator";
import { ImageUrlResponseDto } from "./dto/image-url-response.dto";
import { LikeResponseDto } from "./dto/like-response.dto";
import {
  CheckpointLimitDto,
  ProjectLimitsDto,
  ProjectSizeDto,
  ProjectTooLargeDto
} from "./dto/project-size.dto";
import { PROJECT_BLOB_MAX_BYTES } from "./content-size";
import { ProjectId } from "./project-id.decorator";
import { ViewResponseDto } from "./dto/view-response.dto";
import { ReleaseTagsResponseDto } from "./dto/release-tags-response.dto";

interface RequestWithUser extends Request {
  user: UserDto;
}

/** A suggestion list shows a handful of tags; a catalogue is a different screen. */
const MAX_TAG_LIMIT = 12;

const PROJECT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

@ApiTags("projects")
@Controller("projects")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly s3Service: S3Service,
    private readonly edgeService: EdgeService
  ) {}

  private readonly logger = new Logger(ProjectController.name);

  private parseOptionalInt(value?: string): number | undefined {
    const parsed = value ? parseInt(value, 10) : NaN;
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private parseTags(tags?: string): string[] | undefined {
    return tags ? tags.split(",") : undefined;
  }

  private buildPublishedProjectFilters(
    search?: string,
    tags?: string,
    releaseWindow?: ReleaseWindow
  ): PublishedProjectFilters {
    const filters: PublishedProjectFilters = {};
    const parsedTags = this.parseTags(tags);

    if (search) {
      filters.search = search;
    }

    if (parsedTags) {
      filters.tags = parsedTags;
    }

    if (releaseWindow && RELEASE_WINDOWS.includes(releaseWindow)) {
      filters.releaseWindow = releaseWindow;
    }

    return filters;
  }

  private buildUserProjectFilters(
    search?: string,
    tags?: string,
    status?: UserProjectStatus
  ): UserProjectFilters {
    const filters: UserProjectFilters = {};
    const parsedTags = this.parseTags(tags);

    if (search) {
      filters.search = search;
    }

    if (parsedTags) {
      filters.tags = parsedTags;
    }

    if (status) {
      filters.status = status;
    }

    return filters;
  }

  /**
   * Streams a stored file as the response. A missing object answers 404; once the body has started
   * a failure can only close the connection, the status line being already sent.
   */
  private async sendFile(
    res: Response,
    fetch: () => Promise<DownloadedFile>,
    headers: Record<string, string> = {}
  ): Promise<void> {
    let file: DownloadedFile;
    try {
      file = await fetch();
    } catch (error) {
      if (error instanceof S3ObjectNotFoundException) {
        throw new NotFoundException("File not found");
      }
      throw error;
    }

    res.set({
      "Content-Type": file.contentType,
      "Content-Length": file.contentLength,
      ...headers
    });

    try {
      await pipeline(file.body, res);
    } catch (error) {
      this.logger.warn(
        `Download interrupted: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  @Public()
  @Get("releases")
  @ApiOperation({ summary: "Get all released projects" })
  @ApiResponse({
    status: 200,
    description:
      "A JSON array of projects with collaborators and creator information",
    type: [ProjectExResponseDto]
  })
  async getAllReleases(): Promise<ProjectExResponseDto[]> {
    return this.projectService.fetchPublishedGames();
  }

  @Public()
  @Get("releases/paginated")
  @ApiOperation({ summary: "Get released projects with pagination" })
  @ApiQuery({ name: "page", type: "number", required: false })
  @ApiQuery({ name: "limit", type: "number", required: false })
  @ApiQuery({ name: "search", type: "string", required: false })
  @ApiQuery({
    name: "tags",
    type: "string",
    required: false,
    description: "Comma-separated tag list"
  })
  @ApiQuery({ name: "releaseWindow", enum: RELEASE_WINDOWS, required: false })
  @ApiQuery({
    name: "sort",
    enum: RELEASE_SORTS,
    required: false,
    description: "Shelf ordering; defaults to newest first"
  })
  @ApiResponse({
    status: 200,
    description: "A paginated list of released projects",
    type: PaginatedProjectsResponseDto
  })
  async getPaginatedReleases(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
    @Query("tags") tags?: string,
    @Query("releaseWindow") releaseWindow?: ReleaseWindow,
    @Query("sort") sort?: ReleaseSort
  ): Promise<PaginatedProjectsResponseDto> {
    return this.projectService.fetchPublishedGamesPaginated(
      this.parseOptionalInt(page),
      this.parseOptionalInt(limit),
      this.buildPublishedProjectFilters(search, tags, releaseWindow),
      RELEASE_SORTS.includes(sort as ReleaseSort) ? (sort as ReleaseSort) : "fresh"
    );
  }

  @Public()
  @Get("releases/tags")
  @ApiOperation({ summary: "List the tags published games carry" })
  @ApiQuery({
    name: "q",
    type: "string",
    required: false,
    description: "Narrow to tags holding this fragment"
  })
  @ApiQuery({ name: "limit", type: "number", required: false })
  @ApiResponse({
    status: 200,
    description: "Tags, most used first",
    type: ReleaseTagsResponseDto
  })
  async getReleaseTags(
    @Query("q") q?: string,
    @Query("limit") limit?: string
  ): Promise<ReleaseTagsResponseDto> {
    const take = Math.min(
      Math.max(this.parseOptionalInt(limit) ?? MAX_TAG_LIMIT, 1),
      MAX_TAG_LIMIT
    );

    return {
      tags: await this.projectService.fetchPublishedTags(q?.trim() ?? "", take)
    };
  }

  @Public()
  @Get("releases/count")
  @ApiOperation({ summary: "Count released projects with filters" })
  @ApiQuery({ name: "search", type: "string", required: false })
  @ApiQuery({
    name: "tags",
    type: "string",
    required: false,
    description: "Comma-separated tag list"
  })
  @ApiQuery({
    name: "releaseWindow",
    enum: RELEASE_WINDOWS,
    required: false
  })
  @ApiResponse({
    status: 200,
    description: "The total number of released projects matching the request",
    type: ProjectsCountResponseDto
  })
  async countReleasedProjects(
    @Query("search") search?: string,
    @Query("tags") tags?: string,
    @Query("releaseWindow")
      releaseWindow?: ReleaseWindow
  ): Promise<ProjectsCountResponseDto> {
    const total = await this.projectService.countPublishedGames(
      this.buildPublishedProjectFilters(search, tags, releaseWindow)
    );

    return { total };
  }

  @Public()
  @Get("releases/:id")
  @ApiOperation({ summary: "Get project release version" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project release metadata",
    type: ProjectExResponseDto
  })
  async getRelease(
    @ProjectId() id: number
  ): Promise<ProjectExResponseDto> {
    const projectRelease = await this.projectService.fetchRelease(id);
    // Public, so a draft's name and people are nobody's business until it is on the hub.
    if (!projectRelease.publishedAt) {
      throw new NotFoundException(`Published project with ID ${id} not found`);
    }

    return projectRelease;
  }

  @Public()
  @Get("releases/:id/content")
  @ApiOperation({ summary: "Get project release version" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project release file",
    content: {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" }
      }
    }
  })
  async getReleaseContent(
    @ProjectId() id: number,
    @Res() res: Response
  ): Promise<void> {
    await this.sendFile(res, () => this.projectService.fetchReleaseContent(id));
  }

  @Public()
  @Get("releases/:id/content-url")
  @ApiOperation({ summary: "Get the CDN URL of a release" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "CDN URL of the release, versioned by upload",
    type: SignedUrlResponseDto
  })
  async getReleaseContentUrl(
    @ProjectId() id: number
  ): Promise<SignedUrlResponseDto> {
    const key = `release/${id}`;
    const head = await this.s3Service.getFileMetadataOrNull(key);
    if (!head) {
      throw new NotFoundException("Release not found");
    }

    return { signedUrl: versionedUrl(this.edgeService.getCDNUrl(key), head.ETag) };
  }

  @Public()
  @Get("limits")
  @ApiOperation({ summary: "Get the project size limits" })
  @ApiResponse({
    status: 200,
    description: "Content budget and blob size limits",
    type: ProjectLimitsDto
  })
  getLimits(): ProjectLimitsDto {
    return this.projectService.getLimits();
  }

  @Get()
  @ApiOperation({ summary: "Retrieve the paginated list of projects" })
  @ApiQuery({ name: "page", type: "number", required: false })
  @ApiQuery({ name: "limit", type: "number", required: false })
  @ApiResponse({
    status: 200,
    description:
      "A paginated list of projects with collaborators and creator information",
    type: PaginatedProjectsResponseDto
  })
  @ApiResponse({ status: 500, description: "Internal server error" })
  async findAll(
    @Req() request: RequestWithUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ): Promise<PaginatedProjectsResponseDto> {
    const user = request.user;
    return this.projectService.findAll(
      user.id,
      this.parseOptionalInt(page),
      this.parseOptionalInt(limit)
    );
  }

  @Get("count")
  @ApiOperation({ summary: "Count the user's projects with filters" })
  @ApiQuery({ name: "search", type: "string", required: false })
  @ApiQuery({
    name: "tags",
    type: "string",
    required: false,
    description: "Comma-separated tag list"
  })
  @ApiQuery({
    name: "status",
    enum: USER_PROJECT_STATUSES,
    required: false
  })
  @ApiResponse({
    status: 200,
    description: "The total number of user projects matching the request",
    type: ProjectsCountResponseDto
  })
  async countProjects(
    @Req() request: RequestWithUser,
    @Query("search") search?: string,
    @Query("tags") tags?: string,
    @Query("status") status?: UserProjectStatus
  ): Promise<ProjectsCountResponseDto> {
    const total = await this.projectService.countUserProjects(
      request.user.id,
      this.buildUserProjectFilters(search, tags, status)
    );

    return { total };
  }

  @Get(":id")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Retrieve a single project" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to retrieve"
  })
  @ApiResponse({
    status: 200,
    description: "Project object",
    type: ProjectExResponseDto
  })
  @ApiResponse({ status: 404, description: "Project not found" })
  @ApiResponse({ status: 500, description: "Internal server error" })
  @ApiResponse({ status: 403, description: "Invalid user or project ID" })
  async findOne(
    @ProjectId() id: number
  ): Promise<ProjectExResponseDto> {
    return this.projectService.findOne(id);
  }

  @Get(":id/size")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: "Get the size breakdown of the project's latest save",
    description:
      "Logical content size per category (code, sprites, flags, map, sound, palette) " +
      "computed from the decoded game document, compared against the publishing budget."
  })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({
    status: 200,
    description: "Size breakdown",
    type: ProjectSizeDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Project not found" })
  async getSize(@ProjectId() id: number): Promise<ProjectSizeDto> {
    return this.projectService.getContentSize(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a new project" })
  @ApiBody({ type: CreateProjectDto })
  @ApiResponse({
    status: 201,
    description: "Project created successfully",
    type: ProjectResponseDto
  })
  @ApiResponse({ status: 400, description: "Bad request – invalid input" })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createProjectDto: CreateProjectDto,
    @Req() req: RequestWithUser
  ): Promise<ProjectResponseDto> {
    const userId = req.user.id;
    return await this.projectService.create(createProjectDto, userId);
  }

  @Post(":id/fork")
  @ApiOperation({ summary: "Fork a published project" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the published project to fork"
  })
  @ApiResponse({
    status: 201,
    description: "Forked project created successfully",
    type: ForkProjectResponseDto
  })
  @ApiResponse({ status: 400, description: "Project is not published" })
  @ApiResponse({ status: 404, description: "Project not found" })
  @HttpCode(HttpStatus.CREATED)
  async fork(
    @ProjectId() id: number,
    @Req() req: RequestWithUser
  ): Promise<ForkProjectResponseDto> {
    return await this.projectService.fork(id, req.user.id);
  }

  @Put(":id")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Update an existing project" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to update"
  })
  @ApiBody({ type: UpdateProjectDto })
  @ApiResponse({
    status: 200,
    description: "Updated project object",
    type: ProjectResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Project not found" })
  @ApiResponse({ status: 500, description: "Error updating project" })
  async update(
    @ProjectId() id: number,
    @Body() updateProjectDto: UpdateProjectDto
  ): Promise<ProjectResponseDto> {
    return this.projectService.update(id, updateProjectDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Patch(":id/add-collaborator")
  @ApiOperation({
    summary: "Add a new collaborator",
    description:
      "Add a collaborator to a project by providing either userId, username, or email. At least one must be provided."
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to update"
  })
  @ApiBody({
    type: AddCollaboratorDto,
    examples: {
      byUserId: {
        summary: "Add by User ID",
        value: {
          userId: 42
        }
      },
      byUsername: {
        summary: "Add by Username",
        value: {
          username: "john_doe"
        }
      },

      byEmail: {
        summary: "Add by Email",
        value: {
          email: "john.doe@example.com"
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: "Updated project object with collaborators",
    type: ProjectExResponseDto
  })
  @ApiResponse({
    status: 400,
    description: "Bad request - no valid identifier provided"
  })
  @ApiResponse({ status: 404, description: "Project or user not found" })
  @ApiResponse({ status: 500, description: "Error Patching project" })
  async addCollaborator(
    @ProjectId() id: number,
    @Body() addCollaboratorDto: AddCollaboratorDto
  ): Promise<ProjectExResponseDto> {
    return this.projectService.addCollaborator(id, addCollaboratorDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Delete(":id/remove-collaborator")
  @ApiOperation({
    summary: "Remove a collaborator",
    description:
      "Remove a collaborator from a project by providing either userId, username, or email. At least one must be provided."
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to update"
  })
  @ApiBody({
    type: RemoveCollaboratorDto,
    examples: {
      byUserId: {
        summary: "Remove by User ID",
        value: {
          userId: 42
        }
      },

      byUsername: {
        summary: "Remove by Username",
        value: {
          username: "john_doe"
        }
      },

      byEmail: {
        summary: "Remove by Email",
        value: {
          email: "john.doe@example.com"
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: "Updated project object with collaborators",
    type: ProjectExResponseDto
  })
  @ApiResponse({
    status: 400,
    description: "Bad request - no valid identifier provided"
  })
  @ApiResponse({
    status: 403,
    description: "Forbidden - cannot remove project creator"
  })
  @ApiResponse({ status: 404, description: "Project or user not found" })
  @ApiResponse({
    status: 500,
    description: "Error remove collaborator on project"
  })
  async removeCollaborator(
    @ProjectId() id: number,
    @Body() removeCollaboratorDto: RemoveCollaboratorDto
  ): Promise<ProjectExResponseDto> {
    return this.projectService.removeCollaborator(id, removeCollaboratorDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Delete(":id")
  @ApiOperation({ summary: "Delete a project" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to delete"
  })
  @ApiResponse({
    status: 204,
    description: "Project deleted successfully (no content)"
  })
  @ApiResponse({ status: 404, description: "Project not found" })
  @ApiResponse({ status: 500, description: "Error deleting project" })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@ProjectId() id: number): Promise<void> {
    return this.projectService.remove(id);
  }

  @Patch(":id/saveContent")
  @UseGuards(ProjectCollaboratorGuard)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: PROJECT_BLOB_MAX_BYTES } })
  )
  @ApiOperation({ summary: "Save project's content (Upload)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "The game document, as a Yjs update"
        }
      }
    }
  })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({
    status: 201,
    description: "File uploaded successfully",
    type: ProjectActionResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 413, description: "File too large" })
  @ApiResponse({ status: 422, description: "File validation failed" })
  @HttpCode(HttpStatus.CREATED)
  async saveProjectContent(
    @ProjectId() id: number,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: PROJECT_BLOB_MAX_BYTES })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY
        })
    )
      file: Express.Multer.File
  ): Promise<ProjectActionResponseDto> {
    await this.projectService.save(id, file);

    return { message: "File uploaded successfully", id };
  }

  @Post(":id/image")
  @UseGuards(ProjectCollaboratorGuard)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: PROJECT_IMAGE_MAX_BYTES } })
  )
  @ApiOperation({ summary: "Upload project image" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Project image file (JPEG, PNG, GIF, WebP)"
        }
      }
    }
  })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({
    status: 201,
    description: "Image uploaded successfully",
    type: ProjectActionResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 413, description: "File too large" })
  @ApiResponse({ status: 422, description: "Invalid file type or size" })
  @HttpCode(HttpStatus.CREATED)
  async uploadProjectImage(
    @ProjectId() id: number,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: PROJECT_IMAGE_MAX_BYTES })
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|gif|webp)$/ })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY })
    )
      file: Express.Multer.File,
    @Req() req: RequestWithUser
  ): Promise<ProjectActionResponseDto> {
    await this.projectService.uploadImage(id, file, req.user.id);

    return { message: "Project image uploaded successfully", id };
  }

  @Get(":id/image")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: "Get CDN URL for project image (authenticated, any project status)"
  })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({
    status: 200,
    description: "CDN URL for the project image",
    type: ImageUrlResponseDto
  })
  @ApiResponse({ status: 204, description: "Project has no image" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getProjectImage(
    @ProjectId() id: number
  ): Promise<ImageUrlResponseDto> {
    const key = `projects/${id}/image`;
    const head = await this.s3Service.getFileMetadataOrNull(key);
    if (!head) {
      throw new HttpException("No content", HttpStatus.NO_CONTENT);
    }
    return { url: versionedUrl(this.edgeService.getCDNUrl(key), head.ETag) };
  }

  @Public()
  @Get("public/:id/image")
  @ApiOperation({
    summary: "Get public CDN URL for a published project's image"
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Project ID"
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the CDN URL for the project image",
    type: ImageUrlResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Project not found, not published, or has no image"
  })
  async getPublishedProjectImage(
    @ProjectId() id: number
  ): Promise<ImageUrlResponseDto> {
    await this.projectService.assertPublished(id);

    const key = `projects/${id}/image`;
    const head = await this.s3Service.getFileMetadataOrNull(key);
    if (!head) {
      throw new NotFoundException("Not found");
    }

    return { url: versionedUrl(this.edgeService.getCDNUrl(key), head.ETag) };
  }

  @Get(":id/fetchContent")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch project's content" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "File fetched successfully",
    content: {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" }
      }
    }
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "File not found" })
  async fetchProjectContent(
    @ProjectId() id: number,
    @Res() res: Response
  ): Promise<void> {
    await this.sendFile(res, () => this.projectService.fetchLastVersion(id));
  }

  @Post(":id/saveCheckpoint/:name")
  @UseGuards(ProjectCollaboratorGuard)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: PROJECT_BLOB_MAX_BYTES } })
  )
  @ApiOperation({ summary: "Save project's checkpoint" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary"
        }
      }
    }
  })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "name", type: "string" })
  @ApiResponse({
    status: 201,
    description: "File uploaded successfully",
    type: ProjectActionResponseDto
  })
  @ApiResponse({
    status: 400,
    description: "The project holds as many named versions as it may",
    type: CheckpointLimitDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 413, description: "File too large" })
  @ApiResponse({ status: 422, description: "File validation failed" })
  @HttpCode(HttpStatus.CREATED)
  async saveCheckpoint(
    @ProjectId() id: number,
    @Param("name") name: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: PROJECT_BLOB_MAX_BYTES })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY
        })
    )
      file: Express.Multer.File
  ): Promise<ProjectActionResponseDto> {
    await this.projectService.save(id, file);
    await this.projectService.checkpoint(id, name);

    return { message: "Checkpoint saved successfully", id };
  }

  @Delete(":id/deleteCheckpoint/:name")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Delete project's checkpoint" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "name", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Checkpoint deleted successfully",
    type: ProjectActionResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async deleteCheckpoint(
    @ProjectId() id: number,
    @Param("name") name: string
  ): Promise<ProjectActionResponseDto> {
    await this.projectService.removeCheckpoint(id, name);

    return { message: "Checkpoint deleted successfully", id };
  }

  @Post(":id/publish")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Publish project" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 201,
    description: "Project published successfully",
    type: ProjectActionResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({
    status: 413,
    description: "Project content exceeds the publishing budget",
    type: ProjectTooLargeDto
  })
  @HttpCode(HttpStatus.CREATED)
  async publish(
    @ProjectId() id: number
  ): Promise<ProjectActionResponseDto> {
    await this.projectService.publish(id);

    return { message: "Project published successfully", id };
  }

  @Post(":id/unpublish")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Unpublish project" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 201,
    description: "Project unpublished successfully",
    type: ProjectActionResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @HttpCode(HttpStatus.CREATED)
  async unpublish(
    @ProjectId() id: number
  ): Promise<ProjectActionResponseDto> {
    await this.projectService.unpublish(id);

    return { message: "Project unpublished successfully", id };
  }

  @Get(":id/versions")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Get project versions" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project versions retrieved successfully",
    type: ProjectVersionsResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getVersions(
    @ProjectId() id: number
  ): Promise<ProjectVersionsResponseDto> {
    const versions = await this.projectService.listVersions(id);

    return { versions };
  }

  @Get(":id/checkpoints")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Get project checkpoints" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project checkpoints retrieved successfully",
    type: ProjectCheckpointsResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getCheckpoints(
    @ProjectId() id: number
  ): Promise<ProjectCheckpointsResponseDto> {
    const checkpoints = await this.projectService.listCheckpoints(id);

    return { checkpoints };
  }

  @Delete(":id/versions/:version")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Delete a project autosave" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "version", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Version deleted successfully",
    type: VersionDeletedResponseDto
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "No such version" })
  async deleteVersion(
    @ProjectId() id: number,
    @Param("version") version: string
  ): Promise<VersionDeletedResponseDto> {
    await this.projectService.deleteVersion(id, version);

    return { message: "Version deleted successfully", name: version };
  }

  @Get(":id/versions/:version")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch a project version" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "version", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project version retrieved successfully",
    content: {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" }
      }
    }
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getVersion(
    @ProjectId() id: number,
    @Param("version") version: string,
    @Res() res: Response
  ): Promise<void> {
    await this.sendFile(res, () =>
      this.projectService.fetchSavedVersion(id, version)
    );
  }

  @Get(":id/checkpoints/:checkpoint")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch a project checkpoint" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "checkpoint", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project checkpoint retrieved successfully",
    content: {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" }
      }
    }
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getCheckpoint(
    @ProjectId() id: number,
    @Param("checkpoint") checkpoint: string,
    @Res() res: Response
  ): Promise<void> {
    await this.sendFile(
      res,
      async () => {
        const file = await this.projectService.fetchCheckpoint(id, checkpoint);
        // attachment() also guesses a Content-Type from the name, so it runs before the stored
        // type is set.
        res.attachment(checkpoint);
        return file;
      },
      {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      }
    );
  }

  @Post("releases/:id/like")
  @ApiOperation({
    summary: "Like a published project (idempotent, authenticated users only)"
  })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Like status",
    type: LikeResponseDto
  })
  @HttpCode(HttpStatus.OK)
  async likeProject(
    @ProjectId() id: number,
    @Req() req: RequestWithUser
  ): Promise<LikeResponseDto> {
    return this.projectService.likeProject(id, req.user.id);
  }

  @Delete("releases/:id/like")
  @ApiOperation({
    summary: "Unlike a published project (authenticated users only)"
  })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Like removed",
    type: LikeResponseDto
  })
  @HttpCode(HttpStatus.OK)
  async unlikeProject(
    @ProjectId() id: number,
    @Req() req: RequestWithUser
  ): Promise<LikeResponseDto> {
    return this.projectService.unlikeProject(id, req.user.id);
  }

  @Get("releases/:id/like-status")
  @ApiOperation({
    summary: "Get like status for a project (authenticated users only)"
  })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Like status",
    type: LikeResponseDto
  })
  async getLikeStatus(
    @ProjectId() id: number,
    @Req() req: RequestWithUser
  ): Promise<LikeResponseDto> {
    return this.projectService.getLikeStatus(id, req.user.id);
  }

  // Public, yet it reads the bearer when there is one: a signed-in reader counts by account, an
  // anonymous one by address.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post("releases/:id/view")
  @ApiOperation({ summary: "Register a play view for a published project" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Updated view count",
    type: ViewResponseDto
  })
  @HttpCode(HttpStatus.OK)
  async registerReleaseView(
    @ProjectId() id: number,
    @Req() req: Request & { user?: { id: number } | null }
  ): Promise<ViewResponseDto> {
    return this.projectService.registerReleaseView(id, {
      userId: req.user?.id ?? null,
      ip: req.ip ?? ""
    });
  }

  @Post(":id/update-release")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: "Update an already published project's release content"
  })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Release updated successfully",
    type: ProjectActionResponseDto
  })
  @ApiResponse({ status: 400, description: "Project is not published" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({
    status: 413,
    description: "Project content exceeds the publishing budget",
    type: ProjectTooLargeDto
  })
  @HttpCode(HttpStatus.OK)
  async updateRelease(
    @ProjectId() id: number
  ): Promise<ProjectActionResponseDto> {
    await this.projectService.updateRelease(id);

    return { message: "Release updated successfully", id };
  }
}
