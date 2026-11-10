const coreColumns = ['kind', 'title', 'description', 'status', 'dueDate', 'amount', 'currency'];
const coreColumnNames = coreColumns.map(column => column.toLowerCase());
const defaultDataColumns = ['company', 'contactName', 'email', 'phone', 'source', 'industry'];
const maxRecords = 500;

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safeText = typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character === '"') {
      if (field) throw new Error('CSV contains a quote in an unquoted field.');
      quoted = true;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCrmCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Choose a non-empty CSV file.');
  const rows = parseRows(text.replace(/^\uFEFF/, ''));
  const headers = rows.shift()?.map(header => header.trim()) || [];
  if (!headers.length || headers.some(header => !header)) throw new Error('CSV must have non-empty column names.');

  const normalizedHeaders = headers.map(header => header.toLowerCase());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) throw new Error('CSV contains duplicate column names.');
  if (!normalizedHeaders.includes('kind') || !normalizedHeaders.includes('title')) {
    throw new Error('CSV must include kind and title columns.');
  }
  if (headers.length > 100) throw new Error('CSV cannot contain more than 100 columns.');

  const records = [];
  for (const [index, cells] of rows.entries()) {
    if (cells.every(cell => !cell.trim())) continue;
    if (records.length >= maxRecords) throw new Error(`CSV cannot contain more than ${maxRecords} records.`);
    if (cells.length > headers.length) throw new Error(`CSV row ${index + 2} has more values than the header.`);
    const values = Object.fromEntries(headers.map((header, column) => [header, cells[column] || '']));
    const coreValue = column => values[headers[normalizedHeaders.indexOf(column.toLowerCase())]];
    const input = {
      kind: (coreValue('kind') || '').trim().toLowerCase(),
      title: (coreValue('title') || '').trim(),
      data: {}
    };

    for (const column of coreColumns.slice(2)) {
      const value = coreValue(column)?.trim();
      if (value) input[column] = value;
    }
    if (input.status) input.status = input.status.toUpperCase();
    if (input.currency) input.currency = input.currency.toUpperCase();
    if (input.amount !== undefined) {
      input.amount = Number(input.amount);
      if (!Number.isFinite(input.amount)) throw new Error(`CSV row ${index + 2} has an invalid amount.`);
    }
    for (const header of headers) {
      const lowerHeader = header.toLowerCase();
      if (coreColumnNames.includes(lowerHeader)) continue;
      const key = lowerHeader.startsWith('data.') ? header.slice(5) : header;
      const value = values[header].trim();
      if (value) input.data[key] = value;
    }
    records.push(input);
  }

  if (!records.length) throw new Error('CSV does not contain any records to import.');
  return records;
}

export function serializeCrmCsv(records) {
  const keys = new Set(defaultDataColumns);
  for (const record of records) {
    const data = record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
    for (const key of Object.keys(data)) keys.add(key);
  }
  const dataColumns = [
    ...defaultDataColumns.filter(key => keys.has(key)),
    ...[...keys].filter(key => !defaultDataColumns.includes(key)).sort((left, right) => left.localeCompare(right))
  ];
  const headers = [...coreColumns, ...dataColumns.map(key => `data.${key}`)];
  const lines = [headers.map(csvCell).join(',')];

  for (const record of records) {
    const data = record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
    const values = [
      record.kind,
      record.title,
      record.description,
      record.status,
      record.dueDate ? new Date(record.dueDate).toISOString().slice(0, 10) : '',
      record.amount,
      record.currency || 'INR',
      ...dataColumns.map(key => data[key])
    ];
    lines.push(values.map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
