/**
 * Limits a collection is held to, enforced server-side: the text ones by the DTOs, the two counts
 * by the service.
 */
export const COLLECTION_TITLE_MAX_LENGTH = 40;
export const COLLECTION_DESCRIPTION_MAX_LENGTH = 280;

/** What a search of the public list may carry. */
export const COLLECTION_SEARCH_MAX_LENGTH = 100;

export const COLLECTIONS_PER_USER_MAX = 50;
/** Counts every game listed, the ones that left the hub included. */
export const COLLECTION_GAMES_MAX = 200;

/** Games a collection shows in a list: what its box of disks draws. */
export const COLLECTION_PREVIEW_GAMES = 8;

/** The default page of the public list. */
export const COLLECTIONS_PAGE_SIZE = 24;
