-- Google sign-in (Firebase Authentication)
ALTER TABLE "User" ADD COLUMN "googleUid" TEXT;
CREATE UNIQUE INDEX "User_googleUid_key" ON "User"("googleUid");
