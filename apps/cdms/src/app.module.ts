import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbService } from './db/db.service';
import { CollectorService } from './collector/collector.service';
import { ConfigModule } from '@nestjs/config';
import { WorkerService } from './worker/worker.service';

@Module({
  imports: [ConfigModule.forRoot(), ScheduleModule.forRoot()],
  providers: [DbService, CollectorService, WorkerService],
})
export class AppModule {}
