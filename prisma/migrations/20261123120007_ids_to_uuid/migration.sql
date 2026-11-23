-- Every integer primary key becomes a UUID, and every column that names one follows, with the rows
-- in place. A row's UUID is a version 7 dated at the row's creation, so ids keep the order the
-- rows were made in. Written by hand: the generated migration dropped and recreated each column.
--
-- Three integers stay: "User"."playerNumber" (the old id, with its sequence), "Project"."legacyId"
-- (the old id, no default) and "AnalyticsFact"."id".
--
-- One transaction: Prisma sends this file as a single query, which Postgres runs as one
-- transaction, so a failure anywhere leaves the database as it was. There is no BEGIN and COMMIT
-- on purpose: inside an explicit block Prisma can no longer record why a migration failed. The two
-- statements below stop a runner that would commit statement by statement before it changes
-- anything. By hand, run it with `psql -1 -v ON_ERROR_STOP=1 -f`.
SELECT set_config('naucto.one_transaction', 'yes', true);

DO $$
BEGIN
    IF current_setting('naucto.one_transaction', true) IS DISTINCT FROM 'yes' THEN
        RAISE EXCEPTION 'This migration must run as one transaction.';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Where every row goes
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "LegacyIdMap" (
    "model" TEXT NOT NULL,
    "legacyId" INTEGER NOT NULL,
    "id" UUID NOT NULL,

    CONSTRAINT "LegacyIdMap_pkey" PRIMARY KEY ("model","legacyId")
);

-- Everyone signs in again, and the hub recomputes its day at start: both tables only hold what the
-- application rebuilds.
TRUNCATE "RefreshToken";
TRUNCATE "HubSnapshot";

-- A version 7 UUID dated at `made`, a timestamp in UTC as every date column holds. `uuidv7` reads
-- the clock itself and takes how far to shift it. The shift is counted in seconds: an interval
-- that holds days is added in the time zone of the session, an hour off across a clock change.
-- The clock is read twice, here and in `uuidv7`, so a draw whose date is not `made` to the
-- millisecond is drawn again. A date no version 7 can hold (before 1970) fails the migration.
CREATE FUNCTION pg_temp.id_made_at(made TIMESTAMP) RETURNS UUID
LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
    instant CONSTANT TIMESTAMPTZ := date_trunc('milliseconds', made AT TIME ZONE 'UTC');
    id UUID;
BEGIN
    FOR attempt IN 1..100 LOOP
        id := uuidv7(make_interval(
            secs => EXTRACT(EPOCH FROM instant) - EXTRACT(EPOCH FROM clock_timestamp())
        ));
        IF uuid_extract_timestamp(id) = instant THEN
            RETURN id;
        END IF;
    END LOOP;
    RAISE EXCEPTION 'No version 7 UUID could be dated %.', made;
END
$$;

-- "startedAt" is when a session row is made; every other table says it in "createdAt".
INSERT INTO "LegacyIdMap" ("model", "legacyId", "id")
          SELECT 'User',             "id", pg_temp.id_made_at("createdAt") FROM "User"
UNION ALL SELECT 'FriendRequest',    "id", pg_temp.id_made_at("createdAt") FROM "FriendRequest"
UNION ALL SELECT 'Friendship',       "id", pg_temp.id_made_at("createdAt") FROM "Friendship"
UNION ALL SELECT 'Project',          "id", pg_temp.id_made_at("createdAt") FROM "Project"
UNION ALL SELECT 'Comment',          "id", pg_temp.id_made_at("createdAt") FROM "Comment"
UNION ALL SELECT 'Like',             "id", pg_temp.id_made_at("createdAt") FROM "Like"
UNION ALL SELECT 'ReleaseView',      "id", pg_temp.id_made_at("createdAt") FROM "ReleaseView"
UNION ALL SELECT 'FeaturedRelease',  "id", pg_temp.id_made_at("createdAt") FROM "FeaturedRelease"
UNION ALL SELECT 'Notification',     "id", pg_temp.id_made_at("createdAt") FROM "Notification"
UNION ALL SELECT 'Report',           "id", pg_temp.id_made_at("createdAt") FROM "Report"
UNION ALL SELECT 'ReportOccurrence', "id", pg_temp.id_made_at("createdAt") FROM "ReportOccurrence"
UNION ALL SELECT 'GameSession',      "id", pg_temp.id_made_at("startedAt") FROM "GameSession"
UNION ALL SELECT 'WorkSession',      "id", pg_temp.id_made_at("startedAt") FROM "WorkSession"
UNION ALL SELECT 'AnalyticsMarker',  "id", pg_temp.id_made_at("createdAt") FROM "AnalyticsMarker"
UNION ALL SELECT 'Flag',             "id", pg_temp.id_made_at("createdAt") FROM "Flag"
UNION ALL SELECT 'ModerationAction', "id", pg_temp.id_made_at("createdAt") FROM "ModerationAction";

