import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { query } from '../db';
import { Session, ProductSummary } from '../types';

interface SaleRow {
  quantity: number;
  price_charged: string;
  payment_method: string;
  timestamp: string;
  product_name: string;
  category: string | null;
}

interface StockRow {
  product_name: string;
  category: string | null;
  initial_quantity: number;
  final_quantity: number | null;
  total_sold: number;
  remaining: number;
  total_revenue: number;
}

const router = Router();

// GET /:sessionId — export session data as XLSX or CSV
router.get('/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const format = (req.query.format as string) || 'xlsx';

    // Fetch session
    const sessionResult = await query<Session>(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );
    if (sessionResult.rows.length === 0) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = sessionResult.rows[0];

    // Fetch sales with product info
    const salesResult = await query<SaleRow>(
      `SELECT sa.quantity, sa.price_charged, sa.payment_method, sa.timestamp,
              p.name AS product_name, p.category
       FROM sales sa
       JOIN products p ON p.id = sa.product_id
       WHERE sa.session_id = $1
       ORDER BY sa.timestamp ASC`,
      [sessionId]
    );
    const sales = salesResult.rows;

    // Fetch per-product summary
    const summaryResult = await query<ProductSummary>(
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

    // Fetch stock data (may be empty if never set)
    const stockResult = await query<StockRow>(
      `SELECT p.name AS product_name, p.category,
              ss.initial_quantity, ss.final_quantity,
              COALESCE(sold.total_sold, 0) AS total_sold,
              CASE
                WHEN ss.final_quantity IS NOT NULL THEN ss.final_quantity
                ELSE ss.initial_quantity - COALESCE(sold.total_sold, 0)
              END AS remaining,
              COALESCE(sold.total_revenue, 0) AS total_revenue
       FROM session_stock ss
       JOIN products p ON p.id = ss.product_id
       LEFT JOIN (
         SELECT product_id,
                SUM(quantity) AS total_sold,
                SUM(quantity * price_charged) AS total_revenue
         FROM sales
         WHERE session_id = $1
         GROUP BY product_id
       ) sold ON sold.product_id = ss.product_id
       WHERE ss.session_id = $1
       ORDER BY p.category, p.name`,
      [sessionId]
    );
    const stockRows = stockResult.rows;
    const hasStock = stockRows.length > 0;

    // Build a lookup: product_name -> stock info
    const stockByProduct: Record<string, StockRow> = {};
    for (const row of stockRows) {
      stockByProduct[row.product_name] = row;
    }

    if (format === 'csv') {
      return exportCSV(res, session, sales, summaryResult.rows, hasStock, stockByProduct, stockRows);
    }

    return exportXLSX(res, session, sales, summaryResult.rows, hasStock, stockByProduct, stockRows);
  } catch (err) {
    console.error('Error exporting:', err);
    res.status(500).json({ error: 'Failed to export session data' });
  }
});

