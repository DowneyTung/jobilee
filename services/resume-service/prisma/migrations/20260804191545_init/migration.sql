-- CreateTable
CREATE TABLE "base_resumes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "base_resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tailored_resumes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "gapAnalysis" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tailored_resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_files" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "base_resumes_userId_key" ON "base_resumes"("userId");

-- CreateIndex
CREATE INDEX "tailored_resumes_userId_jobId_idx" ON "tailored_resumes"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "tailored_resumes_userId_jobId_version_key" ON "tailored_resumes"("userId", "jobId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "resume_files_objectKey_key" ON "resume_files"("objectKey");

-- CreateIndex
CREATE INDEX "resume_files_userId_createdAt_idx" ON "resume_files"("userId", "createdAt");
