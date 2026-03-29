const path = window.location.pathname;
const slug = path.split('/').filter(Boolean).pop();

const titleEl = document.getElementById('title');
const formEl = document.getElementById('dynamicForm');
const statusEl = document.getElementById('status');
const templateLinkEl = document.getElementById('templateLink');

function fieldToInput(field) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = `${field.label}${field.required ? ' *' : ''}`;

  let input;
  if (field.type === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.name = field.key;
  } else {
    input = document.createElement('input');
    input.type = field.type || 'text';
    input.name = field.key;
    if (field.required) input.required = true;
  }

  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
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

  formData.fields.forEach((f) => {
    formEl.appendChild(fieldToInput(f));
  });

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = 'Invia modulo';
  formEl.appendChild(submitBtn);

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(formEl);
    const values = {};

    formData.fields.forEach((f) => {
      if (f.type === 'checkbox') {
        values[f.key] = fd.get(f.key) ? 'true' : 'false';
      } else {
        values[f.key] = fd.get(f.key) || '';
      }
    });

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

    statusEl.textContent = '✅ Modulo inviato con successo!';
    formEl.reset();
  });
}

init();
