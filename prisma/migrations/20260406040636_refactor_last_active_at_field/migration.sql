-- Rename lastSave to lastSaveAt for consistency with timestamp naming convention
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'WorkSession' 
        AND column_name = 'lastSave'
    ) THEN
        ALTER TABLE "WorkSession" RENAME COLUMN "lastSave" TO "lastSaveAt";
    END IF;
END $$;
