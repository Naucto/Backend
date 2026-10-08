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

  /**
   * Everything the project owns in the bucket, as single keys and as prefixes to list. A new kind
   * of object belongs here too, or deleting the project leaves it behind.
   */
  owned: (projectId: number): { keys: string[]; prefixes: string[] } => ({
    keys: [projectKeys.release(projectId), projectKeys.cover(projectId)],
    prefixes: [projectKeys.checkpoints(projectId), projectKeys.saves(projectId)],
  }),
};