-- The id of a row that no longer exists: the analytics of a deleted game, a flag on a deleted
-- comment. Derived from its model and number, so every fact about one deleted thing still carries
-- the same id. Shaped as a version 3 UUID so it passes wherever an id is validated.
CREATE FUNCTION pg_temp.derived_id(model TEXT, legacy INTEGER) RETURNS UUID
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT overlay(overlay(md5(model || ':' || legacy) PLACING '3' FROM 13) PLACING '8' FROM 17)::uuid
$$;

-- The UUID an integer id became: the row's when it exists, the derived one otherwise.
CREATE FUNCTION pg_temp.new_id(model TEXT, legacy INTEGER) RETURNS UUID
LANGUAGE sql STABLE STRICT AS $$
    SELECT COALESCE(
        (SELECT map."id" FROM "LegacyIdMap" AS map WHERE map."model" = $1 AND map."legacyId" = $2),
        pg_temp.derived_id($1, $2)
    )
$$;

-- A release id where 0 stood for "no game": 0 becomes the nil UUID.
CREATE FUNCTION pg_temp.new_release_id(legacy INTEGER) RETURNS UUID
LANGUAGE sql STABLE STRICT AS $$
    SELECT CASE WHEN legacy = 0
        THEN '00000000-0000-0000-0000-000000000000'::uuid
        ELSE pg_temp.new_id('Project', legacy)
    END
$$;

-- The model a moderation target type names.
CREATE FUNCTION pg_temp.target_model(target "ModerationTargetType") RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE target WHEN 'USER' THEN 'User' WHEN 'PROJECT' THEN 'Project' WHEN 'COMMENT' THEN 'Comment' END
$$;

