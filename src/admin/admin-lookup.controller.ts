import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  AnalyticsEvent,
  DailyAnalyticsRollup,
  FriendRequest,
  Friendship,
  GameSession,
  Like,
  Prisma,
  Subscription,
  WorkSession
} from "@prisma/client";
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { AdminPaginationDto } from "./dto/admin-pagination.dto";
import {
  AdminPaginated,
  buildMeta,
  resolvePage
} from "./admin-pagination.util";

@ApiTags("admin-lookup")
@ApiCookieAuth("AdminCookie")
@UseGuards(AdminCookieJwtGuard, RolesGuard)
@Roles("Admin", "Moderator")
@Controller("admin/lookup")
export class AdminLookupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("likes")
  @ApiOperation({ summary: "List likes" })
  async likes(
    @Query() filter: AdminPaginationDto
  ): Promise<AdminPaginated<Like>> {
    const page = resolvePage(filter);
    const orderBy: Prisma.LikeOrderByWithRelationInput = {
      createdAt: filter.order ?? "desc"
    };
    const [rows, total] = await Promise.all([
      this.prisma.like.findMany({ skip: page.skip, take: page.take, orderBy }),
      this.prisma.like.count()
    ]);
    return { data: rows, meta: buildMeta(total, page) };
  }

  @Get("friendships")
  @ApiOperation({ summary: "List friendships" })
  async friendships(
    @Query() filter: AdminPaginationDto
  ): Promise<AdminPaginated<Friendship>> {
    const page = resolvePage(filter);
    const [rows, total] = await Promise.all([
      this.prisma.friendship.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: filter.order ?? "desc" }
      }),
      this.prisma.friendship.count()
    ]);
    return { data: rows, meta: buildMeta(total, page) };
  }

  @Get("friend-requests")
  @ApiOperation({ summary: "List friend requests" })
  async friendRequests(
    @Query() filter: AdminPaginationDto
  ): Promise<AdminPaginated<FriendRequest>> {
    const page = resolvePage(filter);
    const [rows, total] = await Promise.all([
      this.prisma.friendRequest.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: filter.order ?? "desc" }
      }),
      this.prisma.friendRequest.count()
    ]);
    return { data: rows, meta: buildMeta(total, page) };
  }

  @Get("subscriptions")
  @ApiOperation({ summary: "List subscriptions" })
  async subscriptions(
    @Query() filter: AdminPaginationDto
  ): Promise<AdminPaginated<Subscription>> {
    const page = resolvePage(filter);
    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { startDate: filter.order ?? "desc" }
      }),
      this.prisma.subscription.count()
    ]);
    return { data: rows, meta: buildMeta(total, page) };
  }

  @Get("game-sessions")
  @ApiOperation({ summary: "List game sessions" })
  async gameSessions(
    @Query() filter: AdminPaginationDto
  ): Promise<AdminPaginated<GameSession>> {
    const page = resolvePage(filter);
    const [rows, total] = await Promise.all([
      this.prisma.gameSession.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { startedAt: filter.order ?? "desc" }
      }),
      this.prisma.gameSession.count()
    ]);
    return { data: rows, meta: buildMeta(total, page) };
  }

  @Get("work-sessions")
  @ApiOperation({ summary: "List work sessions" })
  async workSessions(
    @Query() filter: AdminPaginationDto
  ): Promise<AdminPaginated<WorkSession>> {
    const page = resolvePage(filter);
    const [rows, total] = await Promise.all([
      this.prisma.workSession.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { lastActiveAt: filter.order ?? "desc" }
      }),
      this.prisma.workSession.count()
    ]);
    return { data: rows, meta: buildMeta(total, page) };
  }

  @Get("analytics-events")
  @Roles("Admin")
  @ApiOperation({ summary: "List analytics events (admin only)" })
  async analyticsEvents(
    @Query() filter: AdminPaginationDto
  ): Promise<AdminPaginated<AnalyticsEvent>> {
    const page = resolvePage(filter);
    const [rows, total] = await Promise.all([
      this.prisma.analyticsEvent.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: filter.order ?? "desc" }
      }),
      this.prisma.analyticsEvent.count()
    ]);
    return { data: rows, meta: buildMeta(total, page) };
  }

  @Get("daily-rollups")
  @Roles("Admin")
  @ApiOperation({ summary: "List daily analytics rollups (admin only)" })
  async dailyRollups(
    @Query() filter: AdminPaginationDto
  ): Promise<AdminPaginated<DailyAnalyticsRollup>> {
    const page = resolvePage(filter);
    const [rows, total] = await Promise.all([
      this.prisma.dailyAnalyticsRollup.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { date: filter.order ?? "desc" }
      }),
      this.prisma.dailyAnalyticsRollup.count()
    ]);
    return { data: rows, meta: buildMeta(total, page) };
  }
}
