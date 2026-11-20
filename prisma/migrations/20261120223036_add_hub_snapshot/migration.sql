-- CreateTable
CREATE TABLE "HubSnapshot" (
    "day" DATE NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "HubSnapshot_pkey" PRIMARY KEY ("day")
);