-- A JSON object whose integer under `key` is replaced by the UUID it became; anything else is
-- returned as it is.
CREATE FUNCTION pg_temp.with_new_id(data JSONB, key TEXT, model TEXT) RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN jsonb_typeof(data -> key) = 'number' AND (data ->> key) ~ '^\d{1,9}$'
        THEN jsonb_set(data, ARRAY[key], to_jsonb(pg_temp.new_id(model, (data ->> key)::integer)::text))
        ELSE data
    END
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Foreign keys off: a key cannot hold between an integer and a UUID. Section 6 puts each back.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "AnalyticsProjectionWork" DROP CONSTRAINT "AnalyticsProjectionWork_userId_fkey";
ALTER TABLE "AnalyticsUserDaily" DROP CONSTRAINT "AnalyticsUserDaily_userId_fkey";
ALTER TABLE "AnalyticsVisitor" DROP CONSTRAINT "AnalyticsVisitor_userId_fkey";
ALTER TABLE "Collection" DROP CONSTRAINT "Collection_ownerId_fkey";
ALTER TABLE "CollectionItem" DROP CONSTRAINT "CollectionItem_projectId_fkey";
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_authorId_fkey";
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_parentId_fkey";
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_projectId_fkey";
ALTER TABLE "FeaturedRelease" DROP CONSTRAINT "FeaturedRelease_featuredById_fkey";
ALTER TABLE "FeaturedRelease" DROP CONSTRAINT "FeaturedRelease_projectId_fkey";
ALTER TABLE "FeedbackPrompt" DROP CONSTRAINT "FeedbackPrompt_userId_fkey";
ALTER TABLE "Flag" DROP CONSTRAINT "Flag_reporterId_fkey";
ALTER TABLE "Flag" DROP CONSTRAINT "Flag_resolutionId_fkey";
ALTER TABLE "Flag" DROP CONSTRAINT "Flag_resolvedById_fkey";
ALTER TABLE "FriendRequest" DROP CONSTRAINT "FriendRequest_fromId_fkey";
ALTER TABLE "FriendRequest" DROP CONSTRAINT "FriendRequest_toId_fkey";
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_userAId_fkey";
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_userBId_fkey";
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_hostId_fkey";
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_projectId_fkey";
ALTER TABLE "Like" DROP CONSTRAINT "Like_projectId_fkey";
ALTER TABLE "Like" DROP CONSTRAINT "Like_userId_fkey";
ALTER TABLE "ModerationAction" DROP CONSTRAINT "ModerationAction_actorId_fkey";
ALTER TABLE "ModerationAction" DROP CONSTRAINT "ModerationAction_subjectUserId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";
ALTER TABLE "Project" DROP CONSTRAINT "Project_forked_from_id_fkey";
ALTER TABLE "Project" DROP CONSTRAINT "Project_userId_fkey";
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";
ALTER TABLE "ReleaseView" DROP CONSTRAINT "ReleaseView_projectId_fkey";
ALTER TABLE "Report" DROP CONSTRAINT "Report_ratingId_fkey";
ALTER TABLE "Report" DROP CONSTRAINT "Report_userId_fkey";
ALTER TABLE "ReportOccurrence" DROP CONSTRAINT "ReportOccurrence_reportId_fkey";
ALTER TABLE "WorkSession" DROP CONSTRAINT "WorkSession_hostId_fkey";
ALTER TABLE "WorkSession" DROP CONSTRAINT "WorkSession_projectId_fkey";
ALTER TABLE "_ProjectCollaborators" DROP CONSTRAINT "_ProjectCollaborators_A_fkey";
ALTER TABLE "_ProjectCollaborators" DROP CONSTRAINT "_ProjectCollaborators_B_fkey";
ALTER TABLE "_UserJoinedGameSessions" DROP CONSTRAINT "_UserJoinedGameSessions_A_fkey";
ALTER TABLE "_UserJoinedGameSessions" DROP CONSTRAINT "_UserJoinedGameSessions_B_fkey";
ALTER TABLE "_WorkSessionUsers" DROP CONSTRAINT "_WorkSessionUsers_A_fkey";
ALTER TABLE "_WorkSessionUsers" DROP CONSTRAINT "_WorkSessionUsers_B_fkey";

-- ---------------------------------------------------------------------------------------------
-- 3. The two tables that keep their number
-- ---------------------------------------------------------------------------------------------

-- "User": the old id stays as "playerNumber" with its sequence, which keeps counting from where it
-- is; the UUID is a new column.
ALTER TABLE "User" DROP CONSTRAINT "User_pkey";
ALTER TABLE "User" RENAME COLUMN "id" TO "playerNumber";
ALTER SEQUENCE "User_id_seq" RENAME TO "User_playerNumber_seq";
ALTER TABLE "User" ADD COLUMN "id" UUID;
UPDATE "User" SET "id" = pg_temp.new_id('User', "playerNumber");
ALTER TABLE "User"
    ALTER COLUMN "id" SET NOT NULL,
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "User_playerNumber_key" ON "User"("playerNumber");

-- "Project": the old id is copied to "legacyId", which later projects leave null.
ALTER TABLE "Project" ADD COLUMN "legacyId" INTEGER;
UPDATE "Project" SET "legacyId" = "id";
CREATE UNIQUE INDEX "Project_legacyId_key" ON "Project"("legacyId");

