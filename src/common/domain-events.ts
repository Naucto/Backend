export const ACTIVITY_CHANGED = 'activity.changed';

export class ActivityChangedEvent {
  constructor(readonly userId: string) {}
}

export const FRIENDSHIP_CHANGED = 'friendship.changed';

export class FriendshipChangedEvent {
  constructor(
    readonly userId: string,
    readonly otherId: string,
  ) {}
}

export const PROJECT_CHANGED = 'project.changed';

export class ProjectChangedEvent {
  constructor(readonly projectId: string) {}
}
