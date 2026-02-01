import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { MultiplayerService } from "./multiplayer.service";
import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
  UseGuards
} from "@nestjs/common";
import { GameSession } from "@prisma/client";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RequestWithUser } from "../../auth/auth.types";
import { ProjectNotFoundError } from "../project/project.error";
import { OpenHostRequestDto } from "./dto/open-host.dto";

@ApiTags("multiplayer")
@Controller("multiplayer")
@UseGuards(JwtAuthGuard)
export class MultiplayerController {
  private readonly logger = new Logger(MultiplayerController.name);

  constructor(private readonly multiplayerService: MultiplayerService) {}

  @Get("list-hosts")
  @ApiOperation({ summary: "List available game hosts/sessions from the user's perspective" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "A list of available game hosts is returned."
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Bad request (wrong project ID)."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Unhandled server error."
  })
  async lookupHosts(requestCtx: RequestWithUser, projectId: number): Promise<GameSession[]>
  {
    let hosts: GameSession[];

    try {
      hosts = await this.multiplayerService.lookupHosts(projectId, requestCtx.user.id);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new BadRequestException("Project not found");
      } else {
        this.logger.error(`Error while looking up hosts for project ID ${projectId}`);
        this.logger.error(error);

        throw new InternalServerErrorException("Unhandled error while looking up hosts");
      }
    }

    return hosts;
  }

  @Post("open-host")
  @ApiOperation({ summary: "Open a new game host/session, with the caller being the game host" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "The game host/session has been successfully opened."
  })
  async openHost(requestCtx: RequestWithUser, request: OpenHostRequestDto): Promise<GameSession>
  {
    let gameSession: GameSession;
  }
}
