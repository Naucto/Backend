-- Add lastActiveAt column to WorkSession table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'WorkSession' 
        AND column_name = 'lastActiveAt'
    ) THEN
        ALTER TABLE "WorkSession" ADD COLUMN "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;
