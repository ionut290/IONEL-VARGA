import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

const path = window.location.pathname;
const slug = path.split('/').filter(Boolean).pop();

const titleEl = document.getElementById('title');
const formEl = document.getElementById('dynamicForm');
const statusEl = document.getElementById('status');
const templateLinkEl = document.getElementById('templateLink');
const pdfPagesEl = document.getElementById('pdfPages');
const fallbackFieldsEl = document.getElementById('fallbackFields');

const pageLayers = new Map();

function fieldToInput(field) {
  const wrap = document.createElement('div');
  wrap.className = 'field-row';

  const label = document.createElement('label');
  label.textContent = `${field.label}${field.required ? ' *' : ''}`;
  label.setAttribute('for', `field_${field.key}`);

  let input;
  if (field.type === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.name = field.key;
    input.id = `field_${field.key}`;
  } else {
    input = document.createElement('input');
    input.type = field.type || 'text';
    input.name = field.key;
    input.id = `field_${field.key}`;
    if (field.required) input.required = true;
  }

  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

function createOverlayInput(field) {
  const input = document.createElement('input');
  input.name = field.key;
  input.title = field.label;
  input.className = 'overlay-input';

  if (field.type === 'checkbox') {
    input.type = 'checkbox';
    input.classList.add('overlay-checkbox');
  } else {
    input.type = field.type || 'text';
  }

  if (field.required && field.type !== 'checkbox') {
    input.required = true;
  }

  input.style.left = `${field.x * 100}%`;
  input.style.top = `${field.y * 100}%`;
  input.style.width = `${(field.width || 0.2) * 100}%`;
  input.style.height = `${(field.height || 0.03) * 100}%`;

  return input;
}

async function renderPdfPages(templatePath) {
  const loadingTask = pdfjsLib.getDocument(templatePath);
  const pdf = await loadingTask.promise;

  pdfPagesEl.innerHTML = '';
  pageLayers.clear();

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.25 });

    const pageWrap = document.createElement('section');
    pageWrap.className = 'pdf-page';
    pageWrap.dataset.page = String(i);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const overlay = document.createElement('div');
    overlay.className = 'page-overlay';

    pageWrap.appendChild(canvas);
    pageWrap.appendChild(overlay);
    pdfPagesEl.appendChild(pageWrap);

    pageLayers.set(i, overlay);
  }
}

function placeFields(formData) {
  const positioned = formData.fields.filter(
    (f) => Number.isFinite(f.page) && Number.isFinite(f.x) && Number.isFinite(f.y),
  );
  const unpositioned = formData.fields.filter((f) => !positioned.includes(f));

  positioned.forEach((f) => {
    const overlay = pageLayers.get(f.page);
    if (!overlay) return;
    overlay.appendChild(createOverlayInput(f));
  });

  fallbackFieldsEl.innerHTML = '';
  unpositioned.forEach((f) => {
    fallbackFieldsEl.appendChild(fieldToInput(f));
  });
}

function collectValues(fields) {
  const values = {};
  fields.forEach((f) => {
    const input = formEl.querySelector(`[name="${f.key}"]`);
    if (!input) {
      values[f.key] = '';
      return;
    }

    if (f.type === 'checkbox') {
      values[f.key] = input.checked ? 'true' : 'false';
    } else {
      values[f.key] = input.value || '';
    }
  });
  return values;
}

async function init() {
  const res = await fetch(`/api/forms/${slug}`);
  const formData = await res.json();

  if (!res.ok) {
    statusEl.textContent = formData.error || 'Modulo non trovato';
    return;
  }

  titleEl.textContent = formData.title;

  if (formData.templatePath) {
    templateLinkEl.innerHTML = `<p class="small">Template allegato: <a href="${formData.templatePath}" target="_blank">Apri file</a></p>`;
  }

  const isPdf = Boolean(formData.templatePath && formData.templatePath.toLowerCase().endsWith('.pdf'));
  if (isPdf) {
    await renderPdfPages(formData.templatePath);
  }

  placeFields(formData);

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';

    const values = collectValues(formData.fields);
    const missingRequired = formData.fields.filter((f) => {
      if (!f.required) return false;
      if (f.type === 'checkbox') return values[f.key] !== 'true';
      return !String(values[f.key] || '').trim();
    });

    if (missingRequired.length > 0) {
      statusEl.textContent = `Campi obbligatori mancanti: ${missingRequired.map((f) => f.label).join(', ')}`;
      return;
    }

    const submitRes = await fetch(`/api/forms/${slug}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    const out = await submitRes.json();
    if (!submitRes.ok) {
      statusEl.textContent = out.error || 'Errore invio';
      return;
    }

    statusEl.textContent = out.filledPdfPath
      ? `✅ Modulo inviato con successo! PDF: ${out.filledPdfPath}`
      : '✅ Modulo inviato con successo!';
    formEl.reset();
  });
}

init();
