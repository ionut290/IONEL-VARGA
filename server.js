const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const nodemailer = require('nodemailer');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'forms.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SUBMISSIONS_DIR = path.join(UPLOADS_DIR, 'submissions');

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
    cb(null, safeName);
  },
});

const upload = multer({ storage });

const DEFAULT_FIELDS = [
  { key: 'nome', label: 'Nome', type: 'text', required: true },
  { key: 'cognome', label: 'Cognome', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'telefono', label: 'Telefono', type: 'text', required: false },
  { key: 'data', label: 'Data', type: 'date', required: false },
  { key: 'firma', label: 'Firma', type: 'text', required: false },
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureDataFile() {
  ensureDir(path.dirname(DATA_FILE));
  ensureDir(UPLOADS_DIR);
  ensureDir(SUBMISSIONS_DIR);
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ forms: [] }, null, 2));
  }
}

function loadData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function normalizeField(field = {}, idx = 0) {
  const normalized = {
    key: String(field.key || `field_${idx + 1}`).trim(),
    label: String(field.label || field.key || `Campo ${idx + 1}`).trim(),
    type: field.type || 'text',
    required: Boolean(field.required),
  };

  if (Number.isFinite(field.page)) normalized.page = field.page;
  if (Number.isFinite(field.x)) normalized.x = field.x;
  if (Number.isFinite(field.y)) normalized.y = field.y;
  if (Number.isFinite(field.width)) normalized.width = field.width;
  if (Number.isFinite(field.height)) normalized.height = field.height;

  return normalized;
}

function detectFieldsFromText(text = '') {
  const lower = text.toLowerCase();
  const fields = [];

  const fieldMap = [
    { tokens: ['nome'], field: { key: 'nome', label: 'Nome', type: 'text' } },
    { tokens: ['cognome'], field: { key: 'cognome', label: 'Cognome', type: 'text' } },
    { tokens: ['email', 'e-mail'], field: { key: 'email', label: 'Email', type: 'email' } },
    { tokens: ['telefono', 'cellulare'], field: { key: 'telefono', label: 'Telefono', type: 'text' } },
    { tokens: ['indirizzo'], field: { key: 'indirizzo', label: 'Indirizzo', type: 'text' } },
    { tokens: ['data'], field: { key: 'data', label: 'Data', type: 'date' } },
    { tokens: ['privacy', 'consenso'], field: { key: 'privacy', label: 'Accetto Privacy', type: 'checkbox' } },
    { tokens: ['firma', 'signature'], field: { key: 'firma', label: 'Firma', type: 'text' } },
  ];

  for (const entry of fieldMap) {
    if (entry.tokens.some((t) => lower.includes(t))) {
      fields.push({ ...entry.field, required: entry.field.key !== 'privacy' });
    }
  }

  if (fields.length === 0) {
    return DEFAULT_FIELDS;
  }

  const unique = [];
  const seen = new Set();
  for (const f of fields) {
    if (!seen.has(f.key)) {
      seen.add(f.key);
      unique.push(f);
    }
  }

  return unique;
}

async function parsePdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(buffer);
  return parsed.text || '';
}