async function exportCSV(
  res: Response,
  session: Session,
  sales: SaleRow[],
  summary: ProductSummary[],
  hasStock: boolean,
  stockByProduct: Record<string, StockRow>,
  stockRows: StockRow[]
): Promise<void> {
  const lines: string[] = [];
  const sessionDate = new Date(session.date).toLocaleDateString('en-GB');

  lines.push(`ForgeRealm POS - Sales Report`);
  lines.push(`Session: ${session.name}`);
  lines.push(`Location: ${session.location || 'N/A'}`);
  lines.push(`Date: ${sessionDate}`);
  lines.push('');

  // Product summary — include stock columns (empty if not set)
  lines.push('--- Product Summary ---');
  const headerCols = ['Product', 'Category', 'Starting Stock', 'Units Sold', 'Remaining', 'Avg Price', 'Total Revenue'];
  lines.push(headerCols.join(','));
  let grandTotal = 0;
  let grandUnits = 0;
  let grandStock = 0;
  let grandRemaining = 0;
  for (const row of summary) {
    const revenue = parseFloat(row.total_revenue);
    const units = parseInt(row.total_units);
    grandTotal += revenue;
    grandUnits += units;
    const stock = stockByProduct[row.product_name];
    const startingStock = stock ? String(parseInt(String(stock.initial_quantity))) : '';
    const remaining = stock ? String(parseInt(String(stock.remaining))) : '';
    if (stock) {
      grandStock += parseInt(String(stock.initial_quantity));
      grandRemaining += parseInt(String(stock.remaining));
    }
    lines.push(`"${row.product_name}","${row.category || ''}",${startingStock},${units},${remaining},\u00a3${parseFloat(row.avg_price).toFixed(2)},\u00a3${revenue.toFixed(2)}`);
  }

  // Include stock-only items (brought but never sold)
  if (hasStock) {
    for (const stockRow of stockRows) {
      const alreadyInSummary = summary.some(s => s.product_name === stockRow.product_name);
      if (!alreadyInSummary) {
        const initial = parseInt(String(stockRow.initial_quantity));
        grandStock += initial;
        grandRemaining += initial;
        lines.push(`"${stockRow.product_name}","${stockRow.category || ''}",${initial},0,${initial},,-`);
      }
    }
  }

  const totalStockCol = hasStock ? String(grandStock) : '';
  const totalRemainingCol = hasStock ? String(grandRemaining) : '';
  lines.push(`TOTAL,,${totalStockCol},${grandUnits},${totalRemainingCol},,\u00a3${grandTotal.toFixed(2)}`);

  if (hasStock && grandStock > 0) {
    lines.push('');
    lines.push(`Sell-through Rate,${Math.round((grandUnits / grandStock) * 100)}%`);
  }

  if (session.card_fee_applied) {
    const feeRate = parseFloat(String(session.card_fee_rate)) || 1.69;
    let cardRevenue = 0;
    for (const sale of sales) {
      if (sale.payment_method === 'card') {
        cardRevenue += sale.quantity * parseFloat(sale.price_charged);
      }
    }
    const totalFees = cardRevenue * (feeRate / 100);
    const netRevenue = grandTotal - totalFees;
    lines.push('');
    lines.push('--- Card Fee Summary ---');
    lines.push(`Card Fee Rate,${feeRate}%`);
    lines.push(`Card Revenue,\u00a3${cardRevenue.toFixed(2)}`);
    lines.push(`Total Card Fees,\u00a3${totalFees.toFixed(2)}`);
    lines.push(`Net Revenue (after fees),\u00a3${netRevenue.toFixed(2)}`);
  }

  lines.push('');

  // Individual sales
  lines.push('--- Individual Sales ---');
  lines.push('Time,Product,Category,Quantity,Price Charged,Line Total,Payment');
  for (const sale of sales) {
    const time = new Date(sale.timestamp).toLocaleTimeString('en-GB');
    const lineTotal = (sale.quantity * parseFloat(sale.price_charged)).toFixed(2);
    lines.push(`${time},"${sale.product_name}","${sale.category || ''}",${sale.quantity},\u00a3${parseFloat(sale.price_charged).toFixed(2)},\u00a3${lineTotal},${sale.payment_method}`);
  }

  const filename = `ForgeRealm_${session.name.replace(/[^a-zA-Z0-9]/g, '_')}_${sessionDate.replace(/\//g, '-')}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
}

async function exportXLSX(
  res: Response,
  session: Session,
  sales: SaleRow[],
  summary: ProductSummary[],
  hasStock: boolean,
  stockByProduct: Record<string, StockRow>,
  stockRows: StockRow[]
): Promise<void> {
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
  const purple = '7C3AED';

  // Total column count changes based on stock
  const colCount = 8; // Product, Category, Starting Stock, Units Sold, Remaining, Avg Price, Total Revenue, % of Revenue
  const lastCol = String.fromCharCode(64 + colCount); // 'H'

  // === Summary Sheet ===
  const summarySheet = workbook.addWorksheet('Summary', {
    properties: { tabColor: { argb: gold } },
  });

  // Header
  summarySheet.mergeCells(`A1:${lastCol}1`);
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = 'FORGEREALM';
  titleCell.font = { name: 'Arial', size: 22, bold: true, color: { argb: gold } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(1).height = 45;

  summarySheet.mergeCells(`A2:${lastCol}2`);
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
  summarySheet.mergeCells(`A${tableStart}:${lastCol}${tableStart}`);
  const sectionTitle = summarySheet.getCell(`A${tableStart}`);
  sectionTitle.value = 'Product Breakdown';
  sectionTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: navy } };
  sectionTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold } };
  sectionTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(tableStart).height = 30;

  const headerRow = tableStart + 1;
  const headers = ['Product', 'Category', 'Starting Stock', 'Units Sold', 'Remaining', 'Avg Price', 'Total Revenue', '% of Revenue'];
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
  let grandStock = 0;
  let grandRemaining = 0;
  summary.forEach(r => { grandTotal += parseFloat(r.total_revenue); grandUnits += parseInt(r.total_units); });

  // Build combined rows: sales summary + unsold stock items
  interface CombinedRow {
    product_name: string;
    category: string | null;
    starting_stock: number | null;
    units_sold: number;
    remaining: number | null;
    avg_price: number | null;
    revenue: number;
  }

  const combinedRows: CombinedRow[] = [];
  const addedProducts = new Set<string>();

  for (const row of summary) {
    const stock = stockByProduct[row.product_name];
    const startingStock = stock ? parseInt(String(stock.initial_quantity)) : null;
    const remaining = stock ? parseInt(String(stock.remaining)) : null;
    if (stock) {
      grandStock += parseInt(String(stock.initial_quantity));
      grandRemaining += parseInt(String(stock.remaining));
    }
    combinedRows.push({
      product_name: row.product_name,
      category: row.category,
      starting_stock: startingStock,
      units_sold: parseInt(row.total_units),
      remaining,
      avg_price: parseFloat(row.avg_price),
      revenue: parseFloat(row.total_revenue),
    });
    addedProducts.add(row.product_name);
  }

  // Add stock-only items (brought but zero sales)
  if (hasStock) {
    for (const stockRow of stockRows) {
      if (!addedProducts.has(stockRow.product_name)) {
        const initial = parseInt(String(stockRow.initial_quantity));
        grandStock += initial;
        grandRemaining += initial;
        combinedRows.push({
          product_name: stockRow.product_name,
          category: stockRow.category,
          starting_stock: initial,
          units_sold: 0,
          remaining: initial,
          avg_price: null,
          revenue: 0,
        });
      }
    }
  }

  combinedRows.forEach((row, i) => {
    const r = headerRow + 1 + i;
    const bgColor = i % 2 === 0 ? lightGold : lightGray;

    // cols: Product, Category, Starting Stock, Units Sold, Remaining, Avg Price, Total Revenue, % of Revenue
    const values: (string | number | null)[] = [
      row.product_name,
      row.category || '',
      row.starting_stock,
      row.units_sold,
      row.remaining,
      row.avg_price,
      row.revenue,
      grandTotal > 0 ? row.revenue / grandTotal : 0,
    ];

    values.forEach((v, j) => {
      const cell = summarySheet.getCell(r, j + 1);
      cell.value = v === null ? '' : v;
      cell.font = { name: 'Arial', size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor.replace('#', '') } };
      cell.alignment = { horizontal: j < 2 ? 'left' : 'center', vertical: 'middle' };

      if (j === 5 || j === 6) cell.numFmt = '"£"#,##0.00';
      if (j === 7) cell.numFmt = '0.0%';

      // Highlight remaining column with color
      if (j === 4 && v !== null && v !== '') {
        const rem = v as number;
        if (rem === 0) {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: '16A34A' } }; // green
        } else if (rem < 0) {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'CC0000' } }; // red
        }
      }

      // Purple tint for stock columns if stock is set
      if ((j === 2 || j === 4) && v !== null && v !== '' && hasStock) {
        cell.font = { ...cell.font, color: { argb: purple } };
      }
    });
  });

  // Totals row
  const totalsRow = headerRow + 1 + combinedRows.length;
  const totalsData: (string | number)[] = [
    'TOTAL', '',
    hasStock ? grandStock : '',
    grandUnits,
    hasStock ? grandRemaining : '',
    '',
    grandTotal,
    grandTotal > 0 ? 1 : 0,
  ] as (string | number)[];
  totalsData.forEach((v, j) => {
    const cell = summarySheet.getCell(totalsRow, j + 1);
    cell.value = v;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: navy } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold } };
    cell.alignment = { horizontal: j < 2 ? 'left' : 'center', vertical: 'middle' };
    if (j === 6) cell.numFmt = '"£"#,##0.00';
    if (j === 7) cell.numFmt = '0.0%';
    cell.border = { top: { style: 'medium', color: { argb: navy } } };
  });
  summarySheet.getRow(totalsRow).height = 28;

  let nextSectionStart = totalsRow + 2;

  // Sell-through rate (if stock was tracked)
  if (hasStock && grandStock > 0) {
    const sellRow = nextSectionStart;
    const labelCell = summarySheet.getCell(`A${sellRow}`);
    labelCell.value = 'Sell-through Rate';
    labelCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: purple } };
    const valCell = summarySheet.getCell(`B${sellRow}`);
    valCell.value = grandUnits / grandStock;
    valCell.numFmt = '0%';
    valCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: purple } };
    nextSectionStart = sellRow + 2;
  }

  // Card fee section
  if (session.card_fee_applied) {
    const feeRate = parseFloat(String(session.card_fee_rate)) || 1.69;
    let cardRevenue = 0;
    for (const sale of sales) {
      if (sale.payment_method === 'card') {
        cardRevenue += sale.quantity * parseFloat(sale.price_charged);
      }
    }
    const totalFees = cardRevenue * (feeRate / 100);
    const netRevenue = grandTotal - totalFees;

    const feeStart = nextSectionStart;
    summarySheet.mergeCells(`A${feeStart}:${lastCol}${feeStart}`);
    const feeTitle = summarySheet.getCell(`A${feeStart}`);
    feeTitle.value = 'Card Fee Summary (SumUp)';
    feeTitle.font = { name: 'Arial', size: 12, bold: true, color: { argb: navy } };
    feeTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold } };
    feeTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    summarySheet.getRow(feeStart).height = 28;

    const feeRows = [
      ['Card Fee Rate', `${feeRate}%`],
      ['Card Revenue (gross)', cardRevenue],
      ['Total Card Fees', totalFees],
      ['Net Revenue (after fees)', netRevenue],
    ];

    feeRows.forEach(([label, value], i) => {
      const r = feeStart + 1 + i;
      const bgColor = i % 2 === 0 ? lightGold : lightGray;
      const labelCell = summarySheet.getCell(`A${r}`);
      labelCell.value = label;
      labelCell.font = { name: 'Arial', size: 10, bold: i === 3, color: i === 3 ? { argb: navy } : undefined };
      labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor.replace('#', '') } };

      const valCell = summarySheet.getCell(`B${r}`);
      valCell.value = value;
      valCell.font = { name: 'Arial', size: 10, bold: i === 3, color: i === 2 ? { argb: 'CC0000' } : i === 3 ? { argb: navy } : undefined };
      valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor.replace('#', '') } };
      if (typeof value === 'number') valCell.numFmt = '"£"#,##0.00';
    });
  }

  // Column widths
  summarySheet.columns = [
    { width: 22 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 },
  ];

  // === Sales Detail Sheet ===
  const detailSheet = workbook.addWorksheet('Sales Detail', {
    properties: { tabColor: { argb: navy } },
  });

  detailSheet.mergeCells('A1:G1');
  const detailTitle = detailSheet.getCell('A1');
  detailTitle.value = `${session.name} - Individual Sales`;
  detailTitle.font = { name: 'Arial', size: 16, bold: true, color: { argb: gold } };
  detailTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  detailTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  detailSheet.getRow(1).height = 35;

  const detailHeaders = ['Time', 'Product', 'Category', 'Qty', 'Price', 'Line Total', 'Payment'];
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

    const values: (string | number)[] = [time, sale.product_name, sale.category || '', sale.quantity, parseFloat(sale.price_charged), lineTotal, sale.payment_method.toUpperCase()];
    values.forEach((v, j) => {
      const cell = detailSheet.getCell(r, j + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor.replace('#', '') } };
      cell.alignment = { horizontal: j < 3 ? 'left' : 'center', vertical: 'middle' };
      if (j === 4 || j === 5) cell.numFmt = '"£"#,##0.00';
    });
  });

  detailSheet.columns = [
    { width: 10 }, { width: 22 }, { width: 14 }, { width: 8 }, { width: 12 }, { width: 14 }, { width: 10 },
  ];

  // Generate buffer and send
  const filename = `ForgeRealm_${session.name.replace(/[^a-zA-Z0-9]/g, '_')}_${sessionDate.replace(/\//g, '-')}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

export default router;