-- ---------------------------------------------------------------------------------------------
-- 4. Every id column, in place. Changing a column's type rebuilds its primary key, its unique
--    constraints and its indexes under their names, so none is recreated here.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "Project"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('Project', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId"),
    ALTER COLUMN "forked_from_id" TYPE UUID USING pg_temp.new_id('Project', "forked_from_id");
DROP SEQUENCE "Project_id_seq";

ALTER TABLE "RefreshToken"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('RefreshToken', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId");
DROP SEQUENCE "RefreshToken_id_seq";

ALTER TABLE "FriendRequest"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('FriendRequest', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "fromId" TYPE UUID USING pg_temp.new_id('User', "fromId"),
    ALTER COLUMN "toId" TYPE UUID USING pg_temp.new_id('User', "toId");
DROP SEQUENCE "FriendRequest_id_seq";

ALTER TABLE "Friendship"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('Friendship', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "userAId" TYPE UUID USING pg_temp.new_id('User', "userAId"),
    ALTER COLUMN "userBId" TYPE UUID USING pg_temp.new_id('User', "userBId");
DROP SEQUENCE "Friendship_id_seq";

ALTER TABLE "Comment"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('Comment', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "authorId" TYPE UUID USING pg_temp.new_id('User', "authorId"),
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId"),
    ALTER COLUMN "parentId" TYPE UUID USING pg_temp.new_id('Comment', "parentId");
DROP SEQUENCE "Comment_id_seq";

ALTER TABLE "Like"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('Like', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId"),
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId");
DROP SEQUENCE "Like_id_seq";

ALTER TABLE "ReleaseView"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('ReleaseView', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId");
DROP SEQUENCE "ReleaseView_id_seq";

ALTER TABLE "FeaturedRelease"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('FeaturedRelease', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId"),
    ALTER COLUMN "featuredById" TYPE UUID USING pg_temp.new_id('User', "featuredById");
DROP SEQUENCE "FeaturedRelease_id_seq";

ALTER TABLE "Notification"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('Notification', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId");
DROP SEQUENCE "Notification_id_seq";

-- "releaseId" and "projectId" carry no foreign key: a report outlives the game it is about.
ALTER TABLE "Report"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('Report', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId"),
    ALTER COLUMN "releaseId" TYPE UUID USING pg_temp.new_id('Project', "releaseId"),
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId"),
    ALTER COLUMN "ratingId" TYPE UUID USING pg_temp.new_id('Report', "ratingId");
DROP SEQUENCE "Report_id_seq";

ALTER TABLE "ReportOccurrence"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('ReportOccurrence', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "reportId" TYPE UUID USING pg_temp.new_id('Report', "reportId");
DROP SEQUENCE "ReportOccurrence_id_seq";

ALTER TABLE "FeedbackPrompt"
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId");

ALTER TABLE "GameSession"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('GameSession', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "hostId" TYPE UUID USING pg_temp.new_id('User', "hostId"),
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId");
DROP SEQUENCE "GameSession_id_seq";

ALTER TABLE "WorkSession"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('WorkSession', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "hostId" TYPE UUID USING pg_temp.new_id('User', "hostId"),
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId");
DROP SEQUENCE "WorkSession_id_seq";

-- A flag and a moderation action name their target without a foreign key, and outlive it.
ALTER TABLE "Flag"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('Flag', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "reporterId" TYPE UUID USING pg_temp.new_id('User', "reporterId"),
    ALTER COLUMN "targetId" TYPE UUID USING pg_temp.new_id(pg_temp.target_model("targetType"), "targetId"),
    ALTER COLUMN "targetOwnerId" TYPE UUID USING pg_temp.new_id('User', "targetOwnerId"),
    ALTER COLUMN "resolvedById" TYPE UUID USING pg_temp.new_id('User', "resolvedById"),
    ALTER COLUMN "resolutionId" TYPE UUID USING pg_temp.new_id('ModerationAction', "resolutionId");
DROP SEQUENCE "Flag_id_seq";

ALTER TABLE "ModerationAction"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('ModerationAction', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "actorId" TYPE UUID USING pg_temp.new_id('User', "actorId"),
    ALTER COLUMN "targetId" TYPE UUID USING pg_temp.new_id(pg_temp.target_model("targetType"), "targetId"),
    ALTER COLUMN "subjectUserId" TYPE UUID USING pg_temp.new_id('User', "subjectUserId");
DROP SEQUENCE "ModerationAction_id_seq";

-- A collection keeps its id: it was a UUID already, and is in the links people shared.
ALTER TABLE "Collection"
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "ownerId" TYPE UUID USING pg_temp.new_id('User', "ownerId");

ALTER TABLE "CollectionItem"
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId");

-- The implicit join tables: "A" and "B" follow the alphabetical order of the two models.
ALTER TABLE "_ProjectCollaborators"
    ALTER COLUMN "A" TYPE UUID USING pg_temp.new_id('Project', "A"),
    ALTER COLUMN "B" TYPE UUID USING pg_temp.new_id('User', "B");

ALTER TABLE "_UserJoinedGameSessions"
    ALTER COLUMN "A" TYPE UUID USING pg_temp.new_id('GameSession', "A"),
    ALTER COLUMN "B" TYPE UUID USING pg_temp.new_id('User', "B");

ALTER TABLE "_WorkSessionUsers"
    ALTER COLUMN "A" TYPE UUID USING pg_temp.new_id('User', "A"),
    ALTER COLUMN "B" TYPE UUID USING pg_temp.new_id('WorkSession', "B");

-- Analytics. Its release and project ids carry no foreign key, so the history of a deleted game
-- stays; that history gets the derived id.
ALTER TABLE "AnalyticsVisitor"
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId");

ALTER TABLE "AnalyticsProjectionWork"
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId");

ALTER TABLE "AnalyticsPlay"
    ALTER COLUMN "releaseId" TYPE UUID USING pg_temp.new_id('Project', "releaseId");

ALTER TABLE "AnalyticsLiveMinute"
    ALTER COLUMN "releaseId" TYPE UUID USING pg_temp.new_id('Project', "releaseId");

ALTER TABLE "AnalyticsAnonTally"
    ALTER COLUMN "releaseId" DROP DEFAULT,
    ALTER COLUMN "releaseId" TYPE UUID USING pg_temp.new_release_id("releaseId"),
    ALTER COLUMN "releaseId" SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

ALTER TABLE "AnalyticsUserDaily"
    ALTER COLUMN "userId" TYPE UUID USING pg_temp.new_id('User', "userId"),
    ALTER COLUMN "releaseId" DROP DEFAULT,
    ALTER COLUMN "releaseId" TYPE UUID USING pg_temp.new_release_id("releaseId"),
    ALTER COLUMN "releaseId" SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

ALTER TABLE "AnalyticsFact"
    ALTER COLUMN "actorUserId" TYPE UUID USING pg_temp.new_id('User', "actorUserId"),
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId");

ALTER TABLE "AnalyticsMpSession"
    ALTER COLUMN "projectId" TYPE UUID USING pg_temp.new_id('Project', "projectId");

ALTER TABLE "AnalyticsMarker"
    ALTER COLUMN "id" DROP DEFAULT,
    ALTER COLUMN "id" TYPE UUID USING pg_temp.new_id('AnalyticsMarker', "id"),
    ALTER COLUMN "id" SET DEFAULT uuidv7(),
    ALTER COLUMN "releaseId" TYPE UUID USING pg_temp.new_id('Project', "releaseId");
DROP SEQUENCE "AnalyticsMarker_id_seq";

-- ---------------------------------------------------------------------------------------------
-- 5. Ids held outside a column of their own
-- ---------------------------------------------------------------------------------------------

-- A pair of friends is stored once, lower id first, and the UUIDs do not sort as the numbers did.
UPDATE "Friendship"
SET "userAId" = "userBId", "userBId" = "userAId"
WHERE "userAId" > "userBId";

-- `u:<user id>`; the keys of anonymous viewers hold no id.
UPDATE "ReleaseView"
SET "viewerKey" = 'u:' || pg_temp.new_id('User', substr("viewerKey", 3)::integer)
WHERE "viewerKey" ~ '^u:\d{1,9}$';

-- `project:<project id>` and `release:<project id>:<revision>`.
UPDATE "AnalyticsFact"
SET "dedupeKey" = 'project:' || pg_temp.new_id('Project', split_part("dedupeKey", ':', 2)::integer)
WHERE "dedupeKey" ~ '^project:\d{1,9}$';

UPDATE "AnalyticsFact"
SET "dedupeKey" = 'release:' || pg_temp.new_id('Project', split_part("dedupeKey", ':', 2)::integer)
    || ':' || split_part("dedupeKey", ':', 3)
WHERE "dedupeKey" ~ '^release:\d{1,9}:\d+$';

-- `release:<project id>`.
UPDATE "AnalyticsRollup"
SET "dimension" = 'release:' || pg_temp.new_release_id(split_part("dimension", ':', 2)::integer)
WHERE "dimension" ~ '^release:\d{1,9}$';

-- `<reporter id>:<target type>:<target id>`, while the flag is open.
UPDATE "Flag"
SET "openKey" = "reporterId" || ':' || "targetType" || ':' || "targetId"
WHERE "openKey" IS NOT NULL;

-- `view:<staff id>:<project id>:<hour>`.
UPDATE "ModerationAction"
SET "dedupeKey" = 'view:' || pg_temp.new_id('User', split_part("dedupeKey", ':', 2)::integer)
    || ':' || pg_temp.new_id('Project', split_part("dedupeKey", ':', 3)::integer)
    || ':' || split_part("dedupeKey", ':', 4)
WHERE "dedupeKey" ~ '^view:\d{1,9}:\d{1,9}:\d+$';

-- What a notification links to, per kind.
UPDATE "Notification"
SET "data" = pg_temp.with_new_id(pg_temp.with_new_id(pg_temp.with_new_id(pg_temp.with_new_id(pg_temp.with_new_id(
    "data",
    'requestId', 'FriendRequest'),
    'fromUserId', 'User'),
    'userId', 'User'),
    'projectId', 'Project'),
    'actionId', 'ModerationAction')
WHERE jsonb_typeof("data") = 'object';

-- ---------------------------------------------------------------------------------------------
-- 6. Foreign keys back, as they were
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "AnalyticsProjectionWork" ADD CONSTRAINT "AnalyticsProjectionWork_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsUserDaily" ADD CONSTRAINT "AnalyticsUserDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsVisitor" ADD CONSTRAINT "AnalyticsVisitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeaturedRelease" ADD CONSTRAINT "FeaturedRelease_featuredById_fkey" FOREIGN KEY ("featuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeaturedRelease" ADD CONSTRAINT "FeaturedRelease_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackPrompt" ADD CONSTRAINT "FeedbackPrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "ModerationAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Like" ADD CONSTRAINT "Like_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_forked_from_id_fkey" FOREIGN KEY ("forked_from_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleaseView" ADD CONSTRAINT "ReleaseView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_ratingId_fkey" FOREIGN KEY ("ratingId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReportOccurrence" ADD CONSTRAINT "ReportOccurrence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "_ProjectCollaborators" ADD CONSTRAINT "_ProjectCollaborators_A_fkey" FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProjectCollaborators" ADD CONSTRAINT "_ProjectCollaborators_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_UserJoinedGameSessions" ADD CONSTRAINT "_UserJoinedGameSessions_A_fkey" FOREIGN KEY ("A") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_UserJoinedGameSessions" ADD CONSTRAINT "_UserJoinedGameSessions_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_WorkSessionUsers" ADD CONSTRAINT "_WorkSessionUsers_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_WorkSessionUsers" ADD CONSTRAINT "_WorkSessionUsers_B_fkey" FOREIGN KEY ("B") REFERENCES "WorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
