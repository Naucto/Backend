-- DropForeignKey
ALTER TABLE "AiConnection" DROP CONSTRAINT "AiConnection_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiContext" DROP CONSTRAINT "AiContext_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiKeyGrant" DROP CONSTRAINT "AiKeyGrant_keyId_fkey";

-- DropForeignKey
ALTER TABLE "AiKeyGrant" DROP CONSTRAINT "AiKeyGrant_projectId_fkey";

-- DropTable
DROP TABLE "AiConnection";

-- DropTable
DROP TABLE "AiContext";

-- DropTable
DROP TABLE "AiKeyGrant";
