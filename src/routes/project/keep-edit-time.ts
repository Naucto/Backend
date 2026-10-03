/**
 * `updatedAt` is Prisma's `@updatedAt`, so every write moves it, and it orders the author's own
 * project list. A write that is not an edit (a counter, a size breakdown) spreads this into its
 * data to write the row's edit time back unchanged.
 */
export const keepEditTime = (row: { updatedAt: Date }): { updatedAt: Date } => ({
  updatedAt: row.updatedAt,
});
