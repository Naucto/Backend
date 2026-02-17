import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Put,
  Res,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { ProjectSave, ProjectService } from "@projects/project.service";
import { CreateProjectDto } from "@projects/dto/create-project.dto";
import { UpdateProjectDto } from "@projects/dto/update-project.dto";
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
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import {
  AddCollaboratorDto,
  RemoveCollaboratorDto
} from "@projects/dto/collaborator-project.dto";
import { Request } from "express";
import { UserDto } from "@auth/dto/user.dto";
import { Project } from "@prisma/client";
import {
  ProjectResponseDto,
  ProjectWithRelationsResponseDto
} from "./dto/project-response.dto";
import { S3DownloadException } from "@s3/s3.error";
import { S3Service } from "@s3/s3.service";

interface RequestWithUser extends Request {
  user: UserDto;
}

@ApiTags("projects")
@Controller("projects")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly s3Service: S3Service
  ) {}

  private readonly logger = new Logger(ProjectController.name);

  @Get("releases")
  @ApiOperation({ summary: "Get all released projects" })
  @ApiResponse({
    status: 200,
    description:
      "A JSON array of projects with collaborators and creator information",
    type: [ProjectResponseDto]
  })
  async getAllReleases(): Promise<Project[]> {
    return this.projectService.fetchPublishedGames();
  }

  @Get("releases/:id")
  @ApiOperation({ summary: "Get project release version" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project release file"
  })
  async getRelease(@Param("id") id: string): Promise<Project> {
    const projectRelease = await this.projectService.fetchRelease(Number(id));

    return projectRelease;
  }

  @Get("releases/:id/content")
  @ApiOperation({ summary: "Get project release version" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project release file"
  })
  async getReleaseContent(
    @Param("id") id: string,
    @Res() res: Response
  ): Promise<void> {
    try {
      const file = await this.projectService.fetchReleaseContent(Number(id));
      res.set({
        "Content-Type": file.contentType,
        "Content-Length": file.contentLength
      });

      file.body.pipe(res);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to fetch content for project ${id}: ${error.message}`,
          error.stack
        );
      } else {
        this.logger.error(
          `Failed to fetch content for project ${id}: ${JSON.stringify(error)}`
        );
      }

      if (error instanceof S3DownloadException) {
        res.status(404).json({ message: "File not found" });
        return;
      }
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }

  @Get()
  @ApiOperation({ summary: "Retrieve the list of projects" })
  @ApiResponse({
    status: 200,
    description:
      "A JSON array of projects with collaborators and creator information",
    type: [ProjectWithRelationsResponseDto]
  })
  @ApiResponse({ status: 500, description: "Internal server error" })
  async findAll(@Req() request: RequestWithUser): Promise<Project[]> {
    const user = request.user;
    return this.projectService.findAll(user.id);
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
    type: ProjectResponseDto
  })
  @ApiResponse({ status: 404, description: "Project not found" })
  @ApiResponse({ status: 500, description: "Internal server error" })
  @ApiResponse({ status: 403, description: "Invalid user or project ID" })
  async findOne(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ProjectResponseDto> {
    return this.projectService.findOne(id);
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

  @Put(":id")
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
  @ApiResponse({ status: 404, description: "Project not found" })
  @ApiResponse({ status: 500, description: "Error updating project" })
  async update(
    @Param("id", ParseIntPipe) id: number,
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
    type: ProjectWithRelationsResponseDto
  })
  @ApiResponse({
    status: 400,
    description: "Bad request - no valid identifier provided"
  })
  @ApiResponse({ status: 404, description: "Project or user not found" })
  @ApiResponse({ status: 500, description: "Error Patching project" })
  async addCollaborator(
    @Param("id", ParseIntPipe) id: number,
    @Body() addCollaboratorDto: AddCollaboratorDto
  ): Promise<Project> {
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
    type: ProjectWithRelationsResponseDto
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
    @Param("id", ParseIntPipe) id: number,
    @Body() removeCollaboratorDto: RemoveCollaboratorDto
  ): Promise<Project> {
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
  async remove(@Param("id", ParseIntPipe) id: number): Promise<void> {
    return this.projectService.remove(id);
  }

  @Patch(":id/saveContent")
  @UseGuards(ProjectCollaboratorGuard)
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Save project's content (Upload)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Project file (zip, pdf, png, etc.)"
        }
      }
    }
  })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 201, description: "File uploaded successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 422, description: "File validation failed" })
  @HttpCode(HttpStatus.CREATED)
  async saveProjectContent(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({
          maxSize: 100 * 1024 * 1024
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY
        })
    )
    file: Express.Multer.File,
    @Req() req: RequestWithUser
  ): Promise<{ message: string; id: number }> {
    const extension = file.originalname.split(".").pop();
    if (!extension) throw new BadRequestException("File has no extension");

    const project = await this.projectService.findOne(id);

    const newS3Key = id.toString();

    if (project.contentKey && project.contentKey !== newS3Key) {
      this.logger.log(
        `Deleting old file '${project.contentKey}' for project ${id}`
      );
      try {
        await this.s3Service.deleteFile(project.contentKey);
      } catch (err) {
        this.logger.warn(`Failed to delete old file: ${err}`);
      }
    }

    const metadata = {
      uploadedBy: req.user.id.toString(),
      projectId: id.toString(),
      originalName: file.originalname
    };

    await this.s3Service.uploadFile(file, metadata, undefined, newS3Key);
    await this.projectService.updateContentInfo(id, newS3Key, extension);

    return { message: "File uploaded successfully", id };
  }

  @Get(":id/fetchContent")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch project's content (Download)" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "File stream" })
  @ApiResponse({ status: 404, description: "File not found (DB or S3)" })
  async fetchProjectContent(
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response
  ): Promise<void> {
    try {
      const project = await this.projectService.findOne(id);

      if (!project.contentKey) {
        throw new BadRequestException(
          "No content uploaded for this project yet."
        );
      }
      const file = await this.projectService.fetchLastVersion(Number(id));

      const filename = `${id}.${project.contentExtension || "bin"}`;

      res.set({
        "Content-Type": file.contentType,
        "Content-Length": (file.contentLength ?? 0).toString(),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        ETag: project.contentUploadedAt
          ? `W/"${project.contentUploadedAt.getTime()}"`
          : undefined
      });

      file.body.pipe(res);
    } catch (error) {
      if (error instanceof S3DownloadException) {
        this.logger.warn(
          `S3 File not found for project ${id} (Key: ${error.key})`
        );
        res.status(404).json({ message: "File not found on storage server" });
        return;
      }

      if (error instanceof Error) {
        this.logger.error(`Download failed: ${error.message}`, error.stack);
      } else {
        this.logger.error("Download failed: Unknown error");
      }

      if (!res.headersSent) {
        res
          .status(500)
          .json({ message: "Internal server error during download" });
      }
    }
  }

  @Post(":id/saveCheckpoint/:name")
  @UseGuards(ProjectCollaboratorGuard)
  @UseInterceptors(FileInterceptor("file"))
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
  @ApiResponse({ status: 201, description: "File uploaded successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @HttpCode(HttpStatus.CREATED)
  async saveCheckpoint(
    @Param("id") id: string,
    @Param("name") name: string,
    @UploadedFile() file: Express.Multer.File
  ): Promise<{ message: string; id: string }> {
    await this.projectService.save(Number(id), file);
    await this.projectService.checkpoint(Number(id), name);

    return { message: "Checkpoint saved successfully", id };
  }

  @Delete(":id/deleteCheckpoint/:name")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Delete project's checkpoint" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "name", type: "string" })
  @ApiResponse({ status: 201, description: "File deleted successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteCheckpoint(
    @Param("id") id: string,
    @Param("name") name: string
  ): Promise<{ message: string; id: string }> {
    await this.projectService.removeCheckpoint(Number(id), name);

    return { message: "Checkpoint deleted successfully", id };
  }

  @Post(":id/publish")
  @UseGuards(ProjectCreatorGuard)
  @ApiOperation({ summary: "Publish project" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 201, description: "Project published successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @HttpCode(HttpStatus.CREATED)
  async publish(
    @Param("id") id: string
  ): Promise<{ message: string; id: string }> {
    await this.projectService.publish(Number(id));

    return { message: "Project published successfully", id };
  }

  @Post(":id/unpublish")
  @UseGuards(ProjectCreatorGuard)
  @ApiOperation({ summary: "Unpublish project" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 201, description: "Project unpublished successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @HttpCode(HttpStatus.CREATED)
  async unpublish(
    @Param("id") id: string
  ): Promise<{ message: string; id: string }> {
    await this.projectService.unpublish(Number(id));

    return { message: "Project unpublished successfully", id };
  }

  @Get(":id/versions")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Get project versions" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project versions retrieved successfully"
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getVersions(
    @Param("id") id: string
  ): Promise<{ versions: ProjectSave[] }> {
    const versions = await this.projectService.listVersions(Number(id));

    return { versions };
  }

  @Get(":id/checkpoints")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Get project checkpoints" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project checkpoints retrieved successfully"
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getCheckpoints(
    @Param("id") id: string
  ): Promise<{ checkpoints: ProjectSave[] }> {
    const checkpoints = await this.projectService.listCheckpoints(Number(id));

    return { checkpoints };
  }

  @Get(":id/versions/:version")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch a project version" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "version", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project version retrieved successfully"
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getVersion(
    @Param("id") id: string,
    @Param("version") version: string,
    @Res() res: Response
  ): Promise<void> {
    try {
      const file = await this.projectService.fetchSavedVersion(
        Number(id),
        version
      );

      res.set({
        "Content-Type": file.contentType,
        "Content-Length": file.contentLength
      });

      file.body.pipe(res);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to fetch content for project ${id}: ${error.message}`,
          error.stack
        );
      } else {
        this.logger.error(
          `Failed to fetch content for project ${id}: ${JSON.stringify(error)}`
        );
      }

      if (error instanceof S3DownloadException) {
        res.status(404).json({ message: "File not found" });
        return;
      }
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }

  @Get(":id/checkpoints/:checkpoint")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch a project checkpoint" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "checkpoint", type: "string" })
  @ApiResponse({
    status: 200,
    description: "Project checkpoint retrieved successfully"
  })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getCheckpoint(
    @Param("id") id: number,
    @Param("checkpoint") checkpoint: string,
    @Res() res: Response
  ): Promise<void> {
    try {
      const file = await this.projectService.fetchCheckpoint(
        Number(id),
        checkpoint
      );
      const project = await this.projectService.findOne(id);

      res.set({
        "Content-Type": file.contentType,
        "Content-Length": (file.contentLength ?? 0).toString(),
        "Content-Disposition": `attachment; filename="${checkpoint}"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        ETag: project.contentUploadedAt
          ? `W/"${project.contentUploadedAt.getTime()}"`
          : undefined
      });

      file.body.pipe(res);
    } catch (error) {
      if (error instanceof S3DownloadException) {
        this.logger.warn(
          `S3 File not found for project ${id} (Key: ${error.key})`
        );
        res.status(404).json({ message: "File not found on storage server" });
        return;
      }
      if (error instanceof Error) {
        this.logger.error(`Download failed: ${error.message}`, error.stack);
      } else {
        this.logger.error("Download failed: Unknown error");
      }

      if (!res.headersSent) {
        res
          .status(500)
          .json({ message: "Internal server error during download" });
      }
    }
  }
}
