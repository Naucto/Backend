-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'User';

-- A user linked to several roles keeps the highest.
UPDATE "User" SET "role" = 'Moderator'
WHERE "id" IN (
  SELECT ur."B" FROM "_UserRoles" ur JOIN "Role" r ON r."id" = ur."A" WHERE r."name" = 'Moderator'
);
UPDATE "User" SET "role" = 'Admin'
WHERE "id" IN (
  SELECT ur."B" FROM "_UserRoles" ur JOIN "Role" r ON r."id" = ur."A" WHERE r."name" = 'Admin'
);

-- DropTable
DROP TABLE "_UserRoles";

-- DropTable
DROP TABLE "Role";
