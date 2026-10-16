import {
  dashboardQuerySchema,
  REPORT_KINDS,
  reportQuerySchema,
  type ReportKind,
} from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { AppError } from '../../utils/app-error.js';
import { getShopSettings } from '../settings/service.js';
import { renderReportPdf, toCsv } from './export.js';
import * as reports from './service.js';

export const reportsRouter = Router();
reportsRouter.use(authenticate, requirePermission('reports:read'));

reportsRouter.get('/dashboard', async (req, res) => {
  res.json({ dashboard: await reports.getDashboard(dashboardQuerySchema.parse(req.query)) });
});

reportsRouter.get('/:kind', async (req, res) => {
  const kind = req.params.kind as ReportKind;
  if (!REPORT_KINDS.includes(kind)) throw AppError.notFound('No such report');
  const query = reportQuerySchema.parse(req.query);
  const report = await reports.getReport(kind, query);
  if (query.format === 'json') return void res.json({ report });

  const stem = `${kind}-report-${report.period ? `${report.period.from}-to-${report.period.to}` : report.generatedAt.slice(0, 10)}`;
  res.set('Cache-Control', 'private, no-store');
  if (query.format === 'pdf') {
    const pdf = await renderReportPdf(report, await getShopSettings());
    return void res
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="${stem}.pdf"`)
      .send(pdf);
  }
  const section = query.section
    ? report.sections.find((s) => s.id === query.section)
    : report.sections[0];
  if (!section) throw AppError.notFound('No such table in this report');
  res
    .type('text/csv; charset=utf-8')
    .set(
      'Content-Disposition',
      `attachment; filename="${query.section ? `${stem}-${section.id}` : stem}.csv"`,
    )
    .send(toCsv(section));
});
