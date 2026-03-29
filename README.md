# Moduli + invio email (auto-rilevamento campi)

Applicazione web dove:
1. L'admin crea un modulo.
2. Può allegare un template PDF/immagine.
3. L'app rileva automaticamente campi comuni dal PDF (nome, email, privacy, firma...).
4. Il cliente compila il modulo da link pubblico.
5. L'invio viene salvato e inviato via email all'indirizzo configurato nel modulo.

## Avvio

```bash
npm install
cp .env.example .env
npm run dev
```

Apri:
- Admin: `http://localhost:3000/admin`
- Form cliente: `http://localhost:3000/f/<slug>`

## Note

- Se SMTP non è configurato, l'app non manda email ma registra comunque la submission e scrive i dati in log console.
- I dati sono salvati in `data/forms.json`.
- Upload file in `uploads/`.

## API principali

- `GET /api/forms` lista moduli
- `POST /api/forms` crea modulo (`multipart/form-data` con `title`, `receiverEmail`, `template`)
- `GET /api/forms/:slug` dettaglio modulo
- `POST /api/forms/:slug/submit` invio compilazione
