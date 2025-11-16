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
    UploadedFile,
    UseGuards,
    UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ProjectService } from "@projects/project.service";
import { CreateProjectDto } from "@projects/dto/create-project.dto";
import { UpdateProjectDto } from "@projects/dto/update-project.dto";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { ProjectCollaboratorGuard, ProjectCreatorGuard } from "@auth/guards/project.guard";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AddCollaboratorDto, RemoveCollaboratorDto } from "@projects/dto/collaborator-project.dto";
import { S3Service } from "@s3/s3.service";
import { Request } from "express";
import { UserDto } from "@auth/dto/user.dto";
import { Project } from "@prisma/client";
import { ProjectResponseDto, ProjectWithRelationsResponseDto } from "./dto/project-response.dto";
import { BadRequestException } from "@nestjs/common";
import { CloudfrontService } from "@s3/cloudfront.service";

interface RequestWithUser extends Request {
    user: UserDto;
}

@ApiTags("projects")
@Controller("projects")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class ProjectController {
    constructor(private readonly projectService: ProjectService, private readonly s3Service: S3Service, private readonly cloudfrontService: CloudfrontService) {}

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
        type: ProjectResponseDto
    })
    @ApiResponse({ status: 404, description: "Project not found" })
    @ApiResponse({ status: 500, description: "Internal server error" })
    @ApiResponse({ status: 403, description: "Invalid user or project ID" })
    async findOne(@Param("id", ParseIntPipe) id: number): Promise<ProjectResponseDto> {
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
    ): Promise<Project> {
        return this.projectService.removeCollaborator(id, removeCollaboratorDto);
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
    @UseInterceptors(FileInterceptor("file"))
    @ApiOperation({ summary: "Upload content file for a project" })
    @ApiConsumes("multipart/form-data")
    @ApiParam({ name: "id", type: "string", description: "Project ID" })
    @ApiBody({
        schema: {
            type: "object",
            properties: {
                file: {
                    type: "string",
                    format: "binary",
                    description: "Select the file to upload",
                },
            },
            required: ["file"],
        },
    })
    @ApiResponse({ status: 201, description: "File uploaded successfully" })
    @ApiResponse({ status: 400, description: "No file uploaded" })
    @HttpCode(HttpStatus.CREATED)
    async saveProjectContent(
        @Param("id") id: string,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: RequestWithUser
    ): Promise<{ message: string; cdnUrl: string }> {
        this.logger.log(`Uploading content for project ${id} by user ${req.user.id}`);

        if (!file) {
            this.logger.warn(`No file provided for project ${id}`);
            throw new BadRequestException("No file uploaded");
        }

        const extension = file.originalname.split('.').pop();
        if (!extension) {
            throw new BadRequestException("Uploaded file has no extension");
        }

        const projectId = Number(id);
        const s3Key = `${id}.${extension}`;

        const project = await this.projectService.findOne(projectId);

        if (project.contentKey) {
            this.logger.log(`Deleting old project content: ${project.contentKey}`);
            try {
                await this.s3Service.deleteFile(project.contentKey);
            } catch (error: unknown) {
                if (error instanceof Error) {
                    this.logger.warn(`Failed to delete old file: ${error.message}`);
                } else {
                    this.logger.warn(`Failed to delete old file: Unknown error`);
                }
            }
        }

        await this.s3Service.uploadFile(
            file,
            { uploadedBy: req.user.id.toString(), projectId: id },
            undefined,
            s3Key
        );

        await this.projectService.updateContentInfo(projectId, s3Key, extension);

        const signedUrl = this.cloudfrontService.generateSignedUrl(s3Key);

        this.logger.log(`Upload completed for project ${id}, signed URL generated`);

        return {
            message: "Project content uploaded successfully",
            cdnUrl: signedUrl,
        };
    }

    @Get(":id/fetchContent")
    async fetchProjectContent(@Param("id") id: string) {
        this.logger.log(`Generating CDN signed URL for project ${id}`);

        const projectId = Number(id);
        const project = await this.projectService.findOne(projectId);

        if (!project.contentKey) {
            throw new BadRequestException("Project content not found");
        }

        this.logger.debug(`Content key from DB: "${project.contentKey}"`);

        const exists = await this.s3Service.fileExists(project.contentKey);
        if (!exists) {
            this.logger.error(
                `Content key ${project.contentKey} stored in DB but file not found on S3 for project ${id}`
            );
            throw new BadRequestException("Project content file not found on storage");
        }

        const cdnUrl = this.cloudfrontService.getCDNUrl(project.contentKey);
        this.logger.debug(`CDN URL before signing: "${cdnUrl}"`);

        const signedUrl = this.cloudfrontService.generateSignedUrl(project.contentKey);
        this.logger.debug(`Signed URL: "${signedUrl}"`);

        this.logger.log(`Signed URL generated for project ${id}`);

        return {
            cdnUrl: signedUrl,
            uploadedAt: project.contentUploadedAt,
            extension: project.contentExtension,
        };
    }
}
