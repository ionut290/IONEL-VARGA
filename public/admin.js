import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

const formEl = document.getElementById('createForm');
const listEl = document.getElementById('list');
const templateInput = document.getElementById('templateInput');
const adminPdfPages = document.getElementById('adminPdfPages');
const fieldsListEl = document.getElementById('fieldsList');
const fieldsJsonEl = document.getElementById('fieldsJson');

const fieldLabelEl = document.getElementById('fieldLabel');
const fieldKeyEl = document.getElementById('fieldKey');
const fieldTypeEl = document.getElementById('fieldType');
const fieldRequiredEl = document.getElementById('fieldRequired');
const armFieldBtn = document.getElementById('armFieldBtn');

const placedFields = [];
let pendingField = null;

function slugifyLocal(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)+/g, '');
}

function refreshFieldsList() {
  fieldsListEl.innerHTML = '';

  placedFields.forEach((f, idx) => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <strong>${f.label}</strong>
      <div class="small">key: <span class="code">${f.key}</span> - type: ${f.type} - req: ${f.required ? 'si' : 'no'}</div>
      <div class="small">pagina ${f.page} (x:${f.x.toFixed(3)}, y:${f.y.toFixed(3)}, w:${f.width.toFixed(3)}, h:${f.height.toFixed(3)})</div>
    `;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Rimuovi';
    removeBtn.addEventListener('click', () => {
      placedFields.splice(idx, 1);
      refreshFieldsList();
      redrawOverlayMarkers();
    });

    div.appendChild(removeBtn);
    fieldsListEl.appendChild(div);
  });

  fieldsJsonEl.value = JSON.stringify(placedFields);
}

function markerForField(field) {
  const m = document.createElement('div');
  m.className = 'placed-marker';
  m.style.left = `${field.x * 100}%`;
  m.style.top = `${field.y * 100}%`;
  m.style.width = `${field.width * 100}%`;
  m.style.height = `${field.height * 100}%`;
  m.textContent = field.label;
  return m;
}

function redrawOverlayMarkers() {
  const overlays = adminPdfPages.querySelectorAll('.page-overlay');
  overlays.forEach((ov) => {
    ov.querySelectorAll('.placed-marker').forEach((m) => m.remove());
    const page = Number(ov.dataset.page);
    placedFields.filter((f) => f.page === page).forEach((f) => ov.appendChild(markerForField(f)));
  });
}

async function renderAdminPdf(file) {
  if (!file || file.type !== 'application/pdf') {
    adminPdfPages.innerHTML = '<p class="small">Anteprima disponibile solo per PDF.</p>';
    return;
  }

  const url = URL.createObjectURL(file);
  const loadingTask = pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;

  adminPdfPages.innerHTML = '';

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.1 });

    const pageWrap = document.createElement('section');
    pageWrap.className = 'pdf-page';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const overlay = document.createElement('div');
    overlay.className = 'page-overlay admin-overlay';
    overlay.dataset.page = String(i);

    overlay.addEventListener('click', (e) => {
      if (!pendingField) return;
      const rect = overlay.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      const width = pendingField.type === 'checkbox' ? 0.03 : 0.24;
      const height = pendingField.type === 'checkbox' ? 0.035 : 0.035;

      placedFields.push({
        ...pendingField,
        page: Number(overlay.dataset.page),
        x: Math.min(Math.max(x, 0), 0.98),
        y: Math.min(Math.max(y, 0), 0.98),
        width,
        height,
      });

      pendingField = null;
      armFieldBtn.textContent = '1) Seleziona campo da piazzare';
      refreshFieldsList();
      redrawOverlayMarkers();
    });

    pageWrap.appendChild(canvas);
    pageWrap.appendChild(overlay);
    adminPdfPages.appendChild(pageWrap);
  }

  redrawOverlayMarkers();
}

async function loadForms() {
  const res = await fetch('/api/forms');
  const forms = await res.json();

  listEl.innerHTML = '';
  forms.slice().reverse().forEach((f) => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <strong>${f.title}</strong>
      <div class="small">Slug: <span class="code">${f.slug}</span></div>
      <div class="small">Destinatario: ${f.receiverEmail}</div>
      <div class="small">Campi: ${f.fields.map((x) => x.label).join(', ')}</div>
      <div><a href="/f/${f.slug}" target="_blank">Apri link cliente</a></div>
    `;
    listEl.appendChild(div);
  });
}

templateInput.addEventListener('change', async () => {
  const file = templateInput.files?.[0];
  await renderAdminPdf(file);
});

armFieldBtn.addEventListener('click', () => {
  const label = fieldLabelEl.value.trim();
  const key = slugifyLocal(fieldKeyEl.value || label);
  if (!label || !key) {
    alert('Inserisci almeno label e key del campo.');
    return;
  }

  pendingField = {
    label,
    key,
    type: fieldTypeEl.value || 'text',
    required: fieldRequiredEl.checked,
  };

  armFieldBtn.textContent = `Campo pronto: ${label}. Clicca sul PDF`;
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  refreshFieldsList();

  const fd = new FormData(formEl);
  const res = await fetch('/api/forms', { method: 'POST', body: fd });
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'Errore creazione modulo');
    return;
  }

  alert(`Modulo creato! Link cliente: /f/${data.slug}`);
  formEl.reset();
  placedFields.length = 0;
  fieldsJsonEl.value = '';
  adminPdfPages.innerHTML = '';
  refreshFieldsList();
  await loadForms();
});

refreshFieldsList();
loadForms();
