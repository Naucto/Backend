-- CreateTable
CREATE TABLE "WorkSession" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" TEXT NOT NULL,
    "roomPassword" TEXT NOT NULL,

    CONSTRAINT "WorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_WorkSessionUsers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_WorkSessionUsers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkSession_projectId_key" ON "WorkSession"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSession_roomId_key" ON "WorkSession"("roomId");

-- CreateIndex
CREATE INDEX "_WorkSessionUsers_B_index" ON "_WorkSessionUsers"("B");

-- AddForeignKey
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorkSessionUsers" ADD CONSTRAINT "_WorkSessionUsers_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorkSessionUsers" ADD CONSTRAINT "_WorkSessionUsers_B_fkey" FOREIGN KEY ("B") REFERENCES "WorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
