import { HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { RequestWithUser } from "@auth/auth.types";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

describe("NotificationsController", () => {
  let controller: NotificationsController;
  let notificationsService: {
    createNotification: jest.Mock;
    getWebRTCOffer: jest.Mock;
    markAsRead: jest.Mock;
  };

  const request = {
    user: {
      id: 42
    }
  } as RequestWithUser;

  const notificationPayload = {
    id: "7",
    userId: 42,
    title: "Build complete",
    message: "Your build is ready.",
    type: "INFO" as const,
    read: false,
    createdAt: "2026-06-07T09:00:00.000Z"
  };

  beforeEach(async () => {
    notificationsService = {
      createNotification: jest.fn(),
      getWebRTCOffer: jest.fn(),
      markAsRead: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: notificationsService
        }
      ]
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should return the notification websocket offer", () => {
    const offer = {
      signaling: ["ws://localhost:4098"],
      maxConns: 50,
      peerOpts: { config: { iceServers: [] } }
    };
    notificationsService.getWebRTCOffer.mockReturnValue(offer);

    expect(controller.getWebRTCOffer()).toEqual({
      statusCode: HttpStatus.OK,
      message: "Notification websocket configuration retrieved",
      data: offer
    });
  });

  it("should create a test notification for the current user", async () => {
    notificationsService.createNotification.mockResolvedValue(notificationPayload);

    await expect(
      controller.sendTestNotification(request, {
        title: "Build complete",
        message: "Your build is ready.",
        type: "INFO"
      })
    ).resolves.toEqual({
      statusCode: HttpStatus.OK,
      message: "Notification sent",
      data: notificationPayload
    });

    expect(notificationsService.createNotification).toHaveBeenCalledWith({
      userId: 42,
      title: "Build complete",
      message: "Your build is ready.",
      type: "INFO"
    });
  });

  it("should mark a notification as read for the current user", async () => {
    notificationsService.markAsRead.mockResolvedValue({
      ...notificationPayload,
      read: true
    });

    await expect(controller.markAsRead(request, "7")).resolves.toEqual({
      statusCode: HttpStatus.OK,
      message: "Notification marked as read",
      data: {
        ...notificationPayload,
        read: true
      }
    });

    expect(notificationsService.markAsRead).toHaveBeenCalledWith(42, "7");
  });
});
