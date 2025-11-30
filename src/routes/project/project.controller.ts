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
  Patch,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ProjectSave, ProjectService } from "@projects/project.service";
import { CreateProjectDto } from "@projects/dto/create-project.dto";
import { UpdateProjectDto } from "@projects/dto/update-project.dto";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { ProjectCollaboratorGuard, ProjectCreatorGuard } from "@auth/guards/project.guard";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AddCollaboratorDto, RemoveCollaboratorDto } from "@projects/dto/collaborator-project.dto";
import { S3DownloadException } from "@s3/s3.error";
import { Request, Response } from "express";
import { UserDto } from "@auth/dto/user.dto";
import { Project } from "@prisma/client";
import { ProjectResponseDto, ProjectWithRelationsResponseDto } from "./dto/project-response.dto";
import { DownloadedFile } from "@s3/s3.interface";

interface RequestWithUser extends Request {
    user: UserDto;
}

@ApiTags("projects")
@Controller("projects")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  private readonly logger = new Logger(ProjectController.name);

  @Get()
  @ApiOperation({ summary: "Retrieve the list of projects" })
  @ApiResponse({
    status: 200,
    description: "A JSON array of projects with collaborators and creator information",
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
  @ApiParam({ name: "id", type: "number", description: "Numeric ID of the project to retrieve" })
  @ApiResponse({
    status: 200,
    description: "Project object",
    type: ProjectWithRelationsResponseDto
  })
  @ApiResponse({ status: 404, description: "Project not found" })
  @ApiResponse({ status: 500, description: "Internal server error" })
  @ApiResponse({ status: 403, description: "Invalid user or project ID" })
  async findOne(@Param("id", ParseIntPipe) id: number): Promise<ProjectWithRelationsResponseDto> {
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
  async create(@Body() createProjectDto: CreateProjectDto, @Req() req: RequestWithUser): Promise<ProjectResponseDto> {
    const userId = req.user.id;
    return await this.projectService.create(createProjectDto, userId);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update an existing project" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to update",
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
      @Body() updateProjectDto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.projectService.update(id, updateProjectDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Patch(":id/add-collaborator")
  @ApiOperation({
    summary: "Add a new collaborator",
    description: "Add a collaborator to a project by providing either userId, username, or email. At least one must be provided."
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to update",
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
  @ApiResponse({ status: 400, description: "Bad request - no valid identifier provided" })
  @ApiResponse({ status: 404, description: "Project or user not found" })
  @ApiResponse({ status: 500, description: "Error Patching project" })
  async addCollaborator(
      @Param("id", ParseIntPipe) id: number,
      @Body() addCollaboratorDto: AddCollaboratorDto,
  ): Promise<Project> {
    return this.projectService.addCollaborator(id, addCollaboratorDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Delete(":id/remove-collaborator")
  @ApiOperation({
    summary: "Remove a collaborator",
    description: "Remove a collaborator from a project by providing either userId, username, or email. At least one must be provided."
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to update",
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
  @ApiResponse({ status: 400, description: "Bad request - no valid identifier provided" })
  @ApiResponse({ status: 403, description: "Forbidden - cannot remove project creator" })
  @ApiResponse({ status: 404, description: "Project or user not found" })
  @ApiResponse({
    status: 500,
    description: "Error remove collaborator on project",
  })
  async removeCollaborator(
      @Param("id", ParseIntPipe) id: number,
      @Body() removeCollaboratorDto: RemoveCollaboratorDto,
      @Req() request: RequestWithUser,
  ): Promise<Project> {
    const initiator = request.user.id;
    return this.projectService.removeCollaborator(id, initiator, removeCollaboratorDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Delete(":id")
  @ApiOperation({ summary: "Delete a project" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Numeric ID of the project to delete",
  })
  @ApiResponse({
    status: 204,
    description: "Project deleted successfully (no content)",
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
  @ApiOperation({ summary: "Save project's content" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 201, description: "File uploaded successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @HttpCode(HttpStatus.CREATED)
  async saveProjectContent(@Param("id") id: string, @UploadedFile() file: Express.Multer.File): Promise<{ message: string, id: string }> {
    //const metadata = {
    //  uploadedBy: req.user.id.toString(),
    //  id,
    //};
    await this.projectService.save(Number(id), file);

    return { message: "File uploaded successfully", id };
  }

  @Get(":id/fetchContent")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch project's content" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 200, description: "File fetched successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "File not found" })
  async fetchProjectContent(@Param("id") id: string, @Res() res: Response): Promise<void> {
    try {
      const file = await this.projectService.fetchLastVersion(Number(id));

      res.set({
        "Content-Type": file.contentType,
        "Content-Length": file.contentLength,
      });

      file.body.pipe(res);
    } catch (error) {

      if (error instanceof Error) {
        this.logger.error(`Failed to fetch content for project ${id}: ${error.message}`, error.stack);
      } else {
        this.logger.error(`Failed to fetch content for project ${id}: ${JSON.stringify(error)}`);
      }

      if (error instanceof S3DownloadException) {
        res.status(404).json({ message: "File not found" });
        return;
      }
      res.status(500).json({ message: "Internal server error" });
      return;
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
          format: "binary",
        },
      },
    },
  })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "name", type: "string" })
  @ApiResponse({ status: 201, description: "File uploaded successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @HttpCode(HttpStatus.CREATED)
  async saveCheckpoint(@Param("id") id: string, @Param("name") name: string, @UploadedFile() file: Express.Multer.File): Promise<{ message: string, id: string }> {
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
  async deleteCheckpoint(@Param("id") id: string, @Param("name") name: string): Promise<{ message: string, id: string }> {
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
  async publish(@Param("id") id: string): Promise<{ message: string, id: string }> {
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
  async unpublish(@Param("id") id: string): Promise<{ message: string, id: string }> {
    await this.projectService.unpublish(Number(id));

    return { message: "Project unpublished successfully", id };
  }

  @Get(":id/versions")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Get project versions" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 200, description: "Project versions retrieved successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getVersions(@Param("id") id: string): Promise<{ versions: ProjectSave[] }> {
    const versions = await this.projectService.listVersions(Number(id));

    return { versions };
  }

  @Get(":id/checkpoints")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Get project checkpoints" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 200, description: "Project checkpoints retrieved successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getCheckpoints(@Param("id") id: string): Promise<{ checkpoints: ProjectSave[] }> {
    const checkpoints = await this.projectService.listCheckpoints(Number(id));

    return { checkpoints };
  }

  @Get(":id/versions/:version")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch a project version" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "version", type: "string" })
  @ApiResponse({ status: 200, description: "Project version retrieved successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getVersion(@Param("id") id: string, @Param("version") version: string): Promise<{ project: DownloadedFile }> {
    const projectVersion = await this.projectService.fetchSavedVersion(Number(id), version);

    return { project: projectVersion };
  }

  @Get(":id/checkpoints/:checkpoint")
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: "Fetch a project checkpoint" })
  @ApiParam({ name: "id", type: "string" })
  @ApiParam({ name: "checkpoint", type: "string" })
  @ApiResponse({ status: 200, description: "Project checkpoint retrieved successfully" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getCheckpoint(@Param("id") id: string, @Param("checkpoint") checkpoint: string): Promise<{ project: DownloadedFile }> {
    const projectCheckpoint = await this.projectService.fetchCheckpoint(Number(id), checkpoint);

    return { project: projectCheckpoint };
  }

  @Get("releases/:id")
  @ApiOperation({ summary: "Get project release version" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 200, description: "Project release retrieved successfully" })
  async getRelease(@Param("id") id: string): Promise<{ project: DownloadedFile }> {
    const projectRelease = await this.projectService.fetchRelease(Number(id));

    return { project: projectRelease };
  }

  @Get("releases")
  @ApiOperation({ summary: "Get all released projects" })
  @ApiResponse({ status: 200, description: "All released projects retrieved successfully" })
  async getAllReleases(): Promise<Project[]> {
    return this.projectService.fetchPublishedGames();
  }
}
