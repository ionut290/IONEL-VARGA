const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'forms.json');

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.join(__dirname, 'uploads')),
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

function ensureDataFile() {
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

async function sendSubmissionEmail({ receiverEmail, formTitle, values }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('[EMAIL DISABILITATA] Configura SMTP_* nel file .env');
    console.log('Destinatario:', receiverEmail);
    console.log('Modulo:', formTitle);
    console.log('Valori:', values);
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
        detectedFields = parsedFields;
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
      fields: detectedFields,
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
    const missing = requiredFields.filter((f) => values[f.key] === undefined || values[f.key] === '');

    if (missing.length > 0) {
      return res.status(400).json({ error: `Campi obbligatori mancanti: ${missing.map((m) => m.label).join(', ')}` });
    }

    const submission = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      values,
      submittedAt: new Date().toISOString(),
    };

    form.submissions.push(submission);
    saveData(data);

    await sendSubmissionEmail({
      receiverEmail: form.receiverEmail,
      formTitle: form.title,
      values,
    });

    res.status(201).json({ ok: true, submissionId: submission.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Errore invio modulo.' });
  }
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
