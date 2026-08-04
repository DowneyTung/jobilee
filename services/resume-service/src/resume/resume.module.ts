import { Module } from "@nestjs/common";
import { FilesService } from "../files/files.service.ts";
import { ResumeController } from "./resume.controller.ts";
import { ResumeService } from "./resume.service.ts";

@Module({
  controllers: [ResumeController],
  providers: [ResumeService, FilesService],
})
export class ResumeModule {}
