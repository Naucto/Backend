export const ACTIVITY_CHANGED = 'activity.changed';

export class ActivityChangedEvent {
  constructor(readonly userId: number) {}
}

export const FRIENDSHIP_CHANGED = 'friendship.changed';

export class FriendshipChangedEvent {
  constructor(
    readonly userId: number,
    readonly otherId: number,
  ) {}
}

export const PROJECT_CHANGED = 'project.changed';

export class ProjectChangedEvent {
  constructor(readonly projectId: number) {}
}
