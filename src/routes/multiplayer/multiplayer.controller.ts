import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GameSessionEx, MultiplayerService } from "./multiplayer.service";
import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Post,
  UseGuards
} from "@nestjs/common";
import { GameSession } from "@prisma/client";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RequestWithUser } from "../../auth/auth.types";
import { ProjectNotFoundError } from "../project/project.error";
import { OpenHostRequestDto, OpenHostResponseDto } from "./dto/open-host.dto";
import { LookupHostsResponseDto, LookupHostsResponseDtoHost } from "./dto/lookup-hosts.dto";
import { MultiplayerHostNotFoundError, MultiplayerHostOpenedError, MultiplayerUserDoesNotExistError } from "./multiplayer.error";
import { getExcerrMessage as getExcerrMessage } from "../../util/errors";

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
  async lookupHosts(requestCtx: RequestWithUser, projectId: number): Promise<LookupHostsResponseDto>
  {
    let hosts: GameSessionEx[];

    try {
      hosts = await this.multiplayerService.lookupHosts(projectId, requestCtx.user.id);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new BadRequestException(error.message);
      }

      this.logger.error(`Error while looking up hosts for project ID ${projectId}`);
      this.logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }

    const responseDto = new LookupHostsResponseDto();
    responseDto.hosts = hosts.map((host) => {
      const hostDto = new LookupHostsResponseDtoHost();
      hostDto.sessionUuid = host.sessionId;
      hostDto.sessionVisibility = host.visibility;
      hostDto.playerCount = host.otherUsers.length + 1;
    
      return hostDto;
    });

    return responseDto;
  }

  @Post("open-host")
  @ApiOperation({ summary: "Open a new game host/session, with the caller being the game host" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "The game host/session has been successfully opened."
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "The user or project was not found."
  })
  // FIXME: See comment below
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "The user is already hosting a game session for this project."
  })
  async openHost(requestCtx: RequestWithUser, request: OpenHostRequestDto): Promise<OpenHostResponseDto>
  {
    let gameSession: GameSession;

    try {
      gameSession = await this.multiplayerService.openHost(requestCtx.user.id, request.projectId, request.visibility);
    } catch (error) {
      if (error instanceof MultiplayerUserDoesNotExistError ||
          error instanceof MultiplayerHostNotFoundError) {
        throw new NotFoundException(error.message);
      } else if (error instanceof MultiplayerHostOpenedError) {
        // FIXME: Should the user be able to open multiple hosts for the same project?
        throw new BadRequestException(error.message);
      }

      this.logger.error(`Error while opening host for user ID ${requestCtx.user.id} and project ID ${request.projectId}`);
      this.logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }

    const responseDto = new OpenHostResponseDto();
    responseDto.sessionUuid = gameSession.sessionId;

    return responseDto;
  }
}
