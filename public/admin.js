const formEl = document.getElementById('createForm');
const listEl = document.getElementById('list');

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

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(formEl);

  const res = await fetch('/api/forms', { method: 'POST', body: fd });
  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'Errore creazione modulo');
    return;
  }

  alert(`Modulo creato! Link cliente: /f/${data.slug}`);
  formEl.reset();
  await loadForms();
});

loadForms();
