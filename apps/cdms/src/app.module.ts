import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbService } from './db/db.service';
import { CollectorService } from './collector/collector.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot(), ScheduleModule.forRoot()],
  providers: [DbService, CollectorService],
})
export class AppModule {}
