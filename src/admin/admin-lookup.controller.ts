import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { AdminPaginationDto } from "./dto/admin-pagination.dto";

function pagination(filter: AdminPaginationDto): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 25;
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

function meta(total: number, page: number, limit: number): {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
} {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

@ApiTags("admin-lookup")
@ApiCookieAuth("AdminCookie")
@UseGuards(AdminCookieJwtGuard, RolesGuard)
@Roles("Admin", "Moderator")
@Controller("admin/lookup")
export class AdminLookupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("likes")
  @ApiOperation({ summary: "List likes" })
  async likes(@Query() filter: AdminPaginationDto) {
    const { skip, take, page, limit } = pagination(filter);
    const orderBy: Prisma.LikeOrderByWithRelationInput = {
      createdAt: filter.order ?? "desc"
    };
    const [rows, total] = await Promise.all([
      this.prisma.like.findMany({ skip, take, orderBy }),
      this.prisma.like.count()
    ]);
    return { data: rows, meta: meta(total, page, limit) };
  }

  @Get("friendships")
  @ApiOperation({ summary: "List friendships" })
  async friendships(@Query() filter: AdminPaginationDto) {
    const { skip, take, page, limit } = pagination(filter);
    const [rows, total] = await Promise.all([
      this.prisma.friendship.findMany({
        skip,
        take,
        orderBy: { createdAt: filter.order ?? "desc" }
      }),
      this.prisma.friendship.count()
    ]);
    return { data: rows, meta: meta(total, page, limit) };
  }

  @Get("friend-requests")
  @ApiOperation({ summary: "List friend requests" })
  async friendRequests(@Query() filter: AdminPaginationDto) {
    const { skip, take, page, limit } = pagination(filter);
    const [rows, total] = await Promise.all([
      this.prisma.friendRequest.findMany({
        skip,
        take,
        orderBy: { createdAt: filter.order ?? "desc" }
      }),
      this.prisma.friendRequest.count()
    ]);
    return { data: rows, meta: meta(total, page, limit) };
  }

  @Get("subscriptions")
  @ApiOperation({ summary: "List subscriptions" })
  async subscriptions(@Query() filter: AdminPaginationDto) {
    const { skip, take, page, limit } = pagination(filter);
    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({
        skip,
        take,
        orderBy: { startDate: filter.order ?? "desc" }
      }),
      this.prisma.subscription.count()
    ]);
    return { data: rows, meta: meta(total, page, limit) };
  }

  @Get("game-sessions")
  @ApiOperation({ summary: "List game sessions" })
  async gameSessions(@Query() filter: AdminPaginationDto) {
    const { skip, take, page, limit } = pagination(filter);
    const [rows, total] = await Promise.all([
      this.prisma.gameSession.findMany({
        skip,
        take,
        orderBy: { startedAt: filter.order ?? "desc" }
      }),
      this.prisma.gameSession.count()
    ]);
    return { data: rows, meta: meta(total, page, limit) };
  }

  @Get("work-sessions")
  @ApiOperation({ summary: "List work sessions" })
  async workSessions(@Query() filter: AdminPaginationDto) {
    const { skip, take, page, limit } = pagination(filter);
    const [rows, total] = await Promise.all([
      this.prisma.workSession.findMany({
        skip,
        take,
        orderBy: { lastActiveAt: filter.order ?? "desc" }
      }),
      this.prisma.workSession.count()
    ]);
    return { data: rows, meta: meta(total, page, limit) };
  }

  @Get("analytics-events")
  @Roles("Admin")
  @ApiOperation({ summary: "List analytics events (admin only)" })
  async analyticsEvents(@Query() filter: AdminPaginationDto) {
    const { skip, take, page, limit } = pagination(filter);
    const [rows, total] = await Promise.all([
      this.prisma.analyticsEvent.findMany({
        skip,
        take,
        orderBy: { createdAt: filter.order ?? "desc" }
      }),
      this.prisma.analyticsEvent.count()
    ]);
    return { data: rows, meta: meta(total, page, limit) };
  }

  @Get("daily-rollups")
  @Roles("Admin")
  @ApiOperation({ summary: "List daily analytics rollups (admin only)" })
  async dailyRollups(@Query() filter: AdminPaginationDto) {
    const { skip, take, page, limit } = pagination(filter);
    const [rows, total] = await Promise.all([
      this.prisma.dailyAnalyticsRollup.findMany({
        skip,
        take,
        orderBy: { date: filter.order ?? "desc" }
      }),
      this.prisma.dailyAnalyticsRollup.count()
    ]);
    return { data: rows, meta: meta(total, page, limit) };
  }
}
