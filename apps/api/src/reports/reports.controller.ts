import { Controller, Get, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { Roles, ShopId } from '../common/auth';
import { localDateStr } from '../common/time';
import { Period, ReportsService } from './reports.service';

const asPeriod = (p?: string): Period => (p === 'week' || p === 'month' || p === 'last30' ? p : 'day');

/** Financial reports: owners only (staff don't see revenue). */
@Roles(Role.SHOP_OWNER)
@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('summary')
  summary(@ShopId() shopId: string, @Query('period') period?: string, @Query('date') date?: string) {
    return this.reports.summary(shopId, asPeriod(period), date || localDateStr(new Date()));
  }

  @Get('pdf')
  async pdf(@ShopId() shopId: string, @Res() res: Response, @Query('period') period?: string, @Query('date') date?: string, @Query('download') download?: string) {
    const p = asPeriod(period);
    const d = date || localDateStr(new Date());
    const buf = await this.reports.pdf(shopId, p, d);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="report-${p}-${d}.pdf"`);
    res.send(buf);
  }
}
