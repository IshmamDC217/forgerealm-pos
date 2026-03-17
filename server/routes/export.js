const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const db = require('../db');

// GET /:sessionId — export session data as XLSX
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const format = req.query.format || 'xlsx';

    // Fetch session
    const sessionResult = await db.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = sessionResult.rows[0];

    // Fetch sales with product info
    const salesResult = await db.query(
      `SELECT sa.quantity, sa.price_charged, sa.timestamp,
              p.name AS product_name, p.category
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.session_id = $1
       ORDER BY sa.timestamp ASC`,
      [sessionId]
    );
    const sales = salesResult.rows;

    // Fetch per-product summary
    const summaryResult = await db.query(
      `SELECT p.name AS product_name, p.category,
              SUM(sa.quantity) AS total_units,
              SUM(sa.quantity * sa.price_charged) AS total_revenue,
              AVG(sa.price_charged) AS avg_price
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.session_id = $1
       GROUP BY p.name, p.category
       ORDER BY total_revenue DESC`,
      [sessionId]
    );

    if (format === 'csv') {
      return exportCSV(res, session, sales, summaryResult.rows);
    }

    return exportXLSX(res, session, sales, summaryResult.rows);
  } catch (err) {
    console.error('Error exporting:', err);
    res.status(500).json({ error: 'Failed to export session data' });
  }
});

