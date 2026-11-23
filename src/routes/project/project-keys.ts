/**
 * Where a project's objects sit in the bucket. Every reader, writer and sweeper of project content
 * goes through these, so a key that changes here changes everywhere at once.
 */
export const projectKeys = {
  /** The published game, at one key for the life of the project. */
  release: (projectId: number): string => `release/${projectId}`,

  /** One autosave slot; `slot` is the millisecond the slot was opened. */
  save: (projectId: number, slot: string): string => `save/${projectId}/${slot}`,
  saves: (projectId: number): string => `save/${projectId}/`,

  /** One named version. */
  checkpoint: (projectId: number, name: string): string => `checkpoint/${projectId}/${name}`,
  checkpoints: (projectId: number): string => `checkpoint/${projectId}/`,

  cover: (projectId: number): string => `projects/${projectId}/image`,

  /** The short gameplay video, at one key whatever its container. */
  clip: (projectId: number): string => `projects/${projectId}/clip`,

  /**
   * Where the release, the cover and the clip of a game sit while moderation withholds it. Never
   * made public-read, so the edge stops serving them the moment they are moved here.
   */
  withheldRelease: (projectId: number): string => `withheld/${projectId}/release`,
  withheldCover: (projectId: number): string => `withheld/${projectId}/cover`,
  withheldClip: (projectId: number): string => `withheld/${projectId}/clip`,

  /**
   * Everything the project owns in the bucket, as single keys and as prefixes to list. A new kind
   * of object belongs here too, or deleting the project leaves it behind.
   */
  owned: (projectId: number): { keys: string[]; prefixes: string[] } => ({
    keys: [
      projectKeys.release(projectId),
      projectKeys.cover(projectId),
      projectKeys.clip(projectId),
      projectKeys.withheldRelease(projectId),
      projectKeys.withheldCover(projectId),
      projectKeys.withheldClip(projectId),
    ],
    prefixes: [projectKeys.checkpoints(projectId), projectKeys.saves(projectId)],
  }),
};
