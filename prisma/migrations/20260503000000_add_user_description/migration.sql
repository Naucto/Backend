-- Add a first-class profile description while keeping nickname for backward compatibility.
ALTER TABLE "User"
ADD COLUMN "description" TEXT;