async function generateFilledPdf(form, values) {
  if (!form.templatePath || !form.templatePath.toLowerCase().endsWith('.pdf')) return null;

  const sourcePath = path.join(__dirname, form.templatePath.replace(/^\//, ''));
  if (!fs.existsSync(sourcePath)) return null;

  const pdfBytes = fs.readFileSync(sourcePath);
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const drawableFields = (form.fields || []).filter(
    (f) => Number.isFinite(f.page) && Number.isFinite(f.x) && Number.isFinite(f.y),
  );

  drawableFields.forEach((f) => {
    const page = pages[f.page - 1];
    if (!page) return;
    const { width, height } = page.getSize();

    const boxW = Math.max((f.width || 0.2) * width, 12);
    const boxH = Math.max((f.height || 0.03) * height, 12);
    const x = f.x * width;
    const y = height - (f.y * height) - boxH;
    const rawVal = values[f.key];
    const val = rawVal == null ? '' : String(rawVal);

    if (f.type === 'checkbox') {
      page.drawRectangle({
        x,
        y,
        width: boxH,
        height: boxH,
        borderWidth: 1,
        borderColor: rgb(0.2, 0.2, 0.2),
      });
      if (val === 'true' || val === '1' || val.toLowerCase() === 'on') {
        page.drawText('X', { x: x + 3, y: y + 1, size: Math.max(boxH - 3, 8), font });
      }
    } else {
      page.drawText(val, {
        x: x + 2,
        y: y + Math.max(boxH / 3, 8),
        size: Math.min(Math.max(boxH - 4, 9), 14),
        font,
        color: rgb(0, 0, 0),
        maxWidth: Math.max(boxW - 4, 20),
      });
    }
  });

  const outName = `${form.slug}-${Date.now()}.pdf`;
  const outPath = path.join(SUBMISSIONS_DIR, outName);
  const outBytes = await doc.save();
  fs.writeFileSync(outPath, outBytes);

  return {
    path: outPath,
    publicPath: `/uploads/submissions/${outName}`,
    filename: outName,
  };
}

async function sendSubmissionEmail({ receiverEmail, formTitle, values, attachment }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('[EMAIL DISABILITATA] Configura SMTP_* nel file .env');
    console.log('Destinatario:', receiverEmail);
    console.log('Modulo:', formTitle);
    console.log('Valori:', values);
    if (attachment?.path) {
      console.log('PDF compilato salvato in:', attachment.path);
    }
    return { skipped: true };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const htmlBody = `
    <h2>Nuovo invio modulo: ${formTitle}</h2>
    <ul>
      ${Object.entries(values)
        .map(([k, v]) => `<li><strong>${k}</strong>: ${String(v)}</li>`)
        .join('')}
    </ul>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: receiverEmail,
    subject: `Nuovo invio - ${formTitle}`,
    html: htmlBody,
    attachments: attachment?.path
      ? [
          {
            filename: attachment.filename || 'modulo-compilato.pdf',
            path: attachment.path,
          },
        ]
      : [],
  });

  return { skipped: false };
}

app.get('/api/forms', (_, res) => {
  const data = loadData();
  res.json(data.forms);
});

app.post('/api/forms', upload.single('template'), async (req, res) => {
  try {
    const { title, receiverEmail } = req.body;

    if (!title || !receiverEmail) {
      return res.status(400).json({ error: 'title e receiverEmail sono obbligatori.' });
    }

    let detectedFields = DEFAULT_FIELDS;
    let templatePath = null;

    if (req.file) {
      templatePath = `/uploads/${req.file.filename}`;
      if (req.file.mimetype === 'application/pdf') {
        const text = await parsePdfText(req.file.path);
        detectedFields = detectFieldsFromText(text);
      }
    }

    if (req.body.fieldsJson) {
      const parsedFields = JSON.parse(req.body.fieldsJson);
      if (Array.isArray(parsedFields) && parsedFields.length > 0) {
        detectedFields = parsedFields.map(normalizeField);
      }
    }

    const data = loadData();
    const id = Date.now().toString();
    const slugBase = slugify(title);
    const existingSlugs = new Set(data.forms.map((f) => f.slug));
    let slug = slugBase;
    let i = 2;
    while (existingSlugs.has(slug)) {
      slug = `${slugBase}-${i++}`;
    }

    const form = {
      id,
      title,
      slug,
      receiverEmail,
      templatePath,
      fields: detectedFields.map(normalizeField),
      submissions: [],
      createdAt: new Date().toISOString(),
    };

    data.forms.push(form);
    saveData(data);

    res.status(201).json(form);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Errore creazione modulo.' });
  }
});

app.get('/api/forms/:slug', (req, res) => {
  const { slug } = req.params;
  const data = loadData();
  const form = data.forms.find((f) => f.slug === slug);
  if (!form) return res.status(404).json({ error: 'Modulo non trovato.' });
  res.json(form);
});

app.post('/api/forms/:slug/submit', async (req, res) => {
  try {
    const { slug } = req.params;
    const values = req.body || {};

    const data = loadData();
    const form = data.forms.find((f) => f.slug === slug);
    if (!form) return res.status(404).json({ error: 'Modulo non trovato.' });

    const requiredFields = form.fields.filter((f) => f.required);
    const missing = requiredFields.filter((f) => {
      if (f.type === 'checkbox') return values[f.key] !== 'true' && values[f.key] !== true;
      return values[f.key] === undefined || values[f.key] === '';
    });

    if (missing.length > 0) {
      return res.status(400).json({ error: `Campi obbligatori mancanti: ${missing.map((m) => m.label).join(', ')}` });
    }

    const generatedPdf = await generateFilledPdf(form, values);

    const submission = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      values,
      filledPdfPath: generatedPdf?.publicPath || null,
      submittedAt: new Date().toISOString(),
    };

    form.submissions.push(submission);
    saveData(data);

    await sendSubmissionEmail({
      receiverEmail: form.receiverEmail,
      formTitle: form.title,
      values,
      attachment: generatedPdf,
    });

    res.status(201).json({ ok: true, submissionId: submission.id, filledPdfPath: submission.filledPdfPath });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Errore invio modulo.' });
  }
});


app.get('/', (_, res) => {
  res.redirect('/admin');
});

app.get('/admin', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/f/:slug', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'form.html'));
});

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`Server avviato su http://localhost:${PORT}`);
});