async function exportCSV(res, session, sales, summary) {
  const lines = [];
  const sessionDate = new Date(session.date).toLocaleDateString('en-GB');

  lines.push(`ForgeRealm POS - Sales Report`);
  lines.push(`Session: ${session.name}`);
  lines.push(`Location: ${session.location || 'N/A'}`);
  lines.push(`Date: ${sessionDate}`);
  lines.push('');

  // Product summary
  lines.push('--- Product Summary ---');
  lines.push('Product,Category,Units Sold,Avg Price,Total Revenue');
  let grandTotal = 0;
  let grandUnits = 0;
  for (const row of summary) {
    const revenue = parseFloat(row.total_revenue);
    grandTotal += revenue;
    grandUnits += parseInt(row.total_units);
    lines.push(`"${row.product_name}","${row.category || ''}",${row.total_units},${parseFloat(row.avg_price).toFixed(2)},${revenue.toFixed(2)}`);
  }
  lines.push(`TOTAL,,${grandUnits},,${grandTotal.toFixed(2)}`);
  lines.push('');

  // Individual sales
  lines.push('--- Individual Sales ---');
  lines.push('Time,Product,Category,Quantity,Price Charged,Line Total');
  for (const sale of sales) {
    const time = new Date(sale.timestamp).toLocaleTimeString('en-GB');
    const lineTotal = (sale.quantity * parseFloat(sale.price_charged)).toFixed(2);
    lines.push(`${time},"${sale.product_name}","${sale.category || ''}",${sale.quantity},${parseFloat(sale.price_charged).toFixed(2)},${lineTotal}`);
  }

  const filename = `ForgeRealm_${session.name.replace(/[^a-zA-Z0-9]/g, '_')}_${sessionDate.replace(/\//g, '-')}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
}

async function exportXLSX(res, session, sales, summary) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ForgeRealm POS';
  workbook.created = new Date();

  const sessionDate = new Date(session.date).toLocaleDateString('en-GB');

  // === Brand colors ===
  const navy = '0A1628';
  const gold = 'D4A843';
  const darkBg = '111827';
  const white = 'FFFFFF';
  const lightGold = 'FFF8E7';
  const lightGray = 'F3F4F6';

  // === Summary Sheet ===
  const summarySheet = workbook.addWorksheet('Summary', {
    properties: { tabColor: { argb: gold } },
  });

  // Header
  summarySheet.mergeCells('A1:F1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = 'FORGEREALM';
  titleCell.font = { name: 'Arial', size: 22, bold: true, color: { argb: gold } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(1).height = 45;

  summarySheet.mergeCells('A2:F2');
  const subtitleCell = summarySheet.getCell('A2');
  subtitleCell.value = 'Sales Report';
  subtitleCell.font = { name: 'Arial', size: 14, color: { argb: white } };
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(2).height = 28;

  // Session info
  const infoStart = 4;
  const infoLabels = ['Session', 'Location', 'Date', 'Status'];
  const infoValues = [
    session.name,
    session.location || 'N/A',
    sessionDate,
    session.status.charAt(0).toUpperCase() + session.status.slice(1),
  ];

  infoLabels.forEach((label, i) => {
    const row = infoStart + i;
    const labelCell = summarySheet.getCell(`A${row}`);
    labelCell.value = label;
    labelCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: gold } };
    const valCell = summarySheet.getCell(`B${row}`);
    valCell.value = infoValues[i];
    valCell.font = { name: 'Arial', size: 11 };
  });

  // Product summary table
  const tableStart = infoStart + infoLabels.length + 2;
  summarySheet.mergeCells(`A${tableStart}:F${tableStart}`);
  const sectionTitle = summarySheet.getCell(`A${tableStart}`);
  sectionTitle.value = 'Product Breakdown';
  sectionTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: navy } };
  sectionTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold } };
  sectionTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(tableStart).height = 30;

  const headerRow = tableStart + 1;
  const headers = ['Product', 'Category', 'Units Sold', 'Avg Price', 'Total Revenue', '% of Revenue'];
  headers.forEach((h, i) => {
    const cell = summarySheet.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: darkBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: gold } },
    };
  });
  summarySheet.getRow(headerRow).height = 25;

  let grandTotal = 0;
  let grandUnits = 0;
  summary.forEach(r => { grandTotal += parseFloat(r.total_revenue); grandUnits += parseInt(r.total_units); });

  summary.forEach((row, i) => {
    const r = headerRow + 1 + i;
    const revenue = parseFloat(row.total_revenue);
    const bgColor = i % 2 === 0 ? lightGold : lightGray;

    const values = [
      row.product_name,
      row.category || '',
      parseInt(row.total_units),
      parseFloat(row.avg_price),
      revenue,
      grandTotal > 0 ? revenue / grandTotal : 0,
    ];

    values.forEach((v, j) => {
      const cell = summarySheet.getCell(r, j + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor.replace('#', '') } };
      cell.alignment = { horizontal: j < 2 ? 'left' : 'center', vertical: 'middle' };

      if (j === 3 || j === 4) cell.numFmt = '"$"#,##0.00';
      if (j === 5) cell.numFmt = '0.0%';
    });
  });

  // Totals row
  const totalsRow = headerRow + 1 + summary.length;
  const totalsData = ['TOTAL', '', grandUnits, '', grandTotal, '100%'];
  totalsData.forEach((v, j) => {
    const cell = summarySheet.getCell(totalsRow, j + 1);
    cell.value = v === '100%' ? 1 : v;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: navy } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold } };
    cell.alignment = { horizontal: j < 2 ? 'left' : 'center', vertical: 'middle' };
    if (j === 4) cell.numFmt = '"$"#,##0.00';
    if (j === 5) cell.numFmt = '0.0%';
    cell.border = { top: { style: 'medium', color: { argb: navy } } };
  });
  summarySheet.getRow(totalsRow).height = 28;

  // Column widths
  summarySheet.columns = [
    { width: 22 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 },
  ];

  // === Sales Detail Sheet ===
  const detailSheet = workbook.addWorksheet('Sales Detail', {
    properties: { tabColor: { argb: navy } },
  });

  detailSheet.mergeCells('A1:F1');
  const detailTitle = detailSheet.getCell('A1');
  detailTitle.value = `${session.name} - Individual Sales`;
  detailTitle.font = { name: 'Arial', size: 16, bold: true, color: { argb: gold } };
  detailTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  detailTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  detailSheet.getRow(1).height = 35;

  const detailHeaders = ['Time', 'Product', 'Category', 'Qty', 'Price', 'Line Total'];
  detailHeaders.forEach((h, i) => {
    const cell = detailSheet.getCell(2, i + 1);
    cell.value = h;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: darkBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  detailSheet.getRow(2).height = 25;

  sales.forEach((sale, i) => {
    const r = 3 + i;
    const bgColor = i % 2 === 0 ? lightGold : lightGray;
    const lineTotal = sale.quantity * parseFloat(sale.price_charged);
    const time = new Date(sale.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const values = [time, sale.product_name, sale.category || '', sale.quantity, parseFloat(sale.price_charged), lineTotal];
    values.forEach((v, j) => {
      const cell = detailSheet.getCell(r, j + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor.replace('#', '') } };
      cell.alignment = { horizontal: j < 3 ? 'left' : 'center', vertical: 'middle' };
      if (j === 4 || j === 5) cell.numFmt = '"$"#,##0.00';
    });
  });

  detailSheet.columns = [
    { width: 10 }, { width: 22 }, { width: 14 }, { width: 8 }, { width: 12 }, { width: 14 },
  ];

  // Generate buffer and send
  const filename = `ForgeRealm_${session.name.replace(/[^a-zA-Z0-9]/g, '_')}_${sessionDate.replace(/\//g, '-')}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

module.exports = router;
