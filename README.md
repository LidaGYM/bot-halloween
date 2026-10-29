# bot-halloween

Monitor de reacciones para el Padlet "Halloween Indra 2026". Compara tu publicación con la rival y **te avisa** (Telegram y/o Slack/Discord) cuando la ventaja baja del umbral, hay empate o vas perdiendo. No reacciona por ti.

## Uso

```bash
npm install
npx playwright install chromium
cp .env.example .env   # edita umbral y notificaciones
npm run once           # una sola lectura
npm start              # vigila cada INTERVALO_SEG segundos
```

## Si no lee las reacciones

Padlet cambia su HTML. Ejecuta `npm run debug`: guarda `debug/*.html` y capturas. Busca el elemento que muestra el contador de reacciones y ponlo en `REACTION_SELECTOR` (por ejemplo `button[aria-label*="Like"]`).
