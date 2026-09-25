import { Test } from "@nestjs/testing";
import { Controller, Get, INestApplication, Patch, UseGuards, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { AuthController } from "@auth/auth.controller";
import { AuthService } from "@auth/auth.service";
import { AuthSessionService } from "@auth/auth-session.service";
import { JwtStrategy } from "@auth/strategies/jwt.strategy";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "@auth/guards/permissions.guard";
import { Permissions } from "@auth/decorators/permissions.decorator";
import { Permission } from "@auth/permissions";
import { CookieCsrfMiddleware } from "@auth/middleware/csrf.middleware";
import { GoogleAuthService } from "@auth/providers/google-auth.service";
import { GithubAuthService } from "@auth/providers/github-auth.service";
import { MicrosoftAuthService } from "@auth/providers/microsoft-auth.service";
import { UserService } from "@user/user.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AdminRoleController } from "@admin/admin-role.controller";
import { AdminRoleService } from "@admin/admin-role.service";
import { AdminUserController } from "@admin/admin-user.controller";
import { AdminUserService } from "@admin/admin-user.service";
import { AuditService } from "@moderation/audit";
import { ModerationService } from "@moderation/moderation.service";

@Controller("review-content")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(Permission.MODERATE_CONTENT)
class ContentController {
  @Get()
  read(): { success: true } { return { success: true }; }

  @Patch()
  write(): { success: true } { return { success: true }; }
}

describe("Shared sessions and custom permissions (Postgres)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userService: UserService;
  let adminCookies: string[];
  let adminCsrf: string;
  let reviewerId: number;
  let customRoleId: number;
  const password = randomBytes(24).toString("hex");
  const origin = "http://localhost:3002";
  const runId = randomBytes(4).toString("hex");
  const roleName = `Reviewer_${runId}`;
  const email = (name: string): string => `${name}_${runId}@review.example`;
  const cookies = (response: request.Response): string[] =>
    (response.headers["set-cookie"] as unknown as string[]).map((cookie) => cookie.split(";")[0]!);
  const csrf = (values: string[]): string => values.find((value) => value.startsWith("naucto_admin_csrf="))!.split("=")[1]!;

  beforeAll(async () => {
    const databaseUrl = process.env["REVIEW_TEST_DATABASE_URL"];
    if (!databaseUrl) throw new Error("REVIEW_TEST_DATABASE_URL must point at an isolated migrated test database");
    process.env["DATABASE_URL"] = databaseUrl;
    process.env["REFRESH_TOKEN_ENCRYPTION_KEY"] = randomBytes(32).toString("hex");
    const values = { JWT_SECRET: randomBytes(32).toString("hex"), ADMIN_PANEL_URL: origin };
    const config = new ConfigService(values);
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AuthController, AdminRoleController, AdminUserController, ContentController],
      providers: [
        PrismaService, UserService, AuditService, ModerationService, AdminRoleService, AdminUserService,
        AuthService, AuthSessionService, JwtStrategy, PermissionsGuard,
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: new JwtService({ secret: values["JWT_SECRET"] }) },
        { provide: GoogleAuthService, useValue: {} },
        { provide: GithubAuthService, useValue: {} },
        { provide: MicrosoftAuthService, useValue: {} }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    const middleware = new CookieCsrfMiddleware(config);
    app.use(middleware.use.bind(middleware));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    userService = app.get(UserService);
    await prisma.role.upsert({ where: { name: "Admin" }, create: { name: "Admin" }, update: {} });
    await userService.create({ email: email("admin"), username: `admin_${runId}`, password, roles: ["Admin"] });
    reviewerId = (await userService.create({ email: email("reviewer"), username: `reviewer_${runId}`, password })).id;
    const login = await request(app.getHttpServer()).post("/auth/login?scope=admin")
      .set("Origin", origin).send({ email: email("admin"), password }).expect(201);
    adminCookies = cookies(login);
    adminCsrf = csrf(adminCookies);
    expect(login.body.permissions).toContain(Permission.MANAGE_ROLES);
    expect(login.body).not.toHaveProperty("access_token");
    expect(login.body).not.toHaveProperty("password");
  });

  afterAll(async () => { await app?.close(); });

  it("creates a custom role, validates permissions, and assigns it through the role endpoint", async () => {
    await request(app.getHttpServer()).post("/admin/roles").set("Cookie", adminCookies)
      .set("Origin", origin).set("X-CSRF-Token", adminCsrf)
      .send({ name: "Invalid", permissions: ["ROOT"] }).expect(400);
    const created = await request(app.getHttpServer()).post("/admin/roles").set("Cookie", adminCookies)
      .set("Origin", origin).set("X-CSRF-Token", adminCsrf)
      .send({ name: roleName, permissions: [Permission.MODERATE_CONTENT] }).expect(201);
    customRoleId = created.body.id;
    expect(created.body.permissions).toEqual([Permission.MODERATE_CONTENT]);
    await request(app.getHttpServer()).post(`/admin/users/${reviewerId}/roles/${roleName}`)
      .set("Cookie", adminCookies).set("Origin", origin).set("X-CSRF-Token", adminCsrf).send({}).expect(200);
  });

  it("supports cookie and bearer login concurrently and protects cookie writes on ordinary routes", async () => {
    const staff = await request(app.getHttpServer()).post("/auth/login?scope=admin")
      .set("Origin", origin).send({ email: email("reviewer"), password }).expect(201);
    const staffCookies = cookies(staff);
    const regular = await request(app.getHttpServer()).post("/auth/login")
      .set("Cookie", staffCookies).set("Origin", "http://localhost:3001")
      .send({ email: email("reviewer"), password }).expect(201);
    await request(app.getHttpServer()).get("/review-content").set("Authorization", `Bearer ${regular.body.access_token}`).expect(200);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", staffCookies).expect(200);
    await request(app.getHttpServer()).get("/admin/roles").set("Cookie", staffCookies).expect(403);
    await request(app.getHttpServer()).patch("/review-content").set("Cookie", staffCookies).send({}).expect(403);
    await request(app.getHttpServer()).patch("/review-content").set("Cookie", staffCookies)
      .set("Origin", origin).set("X-CSRF-Token", csrf(staffCookies)).send({}).expect(200);
    await request(app.getHttpServer()).patch("/review-content").set("Cookie", staffCookies)
      .set("Origin", "https://evil.example").set("X-CSRF-Token", csrf(staffCookies)).send({}).expect(403);
    const refresh = await request(app.getHttpServer()).post("/auth/refresh?scope=admin")
      .set("Cookie", staffCookies).set("Origin", origin).expect(201);
    const rotated = cookies(refresh);
    const refreshToken = rotated.find((value) => value.startsWith("naucto_admin_refresh="))!.split("=")[1];
    await request(app.getHttpServer()).get("/review-content").set("Authorization", `Bearer ${refreshToken}`).expect(401);
    await request(app.getHttpServer()).post("/auth/refresh?scope=admin")
      .set("Cookie", staffCookies).set("Origin", origin).expect(401);
    await request(app.getHttpServer()).post("/auth/logout?scope=admin")
      .set("Cookie", rotated).set("Origin", origin).set("X-CSRF-Token", csrf(rotated)).expect(201);
    await request(app.getHttpServer()).post("/auth/refresh?scope=admin")
      .set("Cookie", rotated).set("Origin", origin).expect(401);
  });

  it("revokes permissions immediately for both transports and prevents refresh after demotion", async () => {
    const staff = await request(app.getHttpServer()).post("/auth/login?scope=admin")
      .set("Origin", origin).send({ email: email("reviewer"), password }).expect(201);
    const staffCookies = cookies(staff);
    const regular = await request(app.getHttpServer()).post("/auth/login")
      .send({ email: email("reviewer"), password }).expect(201);
    await request(app.getHttpServer()).patch(`/admin/roles/${customRoleId}`).set("Cookie", adminCookies)
      .set("Origin", origin).set("X-CSRF-Token", adminCsrf)
      .send({ name: roleName, permissions: [], reason: "Revoke access" }).expect(200);
    await request(app.getHttpServer()).get("/review-content").set("Cookie", staffCookies).expect(403);
    await request(app.getHttpServer()).get("/review-content").set("Authorization", `Bearer ${regular.body.access_token}`).expect(403);
    await request(app.getHttpServer()).post("/auth/refresh?scope=admin").set("Cookie", staffCookies).set("Origin", origin).expect(403);
    const audit = await prisma.moderationAction.findFirst({ where: { action: "RENAME_ROLE", targetId: customRoleId } });
    expect(audit?.after).toMatchObject({ permissions: [] });
  });
});
